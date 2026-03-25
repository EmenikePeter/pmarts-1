export type DebugLogLevel = 'log' | 'warn' | 'error';

export type DebugLogEntry = {
  id: string;
  level: DebugLogLevel;
  message: string;
  data?: unknown;
  timestamp: number;
};

type DebugLogListener = (entries: DebugLogEntry[]) => void;

const MAX_ENTRIES = 200;
let entries: DebugLogEntry[] = [];
const listeners = new Set<DebugLogListener>();

export function isDebugEnabled(): boolean {
  try {
    const envValue = typeof process !== 'undefined'
      ? (process as any)?.env?.EXPO_PUBLIC_DEBUG_LOGS
      : undefined;

    // Runtime toggle via URL query (web) or localStorage
    const runtimeEnabled = typeof window !== 'undefined' && (() => {
      try {
        if (window.location?.search?.includes('debug=1')) return true;
        const ls = window.localStorage?.getItem('pmarts_debug');
        if (ls === '1' || ls === 'true') return true;
      } catch {
        // ignore
      }
      return false;
    })();

    return __DEV__ || envValue === 'true' || runtimeEnabled;
  } catch {
    return __DEV__;
  }
}

function notify(): void {
  listeners.forEach((listener) => listener(entries));
}

function addEntry(level: DebugLogLevel, message: string, data?: unknown): void {
  const entry: DebugLogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    level,
    message,
    data,
    timestamp: Date.now(),
  };

  entries = [...entries, entry].slice(-MAX_ENTRIES);
  notify();
}

export function getDebugEntries(): DebugLogEntry[] {
  return entries;
}

export function subscribeDebugEntries(listener: DebugLogListener): () => void {
  listeners.add(listener);
  listener(entries);
  return () => listeners.delete(listener);
}

export function debugLog(message: string, data?: unknown): void {
  addEntry('log', message, data);
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    if (data !== undefined) console.log(message, data);
    else console.log(message);
  }
}

export function debugWarn(message: string, data?: unknown): void {
  addEntry('warn', message, data);
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    if (data !== undefined) console.warn(message, data);
    else console.warn(message);
  }
}

export function debugError(message: string, data?: unknown): void {
  addEntry('error', message, data);
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    if (data !== undefined) console.error(message, data);
    else console.error(message);
  }
}
