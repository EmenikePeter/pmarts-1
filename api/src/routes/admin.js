/**
 * Admin routes for manual system jobs.
 */

const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
// cronJobs file removed - cron-based auto-release disabled.
// Previously this module provided scheduled jobs; provide safe stubs instead.
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
    const missing = fields.filter((field) => !req.body[field]);
    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Missing required fields: ${missing.join(', ')}`,
      });
    }
    next();
  };
}

async function logAdminJob(adminId, jobKey, result) {
  await supabase.from('admin_logs').insert({
    action: `Manual job: ${jobKey}`,
    details: JSON.stringify(result || {}),
    level: 'info',
    user_id: adminId,
  });
}

const JOBS = {
  'auto-release': async () => ({ success: false, error: 'Auto-release cron disabled' }),
  'auto-expire': async () => ({ success: false, error: 'Auto-expire cron disabled' }),
  reminders: async () => ({ success: false, error: 'Reminders cron disabled' }),
  reconcile: async () => ({ success: false, error: 'Reconcile cron disabled' }),
  'dispute-escalation': async () => ({ success: false, error: 'Dispute escalation cron disabled' }),
  cleanup: async () => ({ success: false, error: 'Cleanup cron disabled' }),
  'run-all': async () => ({ success: false, error: 'Cron subsystem removed' }),
};

function isAdminOrSupportRole(role) {
  const normalized = String(role || '').toLowerCase();
  return ['admin', 'super_admin', 'support', 'staff'].includes(normalized);
}

async function resolveReviewerFromRequest(req) {
  const serviceKey = req.headers['x-service-key'] || req.headers['x-internal-key'] || req.headers['x-api-key'];
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const reviewerIdentifier = req.body?.reviewedBy || req.query?.reviewedBy;

  if (serviceKey && SUPABASE_SERVICE_ROLE_KEY && serviceKey === SUPABASE_SERVICE_ROLE_KEY) {
    const reviewer = reviewerIdentifier ? await resolveUser(reviewerIdentifier) : null;
    if (reviewer && !isAdminOrSupportRole(reviewer.role)) {
      return { ok: false, status: 403, error: 'Forbidden' };
    }
    return { ok: true, reviewerId: reviewer?.id || null, actor: reviewer?.id || 'system' };
  }

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const tokenHash = require('crypto').createHash('sha256').update(token).digest('hex');
    const { data: session, error: sErr } = await supabase.from('sessions').select('user_id').eq('token_hash', tokenHash).single();
    if (sErr || !session) return { ok: false, status: 401, error: 'Unauthorized' };
    const reviewer = await resolveUser(session.user_id);
    if (!reviewer || !isAdminOrSupportRole(reviewer.role)) return { ok: false, status: 403, error: 'Forbidden' };
    return { ok: true, reviewerId: reviewer.id, actor: reviewer.id };
  }

  return { ok: false, status: 401, error: 'Unauthorized' };
}

// Admin: view recent webhook_logs entries for debugging
router.get('/webhook-logs', async (req, res) => {
  try {
    const serviceKey = req.headers['x-service-key'] || req.headers['x-internal-key'] || req.headers['x-api-key'];
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey || serviceKey !== SUPABASE_SERVICE_ROLE_KEY) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const limit = parseInt(req.query.limit || '50');
    const { data, error } = await supabase.from('webhook_logs').select('*').order('created_at', { ascending: false }).limit(limit);
    if (error) return res.status(500).json({ success: false, error: error.message || error });
    res.json({ success: true, logs: data });
  } catch (e) {
    logger.error('Admin webhook-logs error: %o', e);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Admin: view push retry queue for debugging
router.get('/push-queue', async (req, res) => {
  try {
    const serviceKey = req.headers['x-service-key'] || req.headers['x-internal-key'] || req.headers['x-api-key'];
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey || serviceKey !== SUPABASE_SERVICE_ROLE_KEY) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const limit = parseInt(req.query.limit || '50');
    const { data, error } = await supabase.from('push_retry_queue').select('*').order('created_at', { ascending: false }).limit(limit);
    if (error) return res.status(500).json({ success: false, error: error.message || error });
    res.json({ success: true, queue: data });
  } catch (e) {
    logger.error('Admin push-queue error: %o', e);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Admin: view recent sessions (sensitive - requires service role key)
router.get('/sessions', async (req, res) => {
  try {
    const serviceKey = req.headers['x-service-key'] || req.headers['x-internal-key'] || req.headers['x-api-key'];
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey || serviceKey !== SUPABASE_SERVICE_ROLE_KEY) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const limit = parseInt(req.query.limit || '50');
    // Select non-sensitive session fields and include basic user info
    const { data, error } = await supabase
      .from('sessions')
      .select('id, user_id, created_at, expires_at, last_used_at, is_active, user:user_id(id, username, pi_id, trust_score)')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) return res.status(500).json({ success: false, error: error.message || error });
    res.json({ success: true, sessions: data });
  } catch (e) {
    logger.error('Admin sessions error: %o', e);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Admin: check a raw token against session store (admin-only)
router.post('/sessions/check', async (req, res) => {
  try {
    const serviceKey = req.headers['x-service-key'] || req.headers['x-internal-key'] || req.headers['x-api-key'];
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey || serviceKey !== SUPABASE_SERVICE_ROLE_KEY) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const token = req.body?.token || null;
    if (!token || typeof token !== 'string') return res.status(400).json({ success: false, error: 'Missing token in body' });

    const tokenHash = require('crypto').createHash('sha256').update(token).digest('hex');

    const { data: session, error } = await supabase
      .from('sessions')
      .select('id, user_id, created_at, expires_at, last_used_at, is_active, pi_access_token')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (error) return res.status(500).json({ success: false, error: error.message || error });
    if (!session) return res.status(404).json({ success: false, error: 'Session not found' });

    // Mask pi_access_token in response
    if (session.pi_access_token) session.pi_access_token = '<masked>'; 

    res.json({ success: true, session });
  } catch (e) {
    logger.error('Admin sessions.check error: %o', e);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.post('/jobs/:jobKey', requireFields('adminId'), async (req, res) => {
  try {
    const { jobKey } = req.params;
    const { adminId } = req.body;

    const admin = await resolveUser(adminId);
    if (!admin || admin.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    const job = JOBS[jobKey];
    if (!job) {
      return res.status(404).json({ success: false, error: 'Unknown job' });
    }

    const result = await job();
    await logAdminJob(admin.id, jobKey, result);

    res.json({ success: true, job: jobKey, result });
  } catch (error) {
    logger.error('Run admin job error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/admin/resolve-dispute - resolve a dispute (can be called by an authenticated admin or by a service key)
router.post('/resolve-dispute', requireFields('disputeId','resolution'), async (req, res) => {
  try {
    const serviceKey = req.headers['x-service-key'] || req.headers['x-internal-key'] || req.headers['x-api-key'];
    const authHeader = req.headers.authorization;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    let adminId = null;

    // If a service key matches, allow system action
    if (serviceKey && SUPABASE_SERVICE_ROLE_KEY && serviceKey === SUPABASE_SERVICE_ROLE_KEY) {
      adminId = null; // system actor
    } else if (authHeader && authHeader.startsWith('Bearer ')) {
      // Try to resolve user from provided Bearer token (reuse sessions lookup)
      const token = authHeader.substring(7);
      const tokenHash = require('crypto').createHash('sha256').update(token).digest('hex');
      const { data: session, error: sErr } = await supabase.from('sessions').select('user_id').eq('token_hash', tokenHash).single();
      if (sErr || !session) return res.status(401).json({ success: false, error: 'Unauthorized' });
      const admin = await resolveUser(session.user_id);
      if (!admin || admin.role !== 'admin') return res.status(403).json({ success: false, error: 'Forbidden' });
      adminId = admin.id;
    } else {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { disputeId, resolution, resolutionNotes, splitPercentage } = req.body;

    const disputeService = require('../lib/disputeService');
    const result = await disputeService.resolveDispute({ disputeId, adminId, resolution, resolutionNotes, splitPercentage });

    await logAdminJob(adminId || 'system', `resolve-dispute:${disputeId}`, { result });

    if (!result || !result.success) return res.status(500).json({ success: false, error: result?.error || 'Failed to resolve dispute' });
    res.json({ success: true, result });
  } catch (error) {
    logger.error('Resolve dispute admin error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/admin/claim-dispute - claim a dispute for review (can be called by an authenticated admin or by a service key + adminId)
router.post('/claim-dispute', requireFields('disputeId'), async (req, res) => {
  try {
    const serviceKey = req.headers['x-service-key'] || req.headers['x-internal-key'] || req.headers['x-api-key'];
    const authHeader = req.headers.authorization;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    let adminId = null;

    if (serviceKey && SUPABASE_SERVICE_ROLE_KEY && serviceKey === SUPABASE_SERVICE_ROLE_KEY) {
      // allow service key but require adminId in body to know who is claiming
      if (!req.body?.adminId) return res.status(400).json({ success: false, error: 'Missing adminId when using service key' });
      const admin = await resolveUser(req.body.adminId);
      if (!admin || admin.role !== 'admin') return res.status(403).json({ success: false, error: 'Forbidden' });
      adminId = admin.id;
    } else if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const tokenHash = require('crypto').createHash('sha256').update(token).digest('hex');
      const { data: session, error: sErr } = await supabase.from('sessions').select('user_id').eq('token_hash', tokenHash).single();
      if (sErr || !session) return res.status(401).json({ success: false, error: 'Unauthorized' });
      const admin = await resolveUser(session.user_id);
      if (!admin || admin.role !== 'admin') return res.status(403).json({ success: false, error: 'Forbidden' });
      adminId = admin.id;
    } else {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { disputeId } = req.body;
    const disputeService = require('../lib/disputeService');
    const result = await disputeService.claimDispute(disputeId, adminId);

    await logAdminJob(adminId || 'system', `claim-dispute:${disputeId}`, { result });

    if (!result) return res.status(500).json({ success: false, error: 'Failed to claim dispute' });
    if (!result.success) {
      if (result.status === 409) {
        return res.status(409).json({ success: false, error: result.error || 'Already claimed', claimedBy: result.claimedBy });
      }
      return res.status(500).json({ success: false, error: result.error || 'Failed to claim dispute' });
    }

    res.json({ success: true, dispute: result.dispute });
  } catch (error) {
    logger.error('Claim dispute admin error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/admin/release-escrow - approve sender release request and execute payout
router.post('/release-escrow', requireFields('escrowId'), async (req, res) => {
  try {
    const auth = await resolveReviewerFromRequest(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });

    const { escrowId, notes } = req.body;

    const { data: releaseRequest, error: requestError } = await supabase
      .from('release_requests')
      .select('*')
      .eq('escrow_id', escrowId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (requestError) {
      return res.status(500).json({ success: false, error: requestError.message || 'Failed to fetch release request' });
    }
    if (!releaseRequest) {
      return res.status(400).json({ success: false, error: 'No pending release request from sender for this escrow' });
    }

    const { data: escrow, error: escrowError } = await supabase
      .from('escrows')
      .select('id, sender_id')
      .eq('id', escrowId)
      .single();

    if (escrowError || !escrow) {
      return res.status(404).json({ success: false, error: 'Escrow not found' });
    }

    const escrowWalletService = require('../lib/escrowWalletService');
    const releaseResult = await escrowWalletService.releaseEscrow(escrowId, escrow.sender_id);
    if (!releaseResult.success) {
      return res.status(400).json({ success: false, error: releaseResult.error || 'Release failed' });
    }

    await supabase
      .from('release_requests')
      .update({
        status: 'approved',
        reviewed_by: auth.reviewerId,
        reviewed_at: new Date().toISOString(),
        review_notes: notes || null,
      })
      .eq('id', releaseRequest.id);

    await supabase.from('notifications').insert([
      {
        user_id: escrow.sender_id,
        type: 'release_approved',
        title: 'Release Approved',
        message: 'Admin/support approved your release request. Funds have been released.',
        escrow_id: escrowId,
      },
    ]).catch(() => {});

    await logAdminJob(auth.actor, `approve-release:${escrowId}`, {
      releaseRequestId: releaseRequest.id,
      reviewedBy: auth.reviewerId,
      notes: notes || null,
    });

    return res.json({
      success: true,
      escrow: releaseResult.escrow,
      netAmount: releaseResult.netAmount,
      feeAmount: releaseResult.feeAmount,
      message: 'Release approved and funds paid out',
    });
  } catch (error) {
    logger.error('Admin release-escrow error: %o', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/admin/release-escrow/reject - reject sender release request
router.post('/release-escrow/reject', requireFields('escrowId'), async (req, res) => {
  try {
    const auth = await resolveReviewerFromRequest(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });

    const { escrowId, notes } = req.body;

    const { data: releaseRequest, error: requestError } = await supabase
      .from('release_requests')
      .select('*')
      .eq('escrow_id', escrowId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (requestError) {
      return res.status(500).json({ success: false, error: requestError.message || 'Failed to fetch release request' });
    }
    if (!releaseRequest) {
      return res.status(400).json({ success: false, error: 'No pending release request from sender for this escrow' });
    }

    const { data: escrow, error: escrowError } = await supabase
      .from('escrows')
      .select('id, sender_id')
      .eq('id', escrowId)
      .single();

    if (escrowError || !escrow) {
      return res.status(404).json({ success: false, error: 'Escrow not found' });
    }

    await supabase
      .from('release_requests')
      .update({
        status: 'rejected',
        reviewed_by: auth.reviewerId,
        reviewed_at: new Date().toISOString(),
        review_notes: notes || null,
      })
      .eq('id', releaseRequest.id);

    await supabase
      .from('escrows')
      .update({ status: 'funds_held', updated_at: new Date().toISOString() })
      .eq('id', escrowId)
      .in('status', ['release_requested', 'release_pending']);

    await supabase.from('notifications').insert([
      {
        user_id: escrow.sender_id,
        type: 'release_rejected',
        title: 'Release Request Rejected',
        message: notes || 'Admin/support rejected your release request. Please review and submit again if needed.',
        escrow_id: escrowId,
      },
    ]).catch(() => {});

    await logAdminJob(auth.actor, `reject-release:${escrowId}`, {
      releaseRequestId: releaseRequest.id,
      reviewedBy: auth.reviewerId,
      notes: notes || null,
    });

    return res.json({ success: true, message: 'Release request rejected' });
  } catch (error) {
    logger.error('Admin release-escrow reject error: %o', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/admin/release-requests - list pending/completed release requests for dashboard queues
router.get('/release-requests', async (req, res) => {
  try {
    const auth = await resolveReviewerFromRequest(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });

    const status = String(req.query.status || 'pending').toLowerCase();
    const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200);

    let query = supabase
      .from('release_requests')
      .select('id, escrow_id, requested_by, status, evidence_urls, notes, reviewed_by, reviewed_at, review_notes, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (status !== 'all') query = query.eq('status', status);

    const { data, error } = await query;
    if (error) return res.status(500).json({ success: false, error: error.message || 'Failed to fetch release requests' });

    return res.json({ success: true, requests: data || [] });
  } catch (error) {
    logger.error('Admin release-requests list error: %o', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================
// REFUND REQUEST GOVERNANCE
// Refunds require strict investigation before execution.
// Flow: pending → under_review → approved (executes refund) | rejected
// ============================================

// GET /api/admin/refund-requests - list refund requests queue
router.get('/refund-requests', async (req, res) => {
  try {
    const auth = await resolveReviewerFromRequest(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });

    const status = String(req.query.status || 'pending').toLowerCase();
    const triggerType = req.query.trigger_type ? String(req.query.trigger_type) : null;
    const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200);

    let query = supabase
      .from('refund_requests')
      .select(`
        id, escrow_id, requested_by, trigger_type, reason, justification,
        evidence_urls, contact_attempted, pi_payment_id, failure_error_code,
        failure_error_message, status, investigation_notes, reviewed_by,
        reviewed_at, review_notes, refund_amount, refund_type, created_at, updated_at
      `)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (status !== 'all') query = query.eq('status', status);
    if (triggerType) query = query.eq('trigger_type', triggerType);

    const { data, error } = await query;
    if (error) return res.status(500).json({ success: false, error: error.message || 'Failed to fetch refund requests' });

    return res.json({ success: true, requests: data || [] });
  } catch (error) {
    logger.error('Admin refund-requests list error: %o', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/admin/refund-requests/:id/review - claim a refund request for investigation
router.post('/refund-requests/:id/review', async (req, res) => {
  try {
    const auth = await resolveReviewerFromRequest(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });

    const { id } = req.params;
    const { investigationNotes } = req.body;

    const { data: refundReq, error: fetchError } = await supabase
      .from('refund_requests')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (fetchError) return res.status(500).json({ success: false, error: fetchError.message });
    if (!refundReq) return res.status(404).json({ success: false, error: 'Refund request not found' });
    if (refundReq.status !== 'pending') {
      return res.status(400).json({ success: false, error: `Request is already ${refundReq.status}` });
    }

    await supabase
      .from('refund_requests')
      .update({
        status: 'under_review',
        reviewed_by: auth.reviewerId,
        investigation_notes: investigationNotes || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    await logAdminJob(auth.actor, `claim-refund-review:${id}`, { reviewedBy: auth.reviewerId });

    return res.json({ success: true, message: 'Refund request claimed for investigation' });
  } catch (error) {
    logger.error('Admin refund-request review error: %o', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/admin/refund-requests/:id/approve - approve + execute refund
router.post('/refund-requests/:id/approve', async (req, res) => {
  try {
    const auth = await resolveReviewerFromRequest(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });

    const { id } = req.params;
    const { notes } = req.body;

    const { data: refundReq, error: fetchError } = await supabase
      .from('refund_requests')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (fetchError) return res.status(500).json({ success: false, error: fetchError.message });
    if (!refundReq) return res.status(404).json({ success: false, error: 'Refund request not found' });

    const approvableStatuses = ['pending', 'under_review'];
    if (!approvableStatuses.includes(refundReq.status)) {
      return res.status(400).json({
        success: false,
        error: `Cannot approve a request in '${refundReq.status}' status`,
      });
    }

    const escrowWalletService = require('../lib/escrowWalletService');
    const refundResult = await escrowWalletService.refundEscrow(
      refundReq.escrow_id,
      refundReq.reason,
      auth.reviewerId
    );

    if (!refundResult.success) {
      return res.status(400).json({ success: false, error: refundResult.error || 'Refund execution failed' });
    }

    await supabase
      .from('refund_requests')
      .update({
        status: 'approved',
        reviewed_by: auth.reviewerId,
        reviewed_at: new Date().toISOString(),
        review_notes: notes || null,
        refund_amount: refundResult.escrow?.amount || null,
        refund_type: 'full',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    // Notify sender
    await supabase.from('notifications').insert([
      {
        user_id: refundReq.requested_by,
        type: 'refund_approved',
        title: 'Refund Approved',
        message: notes || 'Your refund request has been approved. Funds are being returned to your wallet.',
        escrow_id: refundReq.escrow_id,
      },
    ]).catch(() => {});

    await logAdminJob(auth.actor, `approve-refund:${id}`, {
      escrowId: refundReq.escrow_id,
      reason: refundReq.reason,
      reviewedBy: auth.reviewerId,
      notes: notes || null,
    });

    return res.json({
      success: true,
      escrow: refundResult.escrow,
      message: 'Refund approved and processed',
    });
  } catch (error) {
    logger.error('Admin refund-request approve error: %o', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/admin/refund-requests/:id/reject - reject the refund request
router.post('/refund-requests/:id/reject', async (req, res) => {
  try {
    const auth = await resolveReviewerFromRequest(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });

    const { id } = req.params;
    const { notes } = req.body;

    if (!notes || notes.trim().length < 10) {
      return res.status(400).json({
        success: false,
        error: 'Rejection notes (at least 10 characters) are required to explain the decision',
      });
    }

    const { data: refundReq, error: fetchError } = await supabase
      .from('refund_requests')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (fetchError) return res.status(500).json({ success: false, error: fetchError.message });
    if (!refundReq) return res.status(404).json({ success: false, error: 'Refund request not found' });

    const rejectableStatuses = ['pending', 'under_review'];
    if (!rejectableStatuses.includes(refundReq.status)) {
      return res.status(400).json({
        success: false,
        error: `Cannot reject a request in '${refundReq.status}' status`,
      });
    }

    await supabase
      .from('refund_requests')
      .update({
        status: 'rejected',
        reviewed_by: auth.reviewerId,
        reviewed_at: new Date().toISOString(),
        review_notes: notes.trim(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    // Return escrow to funds_held
    await supabase
      .from('escrows')
      .update({ status: 'funds_held', updated_at: new Date().toISOString() })
      .eq('id', refundReq.escrow_id)
      .in('status', ['refund_requested', 'funds_held', 'held']);

    // Notify sender
    await supabase.from('notifications').insert([
      {
        user_id: refundReq.requested_by,
        type: 'refund_rejected',
        title: 'Refund Request Rejected',
        message: notes.trim(),
        escrow_id: refundReq.escrow_id,
      },
    ]).catch(() => {});

    await logAdminJob(auth.actor, `reject-refund:${id}`, {
      escrowId: refundReq.escrow_id,
      reason: refundReq.reason,
      reviewedBy: auth.reviewerId,
      notes: notes.trim(),
    });

    return res.json({ success: true, message: 'Refund request rejected' });
  } catch (error) {
    logger.error('Admin refund-request reject error: %o', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

