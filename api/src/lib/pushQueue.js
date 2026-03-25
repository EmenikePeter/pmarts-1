const fetch = require('node-fetch');
const logger = require('./logger');

/**
 * Enqueue a push to the DB table for later processing.
 * @param {object} supabase - supabase client
 */
async function enqueuePush(supabase, toToken, title, body, metadata = {}) {
  try {
    const { error } = await supabase.from('push_retry_queue').insert({
      to_token: toToken,
      title,
      body,
      metadata,
      next_attempt_at: new Date().toISOString(),
    });
    if (error) logger.warn('[pushQueue.enqueuePush] insert failed: %o', error);
  } catch (e) {
    logger.error('[pushQueue.enqueuePush] unexpected error: %o', e?.message || e);
  }
}

async function _processOnce(supabase) {
  try {
    const now = new Date().toISOString();
    const { data: rows, error } = await supabase
      .from('push_retry_queue')
      .select('*')
      .eq('processed', false)
      .lte('next_attempt_at', now)
      .order('created_at', { ascending: true })
      .limit(10);

    if (error) {
      logger.warn('[pushQueue._processOnce] select error: %o', error);
      return;
    }

    for (const row of rows || []) {
      try {
        const res = await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: row.to_token, title: row.title, body: row.body }),
        });

        const text = await res.text();
        if (res.ok) {
          await supabase.from('push_retry_queue').update({ processed: true, processed_at: new Date().toISOString() }).eq('id', row.id);
          logger.info('[pushQueue] pushed id=%d OK', row.id);
        } else {
          const attempts = (row.attempts || 0) + 1;
          const backoffSec = Math.min(300, attempts * 30);
          await supabase.from('push_retry_queue').update({
            attempts,
            last_error: text || `http:${res.status}`,
            next_attempt_at: new Date(Date.now() + backoffSec * 1000).toISOString(),
          }).eq('id', row.id);
          logger.warn('[pushQueue] push failed id=%d attempts=%d err=%s', row.id, attempts, text || res.status);
        }
      } catch (e) {
        const attempts = (row.attempts || 0) + 1;
        const backoffSec = Math.min(300, attempts * 30);
        await supabase.from('push_retry_queue').update({
          attempts,
          last_error: e?.message || String(e),
          next_attempt_at: new Date(Date.now() + backoffSec * 1000).toISOString(),
        }).eq('id', row.id);
        logger.warn('[pushQueue] push exception id=%d err=%o', row.id, e?.message || e);
      }
    }
  } catch (e) {
    logger.error('[pushQueue._processOnce] unexpected: %o', e?.message || e);
  }
}

let _worker = null;

function startWorker(supabase, intervalMs = 30000) {
  if (_worker) return;
  _worker = setInterval(() => { void _processOnce(supabase); }, intervalMs);
  logger.info('[pushQueue] worker started');
}

module.exports = { enqueuePush, startWorker };
