/* Lightweight structured logger
 * - Uses JSON output in production
 * - Honors LOG_LEVEL (error,warn,info,debug)
 */
const util = require('util');
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const envLevel = (process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug')).toLowerCase();
const CURRENT_LEVEL = LEVELS[envLevel] !== undefined ? LEVELS[envLevel] : LEVELS.info;

function shouldLog(level) {
  return LEVELS[level] <= CURRENT_LEVEL;
}

function format(level, args) {
  if ((process.env.NODE_ENV || '').toLowerCase() === 'production') {
    const msg = util.format.apply(null, args);
    return JSON.stringify({ level, time: new Date().toISOString(), message: msg });
  }
  // human friendly
  return `[${level.toUpperCase()}] ${util.format.apply(null, args)}`;
}

function error() {
  if (!shouldLog('error')) return;
  const out = format('error', arguments);
  console.error(out);
}

function warn() {
  if (!shouldLog('warn')) return;
  const out = format('warn', arguments);
  console.warn(out);
}

function info() {
  if (!shouldLog('info')) return;
  const out = format('info', arguments);
  console.log(out);
}

function debug() {
  if (!shouldLog('debug')) return;
  const out = format('debug', arguments);
  console.log(out);
}

function child(bindings = {}) {
  return {
    error: (...args) => error(JSON.stringify(bindings), ...args),
    warn: (...args) => warn(JSON.stringify(bindings), ...args),
    info: (...args) => info(JSON.stringify(bindings), ...args),
    debug: (...args) => debug(JSON.stringify(bindings), ...args),
  };
}

module.exports = { error, warn, info, debug, child };
