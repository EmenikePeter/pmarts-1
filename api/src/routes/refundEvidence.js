const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const logger = require('../lib/logger');
const audit = require('../lib/audit');

// POST /api/refund-evidence
// best-effort: record uploaded evidence metadata related to an escrow refund
router.post('/', async (req, res) => {
  try {
    const { escrowId, userId, imageUrl, thumbnailUrl, filename, mime } = req.body || {};
    if (!escrowId || !userId || !imageUrl) {
      return res.status(400).json({ success: false, error: 'escrowId, userId and imageUrl are required' });
    }

    // Try to insert into refund_evidence (if table exists). This is best-effort.
    try {
      const { data, error } = await supabase.from('refund_evidence').insert({ escrow_id: escrowId, uploader_id: userId, image_url: imageUrl, thumbnail_url: thumbnailUrl || null, filename: filename || null, mime: mime || null }).select().maybeSingle();
      if (error) {
        logger.warn('[refundEvidence] insert returned error (table may not exist): %o', error.message || error);
        // return success anyway so mobile flow isn't blocked
        return res.json({ success: true, recorded: false });
      }
      try { await audit.insertAuditLog({ action: 'refund_evidence_recorded', entity_type: 'refund', entity_id: null, actor_id: userId, metadata: { escrowId, filename } }); } catch (e) { logger.warn('[refundEvidence] audit failed: %o', e?.message || e); }
      return res.json({ success: true, recorded: true, evidence: data || null });
    } catch (e) {
      logger.warn('[refundEvidence] insertion attempt failed: %o', e?.message || e);
      return res.json({ success: true, recorded: false });
    }
  } catch (err) {
    logger.error('[refundEvidence] error: %o', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;
