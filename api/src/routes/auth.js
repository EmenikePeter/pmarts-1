/**
 * PMARTS Pi Authentication Routes
 *
 * Server-side Pi authentication verification with:
 * - Pi Network API validation
 * - User creation/lookup
 * - Supabase session management
 * - Device fingerprint tracking
 *
 * Routes:
 * POST /api/auth/verify      - Verify Pi auth and create session
 * POST /api/auth/verify-token - Verify existing token
 * POST /api/auth/logout      - Logout and clear session
 */

const express = require('express');
const router = express.Router();
const { supabase } = require('../lib/supabase');
const audit = require('../lib/audit');
const piApi = require('../lib/piApi');
const crypto = require('crypto');
const logger = require('../lib/logger');
const { getUserById, updateUserById } = require('../lib/userResolver');
const escrowWalletService = require('../lib/escrowWalletService');

// Ensure CORS headers for auth routes to satisfy browser preflight requests
router.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ============================================
// VERIFY PI AUTHENTICATION
// ============================================

/**
 * POST /api/auth/verify
 *
 * Verifies Pi authentication and creates/updates user
 */
// Extracted handler for verifying Pi auth so other routes can reuse it (eg. /pi)
async function handleVerify(req, res) {
  try {
    const { piUid, username, accessToken, walletAddress, deviceInfo } = req.body;
    const devAuthBypassEnabled = process.env.ALLOW_DEV_AUTH_BYPASS === 'true';

    logger.info('Verify auth request', {
      piUid,
      username,
      hasAccessToken: !!accessToken,
      deviceInfoPresent: !!deviceInfo,
    });

    // Additional diagnostic logs for deployed login troubleshooting
    try {
      const forwarded = req.headers['x-forwarded-for'] || req.ip || null;
      logger.info('[auth.verify] incoming request diagnostic', {
        ip: forwarded,
        origin: req.headers.origin || null,
        referer: req.headers.referer || null,
        userAgent: req.headers['user-agent'] || null,
        hasAuthHeader: !!req.headers.authorization,
      });
    } catch (diagErr) {
      logger.warn('[auth.verify] diagnostic log failed', diagErr?.message || diagErr);
    }

    // In production require accessToken; in development allow missing accessToken for dev-token flows
    if (!piUid || !username || (process.env.NODE_ENV === 'production' && !accessToken)) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: piUid, username' + (process.env.NODE_ENV === 'production' ? ', accessToken' : ''),
      });
    }

    // Verify access token with Pi Network
    // In development accept special dev tokens or missing tokens for local testing
    let piVerification;
    if (process.env.NODE_ENV !== 'production') {
      if (devAuthBypassEnabled && (!accessToken || accessToken === 'MOCK_VALID' || accessToken === 'dev-token')) {
        logger.info('[auth.verify] Development bypass for accessToken', accessToken ? accessToken : '(none)');
        piVerification = { valid: true, uid: piUid, username };
      } else {
        piVerification = await piApi.verifyAccessToken(accessToken);
      }
    } else {
      // Production: always verify with Pi API
      piVerification = await piApi.verifyAccessToken(accessToken);
    }

    if (!piVerification.valid) {
      return res.status(401).json({
        success: false,
        error: 'Invalid Pi access token',
        code: 'INVALID_TOKEN',
      });
    }

    // Verify UID matches
    if (piVerification.uid !== piUid) {
      return res.status(401).json({
        success: false,
        error: 'Token UID mismatch',
        code: 'UID_MISMATCH',
      });
    }

    // Check if user exists
    const { data: existingUser, error: fetchError } = await supabase
      .from('users')
      .select('*')
      .eq('pi_id', piUid)
      .maybeSingle();

    if (fetchError) {
      logger.error('Fetch user error: %o', fetchError);
    }

    logger.info('Existing user fetch result', { existingUser });

    let user;
    let isNewUser = false;

    if (existingUser) {
      // Update existing user
      const { data: updatedUser, error: updateError } = await supabase
        .from('users')
        .update({
          username: username,
          wallet_address: walletAddress,
          last_login_at: new Date().toISOString(),
          device_info: deviceInfo,
        })
        .eq('pi_id', piUid)
        .select()
        .single();

      logger.info('Updated user result', { updatedUser, updateError });

      if (updateError) {
        logger.error('Update user error: %o', updateError);
        return res.status(500).json({ success: false, error: 'Failed to update user' });
      }

      user = updatedUser;
    } else {
      // Create new user
      const { data: newUser, error: createError } = await supabase
        .from('users')
        .upsert({
          pi_id: piUid,
          username: username,
          wallet_address: walletAddress,
          trust_score: 20, // Default trust score for new users (0-100 model)
          device_info: deviceInfo,
          created_at: new Date().toISOString(),
          last_login_at: new Date().toISOString(),
        }, {
          onConflict: 'pi_id',
        })
        .select()
        .maybeSingle();

      logger.info('Create/upsert user result', { newUser, createError });

      if (createError) {
        logger.error('Create user error: %o', createError);
          // Return more detailed error in development for faster debugging
          if (process.env.NODE_ENV !== 'production') {
            return res.status(500).json({ success: false, error: createError.message || createError });
          }
          return res.status(500).json({ success: false, error: 'Failed to create user' });
      }

      user = newUser;
      isNewUser = true;

      // If the client provided an email, create a Supabase Auth user (admin) and link it.
      // This uses the service-role key via our server-side Supabase client.
      try {
        const email = req.body.email || req.body.user?.email || null;
        if (email) {
          const { data: authRes, error: authError } = await supabase.auth.admin.createUser({
            email,
            user_metadata: {
              provider: 'pi',
              pi_id: piUid,
              username,
            },
            email_confirm: true,
          });

          if (!authError && authRes?.user) {
            // Link the newly created auth user id to our users table
            try {
              await supabase.from('users').update({ auth_user_id: authRes.user.id }).eq('pi_id', piUid);
              // reflect in returned user object if possible
              user.auth_user_id = authRes.user.id;
            } catch (linkErr) {
              logger.warn('Failed to link auth user id to users table: %o', linkErr);
            }
          } else if (authError) {
            logger.warn('Supabase admin.createUser returned error (non-fatal): %o', authError.message || authError);
          }
        }
      } catch (e) {
        logger.warn('Error creating/linking Supabase auth user (non-fatal): %o', e?.message || e);
      }

      // Log new user registration (best-effort)
      try {
        const r = await audit.insertAuditLog({
          action: 'user_registered',
          entity_type: 'user',
          entity_id: user.id,
          actor_id: user.id,
          metadata: { username, isInPiBrowser: deviceInfo?.isInPiBrowser },
        });
        if (!r.success) logger.warn('audit RPC returned error (non-fatal): %o', r.error || r);
      } catch (e) {
        logger.warn('audit RPC failed (non-fatal): %o', e?.message || e);
      }
    }

    // Track device fingerprint
    if (deviceInfo?.deviceId) {
      await trackDeviceFingerprint(user.id, deviceInfo);
    }

    // Generate Supabase session token
    const sessionToken = generateSessionToken(user.id);

    // Store session (log payload and result to help debug persistence issues)
    const sessionPayload = {
      user_id: user.id,
      token_hash: hashToken(sessionToken),
      pi_access_token: accessToken,
      device_info: deviceInfo,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
    };
    try {

      // Build RPC params
      const rpcParams = {
        p_user_id: sessionPayload.user_id,
        p_token_hash: sessionPayload.token_hash,
        p_pi_access_token: sessionPayload.pi_access_token,
        p_device_info: sessionPayload.device_info,
        p_expires_at: sessionPayload.expires_at,
      };

      // Call SECURITY DEFINER RPC to insert session (works around PostgREST table-route issues)
      const { data: sessionUpsertResult, error: sessionUpsertError } = await supabase.rpc('app_insert_session', rpcParams);

      // Log RPC result (mask any sensitive returned fields)
      try {
        logger.info('[session upsert via RPC] result', {
          error: sessionUpsertError ? (sessionUpsertError.message || sessionUpsertError) : null,
          dataPreview: Array.isArray(sessionUpsertResult) ? sessionUpsertResult.slice(0,1) : sessionUpsertResult || null,
        });
      } catch (rlogErr) {
        logger.warn('[session upsert via RPC] log failed: %o', rlogErr?.message || rlogErr);
      }

      if (sessionUpsertError) {
        logger.error('[session upsert via RPC] error: %o', sessionUpsertError);
      }
    } catch (e) {
      logger.error('[session upsert via RPC] exception: %o', e?.message || e);
    }

    // Log successful login (best-effort)
    try {
      const r = await audit.insertAuditLog({
        action: 'user_login',
        entity_type: 'user',
        entity_id: user.id,
        actor_id: user.id,
        metadata: {
          platform: deviceInfo?.platform,
          isInPiBrowser: deviceInfo?.isInPiBrowser,
        },
      });
      if (!r.success) logger.warn('audit RPC returned error (non-fatal): %o', r.error || r);
    } catch (e) {
      logger.warn('audit RPC failed (non-fatal): %o', e?.message || e);
    }

    // Emit a concise success diagnostic (mask session token)
    try {
      logger.info('[auth.verify] login success', {
        userId: user.id,
        isNewUser,
        supabaseTokenPreview: sessionToken ? `${String(sessionToken).slice(0,8)}...` : null,
      });
    } catch (diagErr) {
      // non-fatal
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        pi_id: user.pi_id || user.pi_uid || null,
        username: user.username,
        pmarts_id: user.pmarts_id || null,
        walletAddress: user.wallet_address,
        trustScore: user.trust_score,
        createdAt: user.created_at,
      },
      supabaseToken: sessionToken,
      isNewUser,
    });
  } catch (error) {
    // Enhanced error logging to help diagnose 500s during development
    try {
      logger.error('Verify auth error: %o', error && error.message ? error.message : error);
      if (error && error.stack) logger.error(error.stack);
    } catch (logErr) {
      logger.error('Failed to log Verify auth error: %o', logErr);
    }
    // In development return the error message to the client to speed debugging
    if (process.env.NODE_ENV !== 'production') {
      return res.status(500).json({ success: false, error: error?.message || String(error) });
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

// Original route kept but delegated to extracted handler
router.post('/verify', handleVerify);

// POST /api/auth/pi
// Accepts Pi SDK auth payload: { uid, username, accessToken, walletAddress, deviceInfo }
router.post('/pi', async (req, res) => {
  // Map Pi SDK field names to existing handler expectations
  req.body.piUid = req.body.uid || req.body.piUid;
  req.body.username = req.body.username || req.body.user?.username || req.body.username;
  req.body.accessToken = req.body.accessToken || req.body.access_token || req.body.token;
  req.body.walletAddress = req.body.walletAddress || req.body.wallet_address || null;
  req.body.deviceInfo = req.body.deviceInfo || req.body.device_info || null;

  return handleVerify(req, res);
});

// One-off debug route to capture access tokens from clients for troubleshooting.
// This route is intentionally restrictive: it is disabled in production unless
// `ENABLE_DEBUG_TOKEN_ROUTE=true` is set in the environment. Remove this route
// after debugging is complete.
router.post('/debug-token', (req, res) => {
  try {
    if (process.env.ENABLE_DEBUG_TOKEN_ROUTE !== 'true') {
      return res.status(404).json({ success: false, error: 'Not found' });
    }

    const token = req.body?.accessToken || req.body?.access_token || req.body?.token ||
      (req.headers.authorization && req.headers.authorization.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null) || null;

    // Log a masked preview only (do not log full token in persistent logs)
    const preview = token ? String(token).slice(0, 8) + '...' : null;
    logger.info('[debug.token] received token preview: %s', preview);

    // Return success so client can continue; server does not store the token.
    return res.json({ success: true, tokenPreview: preview });
  } catch (e) {
    logger.error('[debug.token] error: %o', e?.message || e);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

// ============================================
// VERIFY EXISTING TOKEN
// ============================================

/**
 * POST /api/auth/verify-token
 *
 * Verifies an existing session token
 */
router.post('/verify-token', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;
    const bodyToken = req.body?.token || req.body?.accessToken || req.body?.access_token || null;
    const token = headerToken || bodyToken || null;

    // Development/devtools convenience: accept dev tokens locally to simplify testing
    const devAuthBypassEnabled = process.env.ALLOW_DEV_AUTH_BYPASS === 'true';
    if (process.env.NODE_ENV !== 'production' && devAuthBypassEnabled && (token === 'dev-token' || token === 'MOCK_VALID')) {
      return res.json({
        success: true,
        user: {
          id: '00000000-0000-0000-0000-000000000000',
          username: 'dev',
          pi_uid: 'dev-pi-uid',
          trust_score: 20,
        },
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
    }

    if (!token) {
      logger.warn('[verify-token] no token provided', {
        ip: req.ip || null,
        origin: req.headers.origin || null,
      });
      return res.status(401).json({ success: false, error: 'No token provided' });
    }

    const tokenHash = hashToken(token);

    // Find session
    // Try to find session by app session token hash
    let session = null;
    let lookupError = null;
    const { data, error: qErr } = await supabase
      .from('sessions')
      .select('*, user:user_id(id, username, pi_id, pmarts_id, trust_score)')
      .eq('token_hash', tokenHash)
      .gt('expires_at', new Date().toISOString())
      .single();
    session = data;
    lookupError = qErr;

    // If not found by session token, attempt fallback: treat the provided Bearer token
    // as a Pi provider access token and locate the session by `pi_access_token`.
    if (lookupError || !session) {
      try {
        logger.info('[verify-token] session not found by hash, attempting pi_access_token lookup', {
          tokenHashPreview: tokenHash ? tokenHash.slice(0, 8) + '...' : null,
          ip: req.ip || null,
        });

        const { data: piSession, error: piErr } = await supabase
          .from('sessions')
          .select('*, user:user_id(id, username, pi_uid, trust_score)')
          .eq('pi_access_token', token)
          .gt('expires_at', new Date().toISOString())
          .single();

        if (!piErr && piSession) {
          // Verify the Pi access token with Pi API before accepting it
          const piValid = await piApi.verifyAccessToken(token);
          if (piValid && piValid.valid && piSession.user && piValid.uid === piSession.user.pi_uid) {
            session = piSession;
            logger.info('[verify-token] authenticated via pi_access_token fallback', { userId: session.user?.id || null });
          } else {
            logger.warn('[verify-token] pi_access_token present but verification failed', { piValid, userPiUid: piSession.user?.pi_uid || null });
          }
        }
      } catch (e) {
        try {
          logger.warn('[verify-token] session lookup failed', {
            tokenHashPreview: tokenHash ? tokenHash.slice(0, 8) + '...' : null,
            ip: req.ip || null,
            error: e?.message || e,
          });
        } catch (inner) {}
      }
    }

    if (!session) {
      // Final fallback: accept a valid Pi access token even if no session is found.
      // This keeps Pi Browser auto-login from failing when access tokens rotate.
      const piValid = await piApi.verifyAccessToken(token);
      if (piValid && piValid.valid) {
        // Ensure we have a PMARTS user record for this Pi UID, creating one if needed.
        let appUser = null;
        try {
          const { data: existingUser, error: lookupErr } = await supabase
            .from('users')
            .select('id, username, pi_id, pmarts_id, trust_score')
            .eq('pi_id', piValid.uid)
            .maybeSingle();
          if (lookupErr) {
            logger.warn('[verify-token] user lookup error', { piUid: piValid.uid, error: lookupErr.message || lookupErr });
          }
          if (existingUser) {
            appUser = {
              id: existingUser.id,
              username: existingUser.username,
              pi_uid: existingUser.pi_id,
              trust_score: existingUser.trust_score,
            };
          } else {
            const { data: createdUser, error: createErr } = await supabase
              .from('users')
              .insert({
                pi_id: piValid.uid,
                username: piValid.username || `pi-${piValid.uid}`,
                trust_score: 20,
                created_at: new Date().toISOString(),
                last_login_at: new Date().toISOString(),
              })
              .select('id, username, pi_id, pmarts_id, trust_score')
              .single();
            if (createErr) {
              logger.error('[verify-token] user create error', { piUid: piValid.uid, error: createErr.message || createErr });
            } else {
              appUser = {
                id: createdUser.id,
                username: createdUser.username,
                pi_uid: createdUser.pi_id,
                trust_score: createdUser.trust_score,
              };
            }
          }
        } catch (e) {
          logger.warn('[verify-token] user upsert fallback failed', { piUid: piValid.uid, error: e?.message || e });
        }

        return res.json({
          success: true,
          user: appUser || {
            id: null,
            username: piValid.username || null,
            pi_id: piValid.uid || null,
            pmarts_id: null,
            trust_score: null,
          },
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          source: 'pi_access_token_only',
        });
      }
      return res.status(401).json({ success: false, error: 'Invalid or expired token', code: 'INVALID_OR_EXPIRED_TOKEN' });
    }

    // Optional strict Pi token re-verification for existing PMARTS sessions.
    // Default behavior trusts PMARTS session expiry to avoid unnecessary 401 churn
    // when Pi access tokens rotate or network checks are temporarily unreliable.
    const strictPiSessionVerify = process.env.STRICT_PI_SESSION_VERIFY === 'true';
    if (strictPiSessionVerify && session.pi_access_token) {
      const piValid = await piApi.verifyAccessToken(session.pi_access_token);
      if (!piValid.valid) {
        await supabase.from('sessions').delete().eq('token_hash', tokenHash);
        return res.status(401).json({
          success: false,
          error: 'Pi session expired',
          code: 'PI_TOKEN_EXPIRED',
        });
      }
    } else if (session.pi_access_token) {
      logger.info('[verify-token] skipping strict Pi re-verification for existing session', {
        strictPiSessionVerify,
        userId: session.user?.id || null,
      });
    }

    res.json({
      success: true,
      user: session.user,
      expiresAt: session.expires_at,
    });
  } catch (error) {
    logger.error('Verify token error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================
// LOGOUT
// ============================================

/**
 * POST /api/auth/logout
 *
 * Logout and invalidate session
 */
router.post('/logout', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    logger.info('Logout request', { hasAuthHeader: !!authHeader });
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const tokenHash = hashToken(token);

      // Delete session
      const { error } = await supabase.from('sessions').delete().eq('token_hash', tokenHash);
      if (error) {
        logger.error('Logout session delete error: %o', error);
      }
    }

    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    logger.error('Logout error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /api/auth/revoke-all
 *
 * Revoke all sessions for the authenticated user. Accepts optional
 * body { keepCurrent: boolean } to preserve the calling session.
 */
router.post('/revoke-all', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    const tokenHash = hashToken(token);

    // Find current session
    const { data: currentSession, error: sessionErr } = await supabase
      .from('sessions')
      .select('*')
      .eq('token_hash', tokenHash)
      .single();

    if (sessionErr || !currentSession) {
      return res.status(401).json({ success: false, error: 'Invalid session' });
    }

    const userId = currentSession.user_id;
    const keepCurrent = !!req.body?.keepCurrent;

    // Build delete query
    let query = supabase.from('sessions').delete().eq('user_id', userId);
    if (keepCurrent) query = query.neq('token_hash', tokenHash);

    const { error: deleteErr } = await query;
    if (deleteErr) {
      logger.error('[revoke-all] delete error: %o', deleteErr);
      return res.status(500).json({ success: false, error: 'Failed to revoke sessions' });
    }

    // Audit log (best-effort)
    try {
      await audit.insertAuditLog({
        action: 'revoke_all_sessions',
        entity_type: 'user',
        entity_id: userId,
        actor_id: userId,
        metadata: { keepCurrent },
      });
    } catch (e) {
      logger.warn('[revoke-all] audit failed: %o', e?.message || e);
    }

    res.json({ success: true, revoked: !keepCurrent ? 'all' : 'others' });
  } catch (error) {
    logger.error('[revoke-all] error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET /api/auth/sessions
 *
 * Return active sessions for the authenticated user.
 */
router.get('/sessions', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    const tokenHash = hashToken(token);

    const { data: currentSession, error: currentErr } = await supabase
      .from('sessions')
      .select('id,user_id,token_hash,device_info,created_at,expires_at')
      .eq('token_hash', tokenHash)
      .single();

    if (currentErr || !currentSession) {
      return res.status(401).json({ success: false, error: 'Invalid session' });
    }

    const { data: sessions, error } = await supabase
      .from('sessions')
      .select('id,token_hash,device_info,created_at,expires_at')
      .eq('user_id', currentSession.user_id)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(5);

    if (error) {
      logger.error('[sessions] list error: %o', error);
      return res.status(500).json({ success: false, error: 'Failed to load sessions' });
    }

    const normalized = (sessions || []).map((s) => ({
      id: s.id,
      created_at: s.created_at,
      expires_at: s.expires_at,
      current: s.token_hash === tokenHash,
      device: {
        platform: s.device_info?.platform || 'Unknown',
        deviceId: s.device_info?.deviceId || null,
        isInPiBrowser: !!s.device_info?.isInPiBrowser,
      },
    }));

    return res.json({ success: true, sessions: normalized });
  } catch (error) {
    logger.error('[sessions] error: %o', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /api/auth/recalculate-trust
 * Recalculate trust score for a specific user using the canonical backend model.
 */
router.post('/recalculate-trust', async (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!userId) {
      return res.status(400).json({ success: false, error: 'userId is required' });
    }

    await escrowWalletService.recalculateTrustScore(userId);

    const { data: user, error } = await supabase
      .from('users')
      .select('id, trust_score')
      .eq('id', userId)
      .single();

    if (error) {
      return res.status(500).json({ success: false, error: error.message || 'Failed to fetch updated trust score' });
    }

    return res.json({ success: true, user });
  } catch (error) {
    logger.error('recalculate-trust route error: %o', error?.message || error);
    return res.status(500).json({ success: false, error: error?.message || 'Internal server error' });
  }
});

// ============================================
// GET CURRENT USER
// ============================================

/**
 * GET /api/auth/me
 *
 * Get current authenticated user
 */
router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const token = authHeader.substring(7);
    const tokenHash = hashToken(token);

    // Find session with user
    const { data: session, error } = await supabase
      .from('sessions')
      .select(`
        user:user_id(
          id, 
          pi_id,
          username, 
            pmarts_id,
          wallet_address, 
          trust_score, 
          successful_transactions,
          disputes_filed,
          created_at
        )
      `)
      .eq('token_hash', tokenHash)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (error || !session?.user) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    res.json({
      success: true,
      user: session.user,
    });
  } catch (error) {
    logger.error('Get me error: %o', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================
// LINK EMAIL (create auth user + send magic link)
// ============================================
/**
 * POST /api/auth/link-email
 * Body: { email }
 * Requires an app session Bearer token in Authorization header
 */
router.post('/link-email', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const token = authHeader.substring(7);
    const tokenHash = hashToken(token);

    // Find session and user id
    const { data: session, error: sessionErr } = await supabase
      .from('sessions')
      .select('user_id, expires_at')
      .eq('token_hash', tokenHash)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (sessionErr || !session) {
      return res.status(401).json({ success: false, error: 'Invalid or expired token' });
    }

    const email = (req.body && req.body.email) || null;
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }

    // Load our user record
    const { data: userRow, error: userErr } = await getUserById(session.user_id, '*', { maybeSingle: true });

    if (userErr || !userRow) {
      return res.status(400).json({ success: false, error: 'User not found' });
    }

    if (userRow.auth_user_id) {
      return res.json({ success: true, linked: true, authUserId: userRow.auth_user_id });
    }

    // Try to create an auth user (non-fatal if already exists)
    let createdAuthUserId = null;
    try {
      const { data: authRes, error: authError } = await supabase.auth.admin.createUser({
        email,
        user_metadata: {
          provider: 'pi',
          pi_id: userRow.pi_id || null,
          username: userRow.username || null,
        },
        email_confirm: true,
      });

      if (!authError && authRes?.user) {
        createdAuthUserId = authRes.user.id;
        // persist link
        try {
          await updateUserById(userRow.id, { auth_user_id: createdAuthUserId });
        } catch (e) {
          logger.warn('Failed to update users.auth_user_id (non-fatal): %o', e?.message || e);
        }
      } else if (authError) {
        logger.warn('admin.createUser returned error (non-fatal): %o', authError?.message || authError);
      }
    } catch (e) {
      logger.warn('Error calling admin.createUser (non-fatal): %o', e?.message || e);
    }

    // Generate magic link (this will return the auth user info if available)
    let actionLink = null;
    let linkedAuthUserId = createdAuthUserId;
    try {
      const genParams = { type: 'magiclink', email };
      if (process.env.MAGIC_LINK_REDIRECT) genParams.options = { redirectTo: process.env.MAGIC_LINK_REDIRECT };

      const { data: linkRes, error: linkErr } = await supabase.auth.admin.generateLink(genParams);

      if (linkErr) {
        logger.warn('admin.generateLink returned error: %o', linkErr?.message || linkErr);
      } else if (linkRes?.properties) {
        actionLink = linkRes.properties.action_link || null;
      }

      // linkRes may include a user object
      if (linkRes?.user && linkRes.user.id) {
        linkedAuthUserId = linkRes.user.id;
        // persist if we haven't already
        if (!createdAuthUserId) {
          try {
            await updateUserById(userRow.id, { auth_user_id: linkedAuthUserId });
          } catch (e) {
            logger.warn('Failed to update users.auth_user_id after generateLink (non-fatal): %o', e?.message || e);
          }
        }
      }
    } catch (e) {
      logger.warn('Error calling admin.generateLink (non-fatal): %o', e?.message || e);
    }

    const responseBody = { success: true, linked: !!linkedAuthUserId, authUserId: linkedAuthUserId };
    // In non-production provide the action link for testing convenience
    if (actionLink && process.env.NODE_ENV !== 'production') responseBody.actionLink = actionLink;

    return res.json(responseBody);
  } catch (error) {
    logger.error('link-email error: %o', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Track device fingerprint for fraud detection
 */
async function trackDeviceFingerprint(userId, deviceInfo) {
  try {
    const deviceHash = crypto
      .createHash('sha256')
      .update(JSON.stringify({
        deviceId: deviceInfo.deviceId,
        platform: deviceInfo.platform,
      }))
      .digest('hex');

    // Upsert device fingerprint
    await supabase
      .from('device_fingerprints')
      .upsert(
        {
          user_id: userId,
          device_hash: deviceHash,
          device_info: deviceInfo,
          last_seen_at: new Date().toISOString(),
        },
        {
          onConflict: 'user_id,device_hash',
        }
      );

    // Increment transaction count
    await supabase.rpc('increment_device_transaction', {
      p_user_id: userId,
      p_device_hash: deviceHash,
    });
  } catch (error) {
    logger.error('Track device error: %o', error);
  }
}

/**
 * Generate secure session token
 */
function generateSessionToken(userId) {
  const payload = {
    userId,
    timestamp: Date.now(),
    random: crypto.randomBytes(16).toString('hex'),
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

/**
 * Hash token for storage
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = router;
