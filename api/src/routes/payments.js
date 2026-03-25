const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const logger = require('../lib/logger');
const pushQueue = require('../lib/pushQueue');
const fetch = require('node-fetch');
const crypto = require('crypto');
const piApi = require('../lib/piApi');
const { getUserById } = require('../lib/userResolver');

// POST /api/payments/webhook
// Minimal, idempotent webhook handler for payment provider confirmations.
router.post('/webhook', express.json(), async (req, res) => {
  try {
    // Log incoming webhook to webhook_logs for observability and idempotency tracking
    let logId = null;
    try {
      const { data: logRow, error: logErr } = await supabase
        .from('webhook_logs')
        .insert({ provider: req.body.provider || null, provider_tx_id: req.body.provider_tx_id || null, payload: req.body, status: 'received', escrow_id: req.body.escrow_id || null, user_id: req.body.user_id || null })
        .select()
        .maybeSingle();
      if (!logErr && logRow) logId = logRow.id;
    } catch (e) {
      logger.warn('[payments.webhook] failed to write webhook_log: %o', e?.message || e);
    }
    const secret = process.env.PAYMENT_WEBHOOK_SECRET || '';
    const sigHeader = req.headers['x-provider-signature'] || req.headers['x-provider-signature-256'] || '';

    // Basic HMAC verification when secret present
    if (secret && sigHeader) {
      const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
      if (Array.isArray(sigHeader) ? !sigHeader.includes(expected) : sigHeader !== expected) {
        logger.warn('[payments.webhook] invalid signature');
        return res.status(400).json({ success: false, error: 'invalid signature' });
      }
    }

    const payload = req.body || {};
    // Expect provider, provider_tx_id, status, escrow_id, user_id, amount
    const provider = payload.provider || payload.gateway || 'provider';
    const providerTx = payload.provider_tx_id || payload.tx_id || payload.id || null;
    const status = (payload.status || payload.state || '').toString().toLowerCase();
    const escrowId = payload.escrow_id || payload.escrowId || null;
    const userId = payload.user_id || payload.userId || payload.user || null;
    const amount = payload.amount || null;

    if (!providerTx || !status) {
      logger.warn('[payments.webhook] missing provider tx or status');
      try { if (logId) await supabase.from('webhook_logs').update({ processed: true, processed_at: new Date().toISOString(), status: 'invalid', attempt_result: 'missing_provider_tx_or_status' }).eq('id', logId); } catch(_) {}
      return res.status(400).json({ success: false, error: 'missing provider tx or status' });
    }

    // Find or create payment_attempt row
    const { data: existing } = await supabase.from('payment_attempts').select('*').match({ provider, provider_tx_id: providerTx }).limit(1).maybeSingle();

    let attemptId = existing?.id;
    if (!existing) {
      const { data: ins, error: insErr } = await supabase.from('payment_attempts').insert({ provider, provider_tx_id: providerTx, escrow_id: escrowId, user_id: userId, amount, status: 'pending', metadata: payload }).select().maybeSingle();
      if (insErr) logger.warn('[payments.webhook] failed to insert attempt: %o', insErr);
      attemptId = ins?.id;
    }

    // Idempotent: if already approved/failed, ignore if same status
    if (existing && existing.status === 'approved' && status === 'success') {
      return res.json({ success: true, message: 'already processed' });
    }

    // Map incoming status to our canonical status
    const okStatuses = ['success', 'completed', 'approved'];
    const failStatuses = ['failed', 'error', 'declined'];
    let newStatus = 'pending';
    if (okStatuses.includes(status)) newStatus = 'approved';
    else if (failStatuses.includes(status)) newStatus = 'failed';

    // Update payment_attempt
    try {
      await supabase.from('payment_attempts').update({ status: newStatus, updated_at: new Date().toISOString(), metadata: payload }).match({ provider, provider_tx_id: providerTx });
      try { if (logId) await supabase.from('webhook_logs').update({ attempts: supabase.literal('attempts + 1'), status: newStatus }).eq('id', logId); } catch(_) {}
    } catch (e) {
      logger.warn('[payments.webhook] update attempt failed: %o', e?.message || e);
      try { if (logId) await supabase.from('webhook_logs').update({ last_error: e?.message || String(e) }).eq('id', logId); } catch(_) {}
    }

    // If approved, update escrow and notify user
    if (newStatus === 'approved' && escrowId) {
      try {
        // Update escrow status to held and mark deposit verified
        await supabase.from('escrows').update({ status: 'held', deposit_verified: true, deposit_verified_at: new Date().toISOString(), pi_transaction_id: providerTx }).eq('id', escrowId);

        // Create notification for user
        if (userId) {
          const msg = `Deposit of ${amount || ''} confirmed for escrow ${escrowId}`;
          await supabase.from('notifications').insert({ user_id: userId, type: 'Deposit received', message: msg, escrow_id: escrowId });

          // Try to send Expo push if user has token
          try {
            const { data: user } = await getUserById(userId, 'expo_push_token', { maybeSingle: true });
            const token = user?.expo_push_token;
            if (token) {
              // enqueue push to retry queue (worker will process)
              try {
                await pushQueue.enqueuePush(supabase, token, 'Deposit confirmed', `Deposit ${amount || ''} received for escrow ${escrowId}`, { escrowId });
              } catch (e) {
                logger.warn('[payments.webhook] enqueue push failed: %o', e?.message || e);
                try { if (logId) await supabase.from('webhook_logs').update({ last_error: e?.message || String(e) }).eq('id', logId); } catch(_) {}
              }
            }
          } catch (e) {
            logger.warn('[payments.webhook] push send failed: %o', e?.message || e);
          }
        }
      } catch (e) {
        logger.error('[payments.webhook] failed to update escrow/notify: %o', e?.message || e);
      }
    }

    // On failed: mark escrow deposit_failed, create refund_request for audit + admin review
    if (newStatus === 'failed' && escrowId) {
      try {
        await supabase.from('escrows').update({ status: 'deposit_failed' }).eq('id', escrowId);
        if (userId) {
          await supabase.from('notifications').insert({ user_id: userId, type: 'Deposit failed', message: `Deposit for escrow ${escrowId} failed`, escrow_id: escrowId });
        }

        // Create a refund_request so admin has an audit trail and can verify
        // whether Pi Network already reversed the funds or if manual action is needed.
        // Check no active refund request already exists for this escrow.
        const { data: existingRefundReq } = await supabase
          .from('refund_requests')
          .select('id')
          .eq('escrow_id', escrowId)
          .in('status', ['pending', 'under_review'])
          .maybeSingle();

        if (!existingRefundReq) {
          // Find system/sender user for requested_by (default to userId if available)
          const systemUserId = userId || null;
          if (systemUserId) {
            await supabase.from('refund_requests').insert({
              escrow_id: escrowId,
              requested_by: systemUserId,
              trigger_type: 'payment_failure',
              reason: 'payment_failure',
              justification: `Payment webhook reported failure. provider_tx_id=${providerTx} error_code=${payload.error_code || 'unknown'} error_message=${payload.error_message || payload.message || 'none'}`,
              pi_payment_id: payload.pi_payment_id || providerTx,
              failure_error_code: String(payload.error_code || ''),
              failure_error_message: String(payload.error_message || payload.message || ''),
              evidence_urls: [],
              contact_attempted: false,
              status: 'pending',
            }).catch((e) => {
              logger.warn('[payments.webhook] failed to create refund_request for failed payment: %o', e?.message || e);
            });
          }
        }

        try { if (logId) await supabase.from('webhook_logs').update({ processed: true, processed_at: new Date().toISOString(), status: 'failed' }).eq('id', logId); } catch(_) {}
      } catch (e) {
        logger.warn('[payments.webhook] failed handling failure: %o', e?.message || e);
        try { if (logId) await supabase.from('webhook_logs').update({ last_error: e?.message || String(e) }).eq('id', logId); } catch(_) {}
      }
    }
    try { if (logId) await supabase.from('webhook_logs').update({ processed: true, processed_at: new Date().toISOString(), status: newStatus, attempt_result: 'ok' }).eq('id', logId); } catch(_) {}
    return res.json({ success: true });
  } catch (err) {
    logger.error('[payments.webhook] error: %o', err);
    try { if (typeof supabase !== 'undefined') await supabase.from('webhook_logs').insert({ payload: req.body, status: 'error', last_error: err?.message || String(err) }); } catch(_) {}
    return res.status(500).json({ success: false, error: 'internal error' });
  }
});

/**
 * PMARTS Payment Routes
 * 
 * Handles Pi payment verification endpoints.
 * These are called by the mobile app during Pi payment flow.
 * 
 * Flow:
 * 1. POST /approve - Called when Pi SDK triggers onReadyForServerApproval
 * 2. POST /complete - Called when Pi SDK triggers onReadyForServerCompletion
 * 3. POST /cancel - Called when payment is cancelled
 * 4. GET /:id - Get payment status
 */

// (uses existing `router`, `supabase`, `logger` and `piApi` declared above)

/**
 * POST /api/payments/approve
 * 
 * Approve a Pi payment after user initiates it.
 * Called from mobile app's onReadyForServerApproval callback.
 */
router.post('/approve', async (req, res) => {
  try {
    const { paymentId, escrowId, network } = req.body;

    if (!paymentId) {
      return res.status(400).json({
        success: false,
        error: 'paymentId is required',
      });
    }

    logger.info('Payment approve request: %s, escrow: %s', paymentId, escrowId);

    // Enforce server's PI_ENV strictly - if server is testnet-only, ignore client hint
    const serverEnforced = (process.env.PI_ENV || '').trim().toLowerCase();
    const requestedNetwork = serverEnforced ? serverEnforced : (typeof network === 'string' ? network.toLowerCase() : undefined);
    const lookupNetworks = requestedNetwork === 'mainnet'
      ? ['mainnet', 'testnet', undefined]
      : requestedNetwork === 'testnet'
        ? ['testnet', 'mainnet', undefined]
        : [undefined, 'testnet', 'mainnet'];

    let paymentResult = null;
    let resolvedNetwork = requestedNetwork;
    let approvalResult = null;
    let payment = null;
    let linkedEscrowId = escrowId || null;
    let skipPreApprovalValidation = false;

    for (const candidate of lookupNetworks) {
      const result = await piApi.getPayment(paymentId, candidate);
      if (result.success) {
        paymentResult = result;
        resolvedNetwork = candidate || requestedNetwork;
        break;
      }
      logger.warn('Payment lookup failed', {
        paymentId,
        requestedNetwork,
        candidateNetwork: candidate || 'default',
        error: result.error,
      });
    }

    if (paymentResult && paymentResult.success) {
      payment = paymentResult.payment;
      const metadata = payment.metadata || {};
      const metadataEscrowId = metadata.escrow_id || metadata.escrowId || metadata.escrowID;
      linkedEscrowId = escrowId || metadataEscrowId;
    } else {
      // Fallback for eventual consistency / API edge cases where payment lookup returns 404
      // right after createPayment. We still try to approve against Pi, and tie DB updates to a
      // known escrow from request.
      if (!linkedEscrowId) {
        return res.status(400).json({
          success: false,
          error: 'Failed to get payment details',
        });
      }

      const { data: escrowForFallback, error: escrowFallbackError } = await supabase
        .from('escrows')
        .select('*')
        .eq('id', linkedEscrowId)
        .single();

      if (escrowFallbackError || !escrowForFallback) {
        return res.status(404).json({
          success: false,
          error: 'Escrow not found',
        });
      }

      const fallbackApprovalNetworks = requestedNetwork === 'mainnet'
        ? ['mainnet', 'testnet', undefined]
        : requestedNetwork === 'testnet'
          ? ['testnet', 'mainnet', undefined]
          : [undefined, 'testnet', 'mainnet'];

      for (const candidate of fallbackApprovalNetworks) {
        const result = await piApi.approvePayment(paymentId, candidate);
        if (result.success) {
          approvalResult = result;
          resolvedNetwork = candidate || requestedNetwork;
          break;
        }
        logger.warn('Fallback payment approve failed', {
          paymentId,
          requestedNetwork,
          candidateNetwork: candidate || 'default',
          error: result.error,
        });
      }

      if (!approvalResult || !approvalResult.success) {
        return res.status(500).json({
          success: false,
          error: 'Failed to approve payment',
        });
      }

      payment = {
        amount: escrowForFallback.amount,
        user_uid: escrowForFallback.sender_id || null,
        from_address: null,
        to_address: null,
        metadata: { escrow_id: linkedEscrowId },
      };
      skipPreApprovalValidation = true;
    }

    // If escrowId provided, validate the payment matches
    if (linkedEscrowId && !skipPreApprovalValidation) {
      const { data: escrow, error: escrowError } = await supabase
        .from('escrows')
        .select('*')
        .eq('id', linkedEscrowId)
        .single();

      if (escrowError || !escrow) {
        return res.status(404).json({
          success: false,
          error: 'Escrow not found',
        });
      }

      // Validate payment matches escrow
      const validation = piApi.validatePaymentForEscrow(payment, escrow);
      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          error: validation.error,
        });
      }
    }

    const approvalNetworks = resolvedNetwork === 'mainnet'
      ? ['mainnet', 'testnet']
      : resolvedNetwork === 'testnet'
        ? ['testnet', 'mainnet']
        : [undefined, 'testnet', 'mainnet'];

    if (!approvalResult) {
      for (const candidate of approvalNetworks) {
        const result = await piApi.approvePayment(paymentId, candidate);
        if (result.success) {
          approvalResult = result;
          break;
        }
        logger.warn('Payment approve failed', {
          paymentId,
          requestedNetwork,
          candidateNetwork: candidate || 'default',
          error: result.error,
        });
      }

      if (!approvalResult || !approvalResult.success) {
        return res.status(500).json({
          success: false,
          error: 'Failed to approve payment',
        });
      }
    }

    // Record the payment in our database
    const { error: insertError } = await supabase
      .from('payments')
      .upsert({
        pi_payment_id: paymentId,
        escrow_id: linkedEscrowId,
        amount: payment.amount,
        payment_type: 'deposit',
        status: 'submitted',
        sender_uid: payment.user_uid,
        sender_wallet: payment.from_address || null,
        recipient_wallet: payment.to_address || null,
        pmarts_wallet: payment.to_address || null,
        submitted_at: new Date().toISOString(),
      }, {
        onConflict: 'pi_payment_id',
      });

    if (insertError) {
      logger.error('Failed to record payment: %o', insertError);
      // Continue anyway - payment is approved on Pi side
    }

    // Update escrow status if linked
    if (linkedEscrowId) {
      const { error: escrowApproveErr } = await supabase
        .from('escrows')
        .update({
          payment_id: paymentId,
          status: 'deposit_pending',
          updated_at: new Date().toISOString(),
        })
        .eq('id', linkedEscrowId);
      if (escrowApproveErr) {
        logger.error('Failed to update escrow status to deposit_pending: %o', escrowApproveErr);
      }
    }

    res.json({
      success: true,
      message: 'Payment approved',
      paymentId,
    });
  } catch (error) {
    logger.error('Payment approve error: %o', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * POST /api/payments/complete
 * 
 * Complete a Pi payment after user confirms in wallet.
 * Called from mobile app's onReadyForServerCompletion callback.
 */
router.post('/complete', async (req, res) => {
  try {
    const { paymentId, txid, escrowId, network } = req.body;

    if (!paymentId || !txid) {
      return res.status(400).json({
        success: false,
        error: 'paymentId and txid are required',
      });
    }

    logger.info('Payment complete request: %s, txid: %s', paymentId, txid);

    // Complete the payment on Pi Network — try multiple networks to handle cases where
    // the approval was recorded under a different key context (testnet vs mainnet fallback).
    // Enforce server's PI_ENV strictly - if server is testnet-only, ignore client hint
    const serverEnforced = (process.env.PI_ENV || '').trim().toLowerCase();
    const requestedNet = serverEnforced ? serverEnforced : (typeof network === 'string' ? network.toLowerCase() : undefined);
    const completeNetworks = requestedNet === 'mainnet'
      ? ['mainnet', 'testnet', undefined]
      : requestedNet === 'testnet'
        ? ['testnet', 'mainnet', undefined]
        : [undefined, 'testnet', 'mainnet'];

    let completionResult = null;
    for (const candidate of completeNetworks) {
      const result = await piApi.completePayment(paymentId, txid, candidate);
      if (result.success) {
        completionResult = result;
        break;
      }
      logger.warn('Payment complete failed', {
        paymentId,
        candidateNetwork: candidate ?? 'default',
        error: result.error,
      });
    }

    if (!completionResult || !completionResult.success) {
      return res.status(500).json({
        success: false,
        error: completionResult?.error || 'Failed to complete payment',
      });
    }

    const payment = completionResult.payment;

    // Update payment record in database (may not exist if approve didn't record it)
    const { data: paymentRecord, error: updateError } = await supabase
      .from('payments')
      .update({
        status: 'confirmed',
        txid: txid,
        confirmed: true,
        confirmed_at: new Date().toISOString(),
      })
      .eq('pi_payment_id', paymentId)
      .select()
      .maybeSingle();

    if (updateError) {
      logger.error('Failed to update payment record: %o', updateError);
    }

    // Get linked escrow
    const metadata = payment?.metadata || {};
    const metadataEscrowId = metadata.escrow_id || metadata.escrowId || metadata.escrowID;
    const linkedEscrowId = escrowId || paymentRecord?.escrow_id || metadataEscrowId;

    if (linkedEscrowId) {
      // Update escrow status to 'held' - funds are now secure
      const { data: escrow, error: escrowUpdateError } = await supabase
        .from('escrows')
        .update({
          status: 'funds_held',
          pi_payment_id: paymentId,
          pi_transaction_hash: txid,
          deposit_verified: true,
          deposit_verified_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', linkedEscrowId)
        .select('*, sender:sender_id(*), recipient:recipient_id(*)')
        .single();

        if (escrowUpdateError) {
        logger.error('Failed to update escrow: %o', escrowUpdateError);
      } else {
        // Create notification for recipient
        await createDepositNotification(escrow);

        // Record ledger entries for deposit and hold
        const referenceCode = escrow.reference_id || escrow.escrow_code || escrow.id;
        await supabase
          .from('ledger_entries')
          .insert([
            {
              escrow_id: linkedEscrowId,
              user_id: escrow.sender_id,
              payment_id: paymentRecord?.id || null,
              entry_type: 'escrow_deposit',
              amount: payment.amount,
              debit_account: 'sender_wallet',
              credit_account: 'pmarts_escrow',
              reference_code: referenceCode,
              description: `Escrow deposit for ${referenceCode}`,
              metadata: {
                pi_payment_id: paymentId,
                txid,
              },
              verified: true,
              verified_at: new Date().toISOString(),
            },
            {
              escrow_id: linkedEscrowId,
              user_id: escrow.sender_id,
              payment_id: paymentRecord?.id || null,
              entry_type: 'escrow_hold',
              amount: payment.amount,
              debit_account: 'pmarts_escrow',
              credit_account: 'escrow_holdings',
              reference_code: referenceCode,
              description: `Escrow funds held for ${referenceCode}`,
              metadata: {
                pi_payment_id: paymentId,
                txid,
              },
              verified: true,
              verified_at: new Date().toISOString(),
            },
          ]);
      }
    }

    res.json({
      success: true,
      message: 'Payment completed and escrow funded',
      paymentId,
      txid,
      escrowId: linkedEscrowId,
    });
    } catch (error) {
    logger.error('Payment complete error: %o', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * POST /api/payments/cancel
 * 
 * Cancel an incomplete Pi payment.
 */
router.post('/cancel', async (req, res) => {
  try {
    const { paymentId, escrowId } = req.body;

    if (!paymentId) {
      return res.status(400).json({
        success: false,
        error: 'paymentId is required',
      });
    }

    logger.info('Payment cancel request: %s', paymentId);

    // Cancel the payment on Pi Network
    const cancelResult = await piApi.cancelPayment(paymentId);
    
    // Update payment record
    await supabase
      .from('payments')
      .update({
        status: 'cancelled',
        error_message: 'User cancelled payment',
      })
      .eq('pi_payment_id', paymentId);

    // If linked to escrow, update escrow status
    if (escrowId) {
      await supabase
        .from('escrows')
        .update({
          status: 'cancelled',
          updated_at: new Date().toISOString(),
        })
        .eq('id', escrowId);
    }

    res.json({
      success: true,
      message: 'Payment cancelled',
      paymentId,
    });
  } catch (error) {
    logger.error('Payment cancel error: %o', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * GET /api/payments/:paymentId
 * 
 * Get payment status and details.
 */
router.get('/:paymentId', async (req, res) => {
  try {
    const { paymentId } = req.params;

    // Get from our database first
    const { data: payment, error } = await supabase
      .from('payments')
      .select('*, escrow:escrow_id(*)')
      .eq('pi_payment_id', paymentId)
      .single();

    if (error || !payment) {
      // Try getting from Pi Network API
      const piResult = await piApi.getPayment(paymentId);
      if (piResult.success) {
        return res.json({
          success: true,
          payment: piResult.payment,
          source: 'pi_network',
        });
      }
      
      return res.status(404).json({
        success: false,
        error: 'Payment not found',
      });
    }

    res.json({
      success: true,
      payment,
      source: 'database',
    });
  } catch (error) {
    logger.error('Get payment error: %o', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * POST /api/payments/verify-user
 * 
 * Verify a Pi user's access token.
 * Called after authentication to validate the user.
 */
router.post('/verify-user', async (req, res) => {
  try {
    const { accessToken } = req.body;

    if (!accessToken) {
      return res.status(400).json({
        success: false,
        error: 'accessToken is required',
      });
    }

    const result = await piApi.verifyUser(accessToken);
    
    if (!result.success) {
      return res.status(401).json(result);
    }

    res.json(result);
  } catch (error) {
    logger.error('Verify user error: %o', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * Helper: Create notification for deposit
 */
async function createDepositNotification(escrow) {
  try {
    if (!escrow?.recipient?.id) return;

    const message = `${escrow.amount} Pi deposit held for ${escrow.reference_id || 'escrow'} by @${escrow.sender?.username || 'sender'}`;

    await supabase
      .from('notifications')
      .insert({
        user_id: escrow.recipient.id,
        type: 'deposit_received',
        title: 'Escrow Deposit Received',
        message,
        data: {
          escrow_id: escrow.id,
          amount: escrow.amount,
          sender_id: escrow.sender_id,
          recipient_id: escrow.recipient_id,
          reference_id: escrow.reference_id,
        },
        read: false,
      });

    logger.info('Notification sent to recipient: %s', escrow.recipient.id);
  } catch (error) {
    logger.error('Failed to create notification: %o', error);
  }
}

module.exports = router;

