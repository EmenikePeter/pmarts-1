const logger = require('./logger');

/**
 * PMARTS Master Escrow Wallet Service
 * 
 * Core escrow wallet architecture:
 * - All Pi deposits go to ONE master escrow wallet
 * - Individual user balances tracked in ledger database
 * - Release/refund triggers Pi payouts from master wallet
 * 
 * This is how real fintech escrow platforms work:
 * - Bank holds funds in omnibus account
 * - Software tracks who owns what
 * - Payouts happen on instruction
 * 
 * Security layers:
 * 1. All transactions are append-only in ledger
 * 2. Every action has audit trail
 * 3. Double-entry bookkeeping validation
 * 4. Multi-signature for large releases (future)
 */

const supabase = require('./supabase');
const piApi = require('./piApi');
const antiScamService = require('./antiScamService');
const { getUserById, updateUserById } = require('./userResolver');

/**
 * Ledger action types (canonical values stored in DB)
 */
const LEDGER_ACTIONS = {
  DEPOSIT: 'escrow_deposit',
  RELEASE: 'escrow_release',
  REFUND: 'escrow_refund',
  FEE_COLLECTION: 'fee_collection',
  DISPUTE_HOLD: 'dispute_hold',
  DISPUTE_RELEASE: 'dispute_release',
  EXPIRY_REFUND: 'expiry_refund',
};

/**
 * Escrow statuses
 */
const ESCROW_STATUS = {
  PENDING: 'pending',                    // Created, awaiting payment
  HELD: 'held',                          // Payment received, funds held (legacy)
  FUNDS_HELD: 'funds_held',             // Canonical: deposit confirmed, funds held
  RELEASING: 'releasing',                // Release in progress
  RELEASED: 'released',                  // Funds sent to recipient
  RELEASE_REQUESTED: 'release_requested', // Sender submitted release request
  REFUNDING: 'refunding',                // Refund in progress
  REFUNDED: 'refunded',                  // Funds returned to sender
  REFUND_REQUESTED: 'refund_requested',  // Sender submitted refund request (awaiting admin)
  DISPUTED: 'disputed',                  // Under dispute review
  EXPIRED: 'expired',                    // Auto-expired and refunded
  CANCELLED: 'cancelled',                // Cancelled before payment
};

/**
 * System account types (for double-entry bookkeeping)
 */
const SYSTEM_ACCOUNTS = {
  ESCROW_HOLDINGS: 'escrow_holdings',  // Master escrow wallet balance
  FEE_REVENUE: 'fee_revenue',          // Platform fee earnings
  PENDING_PAYOUTS: 'pending_payouts',  // Queued outgoing payments
};

// ============================================
// WALLET OPERATIONS
// ============================================

/**
 * Get master wallet balance summary
 * @returns {Promise<Object>} Wallet balance summary
 */
async function getWalletSummary() {
  try {
    // Get total held in escrow
    const { data: heldEscrows } = await supabase
      .from('escrows')
      .select('amount')
      .eq('status', ESCROW_STATUS.HELD);

    const totalHeld = heldEscrows?.reduce((sum, e) => sum + (e.amount || 0), 0) || 0;

    // Get total in disputed escrows
    const { data: disputedEscrows } = await supabase
      .from('escrows')
      .select('amount')
      .eq('status', ESCROW_STATUS.DISPUTED);

    const totalDisputed = disputedEscrows?.reduce((sum, e) => sum + (e.amount || 0), 0) || 0;

    // Get pending payouts
    const { data: pendingReleases } = await supabase
      .from('escrows')
      .select('amount')
      .eq('status', ESCROW_STATUS.RELEASING);

    const pendingPayouts = pendingReleases?.reduce((sum, e) => sum + (e.amount || 0), 0) || 0;

    // Calculate total fees collected (from ledger)
    const { data: feeEntries } = await supabase
      .from('ledger_entries')
      .select('amount')
      .eq('entry_type', LEDGER_ACTIONS.FEE_COLLECTION);

    const totalFees = feeEntries?.reduce((sum, e) => sum + Math.abs(e.amount || 0), 0) || 0;

    return {
      success: true,
      summary: {
        totalHeld,
        totalDisputed,
        pendingPayouts,
        totalFees,
        availableForRelease: totalHeld - totalDisputed - pendingPayouts,
      },
    };

  } catch (error) {
    logger.error('Get wallet summary error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get escrow balance for specific user
 * @param {string} userId - User ID
 * @returns {Promise<Object>} User's escrow balances
 */
async function getUserEscrowBalance(userId) {
  try {
    // Pi held as sender (money this user has in escrow for others)
    const { data: asSenderHeld } = await supabase
      .from('escrows')
      .select('amount')
      .eq('sender_id', userId)
      .in('status', [ESCROW_STATUS.HELD, ESCROW_STATUS.DISPUTED]);

    const heldAsSender = asSenderHeld?.reduce((sum, e) => sum + (e.amount || 0), 0) || 0;

    // Pi receivable (money others have in escrow for this user)
    const { data: asRecipientHeld } = await supabase
      .from('escrows')
      .select('amount')
      .eq('recipient_id', userId)
      .in('status', [ESCROW_STATUS.HELD, ESCROW_STATUS.DISPUTED]);

    const receivableAmount = asRecipientHeld?.reduce((sum, e) => sum + (e.amount || 0), 0) || 0;

    // Count of active escrows
    const { count: activeEscrowCount } = await supabase
      .from('escrows')
      .select('*', { count: 'exact', head: true })
      .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`)
      .in('status', [ESCROW_STATUS.HELD, ESCROW_STATUS.DISPUTED, ESCROW_STATUS.RELEASING]);

    return {
      success: true,
      balance: {
        heldAsSender,       // User's Pi currently held
        receivable: receivableAmount,  // Pi user can receive when released
        activeEscrowCount: activeEscrowCount || 0,
      },
    };

  } catch (error) {
    logger.error('Get user escrow balance error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================
// DEPOSIT OPERATIONS
// ============================================

/**
 * Record a deposit into escrow
 * Called after Pi payment is verified
 * 
 * @param {Object} params - Deposit parameters
 * @returns {Promise<Object>} Deposit result
 */
async function recordDeposit(params) {
  const { escrowId, paymentId, txid, amount, senderId } = params;

  try {
    // Ensure a payment record exists (upsert by Pi payment id) and get its UUID
    const { data: paymentRecord, error: paymentUpsertError } = await supabase
      .from('payments')
      .upsert({
        pi_payment_id: paymentId,
        txid: txid,
        amount: amount || null,
        payment_type: 'deposit',
        status: 'confirmed',
        confirmed: true,
        confirmed_at: new Date().toISOString(),
        escrow_id: escrowId,
      }, {
        onConflict: 'pi_payment_id',
      })
      .select()
      .single();

    if (paymentUpsertError) {
      logger.error('Failed to upsert payment record:', paymentUpsertError);
      throw paymentUpsertError;
    }

    const paymentUuid = paymentRecord?.id || null;

    // Update escrow to HELD status, referencing the payment UUID
    const { data: escrow, error: updateError } = await supabase
      .from('escrows')
      .update({
        status: 'funds_held',
        payment_id: paymentUuid,
        payment_txid: txid,
        deposited_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        pi_payment_id: paymentId,
      })
      .eq('id', escrowId)
      .select()
      .single();

    if (updateError) throw updateError;

    // Ensure transaction record exists and mark as locked
    const { data: transaction } = await supabase
      .from('transactions')
      .upsert({
        escrow_id: escrowId,
        sender_id: escrow.sender_id,
        recipient_id: escrow.recipient_id,
        amount: escrow.amount,
        platform_fee: escrow.fee || 0,
        status: 'locked',
        reference_id: escrow.reference_id,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'escrow_id',
      })
      .select()
      .single();

    // Log wallet transfer for deposit
    await supabase
      .from('wallet_transfers')
      .insert({
        transaction_id: transaction?.id || null,
        escrow_id: escrowId,
        from_wallet: 'sender_wallet',
        to_wallet: 'pmarts_escrow',
        amount: escrow.amount,
        transfer_type: 'deposit',
        payment_id: paymentUuid,
        pi_payment_id: paymentId,
        pi_txid: txid,
      });

    // Create ledger entry (DEPOSIT = funds into escrow)
    const ledgerEntry = await createLedgerEntry({
      escrowId,
      action: LEDGER_ACTIONS.DEPOSIT,
      amount,
      userId: senderId,
      paymentId: paymentUuid,
      txid,
      description: `Deposit for escrow ${escrowId}`,
    });

    // Update system account balance
    await updateSystemAccount(SYSTEM_ACCOUNTS.ESCROW_HOLDINGS, amount);

    // Create notification for recipient
    await createNotification({
      userId: escrow.recipient_id,
      type: 'escrow_deposit',
      title: 'Escrow Payment Received',
      message: `${amount} Pi deposited for ${escrow.reference_id || 'your order'}`,
      escrowId,
    });

    // For this deployment we do not schedule or perform timeout-based auto-releases on deposit.
    // Delivery-code verification (recipient confirms code) remains the only automatic release trigger.
    // If `confirmation_method === 'auto'` or a `completion_timeout_hours` rule exists, we deliberately
    // do not set `completion_auto_release_at` nor call `releaseEscrow` here to avoid implicit timeouts.
    // This keeps deposit behaviour simple: funds are held until an explicit verification/release flow runs.
    // Returning the escrow and ledger entry so caller can continue normally.
    
    // noop for auto-confirmation: do not schedule timeouts or auto-release

    return {
      success: true,
      escrow,
      ledgerEntry,
    };

  } catch (error) {
    logger.error('Record deposit error:', error);
    // If the error is related to audit_logs missing (db trigger/RLS/schema issue),
    // try to recover: fetch the escrow and return success if it shows funds held.
    try {
      const msg = (error && (error.message || '')).toLowerCase();
      const code = error && error.code;
      if (code === '42P01' || msg.includes('audit_logs') || msg.includes('relation "audit_logs"')) {
        logger.warn('Audit-related DB error detected — attempting best-effort recovery (non-fatal)');
        const { data: escrowPost, error: fetchErr } = await supabase
          .from('escrows')
          .select('*')
          .eq('id', escrowId)
          .single();
        if (!fetchErr && escrowPost && (escrowPost.status === 'funds_held' || escrowPost.status === 'held')) {
          return { success: true, escrow: escrowPost, ledgerEntry: null };
        }
      }
    } catch (recErr) {
      logger.error('Recovery attempt after audit error failed:', recErr);
    }

    // Return structured error information to caller for better diagnostics
    const structured = {
      message: error && (error.message || String(error)),
      code: error && error.code ? error.code : null,
      stack: error && error.stack ? error.stack : null,
    };
    return { success: false, error: structured };
  }
}

// ============================================
// RELEASE OPERATIONS
// ============================================

/**
 * Release escrow funds to recipient
 * Initiates Pi payout from master wallet
 * 
 * @param {string} escrowId - Escrow ID
 * @param {string} releasedBy - User ID who authorized release
 * @returns {Promise<Object>} Release result
 */
async function releaseEscrow(escrowId, releasedBy) {
  try {
    // Get escrow details
    const { data: escrow, error: fetchError } = await supabase
      .from('escrows')
      .select('*, sender:sender_id(*), recipient:recipient_id(*)')
      .eq('id', escrowId)
      .single();

    if (fetchError || !escrow) {
      return { success: false, error: 'Escrow not found' };
    }

    // Validate escrow can be released
    const releasableStatuses = ['funds_held', ESCROW_STATUS.HELD, 'delivery_in_progress', 'release_requested', 'release_pending'];
    if (!releasableStatuses.includes(escrow.status)) {
      return {
        success: false,
        error: `Cannot release escrow in ${escrow.status} status`,
      };
    }

    // Only sender can release
    if (releasedBy !== escrow.sender_id) {
      return {
        success: false,
        error: 'Only the sender can release funds',
      };
    }

    // Calculate fee (2% platform fee)
    const feeRate = 0.02;
    const feeAmount = escrow.amount * feeRate;
    const netAmount = escrow.amount - feeAmount;

    // Update escrow to RELEASING
    await supabase
      .from('escrows')
      .update({
        status: ESCROW_STATUS.RELEASING,
        released_by: releasedBy,
        updated_at: new Date().toISOString(),
      })
      .eq('id', escrowId);

    // Create release ledger entry
    await createLedgerEntry({
      escrowId,
      action: LEDGER_ACTIONS.RELEASE,
      amount: -netAmount, // Negative = funds leaving escrow
      userId: escrow.recipient_id,
      description: `Release to recipient ${escrow.recipient.username || escrow.recipient_id}`,
    });

    // Create fee ledger entry
    if (feeAmount > 0) {
      await createLedgerEntry({
        escrowId,
        action: LEDGER_ACTIONS.FEE_COLLECTION,
        amount: -feeAmount,
        userId: null,
        description: `Platform fee (${feeRate * 100}%)`,
      });
    }

    // Update system accounts
    await updateSystemAccount(SYSTEM_ACCOUNTS.ESCROW_HOLDINGS, -escrow.amount);
    await updateSystemAccount(SYSTEM_ACCOUNTS.FEE_REVENUE, feeAmount);

    // Queue the actual Pi payout (would trigger Pi API payout in production)
    const releaseRecipient = resolvePayoutRecipient(escrow.recipient);
    const payoutResult = await queuePayout({
      escrowId,
      recipientUid: releaseRecipient.uid,
      recipientSource: releaseRecipient.source,
      amount: netAmount,
      memo: `PMARTS Release: ${escrow.reference_id || escrowId}`,
    });

    // Finalize escrow
    // Use txid when available; fall back to paymentId so there is always a traceable Pi reference.
    const releaseTxRef = payoutResult.txid || payoutResult.paymentId || null;
    const { data: updatedEscrow } = await supabase
      .from('escrows')
      .update({
        status: 'completed',
        net_amount: netAmount,
        fee_amount: feeAmount,
        release_txid: releaseTxRef,
        released_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', escrowId)
      .select()
      .single();

    // Update transaction status
    const { data: transaction } = await supabase
      .from('transactions')
      .upsert({
        escrow_id: escrowId,
        sender_id: escrow.sender_id,
        recipient_id: escrow.recipient_id,
        amount: escrow.amount,
        platform_fee: feeAmount,
        status: 'completed',
        reference_id: escrow.reference_id,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'escrow_id',
      })
      .select()
      .single();

    // Log wallet transfer for release
    await supabase
      .from('wallet_transfers')
      .insert({
        transaction_id: transaction?.id || null,
        escrow_id: escrowId,
        from_wallet: 'pmarts_escrow',
        to_wallet: 'recipient_wallet',
        amount: netAmount,
        transfer_type: 'release',
        pi_txid: releaseTxRef,
      });

    // Log platform revenue
    if (feeAmount > 0) {
      await supabase
        .from('platform_revenue')
        .insert({
          transaction_id: transaction?.id || null,
          escrow_id: escrowId,
          fee_amount: feeAmount,
        });

      await supabase
        .from('wallet_transfers')
        .insert({
          transaction_id: transaction?.id || null,
          escrow_id: escrowId,
          from_wallet: 'pmarts_escrow',
          to_wallet: 'pmarts_revenue',
          amount: feeAmount,
          transfer_type: 'fee',
          pi_txid: releaseTxRef,
        });
    }

    // Notifications
    await createNotification({
      userId: escrow.recipient_id,
      type: 'escrow_released',
      title: 'Payment Released! 🎉',
      message: `${netAmount} Pi released to your wallet`,
      escrowId,
    });

    await createNotification({
      userId: escrow.sender_id,
      type: 'escrow_released',
      title: 'Payment Released',
      message: `You released ${escrow.amount} Pi to @${escrow.recipient.username}`,
      escrowId,
    });

    // Update user stats
    await updateUserStats(escrow.sender_id, 'completed_transactions', 1);
    await updateUserStats(escrow.recipient_id, 'completed_transactions', 1);

    return {
      success: true,
      escrow: updatedEscrow,
      netAmount,
      feeAmount,
    };

  } catch (error) {
    logger.error('Release escrow error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Release a single escrow milestone to recipient
 * This performs a partial payout and keeps escrow open until all milestones are released.
 */
async function releaseMilestone(escrowId, milestoneId, releasedBy) {
  try {
    const { data: escrow, error: fetchError } = await supabase
      .from('escrows')
      .select('*, sender:sender_id(*), recipient:recipient_id(*)')
      .eq('id', escrowId)
      .single();

    if (fetchError || !escrow) {
      return { success: false, error: 'Escrow not found' };
    }

    if (escrow.status !== ESCROW_STATUS.HELD) {
      return { success: false, error: `Cannot release milestone in ${escrow.status} status` };
    }

    if (releasedBy !== escrow.sender_id) {
      return { success: false, error: 'Only the sender can approve milestone release' };
    }

    const { data: milestone, error: milestoneError } = await supabase
      .from('escrow_milestones')
      .select('*')
      .eq('id', milestoneId)
      .eq('escrow_id', escrowId)
      .single();

    if (milestoneError || !milestone) {
      return { success: false, error: 'Milestone not found' };
    }

    if (milestone.status !== 'approved') {
      return { success: false, error: 'Milestone must be approved before release' };
    }

    const feeRate = 0.02;
    const feeAmount = milestone.amount * feeRate;
    const netAmount = milestone.amount - feeAmount;

    await supabase
      .from('escrows')
      .update({
        status: ESCROW_STATUS.RELEASING,
        updated_at: new Date().toISOString(),
      })
      .eq('id', escrowId);

    await createLedgerEntry({
      escrowId,
      action: LEDGER_ACTIONS.RELEASE,
      amount: -netAmount,
      userId: escrow.recipient_id,
      description: `Milestone release: ${milestone.title}`,
    });

    if (feeAmount > 0) {
      await createLedgerEntry({
        escrowId,
        action: LEDGER_ACTIONS.FEE_COLLECTION,
        amount: -feeAmount,
        userId: null,
        description: `Platform fee (${feeRate * 100}%) for milestone`,
      });
    }

    await updateSystemAccount(SYSTEM_ACCOUNTS.ESCROW_HOLDINGS, -milestone.amount);
    await updateSystemAccount(SYSTEM_ACCOUNTS.FEE_REVENUE, feeAmount);

    const milestoneRecipient = resolvePayoutRecipient(escrow.recipient);
    const payoutResult = await queuePayout({
      escrowId,
      recipientUid: milestoneRecipient.uid,
      recipientSource: milestoneRecipient.source,
      amount: netAmount,
      memo: `PMARTS Milestone Release: ${milestone.title}`,
    });

    await supabase
      .from('escrow_milestones')
      .update({
        status: 'released',
        released_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', milestoneId);

    const nextNet = (escrow.net_amount || 0) + netAmount;
    const nextFee = (escrow.fee_amount || 0) + feeAmount;
    const milestoneTxRef = payoutResult.txid || payoutResult.paymentId || null;

    const { data: updatedEscrow } = await supabase
      .from('escrows')
      .update({
        status: ESCROW_STATUS.HELD,
        net_amount: nextNet,
        fee_amount: nextFee,
        release_txid: milestoneTxRef,
        updated_at: new Date().toISOString(),
      })
      .eq('id', escrowId)
      .select()
      .single();

    await createNotification({
      userId: escrow.recipient_id,
      type: 'milestone_release',
      title: 'Milestone Released',
      message: `${netAmount} Pi released for milestone "${milestone.title}"`,
      escrowId,
    });

    await createNotification({
      userId: escrow.sender_id,
      type: 'milestone_release',
      title: 'Milestone Released',
      message: `You released ${milestone.amount} Pi for milestone "${milestone.title}"`,
      escrowId,
    });

    await syncEscrowStatusForMilestones(escrowId);

    return {
      success: true,
      escrow: updatedEscrow,
      netAmount,
      feeAmount,
    };
  } catch (error) {
    logger.error('Release milestone error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================
// REFUND OPERATIONS
// ============================================

/**
 * Refund escrow funds to sender
 * 
 * @param {string} escrowId - Escrow ID
 * @param {string} reason - Refund reason
 * @param {string} refundedBy - Who authorized (admin, system, etc.)
 * @returns {Promise<Object>} Refund result
 */
async function refundEscrow(escrowId, reason, refundedBy) {
  try {
    const { data: escrow, error: fetchError } = await supabase
      .from('escrows')
      .select('*, sender:sender_id(*)')
      .eq('id', escrowId)
      .single();

    if (fetchError || !escrow) {
      return { success: false, error: 'Escrow not found' };
    }

    // Validate escrow can be refunded
    const refundableStatuses = [
      ESCROW_STATUS.HELD,
      ESCROW_STATUS.FUNDS_HELD,
      ESCROW_STATUS.REFUND_REQUESTED,
      ESCROW_STATUS.DISPUTED,
    ];
    if (!refundableStatuses.includes(escrow.status)) {
      return {
        success: false,
        error: `Cannot refund escrow in ${escrow.status} status`,
      };
    }

    // Update to REFUNDING
    await supabase
      .from('escrows')
      .update({
        status: ESCROW_STATUS.REFUNDING,
        refund_reason: reason,
        refunded_by: refundedBy,
        updated_at: new Date().toISOString(),
      })
      .eq('id', escrowId);

    // Create refund ledger entry
    await createLedgerEntry({
      escrowId,
      action: LEDGER_ACTIONS.REFUND,
      amount: -escrow.amount,
      userId: escrow.sender_id,
      description: `Refund: ${reason}`,
    });

    // Update system account
    await updateSystemAccount(SYSTEM_ACCOUNTS.ESCROW_HOLDINGS, -escrow.amount);

    // Queue refund payout
    const refundRecipient = resolvePayoutRecipient(escrow.sender);
    const payoutResult = await queuePayout({
      escrowId,
      recipientUid: refundRecipient.uid,
      recipientSource: refundRecipient.source,
      amount: escrow.amount,
      memo: `PMARTS Refund: ${escrow.reference_id || escrowId}`,
    });

    // Finalize
    // Use txid when available; fall back to paymentId so there is always a traceable Pi reference.
    const refundTxRef = payoutResult.txid || payoutResult.paymentId || null;
    const { data: updatedEscrow } = await supabase
      .from('escrows')
      .update({
        status: ESCROW_STATUS.REFUNDED,
        refund_txid: refundTxRef,
        refunded_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', escrowId)
      .select()
      .single();

    // Update transaction status
    const { data: transaction } = await supabase
      .from('transactions')
      .upsert({
        escrow_id: escrowId,
        sender_id: escrow.sender_id,
        recipient_id: escrow.recipient_id,
        amount: escrow.amount,
        platform_fee: escrow.fee_amount || 0,
        status: 'refunded',
        reference_id: escrow.reference_id,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'escrow_id',
      })
      .select()
      .single();

    // Log wallet transfer for refund
    await supabase
      .from('wallet_transfers')
      .insert({
        transaction_id: transaction?.id || null,
        escrow_id: escrowId,
        from_wallet: 'pmarts_escrow',
        to_wallet: 'sender_wallet',
        amount: escrow.amount,
        transfer_type: 'refund',
        pi_txid: refundTxRef,
      });

    // Notification
    await createNotification({
      userId: escrow.sender_id,
      type: 'escrow_refunded',
      title: 'Refund Processed',
      message: `${escrow.amount} Pi refunded to your wallet`,
      escrowId,
    });

    return {
      success: true,
      escrow: updatedEscrow,
    };

  } catch (error) {
    logger.error('Refund escrow error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================
// LEDGER OPERATIONS
// ============================================

/**
 * Create an immutable ledger entry
 * This is the core financial audit trail
 */
async function createLedgerEntry(params) {
  const { escrowId, action, amount, userId, paymentId, txid, description } = params;

  try {
    // Calculate running balance
    const { data: lastEntry } = await supabase
      .from('ledger_entries')
      .select('running_balance')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const previousBalance = lastEntry?.running_balance || 0;
    const runningBalance = previousBalance + amount;

    // Normalize action into canonical DB entry_type values
    const actionKey = typeof action === 'string' ? action.toLowerCase() : '';
    const canonicalMap = {
      deposit: LEDGER_ACTIONS.DEPOSIT,
      escrow_deposit: LEDGER_ACTIONS.DEPOSIT,
      hold: LEDGER_ACTIONS.DEPOSIT, // treat 'hold' as deposit-related where appropriate
      escrow_hold: LEDGER_ACTIONS.DEPOSIT,
      release: LEDGER_ACTIONS.RELEASE,
      escrow_release: LEDGER_ACTIONS.RELEASE,
      refund: LEDGER_ACTIONS.REFUND,
      escrow_refund: LEDGER_ACTIONS.REFUND,
      fee_collection: LEDGER_ACTIONS.FEE_COLLECTION,
      fee_refund: 'fee_refund',
      adjustment: 'adjustment',
      reversal: 'reversal',
      dispute_hold: LEDGER_ACTIONS.DISPUTE_HOLD,
      dispute_release: LEDGER_ACTIONS.DISPUTE_RELEASE,
      expiry_refund: LEDGER_ACTIONS.EXPIRY_REFUND,
    };

    const entryType = canonicalMap[actionKey] || action;

    const { data: entry, error } = await supabase
      .from('ledger_entries')
      .insert({
        escrow_id: escrowId,
        entry_type: entryType,
        amount,
        running_balance: runningBalance,
        user_id: userId,
        payment_id: paymentId,
        txid,
        description,
      })
      .select()
      .single();

    if (error) throw error;

    return entry;

  } catch (error) {
    logger.error('Create ledger entry error:', error);
    throw error;
  }
}

/**
 * Get escrow ledger history
 */
async function getEscrowLedger(escrowId) {
  const { data, error } = await supabase
    .from('ledger_entries')
    .select('*')
    .eq('escrow_id', escrowId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Queue a Pi payout (in production, triggers actual Pi API payout)
 */
async function queuePayout(params) {
  const { escrowId, recipientUid, recipientSource, amount, memo } = params;

  // In development/sandbox mode, simulate payout without hitting Pi Network
  if (process.env.NODE_ENV === 'development' || process.env.SANDBOX_MODE === 'true') {
    const sandboxTxid = `sandbox_tx_${Date.now()}`;
    logger.info('[SANDBOX] Payout simulated: %s Pi to %s (txid=%s)', amount, recipientUid, sandboxTxid);
    return { success: true, paymentId: null, txid: sandboxTxid };
  }

  // Production: initiate App-to-User (A2U) payment via Pi Platform API
  if (!recipientUid) {
    logger.error('[queuePayout] recipientUid is missing for escrow %s — payout aborted', escrowId);
    throw new Error('Payout failed: recipient Pi UID is not available');
  }

  if (recipientSource === 'internal_id') {
    logger.warn('[queuePayout] payout blocked for escrow %s: recipient is not linked to Pi account', escrowId);
    throw new Error('Payout blocked: recipient account is not linked to Pi yet (missing pi_uid/pi_id)');
  }

  if (recipientSource === 'pi_id' && isPlaceholderPiId(recipientUid)) {
    logger.warn('[queuePayout] payout blocked for escrow %s: placeholder pi_id %s', escrowId, recipientUid);
    throw new Error('Payout blocked: recipient pi_id looks like a placeholder test value');
  }

  const result = await piApi.createPayout({
    uid: recipientUid,
    amount,
    memo,
    metadata: { escrow_id: escrowId },
  });

  if (!result.success) {
    logger.error('[queuePayout] Pi A2U payout failed for escrow %s: %s', escrowId, result.error);
    throw new Error(`Payout failed: ${result.error}`);
  }

  logger.info(
    '[queuePayout] Payout initiated for escrow %s — paymentId=%s txid=%s',
    escrowId,
    result.paymentId || '(none)',
    result.txid || '(pending)',
  );

  return {
    success: true,
    paymentId: result.paymentId || null,
    // txid may be null when the on-chain confirmation is still pending;
    // callers should store paymentId as a fallback reference.
    txid: result.txid || null,
  };
}

function resolvePayoutRecipient(user) {
  if (user?.pi_uid) {
    return { uid: user.pi_uid, source: 'pi_uid' };
  }

  if (user?.pi_id) {
    return { uid: user.pi_id, source: 'pi_id' };
  }

  return {
    uid: user?.id || null,
    source: 'internal_id',
  };
}

function isPlaceholderPiId(value) {
  if (typeof value !== 'string') return false;
  return /^(test|mock|fake|demo|sample)[-_]/i.test(value.trim());
}

/**
 * Update system account balance
 */
async function updateSystemAccount(accountType, delta) {
  try {
    // Get or create system account
    let { data: account } = await supabase
      .from('system_accounts')
      .select('*')
      .eq('account_type', accountType)
      .single();

    if (!account) {
      const { data: newAccount } = await supabase
        .from('system_accounts')
        .insert({ account_type: accountType, balance: 0 })
        .select()
        .single();
      account = newAccount;
    }

    // Update balance
    await supabase
      .from('system_accounts')
      .update({
        balance: (account.balance || 0) + delta,
        updated_at: new Date().toISOString(),
      })
      .eq('account_type', accountType);

  } catch (error) {
    logger.error('Update system account error:', error);
  }
}

/**
 * Create notification
 */
async function createNotification(params) {
  const { userId, type, title, message, escrowId } = params;

  try {
    await supabase
      .from('notifications')
      .insert({
        user_id: userId,
        type,
        title,
        message,
        escrow_id: escrowId,
        read: false,
      });
  } catch (error) {
    logger.error('Create notification error:', error);
  }
}

/**
 * Update user statistics
 */
async function updateUserStats(userId, stat, delta) {
  try {
    const { data: user } = await getUserById(userId, stat);

    if (user) {
      await updateUserById(userId, {
        [stat]: (user[stat] || 0) + delta,
        updated_at: new Date().toISOString(),
      });

      // Recalculate trust score
      await recalculateTrustScore(userId);
    }
  } catch (error) {
    logger.error('Update user stats error:', error);
  }
}

/**
 * Sync escrow status based on milestone progression
 */
async function syncEscrowStatusForMilestones(escrowId) {
  try {
    const { data: milestones } = await supabase
      .from('escrow_milestones')
      .select('status')
      .eq('escrow_id', escrowId);

    if (!milestones || milestones.length === 0) return;

    const allReleased = milestones.every((milestone) => milestone.status === 'released');

    if (allReleased) {
      await supabase
        .from('escrows')
        .update({
          status: ESCROW_STATUS.RELEASED,
          released_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', escrowId);
    }
  } catch (error) {
    logger.error('Sync milestone status error:', error);
  }
}

/**
 * Recalculate user trust score
 * Based on: completed transactions, disputes, account age
 */
async function recalculateTrustScore(userId) {
  try {
    const { data: user } = await getUserById(userId, 'completed_transactions, total_transactions, disputes_opened, disputes_lost, created_at');

    if (!user) return;

    const completed = user.completed_transactions || 0;
    const disputesLost = user.disputes_lost || 0;
    const totalTransactions = Math.max(user.total_transactions || 0, completed);

    // 1) Transaction score (40%)
    const transactionScore = Math.min(100, completed * 2);

    // 2) Rating score (30%)
    // Count only ratings from completed/refunded escrows, no self-ratings, min sample = 3
    let ratingScore = 0;
    const { data: candidateRatings } = await supabase
      .from('ratings')
      .select('score, escrow_id, rater_id, rated_id')
      .eq('rated_id', userId);

    if (Array.isArray(candidateRatings) && candidateRatings.length > 0) {
      const validEscrowIds = [...new Set(candidateRatings.map((r) => r.escrow_id).filter(Boolean))];
      let validEscrowIdSet = new Set();

      if (validEscrowIds.length > 0) {
        const { data: escrowsForRatings } = await supabase
          .from('escrows')
          .select('id,status')
          .in('id', validEscrowIds)
          .in('status', ['completed', 'refunded']);

        validEscrowIdSet = new Set((escrowsForRatings || []).map((e) => e.id));
      }

      const filteredRatings = candidateRatings.filter((r) =>
        r &&
        typeof r.score === 'number' &&
        r.rater_id &&
        r.rated_id &&
        r.rater_id !== r.rated_id &&
        validEscrowIdSet.has(r.escrow_id)
      );

      if (filteredRatings.length >= 3) {
        const avgRating = filteredRatings.reduce((sum, r) => sum + r.score, 0) / filteredRatings.length;
        ratingScore = (avgRating / 5) * 100;
      }
    }

    // 3) Dispute score (20%)
    const disputeRatio = totalTransactions > 0 ? disputesLost / totalTransactions : 0;
    let disputeScore = 100 - (disputeRatio * 100);
    if (disputesLost > 3) disputeScore -= 10;
    disputeScore = Math.max(0, Math.min(100, disputeScore));

    // 4) Account score (10%)
    const accountAgeDays = (Date.now() - new Date(user.created_at).getTime()) / (1000 * 60 * 60 * 24);
    let accountScore = 10;
    if (accountAgeDays >= 90) accountScore = 100;
    else if (accountAgeDays >= 30) accountScore = 60;
    else if (accountAgeDays >= 7) accountScore = 30;

    // Weighted final score (0-100)
    const finalScore =
      (transactionScore * 0.4) +
      (ratingScore * 0.3) +
      (disputeScore * 0.2) +
      (accountScore * 0.1);

    let trustScore = Math.max(0, Math.min(100, Math.round(finalScore)));

    // Maturity gates — raw score may be high but tier must be earned
    // Elite gate: 25+ completed escrows, 90+ days old, <2% dispute loss rate
    if (trustScore >= 85 && (completed < 25 || accountAgeDays < 90 || disputeRatio > 0.02)) {
      trustScore = Math.min(trustScore, 84);
    }

    // Trusted gate: 10+ completed escrows, 30+ days old
    if (trustScore >= 70 && (completed < 10 || accountAgeDays < 30)) {
      trustScore = Math.min(trustScore, 69);
    }

    await updateUserById(userId, { trust_score: trustScore });

  } catch (error) {
    logger.error('Recalculate trust score error:', error);
  }
}

module.exports = {
  // Wallet operations
  getWalletSummary,
  getUserEscrowBalance,

  // Deposit/Release/Refund
  recordDeposit,
  releaseEscrow,
  releaseMilestone,
  refundEscrow,

  // Ledger
  createLedgerEntry,
  getEscrowLedger,

  // Helpers
  recalculateTrustScore,
  syncEscrowStatusForMilestones,

  // Constants
  LEDGER_ACTIONS,
  ESCROW_STATUS,
  SYSTEM_ACCOUNTS,
};


