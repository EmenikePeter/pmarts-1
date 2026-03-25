const express = require('express');
const router = express.Router();
const piApi = require('../lib/piApi');
const supabase = require('../lib/supabase');
const logger = require('../lib/logger');

function maskValue(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (text.length <= 8) return `${text.slice(0, 2)}***`;
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

async function probePaymentsEndpoint(network) {
  try {
    const { net, base, key } = piApi.resolvePiConfig(network);
    const client = piApi.getPiAxios(network);
    const response = await client.get('/payments/incomplete_server_payments');
    return {
      network: net,
      base,
      hasKey: !!key,
      keyMask: maskValue(key),
      ok: true,
      count: Array.isArray(response?.data?.incomplete_server_payments)
        ? response.data.incomplete_server_payments.length
        : null,
    };
  } catch (error) {
    return {
      network: piApi.resolvePiConfig(network).net,
      base: piApi.resolvePiConfig(network).base,
      hasKey: !!piApi.resolvePiConfig(network).key,
      keyMask: maskValue(piApi.resolvePiConfig(network).key),
      ok: false,
      status: error?.response?.status || null,
      error: error?.response?.data?.error_message || error?.response?.data?.message || error?.message || 'probe_failed',
    };
  }
}

/**
 * GET /api/pi/diag
 * Returns masked Pi runtime configuration and non-sensitive platform probe results.
 */
router.get('/diag', async (_req, res) => {
  try {
    const [testnetProbe, mainnetProbe] = await Promise.all([
      probePaymentsEndpoint('testnet'),
      probePaymentsEndpoint('mainnet'),
    ]);

    return res.json({
      success: true,
      config: {
        piEnv: String(process.env.PI_ENV || '').trim() || null,
        testnetUrl: String(process.env.PI_TESTNET_API_URL || '').trim() || 'https://api.testnet.minepi.com',
        mainnetUrl: String(process.env.PI_MAINNET_API_URL || '').trim() || 'https://api.minepi.com',
        testnetKeyMask: maskValue(process.env.PI_TESTNET_API_KEY),
        mainnetKeyMask: maskValue(process.env.PI_MAINNET_API_KEY),
      },
      probes: {
        testnet: testnetProbe,
        mainnet: mainnetProbe,
      },
    });
  } catch (e) {
    logger.error('[pi] diag error %o', e);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /api/pi/approve
 * Called by the client when Pi SDK signals onReadyForServerApproval
 */
router.post('/approve', async (req, res) => {
  try {
    const { payment_id: paymentId, escrow_id: escrowId, network } = req.body || req.body || {};
    const net = (network || req.headers['x-pi-network'] || 'mainnet').toString();
    if (!paymentId) return res.status(400).json({ success: false, error: 'payment_id required' });

    logger.info('[pi] approve %s escrow %s', paymentId, escrowId);

    const paymentResult = await piApi.getPayment(paymentId, net);
    if (!paymentResult.success) return res.status(400).json({ success: false, error: paymentResult.error });

    const payment = paymentResult.payment;

    // Optionally validate against escrow
    if (escrowId) {
      const { data: escrow, error: escrowErr } = await supabase.from('escrows').select('*').eq('id', escrowId).single();
      if (escrowErr || !escrow) return res.status(404).json({ success: false, error: 'Escrow not found' });
      const validation = piApi.validatePaymentForEscrow(payment, escrow);
      if (!validation.valid) return res.status(400).json({ success: false, error: validation.error });
    }

    const approval = await piApi.approvePayment(paymentId, net);
    if (!approval.success) return res.status(500).json({ success: false, error: approval.error });

    // Record a minimal transaction row to keep track
    try {
      await supabase.from('pi_transactions').upsert({ pi_payment_id: paymentId, status: 'approved', escrow_id: escrowId, network: net }, { onConflict: 'pi_payment_id' });
    } catch (e) { logger.warn('[pi] failed to upsert pi_transactions %o', e); }

    res.json({ success: true, message: 'approved' });
  } catch (e) {
    logger.error('[pi] approve error %o', e);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});


/**
 * POST /api/pi/complete
 * Called when Pi SDK signals onReadyForServerCompletion
 */
router.post('/complete', async (req, res) => {
  try {
    const { payment_id: paymentId, txid, escrow_id: escrowId, network } = req.body || {};
    const net = (network || req.headers['x-pi-network'] || 'mainnet').toString();
    if (!paymentId || !txid) return res.status(400).json({ success: false, error: 'payment_id and txid required' });

    logger.info('[pi] complete %s %s escrow %s network %s', paymentId, txid, escrowId, net);

    const completion = await piApi.completePayment(paymentId, txid, net);
    if (!completion.success) return res.status(500).json({ success: false, error: completion.error });

    // Update transaction and escrow state
    try {
      await supabase.from('pi_transactions').upsert({ pi_payment_id: paymentId, status: 'completed', pi_txid: txid, escrow_id: escrowId, network: net }, { onConflict: 'pi_payment_id' });
    } catch (e) { logger.warn('[pi] failed to upsert pi_transactions %o', e); }

    if (escrowId) {
      try {
        await supabase.from('escrows').update({ status: 'held', pi_payment_id: paymentId, pi_transaction_hash: txid, deposit_verified: true, deposit_verified_at: new Date().toISOString() }).eq('id', escrowId);
      } catch (e) { logger.warn('[pi] failed to update escrow %o', e); }
    }

    res.json({ success: true, message: 'completed' });
  } catch (e) {
    logger.error('[pi] complete error %o', e);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});


/**
 * POST /api/pi/verify
 * Body: { accessToken }
 * Verifies a Pi auth access token and returns user info
 */
router.post('/verify', async (req, res) => {
  try {
    const { accessToken } = req.body || {};
    if (!accessToken) return res.status(400).json({ success: false, error: 'accessToken required' });

    const result = await piApi.verifyAccessToken(accessToken);
    if (!result.valid) return res.status(401).json({ success: false, error: result.error });

    res.json({ success: true, uid: result.uid, username: result.username });
  } catch (e) {
    logger.error('[pi] verify error %o', e);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;
