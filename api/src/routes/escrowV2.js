/**
 * PMARTS Enhanced Escrow Routes (v2)
 * 
 * Full escrow lifecycle with:
 * - Fraud detection on creation
 * - Master wallet integration
 * - Dispute management
 * - Audit logging
 * 
 * Routes:
 * POST   /api/escrow/v2/create     - Create escrow with fraud check
 * POST   /api/escrow/v2/deposit    - Record deposit after Pi payment
 * POST   /api/escrow/v2/release    - Release funds to recipient
 * POST   /api/escrow/v2/refund     - Refund to sender
 * POST   /api/escrow/v2/dispute    - Open dispute
 * POST   /api/escrow/v2/dispute/respond - Counter-party response
 * POST   /api/escrow/v2/dispute/resolve - Admin resolution
 * GET    /api/escrow/v2/:id        - Get escrow details
 * GET    /api/escrow/v2/user/:userId - Get user's escrows
 * GET    /api/escrow/v2/wallet/summary - Master wallet summary
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const supabase = require('../lib/supabase');
const audit = require('../lib/audit');
const logger = require('../lib/logger');
// Log Supabase URL at startup to verify the runtime DB connection
logger.info('[escrowV2] SUPABASE_URL %s', process.env.SUPABASE_URL);
const antiScamService = require('../lib/antiScamService');
const escrowWalletService = require('../lib/escrowWalletService');
const disputeService = require('../lib/disputeService');
const completionService = require('../lib/completionService');
const { isUuid, resolveUserByIdOrPiId } = require('../lib/userResolver');

const AUTO_RELEASE_TRANSACTION_TYPES = new Set([
  'physical_product',
  'instant',
  'donation',
]);

const ESCROW_PUBLIC_COLUMNS = [
  'id',
  'sender_id',
  'recipient_id',
  'amount',
  'status',
  'description',
  'transaction_type',
  'completion_method',
  'confirmation_method',
  'code_used',
  'code_expires_at',
  'code_attempts',
  'deposit_verified',
  'deposit_verified_at',
  'pi_transaction_id',
  'created_at',
  'updated_at',
].join(',');

function resolveReleaseRouting(escrow) {
  const transactionType = String(escrow?.transaction_type || '').toLowerCase();
  const confirmationMethod = String(escrow?.confirmation_method || '').toLowerCase();

  if (AUTO_RELEASE_TRANSACTION_TYPES.has(transactionType)) {
    return {
      isAutoRelease: true,
      reason: `transaction_type:${transactionType}`,
    };
  }

  if (confirmationMethod === 'auto') {
    return {
      isAutoRelease: true,
      reason: 'confirmation_method:auto',
    };
  }

  return {
    isAutoRelease: false,
    reason: transactionType
      ? `transaction_type:${transactionType}`
      : `confirmation_method:${confirmationMethod || 'manual'}`,
  };
}

function isAdminOrSupportRole(role) {
  const normalized = String(role || '').toLowerCase();
  return ['admin', 'super_admin', 'support', 'staff'].includes(normalized);
}

/**
 * Middleware: Resolve user ID from various formats
 */
async function resolveUser(identifier) {
  if (!identifier) return null;
  // Perform sequential lookups to avoid .or() filter quoting issues
  try {
  logger.info('[resolveUser] lookup start: %o', { identifier });

    const idOrPiIdUser = await resolveUserByIdOrPiId(identifier);
    if (idOrPiIdUser) {
      logger.info('[resolveUser] found by id/pi_id: %o', { id: idOrPiIdUser.id });
      return idOrPiIdUser;
    }
    if (!isUuid(identifier)) {
      logger.info('[resolveUser] skipping id lookup, not a UUID: %o', { identifier });
    }

    // 3) pi_uid
    let result = await supabase.from('users').select('*').eq('pi_uid', identifier).maybeSingle();
    if (result.error) logger.warn('[resolveUser] pi_uid lookup error: %o', result.error);
    if (result.data) {
      logger.info('[resolveUser] found by pi_uid: %o', { id: result.data.id });
      return result.data;
    }

    // 4) username
    result = await supabase.from('users').select('*').eq('username', identifier).maybeSingle();
    if (result.error) logger.warn('[resolveUser] username lookup error: %o', result.error);
    if (result.data) {
      logger.info('[resolveUser] found by username: %o', { id: result.data.id });
      return result.data;
    }

    logger.info('[resolveUser] not found: %o', { identifier });
    return null;
  } catch (err) {
    logger.error('[resolveUser] unexpected error: %o', err);
    return null;
  }
}

/**
 * Middleware: Validate request has required fields
 */
function requireFields(...fields) {
  return (req, res, next) => {
    const missing = fields.filter(f => !req.body[f]);
    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Missing required fields: ${missing.join(', ')}`,
      });
    }
    next();
  };
}

async function getUserIdFromAuthHeader(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.substring(7);
  if (!token) return null;

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const { data: session, error } = await supabase
    .from('sessions')
    .select('user_id')
    .eq('token_hash', tokenHash)
    .single();
  if (error || !session?.user_id) return null;
  return session.user_id;
}

async function createAvatarSignedUrl(avatarPath) {
  if (!avatarPath) return null;
  try {
    const { data, error } = await supabase
      .storage
      .from('profile-avatars')
      .createSignedUrl(String(avatarPath), 60 * 10);
    if (error) return null;
    return data?.signedUrl || null;
  } catch (_e) {
    return null;
  }
}

async function decorateEscrowPartyForViewer(party, viewerUserId, escrow) {
  if (!party) return null;

  const visibility = String(party.avatar_visibility || 'public');
  const moderation = String(party.photo_review_status || 'approved');
  const isSelf = viewerUserId && String(viewerUserId) === String(party.id);
  const isCounterparty =
    viewerUserId &&
    (String(viewerUserId) === String(escrow?.sender_id) || String(viewerUserId) === String(escrow?.recipient_id));

  const canShow =
    isSelf ||
    (visibility === 'public' && moderation === 'approved') ||
    (visibility === 'counterparties_only' && isCounterparty && moderation === 'approved');

  return {
    id: party.id,
    pi_id: party.pi_id || party.pi_uid || null,
    pi_uid: party.pi_uid || null,
    username: party.username,
    trust_score: party.trust_score,
    avatar_visibility: visibility,
    photo_review_status: moderation,
    avatar_url: canShow ? await createAvatarSignedUrl(party.avatar_path) : null,
  };
}

// ============================================
// CREATE ESCROW
// ============================================

// Debug: expose constraint info when needed (production may restrict pg_catalog access)
router.get('/_debug/constraints', async (req, res) => {
  try {
    if (process.env.ENABLE_DEBUG_ROUTES !== 'true') {
      return res.status(404).json({ success: false, error: 'Not found' });
    }
    // Attempt to read pg_constraint entries (may be blocked by PostgREST/RLS)
    const { data, error } = await supabase.from('pg_constraint').select('conname, convalidated, conrelid, conrelid::regclass');
    if (error) {
      logger.warn('Constraint debug read error: %o', error);
      return res.status(500).json({ success: false, error: 'Failed to read pg_constraint', details: error });
    }
    return res.json({ success: true, constraints: data });
  } catch (err) {
    logger.error('Constraint debug unexpected error: %o', err);
    return res.status(500).json({ success: false, error: 'Unexpected error', details: String(err) });
  }
});

/**
 * POST /api/escrow/v2/log
 *
 * Log client-side issues to audit logs (server-side insert).
 */
router.post('/log', requireFields('escrowId', 'userId', 'message'), async (req, res) => {
  try {
    const { escrowId, userId, message, metadata } = req.body;
    const user = await resolveUser(userId);
    try {
      const r = await audit.insertAuditLog({
        action: 'security_alert',
        entity_type: 'transaction',
        entity_id: escrowId,
        user_id: user?.id || null,
        actor_id: user?.id || null,
        user_agent: req.headers['user-agent'] || null,
        session_id: req.headers['x-session-id'] || null,
        request_id: req.headers['x-request-id'] || null,
        metadata: {
          message,
          source: 'mobile',
          ...metadata,
        },
      });
      if (!r.success) logger.warn('audit RPC returned error (non-fatal): %o', r.error || r);
    } catch (e) {
      logger.warn('audit RPC failed (non-fatal): %o', e?.message || e);
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('Log issue error: %o', error);
    res.status(500).json({ success: false, error: 'Failed to log issue' });
  }
});

/**
 * POST /api/escrow/v2/create
 * 
 * Creates escrow with full fraud checking.
 * Status: 'pending' (awaiting Pi payment)
 */
router.post('/create', requireFields('amount', 'referenceId'), async (req, res) => {
  try {
    const { senderId, recipientId, amount, referenceId, note, expiryHours, transactionType } = req.body;

    if (!senderId || !recipientId) {
      return res.status(400).json({
        success: false,
        error: 'senderId and recipientId are required',
      });
    }

    // Resolve users
    const sender = await resolveUser(senderId);
    const recipient = await resolveUser(recipientId);

    if (!sender) {
      return res.status(404).json({ success: false, error: 'Sender not found' });
    }
    if (!recipient) {
      return res.status(404).json({ success: false, error: 'Recipient not found' });
    }

    // Run fraud checks
    const fraudCheck = await antiScamService.preTransactionCheck({
      senderId: sender.id,
      recipientId: recipient.id,
      amount: parseFloat(amount),
      deviceInfo: req.body.deviceInfo || {},
    });

    if (!fraudCheck.approved) {
      // Log blocked attempt (best-effort — use RPC to avoid RLS/schema-cache issues)
        try {
          const res = await audit.insertAuditLog({
            action: 'escrow_blocked',
            entity_type: 'escrow',
            actor_id: sender.id,
            user_agent: req.headers['user-agent'] || null,
            session_id: req.headers['x-session-id'] || null,
            request_id: req.headers['x-request-id'] || null,
            metadata: {
              reason: 'fraud_check_failed',
              riskScore: fraudCheck.riskScore,
              flags: fraudCheck.flags,
            },
          });
          if (!res.success) logger.warn('audit RPC returned error (non-fatal): %o', res.error || res);
        } catch (e) {
          logger.warn('audit RPC failed (non-fatal): %o', e?.message || e);
        }

      return res.status(403).json({
        success: false,
        error: 'Transaction blocked for security review',
        code: 'FRAUD_CHECK_FAILED',
        riskLevel: fraudCheck.riskLevel,
      });
    }

    // Calculate expiry
    const defaultExpiryHours = 7 * 24; // 7 days
    const expiresAt = new Date(
      Date.now() + (expiryHours || defaultExpiryHours) * 60 * 60 * 1000
    );

    // Generate PMARTS reference code
    const pmartsRef = `PMT-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;

    // Normalize transaction type early for use in inserts
    // The `transactions.type` column is a ledger kind (deposit, withdrawal, escrow_fee, refund)
    // Default to `deposit` for escrow creations when not explicitly provided.
    const allowedLedgerTypes = ['deposit', 'withdrawal', 'escrow_fee', 'refund'];
    const ledgerType = allowedLedgerTypes.includes(transactionType) ? transactionType : 'deposit';
    // Application-level transaction type (used for UI/notifications/audit)
    const appType = transactionType || 'other';

    // Create escrow record
    const { data: escrow, error: createError } = await supabase
      .from('escrows')
      .insert({
        sender_id: sender.id,
        recipient_id: recipient.id,
        amount: parseFloat(amount),
        reference_id: referenceId,
        pmarts_reference: pmartsRef,
        note: note || null,
        status: 'deposit_pending',
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

    // Prepare base transaction payload
    const txPayloadBase = {
      escrow_id: escrow.id,
      sender_id: sender.id,
      recipient_id: recipient.id,
      amount: escrow.amount,
      type: ledgerType,
      platform_fee: escrow.fee || 0,
      reference_id: escrow.reference_id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Try inserting without forcing status (use DB default), fallback to trying known statuses if constraint blocks
    let transactionError = null;
    let inserted = null;

    // Attempt 1: let DB apply default status
    let resp = await supabase.from('transactions').insert(txPayloadBase).select().maybeSingle();
    if (resp.error) {
      transactionError = resp.error;
      logger.warn('Initial transaction insert failed, will attempt fallback statuses: %o', transactionError);
    } else {
      inserted = resp.data;
    }

    // If initial insert failed due to status check, try a list of candidate statuses
    if (!inserted) {
      const candidateStatuses = ['created','pending_payment','funded','locked','completed','refunded','cancelled','disputed'];
      for (const s of candidateStatuses) {
        const tryPayload = { ...txPayloadBase, status: s };
        const tryResp = await supabase.from('transactions').insert(tryPayload).select().maybeSingle();
          if (!tryResp.error && tryResp.data) {
          inserted = tryResp.data;
          transactionError = null;
          logger.info('Transaction inserted with fallback status: %s', s);
          break;
        }
        transactionError = tryResp.error || transactionError;
      }
    }

    if (transactionError) {
      logger.error('Create transaction error: %o', transactionError);
      const debugErrorsEnabled = process.env.ENABLE_DEBUG_ROUTES === 'true';
      if (debugErrorsEnabled && req.query && String(req.query.debug) === '1') {
        return res.status(500).json({ success: false, error: 'Failed to create transaction record', debug: transactionError });
      }
      return res.status(500).json({ success: false, error: 'Failed to create transaction record' });
    }

    // Initialize completion method based on the (application) transaction type
    let completionResult = { success: false };
    try {
      completionResult = await completionService.initializeCompletion(escrow.id, appType);
    } catch (initErr) {
      logger.warn('Initialize completion error: %o', initErr);
      completionResult = { success: false };
    }

    if (createError) {
      logger.error('Create escrow error: %o', createError);
      return res.status(500).json({ success: false, error: 'Failed to create escrow' });
    }

    // Create audit log (best-effort via RPC)
    try {
      const res = await audit.insertAuditLog({
        action: 'escrow_created',
        entity_type: 'escrow',
        entity_id: escrow.id,
        actor_id: sender.id,
        user_agent: req.headers['user-agent'] || null,
        session_id: req.headers['x-session-id'] || null,
        request_id: req.headers['x-request-id'] || null,
        metadata: { amount, recipientId: recipient.id, referenceId, transactionType: appType },
      });
      if (!res.success) logger.warn('audit RPC returned error (continuing): %o', res.error || res);
    } catch (auditErr) {
      logger.warn('Audit RPC failed (continuing): %o', auditErr?.message || auditErr);
    }

    // Notify recipient
    const typeLabels = {
      physical_product: 'product',
      digital_product: 'digital product',
      service: 'service',
      currency_exchange: 'trade agreement',
      instant: 'instant transfer',
      donation: 'donation',
      custom: 'custom agreement',
      other: 'transaction',
    };
    const typeLabel = typeLabels[appType] || 'transaction';

    await supabase.from('notifications').insert({
      user_id: recipient.id,
      type: 'escrow_pending',
      title: 'Incoming Escrow',
      message: `@${sender.username} is creating a ${amount} Pi escrow for ${typeLabel}`,
      escrow_id: escrow.id,
    });

    // Build response
    const response = {
      success: true,
      escrow: completionResult.success ? completionResult.escrow : escrow,
      pmartsReference: pmartsRef,
      expiresAt: expiresAt.toISOString(),
      transactionType: transactionType || 'other',
      completionMethod: completionResult.completionMethod || completionService.TYPE_TO_METHOD[appType] || 'sender_release',
      senderId: sender.id,
      recipientId: recipient.id,
      fraudCheck: {
        riskLevel: fraudCheck.riskLevel,
        requiresReview: fraudCheck.requiresReview,
        delayMinutes: fraudCheck.delayMinutes,
      },
    };

    // Include delivery code for physical products (only shown to sender)
    if (completionResult.deliveryCode) {
      response.deliveryCode = completionResult.deliveryCode;
      response.qrPayload = completionResult.qrPayload;
    }

    res.json(response);

  } catch (error) {
    logger.error('Create escrow error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================
// RECORD DEPOSIT
// ============================================

/**
 * POST /api/escrow/v2/deposit
 * 
 * Records deposit after Pi payment is completed.
 * Called by mobile app after successful Pi payment.
 */
router.post('/deposit', requireFields('escrowId', 'paymentId', 'txid'), async (req, res) => {
  try {
    const { escrowId, paymentId, txid, amount } = req.body;

    logger.info('Record deposit request: %o', { escrowId, paymentId, txid, amount });

    // Log which Supabase host and whether service role key exists (per-request debug)
    try {
      logger.info('[deposit] SUPABASE_URL %s', process.env.SUPABASE_URL || '(not-set)');
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
      const masked = key ? `${key.slice(0,8)}...` : '(not-set)';
      logger.info('[deposit] SUPABASE_SERVICE_ROLE_KEY prefix %s', masked);
    } catch (e) {
      logger.warn('[deposit] failed to read SUPABASE env: %o', e?.message || e);
    }
    // Get escrow
    const { data: escrow, error: fetchError } = await supabase
      .from('escrows')
      .select('*')
      .eq('id', escrowId)
      .single();

    if (fetchError || !escrow) {
      logger.error('Record deposit fetch escrow error: %o', fetchError);
      return res.status(404).json({ success: false, error: 'Escrow not found' });
    }

    // Validate status
    if (escrow.status !== 'deposit_pending') {
      logger.warn('Record deposit invalid escrow status: %o', { escrowId, status: escrow.status });
      return res.status(409).json({
        success: false,
        error: `Cannot deposit to escrow in ${escrow.status} status`,
      });
    }

    // Check for existing payment record
    const { data: existingPayment, error: existingPaymentErr } = await supabase
      .from('payments')
      .select('id, escrow_id, status')
      .eq('pi_payment_id', paymentId)
      .single();

    if (existingPaymentErr && existingPaymentErr.code !== 'PGRST116') {
      logger.error('Error fetching existing payment: %o', existingPaymentErr);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }

    // If payment exists and is tied to a different escrow, reject as duplicate
    if (existingPayment && existingPayment.escrow_id && existingPayment.escrow_id !== escrowId) {
      logger.warn('Record deposit duplicate payment (different escrow): %o', { paymentId, escrowId, existingEscrow: existingPayment.escrow_id });
      return res.status(409).json({
        success: false,
        error: 'Payment already processed for another escrow',
        code: 'DUPLICATE_PAYMENT',
      });
    }

    // Otherwise, allow processing (existingPayment may be null or linked to this escrow or unlinked)

    // Record deposit in wallet service
    const depositResult = await escrowWalletService.recordDeposit({
      escrowId,
      paymentId,
      txid,
      amount: amount || escrow.amount,
      senderId: escrow.sender_id,
    });

    if (!depositResult.success) {
      // Diagnostic logging: print masked service key prefix, module, and stack/trace
      try {
        const maskedKey = process.env.SUPABASE_SERVICE_ROLE_KEY
          ? `${process.env.SUPABASE_SERVICE_ROLE_KEY.substring(0,8)}...`
          : '(not-set)';
        const moduleName = __filename || 'escrowV2';
        let errorDetails = depositResult.error;
        if (depositResult.error && depositResult.error.stack) {
          errorDetails = depositResult.error.stack;
        } else if (typeof depositResult.error === 'object') {
          try { errorDetails = JSON.stringify(depositResult.error); } catch (e) { errorDetails = String(depositResult.error); }
        }
        logger.error('[diagnostic] deposit failure — module: %s', moduleName);
        logger.error('[diagnostic] SUPABASE_SERVICE_ROLE_KEY prefix: %s', maskedKey);
        logger.error('[diagnostic] deposit error details: %o', errorDetails);
      } catch (diagErr) {
        logger.error('Failed to write diagnostic logs for deposit error: %o', diagErr);
      }

      // If audit-related DB errors caused the failure, attempt best-effort recovery:
      try {
        const errMsg = (depositResult.error && (depositResult.error.message || depositResult.error)).toString().toLowerCase();
        if (errMsg.includes('audit_logs') || errMsg.includes('relation "audit_logs"') || (depositResult.error && depositResult.error.code === '42P01')) {
          logger.warn('Audit-related error during deposit; attempting to fetch escrow state and continue');
          const { data: escrowPost, error: fetchErr } = await supabase
            .from('escrows')
            .select('*')
            .eq('id', escrowId)
            .single();
          if (!fetchErr && escrowPost && (escrowPost.status === 'funds_held' || escrowPost.status === 'held')) {
            return res.json({ success: true, escrow: escrowPost, message: 'Deposit recorded (audit write failed but core ops succeeded)' });
          }
        }
      } catch (recErr) {
        logger.error('Recovery fetch after deposit audit error failed: %o', recErr);
      }

      return res.status(500).json({ success: false, error: depositResult.error });
    }

    res.json({
      success: true,
      escrow: depositResult.escrow,
      message: 'Deposit recorded successfully',
    });

  } catch (error) {
    logger.error('Record deposit error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================
// RELEASE ESCROW
// ============================================

/**
 * POST /api/escrow/v2/release
 * 
 * Releases escrow funds to recipient.
 * Only sender can release.
 */
router.post('/release', requireFields('escrowId', 'userId'), async (req, res) => {
  try {
    const { escrowId, userId, evidenceUrls, notes } = req.body;

    const user = await resolveUser(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const { data: escrow, error: escrowError } = await supabase
      .from('escrows')
      .select('id, sender_id, recipient_id, status, confirmation_method, transaction_type')
      .eq('id', escrowId)
      .single();

    if (escrowError || !escrow) {
      return res.status(404).json({ success: false, error: 'Escrow not found' });
    }

    if (escrow.sender_id !== user.id) {
      return res.status(403).json({ success: false, error: 'Only sender can request release' });
    }

    const releaseRouting = resolveReleaseRouting(escrow);

    // Automatic-release escrow types execute payout immediately after sender confirms release.
    if (releaseRouting.isAutoRelease) {
      const result = await escrowWalletService.releaseEscrow(escrowId, user.id);

      if (!result.success) {
        return res.status(400).json({ success: false, error: result.error });
      }

      logger.info('[escrowV2.release] auto release executed', {
        escrowId,
        senderId: user.id,
        transactionType: escrow.transaction_type || null,
        confirmationMethod: escrow.confirmation_method || null,
        releaseRoutingReason: releaseRouting.reason,
      });

      return res.json({
        success: true,
        escrow: result.escrow,
        netAmount: result.netAmount,
        feeAmount: result.feeAmount,
        requestSubmitted: false,
        message: 'Funds released successfully',
        releasePath: 'auto',
      });
    }

    if (!['funds_held', 'delivery_in_progress', 'release_pending', 'held'].includes(String(escrow.status || '').toLowerCase())) {
      return res.status(400).json({ success: false, error: `Cannot request release from ${escrow.status} status` });
    }

    const { data: existingPending } = await supabase
      .from('release_requests')
      .select('id')
      .eq('escrow_id', escrowId)
      .eq('status', 'pending')
      .maybeSingle();

    if (existingPending?.id) {
      return res.status(409).json({
        success: false,
        error: 'A release request is already pending admin/support approval',
      });
    }

    const { data: releaseRequest, error: requestError } = await supabase
      .from('release_requests')
      .insert({
        escrow_id: escrowId,
        requested_by: user.id,
        status: 'pending',
        evidence_urls: Array.isArray(evidenceUrls) ? evidenceUrls : null,
        notes: notes || null,
      })
      .select()
      .single();

    if (requestError || !releaseRequest) {
      return res.status(500).json({ success: false, error: requestError?.message || 'Failed to create release request' });
    }

    const { data: updatedEscrow } = await supabase
      .from('escrows')
      .update({ status: 'release_requested', updated_at: new Date().toISOString() })
      .eq('id', escrowId)
      .select()
      .single();

    logger.info('[escrowV2.release] release queued for admin approval', {
      escrowId,
      senderId: user.id,
      transactionType: escrow.transaction_type || null,
      confirmationMethod: escrow.confirmation_method || null,
      releaseRoutingReason: releaseRouting.reason,
    });

    // Notify recipient that sender requested release
    await supabase.from('notifications').insert({
      user_id: escrow.recipient_id,
      type: 'release_requested',
      title: 'Release Requested',
      message: 'Sender has requested admin/support approval to release this escrow.',
      escrow_id: escrowId,
      is_read: false,
    }).catch(() => {});

    return res.json({
      success: true,
      requestSubmitted: true,
      releaseRequest,
      escrow: updatedEscrow || escrow,
      message: 'Release queued for admin/support approval',
      releasePath: 'admin_queue',
    });

  } catch (error) {
    logger.error('Release escrow error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================
// REFUND REQUEST (GOVERNED)
// ============================================

/**
 * POST /api/escrow/v2/refund
 *
 * Creates a refund_request record for admin review.
 * Refunds are NEVER executed immediately — they require admin approval.
 *
 * Strict requirements:
 *   - reason        (required, enum)
 *   - justification (required for sender_request, min 20 chars)
 *   - evidenceUrls  (required for non-mutual-agreement reasons, min 1 item)
 *   - contactAttempted (must be true unless the reason is payment_failure/platform_error)
 *
 * Returns 202 Accepted — the request is queued, not yet processed.
 */
router.post('/refund', requireFields('escrowId', 'userId', 'reason'), async (req, res) => {
  try {
    const {
      escrowId,
      userId,
      reason,
      justification,
      evidenceUrls = [],
      contactAttempted = false,
    } = req.body;

    const VALID_REASONS = [
      'non_delivery', 'partial_delivery', 'wrong_item', 'quality_issue',
      'fraud', 'mutual_agreement', 'payment_failure', 'platform_error', 'other',
    ];
    if (!VALID_REASONS.includes(reason)) {
      return res.status(400).json({
        success: false,
        error: `Invalid reason. Must be one of: ${VALID_REASONS.join(', ')}`,
      });
    }

    const user = await resolveUser(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const { data: escrow, error: escrowError } = await supabase
      .from('escrows')
      .select('id, sender_id, recipient_id, status, amount, confirmation_method, reference_id')
      .eq('id', escrowId)
      .single();

    if (escrowError || !escrow) {
      return res.status(404).json({ success: false, error: 'Escrow not found' });
    }

    // Only sender or admin may request a refund
    const isAdmin = ['admin', 'super_admin'].includes(user.role);
    if (user.id !== escrow.sender_id && !isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Only the sender or an admin can request a refund',
      });
    }

    // Escrow must hold funds
    const refundableStatuses = ['funds_held', 'held', 'refund_requested'];
    if (!refundableStatuses.includes(escrow.status)) {
      return res.status(400).json({
        success: false,
        error: `Cannot request a refund for an escrow in '${escrow.status}' status`,
      });
    }

    // Strict validation for sender-initiated requests
    const systemReason = ['payment_failure', 'platform_error'].includes(reason);

    if (!systemReason) {
      if (!justification || justification.trim().length < 20) {
        return res.status(400).json({
          success: false,
          error: 'A justification of at least 20 characters is required',
        });
      }

      if (!Array.isArray(evidenceUrls) || evidenceUrls.length === 0) {
        if (reason !== 'mutual_agreement') {
          return res.status(400).json({
            success: false,
            error: 'At least one piece of evidence is required for this refund reason',
          });
        }
      }

      // Fraud requires at least 2 evidence items
      if (reason === 'fraud' && evidenceUrls.length < 2) {
        return res.status(400).json({
          success: false,
          error: 'Fraud claims require at least 2 evidence items',
        });
      }

      if (!contactAttempted) {
        return res.status(400).json({
          success: false,
          error: 'You must have attempted to contact the recipient before requesting a refund',
        });
      }
    }

    // Only one active refund request per escrow at a time
    const { data: existing } = await supabase
      .from('refund_requests')
      .select('id, status')
      .eq('escrow_id', escrowId)
      .in('status', ['pending', 'under_review'])
      .maybeSingle();

    if (existing) {
      return res.status(409).json({
        success: false,
        error: 'A refund request for this escrow is already under review',
      });
    }

    // Create the refund request
    const { data: refundRequest, error: insertError } = await supabase
      .from('refund_requests')
      .insert({
        escrow_id: escrowId,
        requested_by: user.id,
        trigger_type: isAdmin ? 'admin_initiated' : 'sender_request',
        reason,
        justification: justification?.trim() || null,
        evidence_urls: evidenceUrls,
        contact_attempted: contactAttempted,
        status: 'pending',
      })
      .select()
      .single();

    if (insertError) {
      logger.error('Refund request insert error: %o', insertError);
      return res.status(500).json({ success: false, error: 'Failed to create refund request' });
    }

    // Update escrow status to reflect pending refund
    await supabase
      .from('escrows')
      .update({ status: 'refund_requested', updated_at: new Date().toISOString() })
      .eq('id', escrowId)
      .in('status', ['funds_held', 'held']);

    // Notify admin/support team
    await supabase.from('notifications').insert([
      {
        type: 'refund_request_submitted',
        title: 'New Refund Request',
        message: `Refund requested for escrow ${escrow.reference_id || escrowId} — reason: ${reason}`,
        escrow_id: escrowId,
        user_id: null, // system-wide admin notification — no specific recipient
      },
    ]).catch(() => {});

    return res.status(202).json({
      success: true,
      refundRequest,
      message: 'Refund request submitted. An admin will review it shortly.',
    });

  } catch (error) {
    logger.error('Refund request error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================
// DISPUTE MANAGEMENT
// ============================================

/**
 * POST /api/escrow/v2/dispute
 * 
 * Opens a new dispute.
 */
router.post('/dispute', requireFields('escrowId', 'userId', 'reason'), async (req, res) => {
  try {
    const { escrowId, userId, reason, description, evidenceUrls } = req.body;

    const user = await resolveUser(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const result = await disputeService.createDispute({
      escrowId,
      filedBy: user.id,
      reason,
      description,
      evidenceUrls: evidenceUrls || [],
    });

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }

    res.json({
      success: true,
      dispute: result.dispute,
      responseDeadline: result.responseDeadline,
      message: 'Dispute filed successfully',
    });

  } catch (error) {
    logger.error('Create dispute error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /api/escrow/v2/dispute/respond
 * 
 * Counter-party responds to dispute.
 */
router.post('/dispute/respond', requireFields('disputeId', 'userId', 'response'), async (req, res) => {
  try {
    const { disputeId, userId, response, evidenceUrls } = req.body;

    const user = await resolveUser(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const result = await disputeService.respondToDispute({
      disputeId,
      respondedBy: user.id,
      response,
      evidenceUrls: evidenceUrls || [],
    });

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }

    res.json({
      success: true,
      message: result.message,
    });

  } catch (error) {
    logger.error('Respond to dispute error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /api/escrow/v2/dispute/resolve
 * 
 * Admin resolves dispute.
 */
router.post('/dispute/resolve', requireFields('disputeId', 'adminId', 'resolution'), async (req, res) => {
  try {
    const { disputeId, adminId, resolution, resolutionNotes, splitPercentage } = req.body;

    // Verify admin
    const admin = await resolveUser(adminId);
    if (!admin || admin.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    const result = await disputeService.resolveDispute({
      disputeId,
      adminId: admin.id,
      resolution,
      resolutionNotes,
      splitPercentage,
    });

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }

    res.json({
      success: true,
      resolution: result.resolution,
      senderAmount: result.senderAmount,
      recipientAmount: result.recipientAmount,
    });

  } catch (error) {
    logger.error('Resolve dispute error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET /api/escrow/v2/dispute/:disputeId
 * 
 * Get dispute details with evidence.
 */
router.get('/dispute/:disputeId', async (req, res) => {
  try {
    const { disputeId } = req.params;

    const dispute = await disputeService.getDispute(disputeId);
    const evidence = await disputeService.getDisputeEvidence(disputeId);

    res.json({
      success: true,
      dispute,
      evidence,
    });

  } catch (error) {
    logger.error('Get dispute error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================
// ESCROW QUERIES
// ============================================

/**
 * GET /api/escrow/v2/:id
 * 
 * Get escrow details with related data.
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const viewerUserId = await getUserIdFromAuthHeader(req);
    if (!viewerUserId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const viewer = await resolveUser(viewerUserId);
    const viewerIsPrivileged = isAdminOrSupportRole(viewer?.role);

    const { data: escrow, error } = await supabase
      .from('escrows')
      .select(`
        ${ESCROW_PUBLIC_COLUMNS},
        sender:sender_id(id, pi_id, pi_uid, username, trust_score, avatar_path, avatar_visibility, photo_review_status),
        recipient:recipient_id(id, pi_id, pi_uid, username, trust_score, avatar_path, avatar_visibility, photo_review_status)
      `)
      .eq('id', id)
      .single();

    if (error || !escrow) {
      return res.status(404).json({ success: false, error: 'Escrow not found' });
    }

    const isParticipant =
      String(escrow.sender_id) === String(viewerUserId) ||
      String(escrow.recipient_id) === String(viewerUserId);

    if (!isParticipant && !viewerIsPrivileged) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    escrow.sender = await decorateEscrowPartyForViewer(escrow.sender, viewerUserId, escrow);
    escrow.recipient = await decorateEscrowPartyForViewer(escrow.recipient, viewerUserId, escrow);

    // Get ledger entries
    const ledger = await escrowWalletService.getEscrowLedger(id);

    // Get dispute if exists
    const { data: dispute } = await supabase
      .from('disputes')
      .select('id,escrow_id,status,reason,description,created_at,updated_at')
      .eq('escrow_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    res.json({
      success: true,
      escrow,
      ledger,
      dispute,
    });

  } catch (error) {
    logger.error('Get escrow error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET /api/escrow/v2/user/:userId
 * 
 * Get all escrows for a user.
 */
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { status, role, limit = 20 } = req.query;
    const viewerUserId = await getUserIdFromAuthHeader(req);
    if (!viewerUserId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const viewer = await resolveUser(viewerUserId);
    const viewerIsPrivileged = isAdminOrSupportRole(viewer?.role);

    const user = await resolveUser(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    if (!viewerIsPrivileged && String(viewerUserId) !== String(user.id)) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    let query = supabase
      .from('escrows')
      .select(`
        ${ESCROW_PUBLIC_COLUMNS},
        sender:sender_id(id, pi_id, pi_uid, username, trust_score, avatar_path, avatar_visibility, photo_review_status),
        recipient:recipient_id(id, pi_id, pi_uid, username, trust_score, avatar_path, avatar_visibility, photo_review_status)
      `)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));

    // Filter by role
    if (role === 'sender') {
      query = query.eq('sender_id', user.id);
    } else if (role === 'recipient') {
      query = query.eq('recipient_id', user.id);
    } else {
      query = query.or(`sender_id.eq.${user.id},recipient_id.eq.${user.id}`);
    }

    // Filter by status
    if (status) {
      query = query.eq('status', status);
    }

    const { data: escrows, error } = await query;

    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }

    const decoratedEscrows = await Promise.all((escrows || []).map(async (escrowRow) => ({
      ...escrowRow,
      sender: await decorateEscrowPartyForViewer(escrowRow.sender, viewerUserId, escrowRow),
      recipient: await decorateEscrowPartyForViewer(escrowRow.recipient, viewerUserId, escrowRow),
    })));

    // Get user's escrow balance
    const balance = await escrowWalletService.getUserEscrowBalance(user.id);

    res.json({
      success: true,
      escrows: decoratedEscrows,
      balance: balance.balance,
    });

  } catch (error) {
    logger.error('Get user escrows error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================
// WALLET OPERATIONS
// ============================================

/**
 * GET /api/escrow/v2/wallet/summary
 * 
 * Get master wallet summary (admin only).
 */
router.get('/wallet/summary', async (req, res) => {
  try {
    // In production, add admin auth check here
    const result = await escrowWalletService.getWalletSummary();

    if (!result.success) {
      return res.status(500).json({ success: false, error: result.error });
    }

    res.json({
      success: true,
      summary: result.summary,
    });

  } catch (error) {
    logger.error('Get wallet summary error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================
// EVIDENCE UPLOAD
// ============================================

/**
 * POST /api/escrow/v2/dispute/evidence
 * 
 * Add evidence to dispute.
 */
router.post('/dispute/evidence', requireFields('disputeId', 'userId', 'evidence'), async (req, res) => {
  try {
    const { disputeId, userId, evidence } = req.body;

    const user = await resolveUser(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const result = await disputeService.addEvidence(disputeId, user.id, evidence);

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }

    res.json({
      success: true,
      evidence: result.evidence,
    });

  } catch (error) {
    logger.error('Add evidence error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

