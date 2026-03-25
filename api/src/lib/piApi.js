/**
 * PMARTS Pi Network API Service
 * 
 * Handles server-side Pi payment verification with Pi Network's API.
 * This is the critical security layer that validates payments.
 * 
 * Pi Payment Flow:
 * 1. User initiates payment in Pi Browser
 * 2. Pi Network returns paymentId → onReadyForServerApproval
 * 3. Backend calls /approve endpoint on Pi API
 * 4. User confirms in Pi wallet
 * 5. Pi Network returns txid → onReadyForServerCompletion
 * 6. Backend calls /complete endpoint on Pi API
 * 7. Payment is finalized
 */

const axios = require('axios');
const logger = require('./logger');

// Pi Platform API configuration.
// The Platform API base path is documented at api.minepi.com/v2; network selection
// is controlled by the app/API key context rather than a separate testnet hostname.
const PI_ENV = String(process.env.PI_ENV || 'testnet').trim().toLowerCase(); // default to testnet
const PI_TESTNET_API_URL = String(process.env.PI_TESTNET_API_URL || 'https://api.minepi.com').trim();
const PI_MAINNET_API_URL = String(process.env.PI_MAINNET_API_URL || 'https://api.minepi.com').trim();

// Keys (keep them separate)
const PI_TESTNET_API_KEY = String(process.env.PI_TESTNET_API_KEY || '').trim();
const PI_MAINNET_API_KEY = String(process.env.PI_MAINNET_API_KEY || '').trim();

function normalizeNetwork(input) {
  const value = String(input || '').trim().toLowerCase();
  if (!value) return undefined;
  if (value.includes('testnet')) return 'testnet';
  if (value === 'mainnet' || value.includes('pi network')) return 'mainnet';
  return value;
}

function normalizePlatformBase(input) {
  const base = String(input || '').trim();
  if (!base) return 'https://api.minepi.com';
  // api.testnet.minepi.com is the blockchain/horizon surface, not the Pi Platform API.
  if (base.includes('api.testnet.minepi.com')) return 'https://api.minepi.com';
  return base;
}

// Helper to pick base URL and key by network
function resolvePiConfig(network = undefined) {
  const net = normalizeNetwork(network) || normalizeNetwork(PI_ENV) || 'testnet';
  const configuredBase = net === 'mainnet' ? PI_MAINNET_API_URL : PI_TESTNET_API_URL;
  const base = normalizePlatformBase(configuredBase);
  const key = net === 'mainnet' ? PI_MAINNET_API_KEY : PI_TESTNET_API_KEY;
  return { net, base, key };
}

// Warn if keys are missing
if (!PI_TESTNET_API_KEY && !PI_MAINNET_API_KEY) {
  logger.warn('⚠️ Neither PI_TESTNET_API_KEY nor PI_MAINNET_API_KEY is set - Pi payment verification will fail');
}

function getPiAxios(network = undefined) {
  const { base, key } = resolvePiConfig(network);
  const baseURL = base.endsWith('/v2') ? base : `${base}/v2`;
  return axios.create({
    baseURL,
    timeout: 30000,
    headers: {
      Authorization: `Key ${key}`,
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Payment status enum
 */
const PaymentStatus = {
  PENDING_APPROVAL: 'pending_approval',
  APPROVED: 'approved',
  PENDING_COMPLETION: 'pending_completion',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  FAILED: 'failed',
};

/**
 * Get payment details from Pi Network
 * @param {string} paymentId - Pi payment ID
 * @returns {Promise<Object>} Payment details
 */
async function getPayment(paymentId, network = undefined) {
  try {
    try {
      const { net, base } = resolvePiConfig(network);
      logger.info('Pi API - Get payment request', {
        paymentId,
        net,
        base,
        hasKey: !!resolvePiConfig(network).key,
      });
    } catch (_) {}
    const response = await getPiAxios(network).get(`/payments/${paymentId}`);
    return {
      success: true,
      payment: response.data,
    };
  } catch (error) {
    logPiError('Get payment', error);
    return { success: false, error: error.response?.data?.message || 'Failed to get payment details' };
  }
}

/**
 * Approve a payment on Pi Network
 * Called when frontend triggers onReadyForServerApproval
 * 
 * @param {string} paymentId - Pi payment ID
 * @returns {Promise<Object>} Approval result
 */
async function approvePayment(paymentId, network = undefined) {
  try {
    logger.info('Pi API - Approving payment: %s', paymentId);
    const response = await getPiAxios(network).post(`/payments/${paymentId}/approve`);
    logger.info('Pi API - Payment approved: %s', paymentId);
    return {
      success: true,
      payment: response.data,
    };
  } catch (error) {
    logPiError('Approve payment', error);
    return { success: false, error: error.response?.data?.message || 'Failed to approve payment' };
  }
}

/**
 * Complete a payment on Pi Network
 * Called when frontend triggers onReadyForServerCompletion
 * 
 * @param {string} paymentId - Pi payment ID
 * @param {string} txid - Blockchain transaction ID
 * @returns {Promise<Object>} Completion result
 */
async function completePayment(paymentId, txid, network = undefined) {
  try {
    logger.info('Pi API - Completing payment: %s, txid: %s', paymentId, txid);
    try {
      const { net, base } = resolvePiConfig(network);
      logger.info('Pi API - Complete payment config', { paymentId, net, base, hasKey: !!resolvePiConfig(network).key });
    } catch (_) {}
    const response = await getPiAxios(network).post(`/payments/${paymentId}/complete`, { txid });
    logger.info('Pi API - Payment completed: %s', paymentId);
    return {
      success: true,
      payment: response.data,
    };
  } catch (error) {
    logPiError('Complete payment', error);
    return { success: false, error: error.response?.data?.message || 'Failed to complete payment' };
  }
}

/**
 * Cancel an incomplete payment
 * Use this to clean up abandoned payments
 * 
 * @param {string} paymentId - Pi payment ID
 * @returns {Promise<Object>} Cancellation result
 */
async function cancelPayment(paymentId, network = undefined) {
  try {
    logger.info('Pi API - Cancelling payment: %s', paymentId);
    const response = await getPiAxios(network).post(`/payments/${paymentId}/cancel`);
    logger.info('Pi API - Payment cancelled: %s', paymentId);
    return {
      success: true,
      payment: response.data,
    };
  } catch (error) {
    logPiError('Cancel payment', error);
    return { success: false, error: error.response?.data?.message || 'Failed to cancel payment' };
  }
}

/**
 * Verify a user's access token
 * Use this to verify Pi authentication on the backend
 * 
 * @param {string} accessToken - Pi access token from authentication
 * @returns {Promise<Object>} User info if valid
 */
async function verifyUser(accessToken) {
  try {
    const { base, net } = resolvePiConfig();
    const baseURL = base.endsWith('/v2') ? base : `${base}/v2`;
    // Log which Pi network/base is used and a masked token preview for diagnostics
    try {
      logger.info('Pi API - verifyUser request', {
        net,
        base: baseURL,
        tokenPreview: (accessToken || '').slice(0, 8) + '...',
      });
    } catch (diagErr) {
      logger.warn('Pi API - verifyUser diagnostic logging failed %o', diagErr?.message || diagErr);
    }
    try {
      const response = await axios.get(`${baseURL}/me`, { headers: { 'Authorization': `Bearer ${accessToken}` } });
      return { success: true, user: response.data };
    } catch (err) {
      // Attempt the alternate network for the common auth failure classes.
      // Pi auth tokens can be minted under a different app/network context than the server expects.
      const resp = err && err.response;
      if (resp && [401, 403, 404].includes(resp.status)) {
        const otherNet = net === 'mainnet' ? 'testnet' : 'mainnet';
        try {
          const otherAxios = getPiAxios(otherNet);
          const otherResp = await otherAxios.get(`/me`, { headers: { 'Authorization': `Bearer ${accessToken}` } });
          logger.info('Pi API - verifyUser succeeded on alternate network %s', otherNet);
          return { success: true, user: otherResp.data };
        } catch (otherErr) {
          logPiError('Verify user (alternate)', otherErr);
          return { success: false, error: 'Invalid access token' };
        }
      }
      logPiError('Verify user', err);
      return { success: false, error: 'Invalid access token' };
    }
  } catch (error) {
    logPiError('Verify user', error);
    return { success: false, error: 'Invalid access token' };
  }
}

/**
 * Get list of incomplete payments for a user
 * Use this during authentication to handle incomplete payments
 * 
 * @param {string} userUid - Pi user UID
 * @returns {Promise<Object>} List of incomplete payments
 */
async function getIncompletePayments(userUid, network = 'mainnet') {
  try {
    const response = await getPiAxios(network).get('/payments/incomplete', {
      params: { user_uid: userUid },
    });
    
    return {
      success: true,
      payments: response.data.incomplete_payments || [],
    };
  } catch (error) {
    logger.error('Pi API - Get incomplete payments error: %o', error.response?.data || error.message);
    return {
      success: false,
      payments: [],
      error: error.response?.data?.message || 'Failed to get incomplete payments',
    };
  }
}

/**
 * Validate payment metadata matches escrow
 * Security check to ensure payment is for the correct escrow
 * 
 * @param {Object} payment - Payment from Pi API
 * @param {Object} escrow - Escrow from database
 * @returns {Object} Validation result
 */
function validatePaymentForEscrow(payment, escrow) {
  const metadata = payment.metadata || {};
  const metadataEscrowId = metadata.escrow_id || metadata.escrowId || metadata.escrowID;
  
  // Check escrow ID matches
  if (metadataEscrowId && metadataEscrowId !== escrow.id) {
    return {
      valid: false,
      error: 'Payment escrow_id does not match',
    };
  }
  
  // Check amount matches
  const paymentAmount = Number(payment.amount);
  const escrowAmount = Number(escrow.amount);
  if (Number.isFinite(paymentAmount) && Number.isFinite(escrowAmount) && paymentAmount !== escrowAmount) {
    return {
      valid: false,
      error: `Payment amount ${payment.amount} does not match escrow amount ${escrow.amount}`,
    };
  }
  
  // Check payment is to PMARTS
  // In production, verify the payment is to your app's Pi wallet
  
  return {
    valid: true,
  };
}

/**
 * Verify an access token and return the user's UID
 * Used for authentication verification
 * 
 * @param {string} accessToken - Pi access token
 * @returns {Promise<Object>} { valid: boolean, uid?: string, username?: string }
 */
async function verifyAccessToken(accessToken) {
  try {
    const { base, net } = resolvePiConfig();
    const baseURL = base.endsWith('/v2') ? base : `${base}/v2`;
    // Per-request diagnostic logging to surface network/base and masked token
    try {
      logger.info('Pi API - verifyAccessToken request', {
        net,
        base: baseURL,
        tokenPreview: (accessToken || '').slice(0, 8) + '...',
      });
    } catch (diagErr) {
      logger.warn('Pi API - verifyAccessToken diagnostic logging failed %o', diagErr?.message || diagErr);
    }
    try {
      const response = await axios.get(`${baseURL}/me`, { headers: { 'Authorization': `Bearer ${accessToken}` } });
      return { valid: true, uid: response.data.uid, username: response.data.username };
    } catch (err) {
      const resp = err && err.response;
      if (resp && [401, 403, 404].includes(resp.status)) {
        const otherNet = net === 'mainnet' ? 'testnet' : 'mainnet';
        try {
          const otherAxios = getPiAxios(otherNet);
          const otherResp = await otherAxios.get('/me', { headers: { 'Authorization': `Bearer ${accessToken}` } });
          logger.info('Pi API - verifyAccessToken succeeded on alternate network %s', otherNet);
          return { valid: true, uid: otherResp.data.uid, username: otherResp.data.username };
        } catch (otherErr) {
          logPiError('Verify access token (alternate)', otherErr);
          return { valid: false, error: 'Invalid or expired access token' };
        }
      }
      logPiError('Verify access token', err);
      return { valid: false, error: 'Invalid or expired access token' };
    }
  } catch (error) {
    logPiError('Verify access token', error);
    return { valid: false, error: 'Invalid or expired access token' };
  }
}

/**
 * Create an App-to-User (A2U) payout — server-initiated payment to a Pi user's wallet.
 *
 * Used for releasing escrow funds to a recipient or refunding Pi to a sender.
 *
 * A2U payment flow:
 *   1. POST /v2/payments         — create the payment (server-controlled)
 *   2. POST /v2/payments/{id}/approve — approve immediately (no user action needed)
 *   3. Poll GET /v2/payments/{id}  — wait for blockchain confirmation + txid
 *   4. POST /v2/payments/{id}/complete — finalise with txid
 *
 * @param {Object} params
 * @param {string} params.uid      - Recipient Pi user UID
 * @param {number} params.amount   - Amount in Pi
 * @param {string} params.memo     - Payment memo shown to recipient
 * @param {Object} [params.metadata] - Arbitrary metadata (e.g. { escrow_id })
 * @param {string} [network]       - Network override ('mainnet'|'testnet')
 * @returns {Promise<{success:boolean, paymentId?:string, txid?:string, error?:string}>}
 */
async function createPayout({ uid, amount, memo, metadata }, network = undefined) {
  const { net } = resolvePiConfig(network);
  logger.info('Pi API - Initiating A2U payout', { uid, amount, memo, net });

  // Guard: API key must be present for the resolved network
  const { key } = resolvePiConfig(network);
  if (!key) {
    logger.error('Pi API - createPayout: no API key configured for network %s', net);
    return { success: false, error: `Pi API key not configured for network: ${net}` };
  }

  // Guard: recipient UID is required
  if (!uid) {
    return { success: false, error: 'Recipient Pi UID is required for payout' };
  }

  let paymentId;

  // ── Step 1: Create the A2U payment ──────────────────────────────────────────
  try {
    const createRes = await getPiAxios(network).post('/payments', {
      payment: {
        amount: Number(amount),
        memo: String(memo || 'PMARTS Payout'),
        metadata: metadata || {},
        uid: String(uid),
      },
    });
    // Pi Platform API returns the payment identifier in `identifier`
    paymentId =
      createRes.data?.identifier ||
      createRes.data?.paymentId ||
      createRes.data?.id;
    logger.info('Pi API - A2U payment created: %s', paymentId);
  } catch (createErr) {
    logPiError('Create A2U payment', createErr);
    return {
      success: false,
      error: createErr.response?.data?.message || 'Failed to create A2U payment',
    };
  }

  if (!paymentId) {
    return { success: false, error: 'Pi Network did not return a payment ID for payout' };
  }

  // ── Step 2: Approve immediately (server is the payer for A2U) ───────────────
  try {
    await getPiAxios(network).post(`/payments/${paymentId}/approve`);
    logger.info('Pi API - A2U payment approved: %s', paymentId);
  } catch (approveErr) {
    logPiError('Approve A2U payment', approveErr);
    return {
      success: false,
      paymentId,
      error: approveErr.response?.data?.message || 'Failed to approve A2U payment',
    };
  }

  // ── Step 3: Poll for blockchain txid (up to ~60 s, 12 × 5 s intervals) ─────
  const MAX_POLL_ATTEMPTS = 12;
  const POLL_INTERVAL_MS = 5_000;
  let txid = null;

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    try {
      const pollRes = await getPiAxios(network).get(`/payments/${paymentId}`);
      const pmt = pollRes.data;

      if (pmt?.transaction?.txid) {
        txid = pmt.transaction.txid;
        logger.info(
          'Pi API - A2U payout confirmed on blockchain: paymentId=%s txid=%s (attempt %d)',
          paymentId,
          txid,
          attempt + 1,
        );
        break;
      }

      // Detect explicit cancellation to bail out early
      if (pmt?.status?.cancelled || pmt?.status?.user_cancelled) {
        logger.warn('Pi API - A2U payment was cancelled: paymentId=%s', paymentId);
        return { success: false, paymentId, error: 'A2U payment was cancelled by Pi Network' };
      }

      logger.info(
        'Pi API - A2U payout not yet confirmed (attempt %d/%d): paymentId=%s',
        attempt + 1,
        MAX_POLL_ATTEMPTS,
        paymentId,
      );
    } catch (pollErr) {
      logger.warn(
        'Pi API - A2U payout poll error (attempt %d): %o',
        attempt + 1,
        pollErr?.message || pollErr,
      );
    }
  }

  if (!txid) {
    // Payment is approved and submitted to Pi Network but txid not yet available.
    // Return success=true with paymentId so callers can persist a traceable reference.
    // A background reconciliation job can update the txid later.
    logger.warn(
      'Pi API - A2U payout txid not available after %d polls (paymentId=%s). ' +
        'Payment is approved and pending on-chain confirmation.',
      MAX_POLL_ATTEMPTS,
      paymentId,
    );
    return { success: true, paymentId, txid: null };
  }

  // ── Step 4: Finalise the payment with the confirmed txid ────────────────────
  try {
    await getPiAxios(network).post(`/payments/${paymentId}/complete`, { txid });
    logger.info('Pi API - A2U payout finalised: paymentId=%s txid=%s', paymentId, txid);
  } catch (completeErr) {
    // Non-fatal: funds are already on-chain. Log and continue.
    logPiError('Complete A2U payment (non-fatal)', completeErr);
    logger.warn(
      'Pi API - /complete call failed for A2U payment %s — funds are on-chain (txid=%s)',
      paymentId,
      txid,
    );
  }

  return { success: true, paymentId, txid };
}

/**
 * Helper to produce consistent, detailed Pi API error logs.
 * Shows HTTP status, url, and truncated response body when available.
 */
function logPiError(action, error) {
  try {
    const resp = error && error.response;
    if (resp) {
      const status = resp.status;
      const url = resp.config && (resp.config.url || resp.config.baseURL);
      const method = resp.config && resp.config.method;
      let dataPreview = resp.data;
      try {
        if (typeof dataPreview === 'object') dataPreview = JSON.stringify(dataPreview);
      } catch (e) {
        dataPreview = String(resp.data);
      }
      if (dataPreview && dataPreview.length > 1000) dataPreview = dataPreview.slice(0, 1000) + '...';
      logger.error('Pi API - %s error: status=%s method=%s url=%s response=%s', action, status, method, url, dataPreview);
    } else {
      logger.error('Pi API - %s error: %o', action, error && (error.message || error));
    }
  } catch (logErr) {
    logger.error('Pi API - %s error (logging failed): %o', action, logErr && (logErr.message || logErr));
  }
}

module.exports = {
  PaymentStatus,
  resolvePiConfig,
  getPiAxios,
  getPayment,
  approvePayment,
  completePayment,
  cancelPayment,
  createPayout,
  verifyUser,
  verifyAccessToken,
  getIncompletePayments,
  validatePaymentForEscrow,
};
