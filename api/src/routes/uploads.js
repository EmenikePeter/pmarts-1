const express = require('express');
const router = express.Router();
const multer = require('multer');
const supabase = require('../lib/supabase');
const logger = require('../lib/logger');
const audit = require('../lib/audit');

// memory storage for small uploads
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

async function getUserIdFromAuthHeader(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.substring(7);
  const tokenHash = require('crypto').createHash('sha256').update(token).digest('hex');
  const { data: session, error } = await supabase.from('sessions').select('user_id').eq('token_hash', tokenHash).single();
  if (error || !session) return null;
  return session.user_id;
}

/**
 * POST /api/uploads/evidence
 * Accept multipart file upload field `file` and optional fields: escrowId, disputeId
 * Stores the file in Supabase Storage (service role) and returns a public URL
 */
router.post('/evidence', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    const { escrowId, disputeId } = req.body || {};

    if (!file) return res.status(400).json({ success: false, error: 'file required' });

    const userId = await getUserIdFromAuthHeader(req);
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const bucket = process.env.SUPABASE_EVIDENCE_BUCKET || 'evidence';
    const segment = disputeId ? String(disputeId) : (escrowId ? String(escrowId) : 'misc');
    const safeName = (file.originalname || `upload_${Date.now()}`).replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `uploads/${segment}/${Date.now()}_${safeName}`;

    // Upload buffer to Supabase Storage
    const { data: uploadData, error: uploadErr } = await supabase.storage.from(bucket).upload(path, file.buffer, { contentType: file.mimetype || 'application/octet-stream', upsert: false });
    if (uploadErr) {
      logger.error('[uploads.evidence] storage.upload error: %o', uploadErr);
      return res.status(500).json({ success: false, error: 'Failed to upload file' });
    }

    const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(path);
    const publicUrl = urlData?.publicUrl || null;

    // Try to generate a thumbnail (image) and upload it alongside the original
    let thumbnailPath = null;
    try {
      const sharp = require('sharp');
      const thumbBuffer = await sharp(file.buffer).resize(320, 240, { fit: 'inside' }).jpeg({ quality: 70 }).toBuffer();
      const thumbPath = `uploads/${segment}/thumb_${Date.now()}_${safeName}`;
      const { data: thumbUpload, error: thumbErr } = await supabase.storage.from(bucket).upload(thumbPath, thumbBuffer, { contentType: 'image/jpeg', upsert: false });
      if (!thumbErr) {
        thumbnailPath = thumbPath;
      } else {
        logger.warn('[uploads.evidence] thumbnail upload failed: %o', thumbErr);
      }
    } catch (e) {
      logger.warn('[uploads.evidence] thumbnail generation skipped or failed: %o', e?.message || e);
    }

    const { data: thumbUrlData } = thumbnailPath ? supabase.storage.from(bucket).getPublicUrl(thumbnailPath) : { data: null };
    const thumbnailPublicUrl = thumbUrlData?.publicUrl || null;

    // Record a lightweight upload audit row if possible
    try {
      await audit.insertAuditLog({ action: 'evidence_uploaded', entity_type: 'upload', entity_id: null, actor_id: userId || null, metadata: { path, thumbnailPath, bucket, escrowId: escrowId || null, disputeId: disputeId || null } });
    } catch (e) {
      logger.warn('[uploads.evidence] audit log failed: %o', e?.message || e);
    }

    return res.json({ success: true, publicUrl, path, thumbnailPublicUrl });
  } catch (err) {
    logger.error('[uploads.evidence] error: %o', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;
