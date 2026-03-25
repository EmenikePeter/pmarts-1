const supabase = require('./supabase');

function isUuid(value) {
  if (typeof value !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function getUserById(userId, columns = '*', options = {}) {
  const { maybeSingle = false } = options;
  const query = supabase.from('users').select(columns).eq('id', userId);
  return maybeSingle ? query.maybeSingle() : query.single();
}

async function getUserRoleById(userId) {
  if (!userId) return null;
  const { data, error } = await getUserById(userId, 'role');
  if (error || !data) return null;
  return data.role;
}

async function updateUserById(userId, values, options = {}) {
  const { select = null, maybeSingle = false } = options;
  let query = supabase.from('users').update(values).eq('id', userId);
  if (select) {
    query = query.select(select);
    return maybeSingle ? query.maybeSingle() : query.single();
  }
  return query;
}

async function resolveUserByIdOrPiId(identifier, columns = '*') {
  if (!identifier) return null;

  if (isUuid(identifier)) {
    const { data } = await getUserById(identifier, columns, { maybeSingle: true });
    if (data) return data;
  }

  const { data } = await supabase.from('users').select(columns).eq('pi_id', identifier).maybeSingle();
  return data || null;
}

module.exports = {
  getUserById,
  getUserRoleById,
  isUuid,
  resolveUserByIdOrPiId,
  updateUserById,
};
