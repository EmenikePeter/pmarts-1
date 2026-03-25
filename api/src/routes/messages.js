const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const supabase = require('../lib/supabase');
const logger = require('../lib/logger');

const SEND_RATE_LIMIT_MS = 1000;
const lastMessageByConversationUser = new Map();
const READ_ONLY_ESCROW_STATUSES = new Set(['completed', 'cancelled', 'expired', 'refunded']);

// ─────────────────────────────────────────────
// Auth helper — resolves userId from Bearer token (same pattern as disputes.js)
// ─────────────────────────────────────────────
async function getUserIdFromAuthHeader(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.substring(7);
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const { data: session, error } = await supabase
    .from('sessions')
    .select('user_id')
    .eq('token_hash', tokenHash)
    .single();
  if (error || !session) return null;
  return session.user_id;
}

// Guarantee canonical (user_a < user_b) ordering for unique pair lookup
function canonicalPair(a, b) {
  return String(a) < String(b) ? [String(a), String(b)] : [String(b), String(a)];
}

function isParticipant(conv, userId) {
  return String(conv.user_a_id) === String(userId) || String(conv.user_b_id) === String(userId);
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

async function decorateUserForViewer(rawUser, viewerUserId, { isCounterparty = false } = {}) {
  if (!rawUser) return null;

  const normalized = {
    id: rawUser.id,
    pi_id: rawUser.pi_id,
    username: rawUser.username,
    trust_score: rawUser.trust_score,
    avatar_visibility: rawUser.avatar_visibility || 'public',
    photo_review_status: rawUser.photo_review_status || null,
    avatar_url: null,
  };

  const isSelf = String(rawUser.id) === String(viewerUserId);
  const visibility = String(rawUser.avatar_visibility || 'public');
  const moderation = String(rawUser.photo_review_status || 'approved');
  const canShow =
    isSelf ||
    (visibility === 'public' && moderation === 'approved') ||
    (visibility === 'counterparties_only' && isCounterparty && moderation === 'approved');

  if (canShow && rawUser.avatar_path) {
    normalized.avatar_url = await createAvatarSignedUrl(rawUser.avatar_path);
  }

  return normalized;
}

async function getConversationOr404(convId, res) {
  const { data: conv, error: convErr } = await supabase
    .from('conversations')
    .select('id, user_a_id, user_b_id, unread_a, unread_b, escrow_id')
    .eq('id', convId)
    .single();
  if (convErr || !conv) {
    res.status(404).json({ success: false, error: 'Conversation not found' });
    return null;
  }
  return conv;
}

async function createSystemMessage({ conversationId, actorUserId, content, escrowId = null }) {
  const safeContent = String(content || '').trim().slice(0, 2000);
  if (!safeContent) return null;

  const { data: row, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_id: actorUserId,
      escrow_id: escrowId,
      type: 'system',
      status: 'delivered',
      delivered_at: new Date().toISOString(),
      content: safeContent,
    })
    .select()
    .single();

  if (error) {
    logger.warn('[messages.system] failed to create system message: %o', error);
    return null;
  }

  await supabase
    .from('conversations')
    .update({
      last_message: safeContent.slice(0, 100),
      last_message_at: row.created_at,
    })
    .eq('id', conversationId);

  return row;
}

// ─────────────────────────────────────────────
// POST /api/messages/start
// Find or create a 1-1 conversation with another user.
// Body: { piId } OR { userId }
// ─────────────────────────────────────────────
router.post('/start', async (req, res) => {
  try {
    const userId = await getUserIdFromAuthHeader(req);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { piId, userId: targetUserId } = req.body || {};
    if (!piId && !targetUserId) {
      return res.status(400).json({ success: false, error: 'piId or userId is required' });
    }

    // Resolve target user
    let otherUser = null;
    if (targetUserId) {
      const { data, error } = await supabase
        .from('users')
        .select('id, pi_id, username, trust_score, avatar_path, avatar_visibility, photo_review_status')
        .eq('id', targetUserId)
        .maybeSingle();
      if (error || !data) return res.status(404).json({ success: false, error: 'User not found' });
      otherUser = data;
    } else {
      // Strip leading @ for username search
      const searchVal = String(piId).startsWith('@') ? String(piId).slice(1) : String(piId);
      const { data: byPiId } = await supabase
        .from('users')
        .select('id, pi_id, username, trust_score, avatar_path, avatar_visibility, photo_review_status')
        .eq('pi_id', searchVal)
        .maybeSingle();
      if (byPiId) {
        otherUser = byPiId;
      } else {
        const { data: byUsername } = await supabase
          .from('users')
          .select('id, pi_id, username, trust_score, avatar_path, avatar_visibility, photo_review_status')
          .eq('username', searchVal)
          .maybeSingle();
        if (!byUsername) return res.status(404).json({ success: false, error: 'User not found' });
        otherUser = byUsername;
      }
    }

    if (String(otherUser.id) === String(userId)) {
      return res.status(400).json({ success: false, error: 'Cannot start a chat with yourself' });
    }

    const [userA, userB] = canonicalPair(userId, otherUser.id);

    // Try to find existing conversation
    const { data: existing } = await supabase
      .from('conversations')
      .select('*')
      .eq('user_a_id', userA)
      .eq('user_b_id', userB)
      .maybeSingle();

    if (existing) {
      const decoratedOther = await decorateUserForViewer(otherUser, userId, { isCounterparty: true });
      return res.json({ success: true, conversation: existing, otherUser: decoratedOther });
    }

    // Create new conversation
    const { data: created, error: createErr } = await supabase
      .from('conversations')
      .insert({ user_a_id: userA, user_b_id: userB })
      .select()
      .single();

    if (createErr) {
      logger.error('[messages.start] create conversation error: %o', createErr);
      return res.status(500).json({ success: false, error: 'Failed to create conversation' });
    }

    const decoratedOther = await decorateUserForViewer(otherUser, userId, { isCounterparty: true });
    res.json({ success: true, conversation: created, otherUser: decoratedOther });
  } catch (err) {
    logger.error('[messages.start] error: %o', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────
// GET /api/messages/conversations
// List all conversations for current user, ordered by most recent message.
// Returns other user profile data and unread counts.
// ─────────────────────────────────────────────
router.get('/conversations', async (req, res) => {
  try {
    const userId = await getUserIdFromAuthHeader(req);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { data: convs, error } = await supabase
      .from('conversations')
      .select(`
        *,
        user_a:users!user_a_id(id, pi_id, username, trust_score, avatar_path, avatar_visibility, photo_review_status),
        user_b:users!user_b_id(id, pi_id, username, trust_score, avatar_path, avatar_visibility, photo_review_status)
      `)
      .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`)
      .order('last_message_at', { ascending: false });

    if (error) {
      logger.error('[messages.conversations] query error: %o', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch conversations' });
    }

    const decorated = await Promise.all((convs || []).map(async (conv) => {
      const userA = await decorateUserForViewer(conv.user_a, userId, { isCounterparty: true });
      const userB = await decorateUserForViewer(conv.user_b, userId, { isCounterparty: true });
      return {
        ...conv,
        user_a: userA,
        user_b: userB,
      };
    }));

    res.json({ success: true, conversations: decorated });
  } catch (err) {
    logger.error('[messages.conversations] error: %o', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────
// GET /api/messages/conversations/:id/messages
// Paginated messages. Query params: limit (default 50, max 100), before (ISO timestamp)
// ─────────────────────────────────────────────
router.get('/conversations/:id/messages', async (req, res) => {
  try {
    const userId = await getUserIdFromAuthHeader(req);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const convId = req.params.id;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const before = req.query.before; // ISO timestamp for cursor pagination

    // Verify participant
    const conv = await getConversationOr404(convId, res);
    if (!conv) return;
    if (!isParticipant(conv, userId)) {
      return res.status(403).json({ success: false, error: 'Not a participant' });
    }

    let query = supabase
      .from('messages')
      .select(`
        id,
        conversation_id,
        sender_id,
        escrow_id,
        type,
        status,
        content,
        is_read,
        delivered_at,
        read_at,
        created_at,
        escrow:escrows(id, status, amount, reference_id)
      `)
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (before) query = query.lt('created_at', before);

    const { data: msgs, error: msgErr } = await query;

    if (msgErr) {
      logger.error('[messages.get] query error: %o', msgErr);
      return res.status(500).json({ success: false, error: 'Failed to fetch messages' });
    }

    // Mark incoming sent messages as delivered when recipient fetches inbox/chat
    const undeliveredIncomingIds = (msgs || [])
      .filter((m) => String(m.sender_id) !== String(userId) && m.type === 'user' && m.status === 'sent')
      .map((m) => m.id);

    if (undeliveredIncomingIds.length > 0) {
      await supabase
        .from('messages')
        .update({ status: 'delivered', delivered_at: new Date().toISOString() })
        .in('id', undeliveredIncomingIds);
      (msgs || []).forEach((m) => {
        if (undeliveredIncomingIds.includes(m.id)) {
          m.status = 'delivered';
          m.delivered_at = new Date().toISOString();
        }
      });
    }

    res.json({ success: true, messages: msgs || [] });
  } catch (err) {
    logger.error('[messages.get] error: %o', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────
// POST /api/messages/conversations/:id/send
// Send a message. Body: { content }
// ─────────────────────────────────────────────
router.post('/conversations/:id/send', async (req, res) => {
  try {
    const userId = await getUserIdFromAuthHeader(req);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const convId = req.params.id;
    const rawContent = (req.body || {}).content;
    const messageEscrowId = (req.body || {}).escrowId || null;

    if (!rawContent || !String(rawContent).trim()) {
      return res.status(400).json({ success: false, error: 'content is required' });
    }
    // Sanitize: strip null bytes, limit length
    const content = String(rawContent).replace(/\0/g, '').trim().slice(0, 2000);

    const conv = await getConversationOr404(convId, res);
    if (!conv) return;

    const isA = String(conv.user_a_id) === String(userId);
    const isB = String(conv.user_b_id) === String(userId);
    if (!isParticipant(conv, userId)) {
      return res.status(403).json({ success: false, error: 'Not a participant' });
    }

    // Spam protection: 1 message per second per user/conversation
    const key = `${userId}:${convId}`;
    const now = Date.now();
    const lastSentAt = lastMessageByConversationUser.get(key) || 0;
    if (now - lastSentAt < SEND_RATE_LIMIT_MS) {
      return res.status(429).json({ success: false, error: 'You are sending messages too quickly. Please wait a second.' });
    }
    lastMessageByConversationUser.set(key, now);

    // Resolve escrow context: either already linked to conversation, or passed in message payload
    const effectiveEscrowId = conv.escrow_id || messageEscrowId || null;
    if (conv.escrow_id && messageEscrowId && String(conv.escrow_id) !== String(messageEscrowId)) {
      return res.status(400).json({ success: false, error: 'Conversation already linked to a different escrow' });
    }

    // Permission control after escrow linkage: lock messaging when escrow is closed
    if (effectiveEscrowId) {
      const { data: escrow, error: escrowErr } = await supabase
        .from('escrows')
        .select('id, sender_id, recipient_id, status')
        .eq('id', effectiveEscrowId)
        .single();

      if (escrowErr || !escrow) {
        return res.status(400).json({ success: false, error: 'Linked escrow not found' });
      }

      const participants = new Set([String(conv.user_a_id), String(conv.user_b_id)]);
      const escrowParticipants = new Set([String(escrow.sender_id), String(escrow.recipient_id)]);
      if (participants.size !== escrowParticipants.size || [...participants].some((p) => !escrowParticipants.has(p))) {
        return res.status(403).json({ success: false, error: 'Escrow participants do not match conversation participants' });
      }

      if (READ_ONLY_ESCROW_STATUSES.has(String(escrow.status || '').toLowerCase())) {
        return res.status(403).json({ success: false, error: `Chat is read-only for escrow status: ${escrow.status}` });
      }
    }

    // Insert message
    const { data: msg, error: insertErr } = await supabase
      .from('messages')
      .insert({
        conversation_id: convId,
        sender_id: userId,
        escrow_id: effectiveEscrowId,
        type: 'user',
        status: 'sent',
        content,
      })
      .select()
      .single();

    if (insertErr) {
      logger.error('[messages.send] insert error: %o', insertErr);
      return res.status(500).json({ success: false, error: 'Failed to send message' });
    }

    // Update conversation: last_message preview + increment unread for the OTHER party
    const unreadField = isA ? 'unread_b' : 'unread_a';
    const currentUnread = isA ? (conv.unread_b || 0) : (conv.unread_a || 0);

    await supabase
      .from('conversations')
      .update({
        last_message: content.slice(0, 100),
        last_message_at: msg.created_at,
        [unreadField]: currentUnread + 1,
      })
      .eq('id', convId);

    // Push notification to other party (best-effort)
    const otherUserId = isA ? conv.user_b_id : conv.user_a_id;
    await supabase
      .from('notifications')
      .insert({
        user_id: otherUserId,
        type: 'new_message',
        escrow_id: effectiveEscrowId,
        message: content.slice(0, 80) + (content.length > 80 ? '…' : ''),
      })
      .catch(() => {});

    res.json({ success: true, message: msg });
  } catch (err) {
    logger.error('[messages.send] error: %o', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────
// POST /api/messages/conversations/:id/read
// Mark all unread messages in this conversation as read for the current user.
// ─────────────────────────────────────────────
router.post('/conversations/:id/read', async (req, res) => {
  try {
    const userId = await getUserIdFromAuthHeader(req);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const convId = req.params.id;

    const conv = await getConversationOr404(convId, res);
    if (!conv) return;

    const isA = String(conv.user_a_id) === String(userId);
    const isB = String(conv.user_b_id) === String(userId);
    if (!isA && !isB) return res.status(403).json({ success: false, error: 'Not a participant' });

    const unreadField = isA ? 'unread_a' : 'unread_b';

    // Reset unread counter and mark messages as read
    await supabase.from('conversations').update({ [unreadField]: 0 }).eq('id', convId);
    await supabase
      .from('messages')
      .update({ is_read: true, status: 'read', read_at: new Date().toISOString() })
      .eq('conversation_id', convId)
      .neq('sender_id', userId);

    res.json({ success: true });
  } catch (err) {
    logger.error('[messages.read] error: %o', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────
// POST /api/messages/conversations/:id/link-escrow
// Link an escrow to an existing conversation and emit a system message.
// Body: { escrowId }
// ─────────────────────────────────────────────
router.post('/conversations/:id/link-escrow', async (req, res) => {
  try {
    const userId = await getUserIdFromAuthHeader(req);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const convId = req.params.id;
    const escrowId = (req.body || {}).escrowId;
    if (!escrowId) return res.status(400).json({ success: false, error: 'escrowId is required' });

    const conv = await getConversationOr404(convId, res);
    if (!conv) return;
    if (!isParticipant(conv, userId)) return res.status(403).json({ success: false, error: 'Not a participant' });

    const { data: escrow, error: escrowErr } = await supabase
      .from('escrows')
      .select('id, sender_id, recipient_id, amount, reference_id, status')
      .eq('id', escrowId)
      .single();

    if (escrowErr || !escrow) {
      return res.status(404).json({ success: false, error: 'Escrow not found' });
    }

    const participants = new Set([String(conv.user_a_id), String(conv.user_b_id)]);
    const escrowParticipants = new Set([String(escrow.sender_id), String(escrow.recipient_id)]);
    if (participants.size !== escrowParticipants.size || [...participants].some((p) => !escrowParticipants.has(p))) {
      return res.status(403).json({ success: false, error: 'Escrow participants do not match conversation participants' });
    }

    if (conv.escrow_id && String(conv.escrow_id) !== String(escrowId)) {
      return res.status(400).json({ success: false, error: 'Conversation already linked to another escrow' });
    }

    await supabase.from('conversations').update({ escrow_id: escrowId }).eq('id', convId);

    const summary = `Escrow linked: ${escrow.amount} π (${escrow.reference_id || escrow.id}) — status ${escrow.status}`;
    const sysMsg = await createSystemMessage({
      conversationId: convId,
      actorUserId: userId,
      escrowId,
      content: summary,
    });

    return res.json({ success: true, escrowId, systemMessage: sysMsg });
  } catch (err) {
    logger.error('[messages.link-escrow] error: %o', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;
