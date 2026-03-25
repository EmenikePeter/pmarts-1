const express = require('express');
const router = express.Router();
const { supabase } = require('../lib/supabase');
const logger = require('../lib/logger');
const { resolveUserByIdOrPiId } = require('../lib/userResolver');

const ALLOWED_PREFERENCE_KEYS = new Set([
  'push_escrow_created',
  'push_deposit_received',
  'push_release_completed',
  'push_refund_completed',
  'push_dispute_update',
  'push_rating_received',
  'email_daily_summary',
  'email_dispute_opened',
  'email_large_transaction',
  'large_transaction_threshold',
  'quiet_hours_enabled',
  'quiet_hours_start',
  'quiet_hours_end',
]);

function sanitizePreferences(preferences) {
  const sanitized = {};
  const invalidKeys = [];

  for (const [key, value] of Object.entries(preferences || {})) {
    if (!ALLOWED_PREFERENCE_KEYS.has(key)) {
      invalidKeys.push(key);
      continue;
    }

    if (
      key.startsWith('push_') ||
      key.startsWith('email_') ||
      key === 'quiet_hours_enabled'
    ) {
      if (typeof value === 'boolean') sanitized[key] = value;
      continue;
    }

    if (key === 'large_transaction_threshold') {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) sanitized[key] = n;
      continue;
    }

    if (key === 'quiet_hours_start' || key === 'quiet_hours_end') {
      if (typeof value === 'string' || value === null) sanitized[key] = value;
      continue;
    }
  }

  return { sanitized, invalidKeys };
}

// POST /api/notification-preferences/preferences
// Body: { user_id: string, preferences: { ... } }
router.post('/preferences', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;
    let user = null;
    if (!token) {
      // Development convenience: optional bypass for local debugging when explicitly enabled.
      const devBypassEnabled = process.env.ALLOW_DEV_AUTH_BYPASS === 'true';
      if (process.env.NODE_ENV !== 'production' && devBypassEnabled && req.body?.user_id) {
        logger.info('[prefs] Dev bypass enabled: resolving user_id from request body');
        const u = await resolveUserByIdOrPiId(req.body.user_id);
        if (!u) {
          logger.warn('[prefs] Dev bypass failed to resolve user_id');
          return res.status(401).json({ success: false, error: 'Invalid user_id' });
        }
        user = u;
      } else {
        return res.status(401).json({ success: false, error: 'No token provided' });
      }
    } else {
      // Verify token maps to user
      const { data: userData, error: userErr } = await supabase.auth.getUser(token);
      if (userErr || !userData?.user) {
        logger.error('[prefs] token verification failed: %o', userErr || '(no user)');
        return res.status(401).json({ success: false, error: 'Invalid token' });
      }
      user = userData.user;
    }
    const { user_id, preferences } = req.body;
    if (!user_id || !preferences || typeof preferences !== 'object') {
      return res.status(400).json({ success: false, error: 'Missing user_id or preferences' });
    }

    if (user.id !== user_id) {
      return res.status(403).json({ success: false, error: 'Token does not match user_id' });
    }

    const { sanitized, invalidKeys } = sanitizePreferences(preferences);
    if (invalidKeys.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Invalid preference keys: ${invalidKeys.join(', ')}`,
      });
    }

    if (Object.keys(sanitized).length === 0) {
      return res.status(400).json({ success: false, error: 'No valid preferences provided' });
    }

    // Upsert preferences using service-role client (this client is created with service role key)
    const payload = Object.assign({ user_id }, sanitized);
    const { data, error } = await supabase
      .from('notification_preferences')
      .upsert(payload, { onConflict: ['user_id'] })
      .select()
      .maybeSingle();

    if (error) {
      logger.error('[prefs] upsert error: %o', error);
      return res.status(500).json({ success: false, error: error.message || error });
    }

    res.json({ success: true, data });
  } catch (e) {
    logger.error('[prefs] exception: %o', e?.message || e);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;
