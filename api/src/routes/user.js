const express = require("express");
const crypto = require('crypto');
const { supabase } = require("../lib/supabase");
const piApi = require("../lib/piApi");
const logger = require("../lib/logger");

const router = express.Router();

const PROFILE_EDITABLE_FIELDS = new Set([
  'username',
  'bio',
  'location',
  'preferred_language',
  'avatar_visibility',
  'theme_preset',
  'notification_preset',
]);

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

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function areCounterparties(userA, userB) {
  try {
    if (!userA || !userB) return false;
    if (String(userA) === String(userB)) return true;

    const convCheck = await supabase
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .or(`and(user_a_id.eq.${userA},user_b_id.eq.${userB}),and(user_a_id.eq.${userB},user_b_id.eq.${userA})`);

    if (Number(convCheck?.count || 0) > 0) return true;

    const escrowCheck = await supabase
      .from('escrows')
      .select('id', { count: 'exact', head: true })
      .or(`and(sender_id.eq.${userA},recipient_id.eq.${userB}),and(sender_id.eq.${userB},recipient_id.eq.${userA})`);

    return Number(escrowCheck?.count || 0) > 0;
  } catch (_e) {
    return false;
  }
}

/**
 * POST /api/user/sync
 *
 * Upsert Pi user into the users table using the service-role key (bypasses RLS).
 * Verifies the Pi access token with Pi Network before writing.
 */
router.post("/sync", async (req, res) => {
  try {
    const { accessToken, username, walletAddress } = req.body;

    if (!accessToken) {
      return res.status(400).json({ success: false, error: "accessToken is required" });
    }

    // Verify with Pi Network to get canonical uid / username
    const verifyResult = await piApi.verifyUser(accessToken);
    if (!verifyResult.success || !verifyResult.user) {
      return res.status(401).json({ success: false, error: "Pi token verification failed" });
    }

    const piUser = verifyResult.user;
    const piUid = piUser.uid;
    const resolvedUsername = piUser.username || username;

    const { error } = await supabase.from("users").upsert(
      {
        pi_id: piUid,
        username: resolvedUsername,
        wallet_address: walletAddress || null,
        last_login_at: new Date().toISOString(),
      },
      { onConflict: "pi_id" }
    );

    if (error) {
      logger.error("[user/sync] upsert error: %o", error);
      return res.status(500).json({ success: false, error: "Failed to sync user" });
    }

    res.json({ success: true });
  } catch (err) {
    logger.error("[user/sync] error: %o", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.get('/profile', async (req, res) => {
  try {
    const userId = await getUserIdFromAuthHeader(req);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { data, error } = await supabase
      .from('users')
      .select('id,pi_id,username,pmarts_id,balance,trust_score,completed_escrows,disputes,created_at,updated_at,avatar_path,avatar_visibility,photo_review_status,bio,location,preferred_language,theme_preset,notification_preset,is_verified')
      .eq('id', userId)
      .single();

    if (error || !data) {
      logger.error('[user/profile] failed to load user: %o', error || '(not found)');
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    return res.json({ success: true, user: data });
  } catch (err) {
    logger.error('[user/profile] error: %o', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.post('/profile/update', async (req, res) => {
  try {
    const userId = await getUserIdFromAuthHeader(req);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const incoming = req.body || {};
    const updates = {};

    for (const [key, value] of Object.entries(incoming)) {
      if (!PROFILE_EDITABLE_FIELDS.has(key)) continue;
      updates[key] = value;
    }

    if (typeof updates.username === 'string') {
      updates.username = updates.username.trim();
      if (!updates.username) return res.status(400).json({ success: false, error: 'Username cannot be empty' });
      if (!/^[a-zA-Z0-9_]{3,20}$/.test(updates.username)) {
        return res.status(400).json({ success: false, error: 'Invalid username format' });
      }
    }

    if (typeof updates.bio === 'string') updates.bio = updates.bio.trim().slice(0, 280);
    if (typeof updates.location === 'string') updates.location = updates.location.trim().slice(0, 120);
    if (typeof updates.preferred_language === 'string') updates.preferred_language = updates.preferred_language.trim().slice(0, 30);

    if (updates.avatar_visibility && !['public', 'counterparties_only'].includes(String(updates.avatar_visibility))) {
      return res.status(400).json({ success: false, error: 'Invalid avatar visibility' });
    }
    if (updates.theme_preset && !['default', 'business', 'quiet'].includes(String(updates.theme_preset))) {
      return res.status(400).json({ success: false, error: 'Invalid theme preset' });
    }
    if (updates.notification_preset && !['balanced', 'business', 'minimal'].includes(String(updates.notification_preset))) {
      return res.status(400).json({ success: false, error: 'Invalid notification preset' });
    }

    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', userId)
      .select('id,pi_id,username,pmarts_id,balance,trust_score,completed_escrows,disputes,created_at,updated_at,avatar_path,avatar_visibility,photo_review_status,bio,location,preferred_language,theme_preset,notification_preset,is_verified')
      .single();

    if (error) {
      logger.error('[user/profile.update] update failed: %o', error);
      if (error.code === '23505') return res.status(409).json({ success: false, error: 'Username already taken' });
      return res.status(500).json({ success: false, error: 'Failed to update profile' });
    }

    return res.json({ success: true, user: data });
  } catch (err) {
    logger.error('[user/profile.update] error: %o', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.post('/profile/avatar-upload', async (req, res) => {
  try {
    const userId = await getUserIdFromAuthHeader(req);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { base64, contentType } = req.body || {};
    if (!base64 || typeof base64 !== 'string') {
      return res.status(400).json({ success: false, error: 'base64 image is required' });
    }

    const normalizedType = String(contentType || 'image/jpeg').toLowerCase();
    const allowedTypes = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
    if (!allowedTypes.has(normalizedType)) {
      return res.status(400).json({ success: false, error: 'Unsupported image type' });
    }

    const cleanBase64 = base64.includes(',') ? base64.split(',').pop() : base64;
    const fileBuffer = Buffer.from(cleanBase64 || '', 'base64');
    if (!fileBuffer.length) return res.status(400).json({ success: false, error: 'Invalid image payload' });
    if (fileBuffer.length > 4 * 1024 * 1024) {
      return res.status(400).json({ success: false, error: 'Image too large (max 4MB)' });
    }

    const ext = normalizedType.includes('png') ? 'png' : normalizedType.includes('webp') ? 'webp' : 'jpg';
    const avatarPath = `${userId}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;

    const { data: oldUser } = await supabase
      .from('users')
      .select('avatar_path')
      .eq('id', userId)
      .maybeSingle();

    const { error: uploadError } = await supabase
      .storage
      .from('profile-avatars')
      .upload(avatarPath, fileBuffer, {
        contentType: normalizedType,
        upsert: false,
      });

    if (uploadError) {
      logger.error('[user/avatar-upload] storage upload failed: %o', uploadError);
      return res.status(500).json({ success: false, error: 'Failed to upload avatar' });
    }

    const reviewStatus = 'pending';
    const { error: updateError } = await supabase
      .from('users')
      .update({
        avatar_path: avatarPath,
        photo_review_status: reviewStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);

    if (updateError) {
      logger.error('[user/avatar-upload] user update failed: %o', updateError);
      return res.status(500).json({ success: false, error: 'Avatar uploaded but profile update failed' });
    }

    if (oldUser?.avatar_path) {
      try {
        await supabase.storage.from('profile-avatars').remove([oldUser.avatar_path]);
      } catch (removeErr) {
        logger.warn('[user/avatar-upload] failed removing old avatar: %o', removeErr);
      }
    }

    const { data: signed, error: signedError } = await supabase
      .storage
      .from('profile-avatars')
      .createSignedUrl(avatarPath, 60 * 10);

    if (signedError) {
      logger.warn('[user/avatar-upload] signed url generation failed: %o', signedError);
    }

    return res.json({
      success: true,
      avatar_path: avatarPath,
      avatar_url: signed?.signedUrl || null,
      photo_review_status: reviewStatus,
      moderation_note: 'Avatar uploaded and queued for review',
    });
  } catch (err) {
    logger.error('[user/avatar-upload] error: %o', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.get('/profile/avatar-url', async (req, res) => {
  try {
    const userId = await getUserIdFromAuthHeader(req);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { data: user, error } = await supabase
      .from('users')
      .select('avatar_path,avatar_visibility,photo_review_status')
      .eq('id', userId)
      .maybeSingle();

    if (error || !user) return res.status(404).json({ success: false, error: 'User not found' });
    if (!user.avatar_path) return res.json({ success: true, avatar_url: null, avatar_path: null, photo_review_status: user.photo_review_status || null });

    const { data: signed, error: signedError } = await supabase
      .storage
      .from('profile-avatars')
      .createSignedUrl(user.avatar_path, 60 * 10);

    if (signedError) {
      logger.error('[user/avatar-url] signed url error: %o', signedError);
      return res.status(500).json({ success: false, error: 'Failed to generate avatar URL' });
    }

    return res.json({
      success: true,
      avatar_url: signed?.signedUrl || null,
      avatar_path: user.avatar_path,
      avatar_visibility: user.avatar_visibility || 'public',
      photo_review_status: user.photo_review_status || null,
    });
  } catch (err) {
    logger.error('[user/avatar-url] error: %o', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.get('/profile/:id/avatar-url', async (req, res) => {
  try {
    const viewerUserId = await getUserIdFromAuthHeader(req);
    if (!viewerUserId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const targetUserId = req.params.id;
    const { data: target, error } = await supabase
      .from('users')
      .select('id,avatar_path,avatar_visibility,photo_review_status')
      .eq('id', targetUserId)
      .maybeSingle();

    if (error || !target) return res.status(404).json({ success: false, error: 'User not found' });
    if (!target.avatar_path) {
      return res.json({ success: true, avatar_url: null, visible: false, reason: 'no_avatar' });
    }

    const isSelf = String(viewerUserId) === String(targetUserId);
    const isCounterparty = await areCounterparties(viewerUserId, targetUserId);
    const visibility = String(target.avatar_visibility || 'public');
    const moderation = String(target.photo_review_status || 'approved');

    const isVisible =
      isSelf ||
      (visibility === 'public' && moderation === 'approved') ||
      (visibility === 'counterparties_only' && isCounterparty && moderation === 'approved');

    if (!isVisible) {
      return res.json({ success: true, avatar_url: null, visible: false, reason: 'restricted' });
    }

    const { data: signed, error: signedError } = await supabase
      .storage
      .from('profile-avatars')
      .createSignedUrl(target.avatar_path, 60 * 10);

    if (signedError) {
      logger.error('[user/profile.target-avatar] signed url error: %o', signedError);
      return res.status(500).json({ success: false, error: 'Failed to generate avatar URL' });
    }

    return res.json({
      success: true,
      avatar_url: signed?.signedUrl || null,
      visible: true,
      reason: 'allowed',
    });
  } catch (err) {
    logger.error('[user/profile.target-avatar] error: %o', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.get('/profile/stats', async (req, res) => {
  try {
    const userId = await getUserIdFromAuthHeader(req);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id,completed_escrows,disputes,is_verified')
      .eq('id', userId)
      .single();

    if (userError || !user) return res.status(404).json({ success: false, error: 'User not found' });

    const { count: totalEscrows } = await supabase
      .from('escrows')
      .select('id', { count: 'exact', head: true })
      .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`);

    const { count: completedEscrows } = await supabase
      .from('escrows')
      .select('id', { count: 'exact', head: true })
      .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`)
      .eq('status', 'completed');

    const { count: disputedEscrows } = await supabase
      .from('escrows')
      .select('id', { count: 'exact', head: true })
      .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`)
      .eq('status', 'disputed');

    const { data: completedRows } = await supabase
      .from('escrows')
      .select('deadline,released_at')
      .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`)
      .eq('status', 'completed')
      .limit(5000);

    const onTimeCompleted = (completedRows || []).filter((row) => {
      if (!row?.deadline || !row?.released_at) return false;
      return new Date(row.released_at).getTime() <= new Date(row.deadline).getTime();
    }).length;

    const completed = toNumber(completedEscrows || user.completed_escrows || 0);
    const total = toNumber(totalEscrows || 0);
    const disputed = toNumber(disputedEscrows || user.disputes || 0);

    const onTimeRate = completed > 0 ? Math.round((onTimeCompleted / completed) * 100) : 100;
    const disputeRate = total > 0 ? Math.round((disputed / total) * 100) : 0;

    const milestoneBadges = [10, 50, 100]
      .filter((threshold) => completed >= threshold)
      .map((threshold) => `${threshold} Completed Escrows`);

    const verificationBadges = [];
    if (Boolean(user.is_verified)) verificationBadges.push('KYC Verified');
    if (completed >= 50) verificationBadges.push('Veteran Trader');
    if (disputed === 0 && total >= 5) verificationBadges.push('Dispute-Free Streak');

    const reputationHighlights = [];
    if (onTimeRate >= 90) reputationHighlights.push('On-time closer');
    if (disputeRate <= 5) reputationHighlights.push('Low dispute risk');
    if (completed >= 10) reputationHighlights.push('Experienced trader');
    if (reputationHighlights.length === 0) reputationHighlights.push('Building track record');

    const profileCompletenessChecks = [
      'username',
      'avatar_path',
      'bio',
      'location',
      'preferred_language',
    ];

    const { data: profileData } = await supabase
      .from('users')
      .select(profileCompletenessChecks.join(','))
      .eq('id', userId)
      .maybeSingle();

    const completionCount = profileCompletenessChecks.filter((field) => {
      const val = profileData?.[field];
      return val !== null && val !== undefined && String(val).trim() !== '';
    }).length;

    const profileCompleteness = Math.round((completionCount / profileCompletenessChecks.length) * 100);

    return res.json({
      success: true,
      stats: {
        total_escrows: total,
        completed_escrows: completed,
        on_time_rate: onTimeRate,
        dispute_rate: disputeRate,
        profile_completeness: profileCompleteness,
      },
      badges: {
        verification: verificationBadges,
        milestones: milestoneBadges,
      },
      reputation_highlights: reputationHighlights,
    });
  } catch (err) {
    logger.error('[user/profile.stats] error: %o', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.get("/:id", async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase.from("users").select("*").eq("id", id).single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  if (!data) {
    return res.status(404).json({ error: "User not found" });
  }

  return res.json({ user: data });
});

module.exports = router;

