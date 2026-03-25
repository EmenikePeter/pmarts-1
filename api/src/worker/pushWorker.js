require('dotenv').config();
const express = require('express');
const supabase = require('../lib/supabase');
const logger = require('../lib/logger');
const pushQueue = require('../lib/pushQueue');

const app = express();
const port = process.env.PUSH_WORKER_PORT || 4001;

// Start the worker loop
try {
  pushQueue.startWorker(supabase, parseInt(process.env.PUSH_WORKER_INTERVAL_MS || '30000'));
} catch (e) {
  logger.error('[pushWorker] failed to start worker: %o', e?.message || e);
}

app.get('/health', async (req, res) => {
  try {
    const now = new Date().toISOString();
    const { data: pendingPushes } = await supabase.from('push_retry_queue').select('id').eq('processed', false).lte('next_attempt_at', now).limit(1);
    const { data: recentErrors } = await supabase.from('webhook_logs').select('id').neq('last_error', null).order('created_at', { ascending: false }).limit(5);

    res.json({ ok: true, pendingPushes: (pendingPushes || []).length, recentWebhookErrors: (recentErrors || []).length });
  } catch (e) {
    logger.error('[pushWorker.health] error: %o', e?.message || e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.listen(port, () => {
  logger.info('[pushWorker] running on port %s', port);
});

// Allow graceful shutdown
process.on('SIGINT', () => {
  logger.info('[pushWorker] shutting down');
  process.exit(0);
});
