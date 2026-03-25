/**
 * PMARTS Escrow Completion Routes
 * 
 * Handles all completion methods:
 * - Delivery code verification (physical products)
 * - Sender release (digital products)
 * - Service approval (services)
 * - Receipt evidence (trade agreement / external payment arrangement)
 * - Mutual cancellation
 * 
 * Routes:
 * GET  /api/completion/code/:escrowId       - Get delivery code (sender only)
 * POST /api/completion/code/verify          - Verify delivery code
 * POST /api/completion/code/verify-qr       - Verify via QR scan
 * POST /api/completion/release              - Sender releases payment
 * POST /api/completion/service/complete     - Recipient marks service complete
 * POST /api/completion/service/approve      - Sender approves service
 * POST /api/completion/receipt/upload       - Upload receipt evidence
 * POST /api/completion/receipt/confirm      - Recipient confirms receipt
 * POST /api/completion/cancel/request       - Request mutual cancellation
 * POST /api/completion/cancel/approve       - Approve cancellation
 */

const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const completionService = require('../lib/completionService');
const escrowWalletService = require('../lib/escrowWalletService');
const logger = require('../lib/logger');
const crypto = require('crypto');

/**
 * Resolve authenticated user from Bearer session token
 */
async function getUserFromAuthHeader(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.substring(7);
  if (!token) return null;

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .select('user_id')
    .eq('token_hash', tokenHash)
    .single();

  if (sessionError || !session?.user_id) return null;

  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id,pi_id,pi_uid,username,role')
    .eq('id', session.user_id)
    .single();

  if (userError || !user) return null;
  return user;
}

async function requireAuthenticatedActor(req, res, next) {
  try {
    const actor = await getUserFromAuthHeader(req);
    if (!actor) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    req.actor = actor;
    return next();
  } catch (_error) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
}

/**
 * Require specific fields middleware
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

// ============================================
// DELIVERY CODE (Physical Products)
// ============================================

/**
 * GET /api/completion/code/:escrowId
 * 
 * Get delivery code for sender.
 * Only sender can see the code.
 */
router.get('/code/:escrowId', requireAuthenticatedActor, async (req, res) => {
  try {
    const { escrowId } = req.params;
    const actor = req.actor;

    const result = await completionService.getDeliveryCode(escrowId, actor.id);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json({
      success: true,
      code: result.code,
      qrPayload: result.qrPayload,
      expiresAt: result.expiresAt,
    });

  } catch (error) {
    logger.error('Get delivery code error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /api/completion/code/verify
 * 
 * Verify delivery code entered by recipient.
 */
router.post('/code/verify', requireAuthenticatedActor, requireFields('escrowId', 'code'), async (req, res) => {
  try {
    const { escrowId, code } = req.body;
    const actor = req.actor;

    const result = await completionService.verifyDeliveryCode(escrowId, code, actor.id);

    if (!result.success) {
      const statusCode = result.locked ? 423 : 400;
      return res.status(statusCode).json(result);
    }

    res.json(result);

  } catch (error) {
    logger.error('Verify delivery code error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /api/completion/code/verify-qr
 * 
 * Verify delivery via QR code scan.
 */
router.post('/code/verify-qr', requireAuthenticatedActor, requireFields('qrPayload'), async (req, res) => {
  try {
    const { qrPayload } = req.body;
    const actor = req.actor;

    const result = await completionService.verifyDeliveryQR(qrPayload, actor.id);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);

  } catch (error) {
    logger.error('Verify QR error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================
// MILESTONES (Partial Releases)
// ============================================

/**
 * GET /api/completion/milestones/:escrowId
 * Fetch milestones for an escrow (sender or recipient only)
 */
router.get('/milestones/:escrowId', requireAuthenticatedActor, async (req, res) => {
  try {
    const { escrowId } = req.params;
    const actor = req.actor;

    const { data: escrow } = await supabase
      .from('escrows')
      .select('id, sender_id, recipient_id')
      .eq('id', escrowId)
      .single();

    if (!escrow) {
      return res.status(404).json({ success: false, error: 'Escrow not found' });
    }

    if (![escrow.sender_id, escrow.recipient_id].includes(actor.id)) {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    const { data: milestones, error } = await supabase
      .from('escrow_milestones')
      .select('*')
      .eq('escrow_id', escrowId)
      .order('position', { ascending: true });

    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({ success: true, milestones: milestones || [] });
  } catch (error) {
    logger.error('Get milestones error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /api/completion/milestone/complete
 * Recipient marks a milestone as completed
 */
router.post('/milestone/complete', requireAuthenticatedActor, requireFields('escrowId', 'milestoneId'), async (req, res) => {
  try {
    const { escrowId, milestoneId } = req.body;
    const actor = req.actor;

    const { data: escrow } = await supabase
      .from('escrows')
      .select('sender_id, recipient_id')
      .eq('id', escrowId)
      .single();

    if (!escrow || escrow.recipient_id !== actor.id) {
      return res.status(403).json({ success: false, error: 'Only recipient can complete milestone' });
    }

    const { data: updated, error } = await supabase
      .from('escrow_milestones')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', milestoneId)
      .eq('escrow_id', escrowId)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }

    await escrowWalletService.syncEscrowStatusForMilestones(escrowId);
    res.json({ success: true, milestone: updated });
  } catch (error) {
    logger.error('Complete milestone error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /api/completion/milestone/approve
 * Sender approves milestone and triggers partial release
 */
router.post('/milestone/approve', requireAuthenticatedActor, requireFields('escrowId', 'milestoneId'), async (req, res) => {
  try {
    const { escrowId, milestoneId } = req.body;
    const actor = req.actor;

    const { data: escrow } = await supabase
      .from('escrows')
      .select('sender_id, status')
      .eq('id', escrowId)
      .single();

    if (!escrow || escrow.sender_id !== actor.id) {
      return res.status(403).json({ success: false, error: 'Only sender can approve milestone' });
    }

    if (!['held', 'funds_held', 'deposit_confirmed'].includes(escrow.status)) {
      return res.status(400).json({
        success: false,
        error: `Escrow must be funded before milestone approval (status: ${escrow.status})`,
      });
    }

    await supabase
      .from('escrow_milestones')
      .update({
        status: 'approved',
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', milestoneId)
      .eq('escrow_id', escrowId);

    const releaseResult = await escrowWalletService.releaseMilestone(escrowId, milestoneId, actor.id);
    if (!releaseResult.success) {
      return res.status(400).json(releaseResult);
    }

    res.json(releaseResult);
  } catch (error) {
    logger.error('Approve milestone error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================
// SENDER RELEASE (Digital Products)
// ============================================

/**
 * POST /api/completion/release
 * 
 * Sender manually releases payment.
 */
router.post('/release', requireAuthenticatedActor, requireFields('escrowId'), async (req, res) => {
  try {
    const { escrowId } = req.body;
    const actor = req.actor;

    const result = await completionService.senderRelease(escrowId, actor.id);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);

  } catch (error) {
    logger.error('Sender release error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================
// SERVICE APPROVAL (Services)
// ============================================

/**
 * POST /api/completion/service/complete
 * 
 * Recipient marks service as completed.
 */
router.post('/service/complete', requireAuthenticatedActor, requireFields('escrowId'), async (req, res) => {
  try {
    const { escrowId, proofUrl, description } = req.body;
    const actor = req.actor;

    const result = await completionService.markServiceCompleted(escrowId, actor.id, {
      proofUrl,
      description,
    });

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);

  } catch (error) {
    logger.error('Mark service complete error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /api/completion/service/approve
 * 
 * Sender approves service and releases payment.
 */
router.post('/service/approve', requireAuthenticatedActor, requireFields('escrowId'), async (req, res) => {
  try {
    const { escrowId, rating } = req.body;
    const actor = req.actor;

    const result = await completionService.approveServiceRelease(escrowId, actor.id, rating);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);

  } catch (error) {
    logger.error('Approve service error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================
// RECEIPT EVIDENCE (Trade Agreement)
// ============================================

/**
 * POST /api/completion/receipt/upload
 * 
 * Sender uploads receipt evidence.
 */
router.post('/receipt/upload', requireAuthenticatedActor, requireFields('escrowId', 'evidence'), async (req, res) => {
  try {
    const { escrowId, evidence } = req.body;
    const actor = req.actor;

    const result = await completionService.uploadReceiptEvidence(escrowId, actor.id, evidence);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);

  } catch (error) {
    logger.error('Upload receipt error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /api/completion/receipt/confirm
 * 
 * Recipient confirms receipt and releases Pi.
 */
router.post('/receipt/confirm', requireAuthenticatedActor, requireFields('escrowId'), async (req, res) => {
  try {
    const { escrowId } = req.body;
    const actor = req.actor;

    const result = await completionService.confirmReceiptRelease(escrowId, actor.id);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);

  } catch (error) {
    logger.error('Confirm receipt error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================
// MUTUAL CANCELLATION
// ============================================

/**
 * POST /api/completion/cancel/request
 * 
 * Request mutual cancellation.
 */
router.post('/cancel/request', requireAuthenticatedActor, requireFields('escrowId', 'reason'), async (req, res) => {
  try {
    const { escrowId, reason } = req.body;
    const actor = req.actor;

    const result = await completionService.requestCancellation(escrowId, actor.id, reason);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);

  } catch (error) {
    logger.error('Request cancellation error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /api/completion/cancel/approve
 * 
 * Approve cancellation and refund.
 */
router.post('/cancel/approve', requireAuthenticatedActor, requireFields('escrowId'), async (req, res) => {
  try {
    const { escrowId } = req.body;
    const actor = req.actor;

    const result = await completionService.approveCancellation(escrowId, actor.id);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);

  } catch (error) {
    logger.error('Approve cancellation error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================
// GET COMPLETION INFO
// ============================================

/**
 * GET /api/completion/info/:escrowId
 * 
 * Get completion method info for escrow.
 */
router.get('/info/:escrowId', requireAuthenticatedActor, async (req, res) => {
  try {
    const { escrowId } = req.params;
    const actor = req.actor;

    const { data: escrow, error } = await supabase
      .from('escrows')
      .select(`
        id,
        status,
        transaction_type,
        completion_method,
        code_used,
        code_expires_at,
        code_attempts,
        service_completed_at,
        service_proof_url,
        sender_confirmed_at,
        receipt_uploaded_at,
        receipt_confirmed_at,
        cancellation_requested_by,
        cancellation_reason,
        sender_id,
        recipient_id
      `)
      .eq('id', escrowId)
      .single();

    if (error || !escrow) {
      return res.status(404).json({ success: false, error: 'Escrow not found' });
    }

    const isSender = escrow.sender_id === actor.id;
    const isRecipient = escrow.recipient_id === actor.id;

    if (!isSender && !isRecipient) {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    // Build completion info based on method
    const completionInfo = {
      method: escrow.completion_method,
      transactionType: escrow.transaction_type,
      status: escrow.status,
    };

    switch (escrow.completion_method) {
      case 'delivery_code':
        completionInfo.codeUsed = escrow.code_used;
        completionInfo.codeExpiresAt = escrow.code_expires_at;
        completionInfo.attemptsRemaining = 5 - escrow.code_attempts;
        if (isSender) {
          // Sender sees code
          const codeResult = await completionService.getDeliveryCode(escrowId, actor.id);
          if (codeResult.success) {
            completionInfo.code = codeResult.code;
            completionInfo.qrPayload = codeResult.qrPayload;
          }
        }
        break;

      case 'service_approval':
        completionInfo.serviceCompleted = !!escrow.service_completed_at;
        completionInfo.serviceCompletedAt = escrow.service_completed_at;
        completionInfo.proofUrl = escrow.service_proof_url;
        break;

      case 'receipt_evidence':
        completionInfo.receiptUploaded = !!escrow.receipt_uploaded_at;
        completionInfo.receiptConfirmed = !!escrow.receipt_confirmed_at;
        break;

      case 'sender_release':
        completionInfo.senderConfirmed = !!escrow.sender_confirmed_at;
        break;
    }

    // Cancellation info
    if (escrow.cancellation_requested_by) {
      completionInfo.cancellationRequested = true;
      completionInfo.cancellationReason = escrow.cancellation_reason;
      completionInfo.canApproveCancellation =
        escrow.cancellation_requested_by !== actor.id &&
        (isSender || isRecipient);
    }

    // Get evidence if any
    const { data: evidence } = await supabase
      .from('completion_evidence')
      .select('*')
      .eq('escrow_id', escrowId)
      .order('created_at', { ascending: false });

    completionInfo.evidence = evidence || [];

    res.json({
      success: true,
      completion: completionInfo,
      userRole: isSender ? 'sender' : isRecipient ? 'recipient' : 'observer',
    });

  } catch (error) {
    logger.error('Get completion info error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

