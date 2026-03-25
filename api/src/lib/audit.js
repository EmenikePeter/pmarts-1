const supabase = require('./supabase');
const logger = require('./logger');

/**
 * Insert an audit log via SECURITY DEFINER RPC `fn_insert_audit_log`.
 * This avoids RLS/postgrest schema-cache issues with direct inserts.
 */
async function insertAuditLog(params) {
  const rpcPayload = {
    p_action: params.action || null,
    p_entity_type: params.entity_type || params.entityType || null,
    p_entity_id: params.entity_id || params.entityId || null,
    p_actor_id: params.actor_id || params.actorId || null,
    p_user_agent: params.user_agent || params.userAgent || null,
    p_session_id: params.session_id || params.sessionId || null,
    p_request_id: params.request_id || params.requestId || null,
    p_metadata: params.metadata || params.details || {},
  };

  try {
    // Call the unqualified function name first (PostgREST expects function name without schema).
    // Some setups add schema automatically; calling 'public.fn_insert_audit_log' can end up
    // as 'public.public.fn_insert_audit_log' in the schema cache, so prefer the unqualified call.
    let res = await supabase.rpc('fn_insert_audit_log', rpcPayload);
    let data = res.data;
    let error = res.error;
    // If not found in search_path, try schema-qualified variant as a fallback.
    if (error && (error.code === '42P01' || (error.message || '').toLowerCase().includes('function fn_insert_audit_log does not exist'))) {
      const fallback = await supabase.rpc('public.fn_insert_audit_log', rpcPayload);
      data = fallback.data;
      error = fallback.error;
    }
    if (error) {
      // If audit table is missing or RLS blocks access, treat as non-fatal
      const msg = (error && (error.message || '')).toString().toLowerCase();
      if (error.code === '42P01' || msg.includes('audit_logs') || msg.includes('relation "audit_logs"')) {
        logger.warn('Audit RPC non-fatal: audit_logs relation missing or inaccessible', error);
        return { success: true, warning: 'audit_unavailable' };
      }
      // Return other errors to caller for handling
      return { success: false, error };
    }
    return { success: true, data };
  } catch (err) {
    // If RPC throws and mentions missing relation, treat as non-fatal
    const msg = (err && (err.message || '')).toString().toLowerCase();
    if (msg.includes('audit_logs') || msg.includes('relation "audit_logs"') || (err && err.code === '42P01')) {
      logger.warn('Audit RPC exception non-fatal: audit_logs relation missing or inaccessible', err);
      return { success: true, warning: 'audit_unavailable' };
    }
    return { success: false, error: err };
  }
}

module.exports = {
  insertAuditLog,
};
