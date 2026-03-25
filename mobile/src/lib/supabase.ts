import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { debugWarn } from './debugLogger';

// Safe SecureStore adapter with fallback for web/unsupported environments
const ExpoSecureStoreAdapter = {
  getItem: async (key: string) => {
    try {
      if (Platform.OS === 'web') {
        return localStorage.getItem(key);
      }
      return await SecureStore.getItemAsync(key);
    } catch (e) {
      debugWarn('SecureStore getItem failed:', e);
      return null;
    }
  },
  setItem: async (key: string, value: string) => {
    try {
      if (Platform.OS === 'web') {
        localStorage.setItem(key, value);
        return;
      }
      await SecureStore.setItemAsync(key, value);
    } catch (e) {
      debugWarn('SecureStore setItem failed:', e);
    }
  },
  removeItem: async (key: string) => {
    try {
      if (Platform.OS === 'web') {
        localStorage.removeItem(key);
        return;
      }
      await SecureStore.deleteItemAsync(key);
    } catch (e) {
      debugWarn('SecureStore removeItem failed:', e);
    }
  },
};

// Environment variables (must be prefixed with EXPO_PUBLIC_ to be available in the app)
let SUPABASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://zlzepcizwditfxckyuwl.supabase.co').trim();
let SUPABASE_ANON_KEY = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemVwY2l6d2RpdGZ4Y2t5dXdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2ODUyNjgsImV4cCI6MjA4ODI2MTI2OH0.ITeotKblFmYymMWC32L6UvE1OmWUhulrn9asSb8-0QU').trim();

// Detect when the anon key is the development placeholder or missing in production
const BUILD_ANON_PLACEHOLDER = SUPABASE_ANON_KEY;
export let SUPABASE_CONFIG_VALID = !!process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY && process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY !== BUILD_ANON_PLACEHOLDER;
if (!SUPABASE_CONFIG_VALID) {
  debugWarn('[supabase] EXPO_PUBLIC_SUPABASE_ANON_KEY is missing or using the placeholder key. Attempting to fetch runtime public config.');
}

function createSingletonClient(url: string, anonKey: string) {
  if (typeof window !== 'undefined') {
    const gw = window as any;
    if (gw.__supabase && gw.__supabaseUrl === url && gw.__supabaseAnonKey === anonKey) return gw.__supabase;
    const client = createClient(url, anonKey, {
      auth: {
        storage: ExpoSecureStoreAdapter,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
    gw.__supabase = client;
    gw.__supabaseUrl = url;
    gw.__supabaseAnonKey = anonKey;
    return client;
  }
  return createClient(url, anonKey, {
    auth: {
      storage: ExpoSecureStoreAdapter,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
}

export let supabase = createSingletonClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// If build-time config is invalid, attempt to fetch runtime public config from the API
// This is useful for hosted static builds where runtime env is provided by the server.
if (!SUPABASE_CONFIG_VALID && Platform.OS === 'web') {
  (async () => {
      try {
        // Prefer fetching runtime public-config from the configured API host
        // to avoid same-origin 404s when the static/web origin doesn't host
        // the API (eg. pmarts.vercel.app vs pmarts-api.vercel.app).
        const fallbackHost = process.env.EXPO_PUBLIC_API_URL || 'https://pmarts-api.vercel.app';
        let resp;
        // If the current origin matches the API host, use same-origin path
        const apiHostOnly = fallbackHost.replace(/^https?:\/\//, '').replace(/\/$/, '');
        const runningHost = (typeof window !== 'undefined' && window.location && window.location.host) ? window.location.host : null;
        if (runningHost === apiHostOnly) {
          resp = await fetch('/api/public-config');
        } else {
          // Directly call the API host to avoid a noisy 404 from the web origin.
          resp = await fetch(`${fallbackHost.replace(/\/$/, '')}/api/public-config`);
        }
        if (!resp.ok) {
          // As a last resort, try same-origin if the above failed
          try { resp = await fetch('/api/public-config'); } catch (e) { /* ignore */ }
        }
      if (!resp || !resp.ok) throw new Error(`public-config fetch failed`);
      const body = await resp.json();
      const cfg = body?.config || {};
      // Accept either NEXT_PUBLIC_* (Next.js) or EXPO_PUBLIC_* (Expo) keys
      const anonKey = (cfg.NEXT_PUBLIC_SUPABASE_ANON_KEY || cfg.EXPO_PUBLIC_SUPABASE_ANON_KEY || '').trim();
      const url = (cfg.NEXT_PUBLIC_SUPABASE_URL || cfg.EXPO_PUBLIC_SUPABASE_URL || '').trim();
      if (anonKey && url) {
        SUPABASE_ANON_KEY = anonKey;
        SUPABASE_URL = url;
        // Recreate singleton supabase client with runtime values
        supabase = createSingletonClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        SUPABASE_CONFIG_VALID = true;
        debugWarn('[supabase] Initialized client from runtime public-config');
      } else {
        debugWarn('[supabase] public-config did not contain supabase keys');
      }
    } catch (e) {
      debugWarn('[supabase] runtime public-config fetch failed:', e);
    }
  })();
}

