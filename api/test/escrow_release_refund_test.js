/*
Integration test for Escrow Release and Refund endpoints.

Required environment variables:
  - API_URL           (e.g. http://localhost:4000 or your Vercel URL)
  - ESCROW_ID         (UUID of a valid escrow in 'funds_held' status)
  - USER_ID           (sender's UUID, pi_uid, or username)
  - TEST_MODE         set to 'refund' to test refund only, 'release' to test release only, defaults to both

Optional (for refund test):
  - REFUND_REASON     defaults to 'payment_failure' (skips justification/evidence requirements)

Run with:
  node api/test/escrow_release_refund_test.js
  API_URL=https://your-api.vercel.app ESCROW_ID=xxx USER_ID=yyy node api/test/escrow_release_refund_test.js
*/

let fetchFn = global.fetch;
if (!fetchFn) {
  try {
    fetchFn = require('node-fetch');
  } catch (err) {
    console.error('Global fetch not available. Run `npm install node-fetch@2` or use Node 18+.');
    process.exit(1);
  }
}
const fetch = fetchFn;

const API_URL = process.env.API_URL || 'http://localhost:4000';
const ESCROW_ID = process.env.ESCROW_ID;
const USER_ID = process.env.USER_ID;
const TEST_MODE = (process.env.TEST_MODE || 'both').toLowerCase();
const REFUND_REASON = process.env.REFUND_REASON || 'payment_failure';

if (!ESCROW_ID || !USER_ID) {
  console.error('ERROR: Set ESCROW_ID and USER_ID environment variables to run this test.');
  console.error('  ESCROW_ID  — UUID of the escrow to test (must be in funds_held status)');
  console.error('  USER_ID    — Sender\'s user UUID or pi_uid');
  process.exit(2);
}

// ─── helpers ────────────────────────────────────────────────────────────────

function pass(label, status, body) {
  console.log(`✅  PASS  [${status}]  ${label}`);
  if (body?.releasePath) console.log(`         releasePath: ${body.releasePath}`);
  if (body?.message)     console.log(`         message: ${body.message}`);
}

function fail(label, status, body) {
  console.error(`❌  FAIL  [${status}]  ${label}`);
  console.error('         Response:', JSON.stringify(body, null, 2));
}

async function post(path, payload) {
  const url = `${API_URL}${path}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  let body;
  try { body = await resp.json(); } catch { body = {}; }
  return { status: resp.status, ok: resp.ok, body };
}

// ─── tests ───────────────────────────────────────────────────────────────────

async function testRelease() {
  console.log('\n── Release Test ─────────────────────────────────────────────');
  console.log(`   POST ${API_URL}/api/escrow/v2/release`);
  console.log(`   escrowId: ${ESCROW_ID}  userId: ${USER_ID}`);

  const { status, ok, body } = await post('/api/escrow/v2/release', {
    escrowId: ESCROW_ID,
    userId: USER_ID,
  });

  if (ok) {
    pass('Release', status, body);
  } else {
    fail('Release', status, body);
  }
  return ok;
}

async function testRefund() {
  console.log('\n── Refund Test ──────────────────────────────────────────────');
  console.log(`   POST ${API_URL}/api/escrow/v2/refund`);
  console.log(`   escrowId: ${ESCROW_ID}  userId: ${USER_ID}  reason: ${REFUND_REASON}`);

  // Build payload — 'payment_failure' and 'platform_error' are system reasons
  // that skip justification / evidence / contactAttempted requirements.
  // For other reasons, supply the extra fields.
  const isSystemReason = ['payment_failure', 'platform_error'].includes(REFUND_REASON);
  const payload = {
    escrowId: ESCROW_ID,
    userId: USER_ID,
    reason: REFUND_REASON,
    ...(isSystemReason ? {} : {
      justification: 'Item was never delivered despite multiple follow-up attempts.',
      evidenceUrls: ['https://example.com/screenshot.png'],
      contactAttempted: true,
    }),
  };

  const { status, ok, body } = await post('/api/escrow/v2/refund', payload);

  if (ok) {
    pass('Refund', status, body);
  } else {
    fail('Refund', status, body);
  }
  return ok;
}

// ─── runner ──────────────────────────────────────────────────────────────────

async function run() {
  console.log('=== PMARTS Escrow Release/Refund Test ===');
  console.log(`API: ${API_URL}`);
  console.log(`Escrow ID: ${ESCROW_ID}`);
  console.log(`User ID: ${USER_ID}`);

  const results = [];

  try {
    if (TEST_MODE === 'both' || TEST_MODE === 'release') {
      results.push(await testRelease());
    }
    if (TEST_MODE === 'both' || TEST_MODE === 'refund') {
      results.push(await testRefund());
    }
  } catch (err) {
    console.error('\nUnexpected error during test:', err.message);
    process.exit(1);
  }

  const allPassed = results.every(Boolean);
  console.log(`\n${'─'.repeat(55)}`);
  console.log(allPassed ? '✅  All tests passed' : '❌  Some tests failed');
  process.exit(allPassed ? 0 : 1);
}

run();
