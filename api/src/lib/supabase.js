const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

// No verbose environment logging in production; rely on structured logs for diagnostics.

// Export client directly and as named property for compatibility with
// modules that import either `const supabase = require(...)` or
// `const { supabase } = require(...)`.
module.exports = supabase;
module.exports.supabase = supabase;

