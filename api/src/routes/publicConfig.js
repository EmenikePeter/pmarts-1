const express = require('express');
const router = express.Router();
const logger = require('../lib/logger');

// Ensure CORS headers are present for this route (helps in environments
// where global CORS configuration may not be applied to all handlers).
router.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  // short-circuit preflight
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Returns non-sensitive public runtime config required by the web client.
// The Supabase anon key is intentionally public for client use.
router.get('/', (req, res) => {
  try {
    // Provide both NEXT_PUBLIC_* and EXPO_PUBLIC_* keys so both web (Next) and
    // Expo web builds can read runtime config without a rebuild.
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || null;
    const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || null;
    const publicConfig = {
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: supabaseAnon,
      EXPO_PUBLIC_SUPABASE_URL: supabaseUrl,
      EXPO_PUBLIC_SUPABASE_ANON_KEY: supabaseAnon,
      // Public API URL for mobile/web builds
      EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL || process.env.API_URL || null,
      NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || null,
      PI_ENV: process.env.PI_ENV || null,
    };
    res.json({ success: true, config: publicConfig });
  } catch (e) {
    logger.error('[public-config] failed to read env: %o', e?.message || e);
    res.status(500).json({ success: false, error: 'Failed to read public config' });
  }
});

module.exports = router;
