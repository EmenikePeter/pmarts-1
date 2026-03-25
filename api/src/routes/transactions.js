/**
 * PMARTS Transactions Routes
 *
 * Dedicated transaction endpoints for Pi escrow lifecycle.
 */

const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const antiScamService = require('../lib/antiScamService');
const completionService = require('../lib/completionService');
const audit = require('../lib/audit');
const logger = require('../lib/logger');

async function resolveUser(identifier) {
  if (!identifier) return null;

  const { data } = await supabase
    .from('users')
    .select('*')
    .or(`id.eq.${identifier},pi_uid.eq.${identifier},username.eq.${identifier}`)
    .single();

  return data;
}

function requireFields(...fields) {
  return (req, res, next) => {
    const missing = fields.filter((f) => !req.body[f]);
    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Missing required fields: ${missing.join(', ')}`,
      });
    }
    next();
  };
}

/**
 * POST /api/transactions/create
 *
 * Creates a transaction (and escrow) record before payment.
 */
router.post('/create', requireFields('amount', 'senderId', 'recipientId', 'referenceId'), async (req, res) => {
  try {
    const { senderId, recipientId, amount, referenceId, note, transactionType, expiryHours } = req.body;

    const sender = await resolveUser(senderId);
    const recipient = await resolveUser(recipientId);

    if (!sender) {
      return res.status(404).json({ success: false, error: 'Sender not found' });
    }
    if (!recipient) {
      return res.status(404).json({ success: false, error: 'Recipient not found' });
    }

    const fraudCheck = await antiScamService.preTransactionCheck({
      senderId: sender.id,
      recipientId: recipient.id,
      amount: parseFloat(amount),
      deviceInfo: req.body.deviceInfo || {},
    });

    if (!fraudCheck.approved) {
      try {
        const r = await audit.insertAuditLog({
          action: 'escrow_created',
          entity_type: 'transaction',
          entity_id: null,
          actor_id: sender.id,
          user_id: sender.id,
          metadata: {
            reason: 'fraud_check_failed',
            riskScore: fraudCheck.riskScore,
            flags: fraudCheck.flags,
          },
        });
        if (!r.success) logger.warn('audit RPC returned error (non-fatal): %o', r.error || r);
      } catch (e) {
        logger.warn('audit RPC failed (non-fatal): %o', e?.message || e);
      }

      return res.status(403).json({
        success: false,
        error: 'Transaction blocked for security review',
        code: 'FRAUD_CHECK_FAILED',
      });
    }

    const defaultExpiryHours = 7 * 24;
    const expiresAt = new Date(
      Date.now() + (expiryHours || defaultExpiryHours) * 60 * 60 * 1000
    );

    const pmartsRef = `PMT-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;

    const { data: escrow, error: createError } = await supabase
      .from('escrows')
      .insert({
        sender_id: sender.id,
        recipient_id: recipient.id,
        amount: parseFloat(amount),
        reference_id: referenceId,
        pmarts_reference: pmartsRef,
        note: note || null,
        status: 'pending',
        expires_at: expiresAt.toISOString(),
        risk_score: fraudCheck.riskScore,
        fraud_flags: fraudCheck.flags.length > 0 ? fraudCheck.flags : null,
        transaction_type: transactionType || 'other',
      })
      .select()
      .single();

    if (createError) {
      logger.error('Create escrow error: %o', createError);
      return res.status(500).json({ success: false, error: 'Failed to create escrow' });
    }

    const { error: transactionError } = await supabase
      .from('transactions')
      .insert({
        escrow_id: escrow.id,
        sender_id: sender.id,
        recipient_id: recipient.id,
        amount: escrow.amount,
        platform_fee: escrow.fee || 0,
        status: 'created',
        reference_id: escrow.reference_id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

    if (transactionError) {
      logger.error('Create transaction error: %o', transactionError);
      return res.status(500).json({ success: false, error: 'Failed to create transaction' });
    }

    const validType = transactionType || 'other';
    await completionService.initializeCompletion(escrow.id, validType);

    try {
      const r = await audit.insertAuditLog({
        action: 'escrow_created',
        entity_type: 'transaction',
        entity_id: escrow.id,
        actor_id: sender.id,
        user_id: sender.id,
        user_agent: req.headers['user-agent'] || null,
        session_id: req.headers['x-session-id'] || null,
        request_id: req.headers['x-request-id'] || null,
        metadata: {
          amount: escrow.amount,
          recipientId: recipient.id,
          referenceId,
          transactionType: validType,
        },
      });
      if (!r.success) logger.warn('audit RPC returned error (non-fatal): %o', r.error || r);
    } catch (e) {
      logger.warn('audit RPC failed (non-fatal): %o', e?.message || e);
    }

    res.json({
      success: true,
      escrow,
      transaction: {
        escrow_id: escrow.id,
        sender_id: sender.id,
        recipient_id: recipient.id,
        amount: escrow.amount,
        platform_fee: escrow.fee || 0,
        status: 'created',
        reference_id: escrow.reference_id,
      },
      pmartsReference: pmartsRef,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    logger.error('Create transaction error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;
