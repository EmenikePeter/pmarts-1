const express = require("express");
const { supabase } = require("../lib/supabase");
const audit = require('../lib/audit');
const logger = require('../lib/logger');

const router = express.Router();

async function resolveUserId(value) {
  if (!value) return null;

  // Normalize input: remove leading '@' and whitespace
  const normalized = String(value).trim().replace(/^@/, '');

  const { data, error } = await supabase
    .from("users")
    .select("id")
    .or(`id.eq.${normalized},pi_id.eq.${normalized},username.eq.${normalized}`)
    .maybeSingle();

  if (error) {
    logger.warn('[resolveUserId] db lookup error', { value, normalized, error });
    return null;
  }

  return data?.id || null;
}

router.post("/deposit", async (req, res) => {
  const { senderId, recipientId, amount, referenceId, note } = req.body;
  if (!senderId || !recipientId || !amount || !referenceId) {
    return res.status(400).json({ error: "senderId, recipientId, amount, and referenceId are required" });
  }

  const senderUserId = await resolveUserId(senderId);
  const recipientUserId = await resolveUserId(recipientId);

  if (!senderUserId || !recipientUserId) {
    return res.status(404).json({ error: "Sender or recipient not found" });
  }

  const payload = {
    sender_id: senderUserId,
    recipient_id: recipientUserId,
    amount: Number(amount),
    reference_id: referenceId,
    note: note || null,
    status: "held",
  };

  const { data, error } = await supabase.from("escrows").insert(payload).select("*").single();
  if (error) {
    return res.status(500).json({ error: error.message });
  }

  await supabase.from("escrow_ledger").insert({
    escrow_id: data.id,
    sender_id: senderUserId,
    recipient_id: recipientUserId,
    amount: data.amount,
    action: "deposit",
  });

  try {
    const r = await audit.insertAuditLog({
      action: 'deposit',
      entity_type: 'escrow',
      entity_id: data.id,
      actor_id: senderUserId,
      metadata: { notes: `Reference ${data.reference_id}` },
    });
    if (!r.success) logger.warn('audit RPC returned error (non-fatal): %o', r.error || r);
  } catch (e) {
    logger.warn('audit RPC failed (non-fatal): %o', e?.message || e);
  }

  await supabase.from("notifications").insert({
    user_id: recipientUserId,
    escrow_id: data.id,
    type: "deposit",
    message: `New escrow received: ${data.amount} Pi (${data.reference_id})`,
  });

  return res.json({ escrow: data });
});

router.get("/user", async (req, res) => {
  const { userId, status } = req.query;
  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }

  const resolvedUserId = await resolveUserId(userId);
  if (!resolvedUserId) {
    return res.status(404).json({ error: "User not found" });
  }

  let query = supabase
    .from("escrows")
    .select("*")
    .or(`sender_id.eq.${resolvedUserId},recipient_id.eq.${resolvedUserId}`)
    .order("created_at", { ascending: false });

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.json({ escrows: data });
});

router.get("/:id", async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase.from("escrows").select("*").eq("id", id).single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  if (!data) {
    return res.status(404).json({ error: "Escrow not found" });
  }

  return res.json({ escrow: data });
});

router.post("/release", async (req, res) => {
  const { escrowId, userId } = req.body;
  if (!escrowId || !userId) {
    return res.status(400).json({ error: "escrowId and userId are required" });
  }

  const resolvedUserId = await resolveUserId(userId);
  if (!resolvedUserId) {
    return res.status(404).json({ error: "User not found" });
  }

  const { data, error } = await supabase
    .from("escrows")
    .update({ status: "released", updated_at: new Date().toISOString() })
    .eq("id", escrowId)
    .eq("sender_id", resolvedUserId)
    .eq("status", "held")
    .select("*")
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  if (!data) {
    return res.status(409).json({ error: "Escrow not releasable" });
  }

  await supabase.from("escrow_ledger").insert({
    escrow_id: data.id,
    sender_id: data.sender_id,
    recipient_id: data.recipient_id,
    amount: data.amount,
    action: "release",
  });

  try {
    const r = await audit.insertAuditLog({
      action: 'release',
      entity_type: 'escrow',
      entity_id: data.id,
      actor_id: resolvedUserId,
    });
    if (!r.success) logger.warn('audit RPC returned error (non-fatal): %o', r.error || r);
  } catch (e) {
    logger.warn('audit RPC failed (non-fatal): %o', e?.message || e);
  }

  await supabase.from("notifications").insert({
    user_id: data.recipient_id,
    escrow_id: data.id,
    type: "release",
    message: `Payment released: ${data.amount} Pi (${data.reference_id})`,
  });

  return res.json({ escrow: data });
});

router.post("/refund", async (req, res) => {
  const { escrowId, userId } = req.body;
  if (!escrowId || !userId) {
    return res.status(400).json({ error: "escrowId and userId are required" });
  }

  const resolvedUserId = await resolveUserId(userId);
  if (!resolvedUserId) {
    return res.status(404).json({ error: "User not found" });
  }

  const { data, error } = await supabase
    .from("escrows")
    .update({ status: "refunded", updated_at: new Date().toISOString() })
    .eq("id", escrowId)
    .eq("sender_id", resolvedUserId)
    .eq("status", "held")
    .select("*")
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  if (!data) {
    return res.status(409).json({ error: "Escrow not refundable" });
  }

  await supabase.from("escrow_ledger").insert({
    escrow_id: data.id,
    sender_id: data.sender_id,
    recipient_id: data.recipient_id,
    amount: data.amount,
    action: "refund",
  });

  try {
    const r = await audit.insertAuditLog({
      action: 'refund',
      entity_type: 'escrow',
      entity_id: data.id,
      actor_id: resolvedUserId,
    });
    if (!r.success) logger.warn('audit RPC returned error (non-fatal): %o', r.error || r);
  } catch (e) {
    logger.warn('audit RPC failed (non-fatal): %o', e?.message || e);
  }

  await supabase.from("notifications").insert({
    user_id: data.recipient_id,
    escrow_id: data.id,
    type: "refund",
    message: `Payment refunded: ${data.amount} Pi (${data.reference_id})`,
  });

  return res.json({ escrow: data });
});

router.post("/dispute", async (req, res) => {
  const { escrowId, userId, reason, evidence } = req.body;
  if (!escrowId || !userId) {
    return res.status(400).json({ error: "escrowId and userId are required" });
  }

  const resolvedUserId = await resolveUserId(userId);
  if (!resolvedUserId) {
    return res.status(404).json({ error: "User not found" });
  }

  const { data: escrow, error: escrowError } = await supabase
    .from("escrows")
    .select("*")
    .eq("id", escrowId)
    .single();

  if (escrowError) {
    return res.status(500).json({ error: escrowError.message });
  }

  const { data, error } = await supabase
    .from("disputes")
    .insert({
      escrow_id: escrowId,
      reported_by: resolvedUserId,
      reason: reason || null,
      evidence: evidence || null,
    })
    .select("*")
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  try {
    const r = await audit.insertAuditLog({
      action: 'dispute',
      entity_type: 'escrow',
      entity_id: escrowId,
      actor_id: resolvedUserId,
      metadata: { notes: reason || null },
    });
    if (!r.success) logger.warn('audit RPC returned error (non-fatal): %o', r.error || r);
  } catch (e) {
    logger.warn('audit RPC failed (non-fatal): %o', e?.message || e);
  }

  const counterparty = escrow.sender_id === resolvedUserId ? escrow.recipient_id : escrow.sender_id;
  await supabase.from("notifications").insert({
    user_id: counterparty,
    escrow_id: escrowId,
    type: "dispute",
    message: `Dispute opened on escrow (${escrow.reference_id})`,
  });

  return res.json({ dispute: data });
});

module.exports = router;

