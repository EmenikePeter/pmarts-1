const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const audit = require('../lib/audit');
const logger = require('../lib/logger');
const { getUserRoleById } = require('../lib/userResolver');

// Helper to get user id from Bearer token
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

// POST /api/support/tickets - create a new support ticket (authenticated)
router.post('/tickets', async (req, res) => {
  try {
    const userId = await getUserIdFromAuthHeader(req);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { title, body, priority } = req.body || {};
    if (!title || !body) return res.status(400).json({ success: false, error: 'title and body required' });

    const payload = {
      user_id: userId,
      title: String(title).slice(0, 255),
      body: typeof body === 'string' ? { message: body } : body,
      priority: priority || 'normal',
      status: 'open',
    };

    const { data, error } = await supabase.from('support_tickets').insert(payload).select().maybeSingle();
    if (error) {
      logger.error('[support.create] insert error: %o', error);
      return res.status(500).json({ success: false, error: 'Failed to create ticket' });
    }

    try {
      await audit.insertAuditLog({ action: 'support_ticket_create', entity_type: 'support_ticket', entity_id: data.id, actor_id: userId, metadata: { title: data.title } });
    } catch (e) {
      logger.warn('[support.create] audit failed: %o', e?.message || e);
    }

    // echo back any client-provided id for client-side reconciliation
    const clientTicketId = req.body?.client_ticket_id || null;
    const resp = { success: true, ticket: data };
    if (clientTicketId) resp.ticket.client_ticket_id = clientTicketId;
    res.json(resp);
  } catch (err) {
    logger.error('[support.create] error: %o', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/support/tickets - list tickets for authenticated user or (admin) for a specific user
router.get('/tickets', async (req, res) => {
  try {
    const userId = await getUserIdFromAuthHeader(req);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const role = await getUserRole(userId);

    const queryUserId = req.query.userId;
    if (queryUserId) {
      // only admin/staff may request other user's tickets
      if (!isAdminRole(role)) return res.status(403).json({ success: false, error: 'Forbidden' });
      const { data, error } = await supabase.from('support_tickets').select('*').eq('user_id', queryUserId).order('created_at', { ascending: false });
      if (error) return res.status(500).json({ success: false, error: 'Failed to fetch tickets' });
      return res.json({ success: true, tickets: data });
    }

    // default: list tickets for the authenticated user
    const { data, error } = await supabase.from('support_tickets').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    if (error) {
      logger.error('[support.list] select error: %o', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch tickets' });
    }

    res.json({ success: true, tickets: data });
  } catch (err) {
    logger.error('[support.list] error: %o', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/support/tickets/all - admin: list recent tickets (paginated)
router.get('/tickets/all', async (req, res) => {
  try {
    const userId = await getUserIdFromAuthHeader(req);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const role = await getUserRole(userId);
    if (!isAdminRole(role)) return res.status(403).json({ success: false, error: 'Forbidden' });

    const limit = parseInt(req.query.limit) || 100;
    const { data, error } = await supabase.from('support_tickets').select('id,user_id,title,status,created_at,priority').order('created_at', { ascending: false }).limit(limit);
    if (error) {
      logger.error('[support.all] select error: %o', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch tickets' });
    }
    res.json({ success: true, tickets: data });
  } catch (err) {
    logger.error('[support.all] error: %o', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/support/tickets/:id/reply - admin reply to a ticket (append to JSON body.messages)
router.post('/tickets/:id/reply', async (req, res) => {
  try {
    const userId = await getUserIdFromAuthHeader(req);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const role = await getUserRole(userId);
    if (!isAdminRole(role)) return res.status(403).json({ success: false, error: 'Forbidden' });

    const ticketId = req.params.id;
    const { message, status } = req.body || {};
    if (!message) return res.status(400).json({ success: false, error: 'message required' });

    // fetch existing ticket
    const { data: ticket, error: fetchErr } = await supabase.from('support_tickets').select('id,body').eq('id', ticketId).maybeSingle();
    if (fetchErr || !ticket) {
      logger.error('[support.reply] fetch error: %o', fetchErr);
      return res.status(404).json({ success: false, error: 'Ticket not found' });
    }

    const existingBody = ticket.body || {};
    const msgs = Array.isArray(existingBody.messages) ? existingBody.messages.slice() : (existingBody.messages ? [existingBody.messages] : []);
    msgs.push({ sender: 'admin', admin_id: userId, message: String(message).slice(0, 2000), created_at: new Date().toISOString() });
    const newBody = { ...existingBody, messages: msgs };

    const updatePayload = { body: newBody };
    if (status) updatePayload.status = status;

    const { data: updated, error: upErr } = await supabase.from('support_tickets').update(updatePayload).eq('id', ticketId).select().maybeSingle();
    if (upErr) {
      logger.error('[support.reply] update error: %o', upErr);
      return res.status(500).json({ success: false, error: 'Failed to update ticket' });
    }

    try {
      await audit.insertAuditLog({ action: 'support_ticket_reply', entity_type: 'support_ticket', entity_id: ticketId, actor_id: userId, metadata: { snippet: String(message).slice(0, 200) } });
    } catch (e) {
      logger.warn('[support.reply] audit failed: %o', e?.message || e);
    }

    res.json({ success: true, ticket: updated });
  } catch (err) {
    logger.error('[support.reply] error: %o', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /api/support/tickets/:id - admin update ticket fields (status, assigned_to)
router.patch('/tickets/:id', async (req, res) => {
  try {
    const userId = await getUserIdFromAuthHeader(req);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const role = await getUserRole(userId);
    if (!isAdminRole(role)) return res.status(403).json({ success: false, error: 'Forbidden' });

    const ticketId = req.params.id;
    const { status, assigned_to } = req.body || {};
    if (!status && !assigned_to) return res.status(400).json({ success: false, error: 'status or assigned_to required' });

    const payload = {};
    if (status) payload.status = status;
    if (assigned_to) payload.assigned_to = assigned_to;

    const { data: updated, error } = await supabase.from('support_tickets').update(payload).eq('id', ticketId).select().maybeSingle();
    if (error) {
      logger.error('[support.update] update error: %o', error);
      return res.status(500).json({ success: false, error: 'Failed to update ticket' });
    }

    try {
      await audit.insertAuditLog({ action: 'support_ticket_update', entity_type: 'support_ticket', entity_id: ticketId, actor_id: userId, metadata: payload });
    } catch (e) {
      logger.warn('[support.update] audit failed: %o', e?.message || e);
    }

    res.json({ success: true, ticket: updated });
  } catch (err) {
    logger.error('[support.update] error: %o', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/support/tickets/:id/messages - list messages for a ticket (paginated)
router.get('/tickets/:id/messages', async (req, res) => {
  try {
    const userId = await getUserIdFromAuthHeader(req);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const ticketId = req.params.id;
    const role = await getUserRole(userId);

    // Verify authorization: owner or admin/staff
    const { data: ticket, error: tErr } = await supabase.from('support_tickets').select('id,user_id').eq('id', ticketId).maybeSingle();
    if (tErr || !ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });
    if (ticket.user_id !== userId && !isAdminRole(role)) return res.status(403).json({ success: false, error: 'Forbidden' });

    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    const { data, error } = await supabase.from('support_ticket_messages').select('id,ticket_id,sender_id,message,attachments,created_at').eq('ticket_id', ticketId).order('created_at', { ascending: true }).range(offset, offset + limit - 1);
    if (error) {
      logger.error('[support.messages.list] error: %o', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch messages' });
    }
    res.json({ success: true, messages: data });
  } catch (err) {
    logger.error('[support.messages.list] error: %o', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/support/tickets/:id/message - create a new message for a ticket (user or admin)
router.post('/tickets/:id/message', async (req, res) => {
  try {
    const userId = await getUserIdFromAuthHeader(req);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const ticketId = req.params.id;
    const { message, attachments } = req.body || {};
    if (!message) return res.status(400).json({ success: false, error: 'message required' });

    // Verify ticket exists and authorization: owner or admin
    const { data: ticket, error: tErr } = await supabase.from('support_tickets').select('id,user_id,status').eq('id', ticketId).maybeSingle();
    if (tErr || !ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });

    const role = await getUserRole(userId);
    if (ticket.user_id !== userId && !isAdminRole(role)) return res.status(403).json({ success: false, error: 'Forbidden' });

    const payload = {
      ticket_id: ticketId,
      sender_id: userId,
      message: String(message).slice(0, 4000),
      attachments: attachments || null,
    };
    // include client-provided id in the stored row if present
    if (req.body?.client_id) payload.client_id = String(req.body.client_id).slice(0, 255);

    // accept optional client_id for client-side optimistic reconciliation
    const clientId = req.body?.client_id || null;
    const { data, error } = await supabase.from('support_ticket_messages').insert(payload).select().maybeSingle();
    if (error) {
      logger.error('[support.message.create] insert error: %o', error);
      return res.status(500).json({ success: false, error: 'Failed to create message' });
    }

    try {
      await audit.insertAuditLog({ action: 'support_message_create', entity_type: 'support_ticket_message', entity_id: data.id, actor_id: userId, metadata: { ticket_id: ticketId } });
    } catch (e) {
      logger.warn('[support.message.create] audit failed: %o', e?.message || e);
    }

    // include the client_id back in the response so client can reconcile optimistic messages
    const resp = { success: true, message: data };
    if (clientId) resp.message.client_id = clientId;
    res.json(resp);
  } catch (err) {
    logger.error('[support.message.create] error: %o', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/support/tickets/:id/typing - mark typing presence for a ticket
router.post('/tickets/:id/typing', async (req, res) => {
  try {
    const userId = await getUserIdFromAuthHeader(req);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const ticketId = req.params.id;
    // verify ticket exists and user is owner or admin
    const { data: ticket, error: tErr } = await supabase.from('support_tickets').select('id,user_id').eq('id', ticketId).maybeSingle();
    if (tErr || !ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });
    const role = await getUserRole(userId);
    if (ticket.user_id !== userId && !isAdminRole(role)) return res.status(403).json({ success: false, error: 'Forbidden' });

    // upsert typing row
    const payload = { ticket_id: ticketId, user_id: userId, last_typing_at: new Date().toISOString() };
    const { data, error } = await supabase.from('support_typing').upsert(payload, { onConflict: ['ticket_id','user_id'] }).select().maybeSingle();
    if (error) {
      logger.error('[support.typing] upsert error: %o', error);
      return res.status(500).json({ success: false, error: 'Failed to update typing' });
    }

    res.json({ success: true });
  } catch (err) {
    logger.error('[support.typing] error: %o', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;
