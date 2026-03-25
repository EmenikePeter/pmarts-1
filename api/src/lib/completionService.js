const logger = require('./logger');

/**
 * PMARTS Escrow Completion Service
 * 
 * Handles different completion methods for escrow transactions:
 * 1. DELIVERY_CODE - 6-digit code for physical product delivery
 * 2. SENDER_RELEASE - Manual release by sender (digital products)
 * 3. SERVICE_APPROVAL - Recipient marks complete, sender approves (services)
 * 4. RECEIPT_EVIDENCE - Sender uploads external-payment receipt (trade agreement)
 * 5. DISPUTE_RESOLUTION - Admin resolves disputes
 * 
 * @module CompletionService
 */

const crypto = require('crypto');
const supabase = require('./supabase');
const escrowWalletService = require('./escrowWalletService');
const audit = require('./audit');

// ============================================
// CONSTANTS
// ============================================

/**
 * Transaction types that determine completion method
 */
const TRANSACTION_TYPES = {
  PHYSICAL_PRODUCT: 'physical_product',
  DIGITAL_PRODUCT: 'digital_product',
  SERVICE: 'service',
  CURRENCY_EXCHANGE: 'currency_exchange',
  INSTANT: 'instant',
  DONATION: 'donation',
  CUSTOM: 'custom',
  OTHER: 'other',
};

/**
 * Completion methods available
 */
const COMPLETION_METHODS = {
  DELIVERY_CODE: 'delivery_code',
  SENDER_RELEASE: 'sender_release',
  SERVICE_APPROVAL: 'service_approval',
  RECEIPT_EVIDENCE: 'receipt_evidence',
  DISPUTE_RESOLUTION: 'dispute_resolution',
  MUTUAL_CANCELLATION: 'mutual_cancellation',
};

/**
 * Map transaction type to default completion method
 */
const TYPE_TO_METHOD = {
  [TRANSACTION_TYPES.PHYSICAL_PRODUCT]: COMPLETION_METHODS.DELIVERY_CODE,
  [TRANSACTION_TYPES.DIGITAL_PRODUCT]: COMPLETION_METHODS.SENDER_RELEASE,
  [TRANSACTION_TYPES.SERVICE]: COMPLETION_METHODS.SERVICE_APPROVAL,
  [TRANSACTION_TYPES.CURRENCY_EXCHANGE]: COMPLETION_METHODS.RECEIPT_EVIDENCE,
  [TRANSACTION_TYPES.INSTANT]: COMPLETION_METHODS.SENDER_RELEASE,
  [TRANSACTION_TYPES.DONATION]: COMPLETION_METHODS.SENDER_RELEASE,
  [TRANSACTION_TYPES.CUSTOM]: COMPLETION_METHODS.SENDER_RELEASE,
  [TRANSACTION_TYPES.OTHER]: COMPLETION_METHODS.SENDER_RELEASE,
};

function getDeliveryCodeSecret() {
  const secret = String(process.env.DELIVERY_CODE_SECRET || '').trim();

  if (!secret) {
    throw new Error('DELIVERY_CODE_SECRET is required to sign delivery-code QR payloads');
  }

  return secret;
}

/**
 * Map transaction type to default release confirmation routing.
 *
 * Auto-release family: physical_product, instant, donation.
 * Admin-approval family: service, digital_product, custom, other.
 */
const TYPE_TO_CONFIRMATION = {
  [TRANSACTION_TYPES.PHYSICAL_PRODUCT]: 'auto',
  [TRANSACTION_TYPES.DIGITAL_PRODUCT]: 'manual',
  [TRANSACTION_TYPES.SERVICE]: 'manual',
  [TRANSACTION_TYPES.CURRENCY_EXCHANGE]: 'receipt_upload',
  [TRANSACTION_TYPES.INSTANT]: 'auto',
  [TRANSACTION_TYPES.DONATION]: 'auto',
  [TRANSACTION_TYPES.CUSTOM]: 'manual',
  [TRANSACTION_TYPES.OTHER]: 'manual',
};

/**
 * Escrow completion statuses
 */
const COMPLETION_STATUS = {
  PENDING: 'pending',
  HELD: 'held',
  CODE_VERIFIED: 'code_verified',
  SERVICE_COMPLETED: 'service_completed',
  SENDER_CONFIRMED: 'sender_confirmed',
  RECEIPT_UPLOADED: 'receipt_uploaded',
  RECEIPT_CONFIRMED: 'receipt_confirmed',
  RELEASING: 'releasing',
  RELEASED: 'released',
  DISPUTED: 'disputed',
  REFUNDED: 'refunded',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
};

/**
 * Max code verification attempts
 */
const MAX_CODE_ATTEMPTS = 5;

/**
 * Code expiry days
 */
const CODE_EXPIRY_DAYS = 30;
const QR_PAYLOAD_PREFIX = 'PMARTS';
const QR_SIGNATURE_LENGTH = 8;
const DEFAULT_QR_MAX_AGE_SECONDS = 300;
const QR_ALLOWED_FUTURE_SKEW_MS = 60 * 1000;

// ============================================
// DELIVERY CODE GENERATION
// ============================================

/**
 * Generate a secure 6-digit delivery code
 * @returns {string} 6-digit code
 */
function generateDeliveryCode() {
  // Generate cryptographically secure random number
  const bytes = crypto.randomBytes(4);
  const number = bytes.readUInt32BE(0);
  // Ensure 6 digits: 100000 - 999999
  const code = 100000 + (number % 900000);
  return code.toString();
}

function buildQRSigningPayload(escrowId, code, timestamp) {
  return JSON.stringify({
    type: 'pmarts_delivery',
    escrowId,
    code,
    timestamp,
  });
}

function signQRPayload(escrowId, code, timestamp) {
  return crypto
    .createHmac('sha256', getDeliveryCodeSecret())
    .update(buildQRSigningPayload(escrowId, code, timestamp))
    .digest('hex')
    .substring(0, QR_SIGNATURE_LENGTH);
}

function getQRMaxAgeSeconds() {
  const raw = Number(process.env.DELIVERY_QR_MAX_AGE_SECONDS);
  if (!Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_QR_MAX_AGE_SECONDS;
  }
  return Math.floor(raw);
}

/**
 * Generate QR code data for delivery verification
 * @param {string} escrowId - Escrow ID
 * @param {string} code - Delivery code
 * @returns {string} QR code payload
 */
function generateQRPayload(escrowId, code) {
  const timestamp = Date.now().toString();
  const signature = signQRPayload(escrowId, code, timestamp);

  return `${QR_PAYLOAD_PREFIX}:${escrowId}:${code}:${timestamp}:${signature}`;
}

/**
 * Verify QR code payload
 * @param {string} qrPayload - Scanned QR payload
 * @returns {Object} { valid: boolean, escrowId?: string, code?: string }
 */
function verifyQRPayload(qrPayload) {
  try {
    const parts = String(qrPayload || '').split(':');
    if (parts.length !== 5 || parts[0] !== QR_PAYLOAD_PREFIX) {
      return { valid: false, error: 'Invalid QR code format' };
    }

    const [, escrowId, code, timestamp, signature] = parts;

    if (!/^\d{6}$/.test(String(code || ''))) {
      return { valid: false, error: 'Invalid QR code payload' };
    }

    if (!/^\d+$/.test(String(timestamp || ''))) {
      return { valid: false, error: 'Invalid QR timestamp' };
    }

    const qrTimestamp = Number(timestamp);
    const now = Date.now();
    const qrMaxAgeMs = getQRMaxAgeSeconds() * 1000;

    if (qrTimestamp > now + QR_ALLOWED_FUTURE_SKEW_MS) {
      return { valid: false, error: 'Invalid QR timestamp' };
    }

    if (now - qrTimestamp > qrMaxAgeMs) {
      return { valid: false, error: 'QR code expired' };
    }

    const expectedSignature = signQRPayload(escrowId, code, timestamp);
    const providedSignature = String(signature || '').toLowerCase();

    if (providedSignature.length !== QR_SIGNATURE_LENGTH || !crypto.timingSafeEqual(Buffer.from(providedSignature), Buffer.from(expectedSignature))) {
      return { valid: false, error: 'Invalid QR signature' };
    }

    return {
      valid: true,
      escrowId,
      code,
      timestamp: qrTimestamp,
    };
  } catch (error) {
    return { valid: false, error: 'Invalid QR code' };
  }
}

// ============================================
// ESCROW CREATION WITH COMPLETION METHOD
// ============================================

/**
 * Initialize escrow with appropriate completion method
 * @param {Object} escrow - Escrow record
 * @param {string} transactionType - Transaction type
 * @returns {Object} Updated escrow data
 */
async function initializeCompletion(escrowId, transactionType) {
  const rule = await loadTransactionRule(transactionType);
  const completionMethod = rule?.completion_method || TYPE_TO_METHOD[transactionType] || COMPLETION_METHODS.SENDER_RELEASE;
  const confirmationMethod = rule?.confirmation_method || TYPE_TO_CONFIRMATION[transactionType] || 'manual';
  const timeoutHours = Number.isFinite(rule?.timeout_hours) ? rule.timeout_hours : null;

  const updateData = {
    transaction_type: transactionType,
    completion_method: completionMethod,
    confirmation_method: confirmationMethod,
    completion_timeout_hours: timeoutHours,
  };

  // Generate delivery code for physical products
  if (completionMethod === COMPLETION_METHODS.DELIVERY_CODE) {
    const code = generateDeliveryCode();
    updateData.delivery_code = code;
    updateData.delivery_code_hash = crypto
      .createHash('sha256')
      .update(code)
      .digest('hex');
    updateData.code_attempts = 0;
    updateData.code_expires_at = new Date(
      Date.now() + CODE_EXPIRY_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();
  }

  const { data: escrow, error } = await supabase
    .from('escrows')
    .update(updateData)
    .eq('id', escrowId)
    .select()
    .single();

  if (error) {
    logger.error('Initialize completion error:', error);
    return { success: false, error: error.message };
  }

  return {
    success: true,
    escrow,
    completionMethod,
    confirmationMethod,
    timeoutHours,
    deliveryCode: updateData.delivery_code, // Only return plain code on creation
    qrPayload: updateData.delivery_code
      ? generateQRPayload(escrowId, updateData.delivery_code)
      : null,
  };
}

async function loadTransactionRule(transactionType) {
  if (!transactionType) return null;

  const { data, error } = await supabase
    .from('transaction_rules')
    .select('*')
    .eq('type', transactionType)
    .single();

  if (error || !data) {
    return null;
  }

  return data;
}

// ============================================
// COMPLETION METHOD 1: DELIVERY CODE
// ============================================

/**
 * Verify delivery code and release escrow
 * @param {string} escrowId - Escrow ID
 * @param {string} code - 6-digit code entered by recipient
 * @param {string} recipientId - Recipient user ID
 * @returns {Object} Result
 */
async function verifyDeliveryCode(escrowId, code, recipientId) {
  // Get escrow
  const { data: escrow, error: fetchError } = await supabase
    .from('escrows')
    .select('*')
    .eq('id', escrowId)
    .single();

  if (fetchError || !escrow) {
    return { success: false, error: 'Escrow not found' };
  }

  // Validate recipient
  if (escrow.recipient_id !== recipientId) {
    return { success: false, error: 'Only the recipient can verify delivery code' };
  }

  // Check status — accept all statuses where funds are held and delivery is in progress
  const verifiableStatuses = ['held', 'funds_held', 'delivery_in_progress'];
  if (!verifiableStatuses.includes(escrow.status)) {
    return { success: false, error: `Cannot verify code for escrow in ${escrow.status} status` };
  }

  // Check completion method
  if (escrow.completion_method !== COMPLETION_METHODS.DELIVERY_CODE) {
    return { success: false, error: 'This escrow does not use delivery code verification' };
  }

  // Check code expiry
  if (escrow.code_expires_at && new Date(escrow.code_expires_at) < new Date()) {
    return { success: false, error: 'Delivery code has expired. Please open a dispute.' };
  }

  // Check attempts
  if (escrow.code_attempts >= MAX_CODE_ATTEMPTS) {
    return { 
      success: false, 
      error: 'Maximum verification attempts exceeded. Escrow locked for review.',
      locked: true,
    };
  }

  // Verify code
  const codeHash = crypto.createHash('sha256').update(code).digest('hex');
  const isValid = codeHash === escrow.delivery_code_hash || code === escrow.delivery_code;

  if (!isValid) {
    // Increment attempts
    await supabase
      .from('escrows')
      .update({ code_attempts: escrow.code_attempts + 1 })
      .eq('id', escrowId);

    const remainingAttempts = MAX_CODE_ATTEMPTS - escrow.code_attempts - 1;
    return { 
      success: false, 
      error: `Invalid code. ${remainingAttempts} attempts remaining.`,
      attemptsRemaining: remainingAttempts,
    };
  }

  // Code is valid - update status
  await supabase
    .from('escrows')
    .update({
      code_used: true,
      code_verified_at: new Date().toISOString(),
      status: COMPLETION_STATUS.CODE_VERIFIED,
    })
    .eq('id', escrowId);

  // Create audit log (best-effort via RPC)
  try {
    const r = await audit.insertAuditLog({
      action: 'delivery_code_verified',
      entity_type: 'escrow',
      entity_id: escrowId,
      actor_id: recipientId,
      metadata: { verification_method: 'code' },
    });
    if (!r.success) logger.warn('audit RPC returned error (non-fatal)', r.error || r);
  } catch (e) {
    logger.warn('audit RPC failed (non-fatal)', e?.message || e);
  }

  // Notify sender
  await supabase.from('notifications').insert({
    user_id: escrow.sender_id,
    type: 'delivery_confirmed',
    title: 'Delivery Confirmed',
    message: 'Your delivery code was verified. Payment is being released.',
    escrow_id: escrowId,
  });

  // Release the escrow
  const releaseResult = await escrowWalletService.releaseEscrow(escrowId, escrow.sender_id);

  return {
    success: true,
    message: 'Delivery verified. Funds released to recipient.',
    escrow: releaseResult.escrow,
    netAmount: releaseResult.netAmount,
    feeAmount: releaseResult.feeAmount,
  };
}

/**
 * Verify delivery via QR code scan
 * @param {string} qrPayload - Scanned QR code payload
 * @param {string} recipientId - Recipient user ID
 * @returns {Object} Result
 */
async function verifyDeliveryQR(qrPayload, recipientId) {
  const qrResult = verifyQRPayload(qrPayload);
  
  if (!qrResult.valid) {
    return { success: false, error: qrResult.error };
  }

  return verifyDeliveryCode(qrResult.escrowId, qrResult.code, recipientId);
}

/**
 * Get delivery code for sender
 * Only the sender can see their own delivery code
 * @param {string} escrowId - Escrow ID
 * @param {string} senderId - Sender user ID
 * @returns {Object} Delivery code info
 */
async function getDeliveryCode(escrowId, senderId) {
  const { data: escrow, error } = await supabase
    .from('escrows')
    .select('id, sender_id, delivery_code, code_expires_at, status, completion_method')
    .eq('id', escrowId)
    .single();

  if (error || !escrow) {
    return { success: false, error: 'Escrow not found' };
  }

  if (escrow.sender_id !== senderId) {
    return { success: false, error: 'Only the sender can view the delivery code' };
  }

  if (escrow.completion_method !== COMPLETION_METHODS.DELIVERY_CODE) {
    return { success: false, error: 'This escrow does not use delivery code' };
  }

  if (!['funds_held', 'delivery_in_progress'].includes(escrow.status)) {
    return { success: false, error: 'Delivery code only available when escrow is held' };
  }

  return {
    success: true,
    code: escrow.delivery_code,
    qrPayload: generateQRPayload(escrowId, escrow.delivery_code),
    expiresAt: escrow.code_expires_at,
  };
}

// ============================================
// COMPLETION METHOD 2: SENDER RELEASE
// ============================================

/**
 * Sender manually releases payment (digital products)
 * @param {string} escrowId - Escrow ID
 * @param {string} senderId - Sender user ID
 * @returns {Object} Result
 */
async function senderRelease(escrowId, senderId) {
  const { data: escrow, error: fetchError } = await supabase
    .from('escrows')
    .select('*')
    .eq('id', escrowId)
    .single();

  if (fetchError || !escrow) {
    return { success: false, error: 'Escrow not found' };
  }

  if (escrow.sender_id !== senderId) {
    return { success: false, error: 'Only the sender can release payment' };
  }

  const releasableStatuses = ['held', 'funds_held', 'delivery_in_progress'];
  if (!releasableStatuses.includes(escrow.status)) {
    return { success: false, error: `Cannot release escrow in ${escrow.status} status` };
  }

  // Update status
  await supabase
    .from('escrows')
    .update({
      status: COMPLETION_STATUS.SENDER_CONFIRMED,
      sender_confirmed_at: new Date().toISOString(),
    })
    .eq('id', escrowId);

  // Create audit log (best-effort via RPC)
  try {
    const r = await audit.insertAuditLog({
      action: 'sender_confirmed_release',
      entity_type: 'escrow',
      entity_id: escrowId,
      actor_id: senderId,
    });
    if (!r.success) logger.warn('audit RPC returned error (non-fatal)', r.error || r);
  } catch (e) {
    logger.warn('audit RPC failed (non-fatal)', e?.message || e);
  }

  // Notify recipient
  await supabase.from('notifications').insert({
    user_id: escrow.recipient_id,
    type: 'payment_released',
    title: 'Payment Released',
    message: 'Sender has released your payment.',
    escrow_id: escrowId,
  });

  // Release the escrow
  const releaseResult = await escrowWalletService.releaseEscrow(escrowId, senderId);

  return {
    success: true,
    message: 'Payment released to recipient.',
    escrow: releaseResult.escrow,
    netAmount: releaseResult.netAmount,
    feeAmount: releaseResult.feeAmount,
  };
}

// ============================================
// COMPLETION METHOD 3: SERVICE APPROVAL
// ============================================

/**
 * Recipient marks service as completed
 * @param {string} escrowId - Escrow ID
 * @param {string} recipientId - Recipient user ID
 * @param {Object} options - Optional proof of work
 * @returns {Object} Result
 */
async function markServiceCompleted(escrowId, recipientId, options = {}) {
  const { data: escrow, error: fetchError } = await supabase
    .from('escrows')
    .select('*')
    .eq('id', escrowId)
    .single();

  if (fetchError || !escrow) {
    return { success: false, error: 'Escrow not found' };
  }

  if (escrow.recipient_id !== recipientId) {
    return { success: false, error: 'Only the recipient can mark service as completed' };
  }

  if (escrow.status !== 'held') {
    return { success: false, error: `Cannot update escrow in ${escrow.status} status` };
  }

  if (escrow.completion_method !== COMPLETION_METHODS.SERVICE_APPROVAL) {
    return { success: false, error: 'This escrow does not use service approval' };
  }

  // Update status
  const updateData = {
    status: COMPLETION_STATUS.SERVICE_COMPLETED,
    service_completed_at: new Date().toISOString(),
  };

  // Store proof of work if provided
  if (options.proofUrl) {
    updateData.service_proof_url = options.proofUrl;
  }
  if (options.description) {
    updateData.service_completion_notes = options.description;
  }

  await supabase.from('escrows').update(updateData).eq('id', escrowId);

  // Create audit log (best-effort via RPC)
  try {
    const r = await audit.insertAuditLog({
      action: 'service_marked_complete',
      entity_type: 'escrow',
      entity_id: escrowId,
      actor_id: recipientId,
      metadata: { hasProof: !!options.proofUrl },
    });
    if (!r.success) logger.warn('audit RPC returned error (non-fatal)', r.error || r);
  } catch (e) {
    logger.warn('audit RPC failed (non-fatal)', e?.message || e);
  }

  // Notify sender to review
  await supabase.from('notifications').insert({
    user_id: escrow.sender_id,
    type: 'service_completed',
    title: 'Service Completed',
    message: 'Recipient has marked the service as completed. Please review and release payment.',
    escrow_id: escrowId,
  });

  return {
    success: true,
    message: 'Service marked as completed. Waiting for sender approval.',
  };
}

/**
 * Sender approves service and releases payment
 * @param {string} escrowId - Escrow ID
 * @param {string} senderId - Sender user ID
 * @param {number} rating - Optional rating (1-5)
 * @returns {Object} Result
 */
async function approveServiceRelease(escrowId, senderId, rating = null) {
  const { data: escrow, error: fetchError } = await supabase
    .from('escrows')
    .select('*')
    .eq('id', escrowId)
    .single();

  if (fetchError || !escrow) {
    return { success: false, error: 'Escrow not found' };
  }

  if (escrow.sender_id !== senderId) {
    return { success: false, error: 'Only the sender can approve service' };
  }

  // Allow approval from held or service_completed status
  if (!['held', 'service_completed'].includes(escrow.status)) {
    return { success: false, error: `Cannot approve escrow in ${escrow.status} status` };
  }

  // Update status
  await supabase
    .from('escrows')
    .update({
      status: COMPLETION_STATUS.SENDER_CONFIRMED,
      sender_confirmed_at: new Date().toISOString(),
    })
    .eq('id', escrowId);

  // Add rating if provided
  if (rating && rating >= 1 && rating <= 5) {
    await supabase.from('ratings').insert({
      escrow_id: escrowId,
      rater_id: senderId,
      rated_id: escrow.recipient_id,
      rating,
      type: 'service',
    });
  }

  // Create audit log (best-effort via RPC)
  try {
    const r = await audit.insertAuditLog({
      action: 'service_approved',
      entity_type: 'escrow',
      entity_id: escrowId,
      actor_id: senderId,
      metadata: { rating },
    });
    if (!r.success) logger.warn('audit RPC returned error (non-fatal)', r.error || r);
  } catch (e) {
    logger.warn('audit RPC failed (non-fatal)', e?.message || e);
  }

  // Notify recipient
  await supabase.from('notifications').insert({
    user_id: escrow.recipient_id,
    type: 'service_approved',
    title: 'Service Approved',
    message: 'Sender has approved your service. Payment is being released.',
    escrow_id: escrowId,
  });

  // Release the escrow
  const releaseResult = await escrowWalletService.releaseEscrow(escrowId, senderId);

  return {
    success: true,
    message: 'Service approved. Payment released to recipient.',
    escrow: releaseResult.escrow,
    netAmount: releaseResult.netAmount,
    feeAmount: releaseResult.feeAmount,
  };
}

// ============================================
// COMPLETION METHOD 4: RECEIPT EVIDENCE
// ============================================

/**
 * Sender uploads receipt evidence (trade agreement / external payment arrangement)
 * @param {string} escrowId - Escrow ID
 * @param {string} senderId - Sender user ID
 * @param {Object} evidence - Receipt evidence
 * @returns {Object} Result
 */
async function uploadReceiptEvidence(escrowId, senderId, evidence) {
  const { data: escrow, error: fetchError } = await supabase
    .from('escrows')
    .select('*')
    .eq('id', escrowId)
    .single();

  if (fetchError || !escrow) {
    return { success: false, error: 'Escrow not found' };
  }

  if (escrow.sender_id !== senderId) {
    return { success: false, error: 'Only the sender can upload receipt evidence' };
  }

  if (escrow.status !== 'held') {
    return { success: false, error: `Cannot upload evidence for escrow in ${escrow.status} status` };
  }

  if (escrow.completion_method !== COMPLETION_METHODS.RECEIPT_EVIDENCE) {
    return { success: false, error: 'This escrow does not use receipt evidence' };
  }

  // Store evidence
  const { data: evidenceRecord, error: evidenceError } = await supabase
    .from('completion_evidence')
    .insert({
      escrow_id: escrowId,
      submitted_by: senderId,
      evidence_type: evidence.type || 'receipt',
      title: evidence.title || 'Payment Receipt',
      description: evidence.description,
      file_url: evidence.fileUrl,
      metadata: evidence.metadata,
    })
    .select()
    .single();

  if (evidenceError) {
    logger.error('Upload evidence error:', evidenceError);
    return { success: false, error: 'Failed to upload evidence' };
  }

  // Update escrow status
  await supabase
    .from('escrows')
    .update({
      status: COMPLETION_STATUS.RECEIPT_UPLOADED,
      receipt_uploaded_at: new Date().toISOString(),
    })
    .eq('id', escrowId);

  // Notify recipient to confirm
  await supabase.from('notifications').insert({
    user_id: escrow.recipient_id,
    type: 'receipt_uploaded',
    title: 'Payment Receipt Uploaded',
    message: 'Sender has uploaded payment receipt. Please confirm to release escrow.',
    escrow_id: escrowId,
  });

  return {
    success: true,
    message: 'Receipt uploaded. Waiting for recipient confirmation.',
    evidence: evidenceRecord,
  };
}

/**
 * Recipient confirms receipt and releases payment
 * @param {string} escrowId - Escrow ID
 * @param {string} recipientId - Recipient user ID
 * @returns {Object} Result
 */
async function confirmReceiptRelease(escrowId, recipientId) {
  const { data: escrow, error: fetchError } = await supabase
    .from('escrows')
    .select('*')
    .eq('id', escrowId)
    .single();

  if (fetchError || !escrow) {
    return { success: false, error: 'Escrow not found' };
  }

  if (escrow.recipient_id !== recipientId) {
    return { success: false, error: 'Only the recipient can confirm receipt' };
  }

  // Allow from held or receipt_uploaded status
  if (!['held', 'receipt_uploaded'].includes(escrow.status)) {
    return { success: false, error: `Cannot confirm receipt for escrow in ${escrow.status} status` };
  }

  // Update status
  await supabase
    .from('escrows')
    .update({
      status: COMPLETION_STATUS.RECEIPT_CONFIRMED,
      receipt_confirmed_at: new Date().toISOString(),
    })
    .eq('id', escrowId);

  // Create audit log (best-effort via RPC)
  try {
    const r = await audit.insertAuditLog({
      action: 'receipt_confirmed',
      entity_type: 'escrow',
      entity_id: escrowId,
      actor_id: recipientId,
    });
    if (!r.success) logger.warn('audit RPC returned error (non-fatal)', r.error || r);
  } catch (e) {
    logger.warn('audit RPC failed (non-fatal)', e?.message || e);
  }

  // Notify sender
  await supabase.from('notifications').insert({
    user_id: escrow.sender_id,
    type: 'receipt_confirmed',
    title: 'Receipt Confirmed',
    message: 'Recipient has confirmed your payment. Escrow is being released.',
    escrow_id: escrowId,
  });

  // For trade-agreement flow, sender receives the Pi (reverse release)
  // Since sender sent external payment, recipient releases the Pi to sender
  const releaseResult = await escrowWalletService.releaseEscrow(escrowId, recipientId);

  return {
    success: true,
    message: 'Receipt confirmed. Pi released to sender.',
    escrow: releaseResult.escrow,
    netAmount: releaseResult.netAmount,
    feeAmount: releaseResult.feeAmount,
  };
}

// ============================================
// MUTUAL CANCELLATION
// ============================================

/**
 * Request mutual cancellation
 * @param {string} escrowId - Escrow ID
 * @param {string} userId - Requesting user ID
 * @param {string} reason - Cancellation reason
 * @returns {Object} Result
 */
async function requestCancellation(escrowId, userId, reason) {
  const { data: escrow, error: fetchError } = await supabase
    .from('escrows')
    .select('*')
    .eq('id', escrowId)
    .single();

  if (fetchError || !escrow) {
    return { success: false, error: 'Escrow not found' };
  }

  // Verify user is party to escrow
  const isSender = escrow.sender_id === userId;
  const isRecipient = escrow.recipient_id === userId;

  if (!isSender && !isRecipient) {
    return { success: false, error: 'Only escrow parties can request cancellation' };
  }

  if (!['held', 'pending', 'service_completed', 'receipt_uploaded'].includes(escrow.status)) {
    return { success: false, error: `Cannot cancel escrow in ${escrow.status} status` };
  }

  // Record cancellation request
  await supabase.from('escrows').update({
    cancellation_requested_by: userId,
    cancellation_reason: reason,
    cancellation_requested_at: new Date().toISOString(),
  }).eq('id', escrowId);

  // Notify the other party
  const otherPartyId = isSender ? escrow.recipient_id : escrow.sender_id;
  await supabase.from('notifications').insert({
    user_id: otherPartyId,
    type: 'cancellation_requested',
    title: 'Cancellation Requested',
    message: `The other party has requested to cancel this escrow: "${reason}". Approve or decline.`,
    escrow_id: escrowId,
  });

  return {
    success: true,
    message: 'Cancellation request sent. Waiting for other party approval.',
  };
}

/**
 * Approve cancellation and refund
 * @param {string} escrowId - Escrow ID
 * @param {string} userId - Approving user ID
 * @returns {Object} Result
 */
async function approveCancellation(escrowId, userId) {
  const { data: escrow, error: fetchError } = await supabase
    .from('escrows')
    .select('*')
    .eq('id', escrowId)
    .single();

  if (fetchError || !escrow) {
    return { success: false, error: 'Escrow not found' };
  }

  // Verify user is the other party
  if (escrow.cancellation_requested_by === userId) {
    return { success: false, error: 'You cannot approve your own cancellation request' };
  }

  const isSender = escrow.sender_id === userId;
  const isRecipient = escrow.recipient_id === userId;

  if (!isSender && !isRecipient) {
    return { success: false, error: 'Only escrow parties can approve cancellation' };
  }

  // Update status
  await supabase.from('escrows').update({
    status: COMPLETION_STATUS.CANCELLED,
    cancellation_approved_by: userId,
    cancelled_at: new Date().toISOString(),
  }).eq('id', escrowId);

  // Create audit log (best-effort via RPC)
  try {
    const r = await audit.insertAuditLog({
      action: 'mutual_cancellation',
      entity_type: 'escrow',
      entity_id: escrowId,
      actor_id: userId,
      metadata: { reason: escrow.cancellation_reason },
    });
    if (!r.success) logger.warn('audit RPC returned error (non-fatal)', r.error || r);
  } catch (e) {
    logger.warn('audit RPC failed (non-fatal)', e?.message || e);
  }

  // Refund to sender
  const refundResult = await escrowWalletService.refundEscrow(
    escrowId,
    'Mutual cancellation',
    userId
  );

  // Notify both parties
  await supabase.from('notifications').insert([
    {
      user_id: escrow.sender_id,
      type: 'escrow_cancelled',
      title: 'Escrow Cancelled',
      message: 'Escrow has been cancelled by mutual agreement. Funds refunded.',
      escrow_id: escrowId,
    },
    {
      user_id: escrow.recipient_id,
      type: 'escrow_cancelled',
      title: 'Escrow Cancelled',
      message: 'Escrow has been cancelled by mutual agreement.',
      escrow_id: escrowId,
    },
  ]);

  return {
    success: true,
    message: 'Escrow cancelled and funds refunded.',
    escrow: refundResult.escrow,
  };
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  // Constants
  TRANSACTION_TYPES,
  COMPLETION_METHODS,
  COMPLETION_STATUS,
  TYPE_TO_METHOD,

  // Initialization
  initializeCompletion,
  generateDeliveryCode,
  generateQRPayload,
  verifyQRPayload,

  // Delivery Code (Physical Products)
  verifyDeliveryCode,
  verifyDeliveryQR,
  getDeliveryCode,

  // Sender Release (Digital Products)
  senderRelease,

  // Service Approval (Services)
  markServiceCompleted,
  approveServiceRelease,

  // Receipt Evidence (Trade Agreement)
  uploadReceiptEvidence,
  confirmReceiptRelease,

  // Mutual Cancellation
  requestCancellation,
  approveCancellation,
};

