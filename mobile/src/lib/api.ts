/**
 * PMARTS API Configuration
 *
 * Centralized API configuration for the mobile app.
 *
 * @module api
 */

// API base URL - defaults to localhost for development
// In production, this should point to your deployed API server
// Prefer local API during development or when running on localhost/web.
let _apiUrl = process.env.EXPO_PUBLIC_API_URL || 'https://pms-admin-panel.vercel.app';
try {
  if (typeof window !== 'undefined') {
    const host = (window.location && window.location.hostname) || '';
    if (process.env.NODE_ENV === 'development' || host === 'localhost' || host === '127.0.0.1') {
      _apiUrl = 'http://localhost:4000';
    }
  }
} catch (e) {
  // ignore
}

export const API_URL = _apiUrl;
// Allow runtime override from server when build-time env is missing or incorrect
export let RUNTIME_API_URL = API_URL;

if (typeof window !== 'undefined') {
  (async () => {
    try {
      // Only attempt runtime fetch if no build-time EXPO_PUBLIC_API_URL
      if (!process.env.EXPO_PUBLIC_API_URL || RUNTIME_API_URL.includes('pms-admin-panel.vercel.app')) {
        const fallbackHost = process.env.EXPO_PUBLIC_API_URL || 'https://pmarts-api.vercel.app';
        // If the current origin is the API host, use same-origin, otherwise call API host directly
        const apiHostOnly = fallbackHost.replace(/^https?:\/\//, '').replace(/\/$/, '');
        const runningHost = (typeof window !== 'undefined' && window.location && window.location.host) ? window.location.host : null;
        let resp;
        try {
          if (runningHost === apiHostOnly) {
            resp = await fetch('/api/public-config');
          } else {
            resp = await fetch(`${fallbackHost.replace(/\/$/, '')}/api/public-config`);
          }
          if (!resp.ok) throw new Error('public-config fetch failed');
          const body = await resp.json();
          const cfg = body?.config || {};
          const runtimeApi = cfg.EXPO_PUBLIC_API_URL || cfg.NEXT_PUBLIC_API_URL;
          if (runtimeApi) {
            RUNTIME_API_URL = runtimeApi;
          }
        } catch (e) {
          // ignore runtime fetch failure
        }
      }
    } catch (e) {
      // ignore runtime fetch failure
    }
  })();
}

// API versioning
export const API_VERSION = 'v2';

// Construct full API endpoint
export function getApiEndpoint(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_URL}${cleanPath}`;
}

// API request timeout (milliseconds)
export const API_TIMEOUT = 30000;

export default {
  API_URL,
  API_VERSION,
  API_TIMEOUT,
  getApiEndpoint,
};

