const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const audit = require('../lib/audit');
const logger = require('../lib/logger');
const { getUserRoleById } = require('../lib/userResolver');

/**
 * POST /api/disputes/create
 * 
 * Create a new dispute for an escrow.
 */
router.post('/create', async (req, res) => {
  try {
    const { escrowId, userId, reason } = req.body;

    if (!escrowId || !userId || !reason) {
      return res.status(400).json({
        success: false,
        error: 'escrowId, userId, and reason are required',
      });
    }

    // Verify escrow exists and user is involved
    const { data: escrow, error: escrowError } = await supabase
      .from('escrows')
      .select('*')
      .eq('id', escrowId)
      .single();

    if (escrowError || !escrow) {
      return res.status(404).json({
        success: false,
        error: 'Escrow not found',
      });
    }

    // Check user is involved in escrow
    if (escrow.sender_id !== userId && escrow.recipient_id !== userId) {
      return res.status(403).json({
        success: false,
        error: 'You are not involved in this escrow',
      });
    }

    // Check escrow is in a disputable state
    if (escrow.status !== 'held') {
      return res.status(400).json({
        success: false,
        error: 'Cannot dispute an escrow that is not held',
      });
    }

    // Create dispute
    const { data: dispute, error: createError } = await supabase
      .from('disputes')
      .insert({
        escrow_id: escrowId,
        reported_by: userId,
        reason,
        status: 'open',
        response_deadline: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(), // 72 hours
      })
      .select()
      .single();

    if (createError) {
      logger.error('Failed to create dispute: %o', createError);
      return res.status(500).json({
        success: false,
        error: 'Failed to create dispute',
      });
    }

    // Update escrow status
    await supabase
      .from('escrows')
      .update({ status: 'disputed' })
      .eq('id', escrowId);

    // Notify the other party
    const otherPartyId = escrow.sender_id === userId ? escrow.recipient_id : escrow.sender_id;
    await supabase.from('notifications').insert({
      user_id: otherPartyId,
      escrow_id: escrowId,
      type: 'dispute_opened',
      message: `A dispute has been opened for escrow ${escrow.reference_id}. Please respond within 72 hours.`,
    });

    // Audit log (best-effort via RPC)
    try {
      const r = await audit.insertAuditLog({
        action: 'dispute_created',
        entity_type: 'escrow',
        entity_id: escrowId,
        actor_id: userId,
        metadata: { reason },
      });
      if (!r.success) logger.warn('audit RPC returned error (non-fatal): %o', r.error || r);
    } catch (e) {
      logger.warn('audit RPC failed (non-fatal): %o', e?.message || e);
    }

    res.json({
      success: true,
      dispute,
    });
  } catch (error) {
    logger.error('Dispute creation error: %o', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * POST /api/disputes/evidence
 * 
 * Record evidence upload for a dispute.
 * The actual file upload happens directly to Supabase Storage from mobile.
 * This endpoint records the metadata.
 */
router.post('/evidence', async (req, res) => {
  try {
    const { disputeId, escrowId, userId, imageUrl, description, evidenceType } = req.body;

    if (!escrowId || !userId || !imageUrl) {
      return res.status(400).json({
        success: false,
        error: 'escrowId, userId, and imageUrl are required',
      });
    }

    // Verify user is involved in the escrow
    const { data: escrow, error: escrowError } = await supabase
      .from('escrows')
      .select('*')
      .eq('id', escrowId)
      .single();

    if (escrowError || !escrow) {
      return res.status(404).json({
        success: false,
        error: 'Escrow not found',
      });
    }

    if (escrow.sender_id !== userId && escrow.recipient_id !== userId) {
      return res.status(403).json({
        success: false,
        error: 'You are not involved in this escrow',
      });
    }

    // Record evidence in database
    const { data: evidence, error: insertError } = await supabase
      .from('dispute_evidence')
      .insert({
        dispute_id: disputeId,
        escrow_id: escrowId,
        user_id: userId,
        image_url: imageUrl,
        description: description || '',
        evidence_type: evidenceType || 'screenshot',
      })
      .select()
      .single();

    if (insertError) {
      logger.error('Failed to record evidence: %o', insertError);
      return res.status(500).json({
        success: false,
        error: 'Failed to record evidence',
      });
    }

    // Audit log (best-effort via RPC)
    try {
      const r = await audit.insertAuditLog({
        action: 'evidence_uploaded',
        entity_type: 'escrow',
        entity_id: escrowId,
        actor_id: userId,
        metadata: { note: `Evidence uploaded: ${evidenceType || 'screenshot'}` },
      });
      if (!r.success) logger.warn('audit RPC returned error (non-fatal): %o', r.error || r);
    } catch (e) {
      logger.warn('audit RPC failed (non-fatal): %o', e?.message || e);
    }

    res.json({
      success: true,
      evidence,
    });
  } catch (error) {
    logger.error('Evidence upload error: %o', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * POST /api/disputes/respond
 * 
 * Respond to a dispute with counter-evidence or acceptance.
 */
router.post('/respond', async (req, res) => {
  try {
    const { disputeId, userId, responseText } = req.body;

    if (!disputeId || !userId || !responseText) {
      return res.status(400).json({
        success: false,
        error: 'disputeId, userId, and responseText are required',
      });
    }

    // Get dispute
    const { data: dispute, error: disputeError } = await supabase
      .from('disputes')
      .select('*, escrow:escrows(*)')
      .eq('id', disputeId)
      .single();

    if (disputeError || !dispute) {
      return res.status(404).json({
        success: false,
        error: 'Dispute not found',
      });
    }

    // Verify user is the other party (not the reporter)
    const escrow = dispute.escrow;
    const isOtherParty =
      (escrow.sender_id === userId || escrow.recipient_id === userId) &&
      dispute.reported_by !== userId;

    if (!isOtherParty) {
      return res.status(403).json({
        success: false,
        error: 'Only the other party can respond to this dispute',
      });
    }

    // Update dispute with response
    const { data: updated, error: updateError } = await supabase
      .from('disputes')
      .update({
        response_text: responseText,
        responded_at: new Date().toISOString(),
        status: 'under_review',
      })
      .eq('id', disputeId)
      .select()
      .single();

    if (updateError) {
      logger.error('Failed to update dispute: %o', updateError);
      return res.status(500).json({
        success: false,
        error: 'Failed to record response',
      });
    }

    // Notify reporter
    await supabase.from('notifications').insert({
      user_id: dispute.reported_by,
      escrow_id: escrow.id,
      type: 'dispute_response',
      message: 'The other party has responded to your dispute.',
    });

    res.json({
      success: true,
      dispute: updated,
    });
  } catch (error) {
    logger.error('Dispute response error: %o', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * GET /api/disputes/:id
 * 
 * Get dispute details with evidence.
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: dispute, error } = await supabase.from('disputes').select(`
      *,
      escrow:escrows(*),
      reporter:users!reported_by(*),
      evidence:dispute_evidence(*)
    `).eq('id', id).single();

    if (error || !dispute) {
      return res.status(404).json({
        success: false,
        error: 'Dispute not found',
      });
    }

    res.json({ success: true, dispute });
  } catch (error) {
    logger.error('Get dispute error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET /api/disputes/escrow/:escrowId
 * 
 * Get disputes for a specific escrow.
 */
router.get('/escrow/:escrowId', async (req, res) => {
  try {
    const { escrowId } = req.params;

    const { data: disputes, error } = await supabase.from('disputes').select(`
      *,
      reporter:users!reported_by(username),
      evidence:dispute_evidence(*)
    `).eq('escrow_id', escrowId).order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ success: false, error: 'Failed to fetch disputes' });
    }

    res.json({ success: true, disputes: disputes || [] });
  } catch (error) {
    logger.error('Get escrow disputes error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /api/disputes/upload
 *
 * Accepts base64-encoded file payloads from the client, stores the file
 * in Supabase Storage using the service role key, records a row in
 * `dispute_evidence`, and returns a public URL.
 */
router.post('/upload', async (req, res) => {
  try {
    const { disputeId, escrowId, userId, filename, contentType, base64 } = req.body || {};

    if (!escrowId || !userId || !filename || !base64) {
      return res.status(400).json({ success: false, error: 'escrowId, userId, filename and base64 payload are required' });
    }

    // Verify escrow and that the user is a participant
    const { data: escrow, error: escrowErr } = await supabase.from('escrows').select('id, sender_id, recipient_id').eq('id', escrowId).single();
    if (escrowErr || !escrow) return res.status(404).json({ success: false, error: 'Escrow not found' });
    if (String(userId) !== String(escrow.sender_id) && String(userId) !== String(escrow.recipient_id)) return res.status(403).json({ success: false, error: 'You are not a participant of this escrow' });

    const bucket = process.env.SUPABASE_EVIDENCE_BUCKET || 'evidence';
    const disputeSegment = disputeId ? String(disputeId) : String(escrowId);
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `disputes/${disputeSegment}/${Date.now()}_${safeName}`;

    const fileBuffer = Buffer.from(base64, 'base64');

    // Upload to Supabase Storage (service role client)
    const { data: uploadData, error: uploadErr } = await supabase.storage.from(bucket).upload(path, fileBuffer, { contentType, upsert: false });
    if (uploadErr) {
      logger.error('[disputes.upload] storage.upload error: %o', uploadErr);
      return res.status(500).json({ success: false, error: 'Failed to upload file' });
    }

    // Get public URL for the uploaded file (may be null depending on bucket policy)
    const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(path);

    // Try to generate a thumbnail (image) and upload it alongside the original
    let thumbnailPath = null;
    try {
      const sharp = require('sharp');
      const thumbBuffer = await sharp(fileBuffer).resize(320, 240, { fit: 'inside' }).jpeg({ quality: 70 }).toBuffer();
      const thumbPath = `disputes/${disputeSegment}/thumb_${Date.now()}_${safeName}`;
      const { data: thumbUpload, error: thumbErr } = await supabase.storage.from(bucket).upload(thumbPath, thumbBuffer, { contentType: 'image/jpeg', upsert: false });
      if (!thumbErr) thumbnailPath = thumbPath; else logger.warn('[disputes.upload] thumbnail upload failed: %o', thumbErr);
    } catch (e) {
      logger.warn('[disputes.upload] thumbnail generation skipped or failed: %o', e?.message || e);
    }

    // Record evidence metadata in DB
    try {
      const { data: evidenceRow, error: evidenceErr } = await supabase.from('dispute_evidence').insert({ dispute_id: disputeId || null, uploader_id: userId, storage_path: path, thumbnail_path: thumbnailPath, mime: contentType || null, size: fileBuffer.length }).select().single();
      if (evidenceErr) logger.warn('[disputes.upload] failed to record evidence metadata: %o', evidenceErr);

      // Audit log
      try {
        await audit.insertAuditLog({ action: 'evidence_uploaded', entity_type: 'dispute', entity_id: disputeId || null, actor_id: userId, metadata: { path, thumbnailPath, bucket } });
      } catch (e) {
        logger.warn('[disputes.upload] audit failed: %o', e?.message || e);
      }

      const publicUrl = urlData?.publicUrl || null;
      const thumbPublicUrl = thumbnailPath ? supabase.storage.from(bucket).getPublicUrl(thumbnailPath)?.data?.publicUrl || null : null;

      return res.json({ success: true, evidence: evidenceRow || null, publicUrl, thumbnailPublicUrl: thumbPublicUrl });
    } catch (e) {
      logger.error('[disputes.upload] unexpected error: %o', e);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  } catch (err) {
    logger.error('[disputes.upload] error: %o', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * DELETE /api/disputes/evidence/:id
 *
 * Delete an evidence row and its storage object. Accepts `userId` in body or query
 * to authorize the deletion (uploader or admin). This is best-effort and will
 * remove the storage object and the DB row.
 */
router.delete('/evidence/:id', async (req, res) => {
  try {
    const evidenceId = req.params.id;
    const userId = req.body?.userId || req.query?.userId;

    if (!evidenceId || !userId) return res.status(400).json({ success: false, error: 'evidence id and userId required' });

    const { data: ev, error: evErr } = await supabase.from('dispute_evidence').select('*').eq('id', evidenceId).single();
    if (evErr || !ev) return res.status(404).json({ success: false, error: 'Evidence not found' });

    // Only uploader or admin may delete
    const isUploader = String(ev.uploader_id) === String(userId);
    let isAdmin = false;
    try {
      const role = await getUserRoleById(userId);
      isAdmin = !!(role && (role === 'admin' || role === 'staff'));
    } catch (e) {}

    if (!isUploader && !isAdmin) return res.status(403).json({ success: false, error: 'Not authorized to delete evidence' });

    const bucket = process.env.SUPABASE_EVIDENCE_BUCKET || 'evidence';
    const storagePath = ev.storage_path;

    // Attempt to delete storage object
    if (storagePath) {
      try {
        const { error: delErr } = await supabase.storage.from(bucket).remove([storagePath]);
        if (delErr) {
          // log but continue to remove DB row
          logger.warn('[disputes.delete] storage.remove failed: %o', delErr);
        }
      } catch (e) {
        logger.warn('[disputes.delete] storage.remove threw: %o', e?.message || e);
      }
    }

    // Remove DB row
    try {
      const { error: delRowErr } = await supabase.from('dispute_evidence').delete().eq('id', evidenceId);
      if (delRowErr) {
        logger.warn('[disputes.delete] failed to delete evidence row: %o', delRowErr);
      }
    } catch (e) {
      logger.warn('[disputes.delete] delete row threw: %o', e?.message || e);
    }

    // Audit
    try {
      await audit.insertAuditLog({ action: 'evidence_deleted', entity_type: 'dispute', entity_id: ev.dispute_id || null, actor_id: userId, metadata: { path: storagePath } });
    } catch (e) {}

    return res.json({ success: true });
  } catch (err) {
    logger.error('Delete evidence error: %o', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /api/disputes/signed-upload
 *
 * Returns a signed URL the client can PUT a file to directly (S3-style),
 * plus the storage path and a future public URL. Uses Supabase Storage
 * signed-upload API when available; otherwise returns the target path so
 * client may fallback to other upload methods.
 */
router.post('/signed-upload', async (req, res) => {
  try {
    const { disputeId, escrowId, userId, filename, contentType, expires = 60 } = req.body || {};
    if (!escrowId || !userId || !filename) return res.status(400).json({ success: false, error: 'escrowId, userId and filename are required' });

    const bucket = process.env.SUPABASE_EVIDENCE_BUCKET || 'evidence';
    const disputeSegment = disputeId ? String(disputeId) : String(escrowId);
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `disputes/${disputeSegment}/${Date.now()}_${safeName}`;

    // Try to create a signed upload URL via Supabase storage API
    try {
      if (typeof supabase.storage.from(bucket).createSignedUploadUrl === 'function') {
        const { data, error } = await supabase.storage.from(bucket).createSignedUploadUrl(path, expires);
        if (error) logger.warn('[disputes.signed-upload] createSignedUploadUrl returned error: %o', error);
        else {
          const publicUrl = supabase.storage.from(bucket).getPublicUrl(path)?.data?.publicUrl || null;
          return res.json({ success: true, path, uploadUrl: data?.signedUploadUrl || data?.signedUrl || null, publicUrl });
        }
      }
    } catch (e) {
      logger.warn('[disputes.signed-upload] createSignedUploadUrl attempt failed: %o', e?.message || e);
    }

    // Fallback: return path only; client can upload via anon client or call /upload base64 endpoint
    return res.json({ success: true, path, uploadUrl: null });
  } catch (err) {
    logger.error('[disputes.signed-upload] error: %o', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// -------------------------
// Message & Admin actions
// -------------------------

// Helpers (auth/role) - mirror support.js pattern
async function getUserIdFromAuthHeader(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.substring(7);
  const tokenHash = require('crypto').createHash('sha256').update(token).digest('hex');
  const { data: session, error } = await supabase.from('sessions').select('user_id').eq('token_hash', tokenHash).single();
  if (error || !session) return null;
  return session.user_id;
}

async function getUserRole(userId) {
  return getUserRoleById(userId);
}

function isAdminRole(role) {
  return role === 'admin' || role === 'staff';
}

const disputeService = require('../lib/disputeService');

// POST /api/disputes/:id/message - create a new message in a dispute thread
router.post('/:id/message', async (req, res) => {
  try {
    const userId = await getUserIdFromAuthHeader(req);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const disputeId = req.params.id;
    const { message, attachments } = req.body || {};
    if (!message) return res.status(400).json({ success: false, error: 'message required' });

    // Verify dispute exists
    const { data: dispute, error: dErr } = await supabase.from('disputes').select('id,reported_by,counter_party,escrow_id').eq('id', disputeId).maybeSingle();
    if (dErr || !dispute) return res.status(404).json({ success: false, error: 'Dispute not found' });

    const role = await getUserRole(userId);
    // allow participant or admin
    const isParticipant = String(userId) === String(dispute.reported_by) || String(userId) === String(dispute.counter_party);
    if (!isParticipant && !isAdminRole(role)) return res.status(403).json({ success: false, error: 'Forbidden' });

    const payload = {
      dispute_id: disputeId,
      sender_id: userId,
      message: String(message).slice(0, 4000),
      attachments: attachments || null,
    };
    if (req.body?.client_id) payload.client_id = String(req.body.client_id).slice(0, 255);

    const { data: row, error: insertErr } = await supabase.from('dispute_messages').insert(payload).select().maybeSingle();
    if (insertErr) {
      logger.error('[disputes.message.create] insert error: %o', insertErr);
      return res.status(500).json({ success: false, error: 'Failed to create message' });
    }

    try {
      await audit.insertAuditLog({ action: 'dispute_message_create', entity_type: 'dispute_message', entity_id: row.id, actor_id: userId, metadata: { dispute_id: disputeId } });
    } catch (e) {
      logger.warn('[disputes.message.create] audit failed: %o', e?.message || e);
    }

    const resp = { success: true, message: row };
    if (req.body?.client_id) resp.message.client_id = req.body.client_id;
    res.json(resp);
  } catch (err) {
    logger.error('[disputes.message.create] error: %o', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/disputes/:id/resolve - admin resolves a dispute
router.post('/:id/resolve', async (req, res) => {
  try {
    const userId = await getUserIdFromAuthHeader(req);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const role = await getUserRole(userId);
    if (!isAdminRole(role)) return res.status(403).json({ success: false, error: 'Forbidden' });

    const disputeId = req.params.id;
    const { resolution, resolutionNotes, splitPercentage } = req.body || {};
    if (!resolution) return res.status(400).json({ success: false, error: 'resolution required' });

    // Validate resolution
    const allowed = Object.values(disputeService.RESOLUTION_TYPES || {});
    if (allowed.length > 0 && !allowed.includes(resolution)) {
      return res.status(400).json({ success: false, error: 'Invalid resolution type' });
    }

    const result = await disputeService.resolveDispute({ disputeId, adminId: userId, resolution, resolutionNotes: resolutionNotes || null, splitPercentage: splitPercentage || null });
    if (!result || !result.success) {
      return res.status(500).json({ success: false, error: result?.error || 'Failed to resolve dispute' });
    }

    try {
      await audit.insertAuditLog({ action: 'dispute_resolved_api', entity_type: 'dispute', entity_id: disputeId, actor_id: userId, metadata: { resolution } });
    } catch (e) {
      logger.warn('[disputes.resolve] audit failed: %o', e?.message || e);
    }

    res.json({ success: true, result });
  } catch (err) {
    logger.error('[disputes.resolve] error: %o', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;
