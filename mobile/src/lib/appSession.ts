import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const APP_SESSION_TOKEN_KEY = 'pmarts_app_session_token';
const APP_SESSION_USER_KEY = 'pmarts_app_session_user';

async function setString(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(key, value);
      }
    } catch {}
    return;
  }
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {}
}

async function getString(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage.getItem(key);
      }
    } catch {}
    return null;
  }
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function deleteString(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(key);
      }
    } catch {}
    return;
  }
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {}
}

export async function saveAppSession(token: string, user?: any): Promise<void> {
  if (!token) return;
  await setString(APP_SESSION_TOKEN_KEY, token);
  if (user) {
    await setString(APP_SESSION_USER_KEY, JSON.stringify(user));
  }
}

export async function getAppSessionToken(): Promise<string | null> {
  return getString(APP_SESSION_TOKEN_KEY);
}

export async function getAppSessionUser<T = any>(): Promise<T | null> {
  const raw = await getString(APP_SESSION_USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function clearAppSession(): Promise<void> {
  await deleteString(APP_SESSION_TOKEN_KEY);
  await deleteString(APP_SESSION_USER_KEY);
}

export async function getBestAuthTokenFromSupabase(supabase: any): Promise<string | null> {
  try {
    const appToken = await getAppSessionToken();
    if (appToken) return appToken;
  } catch {}

  try {
    const sess = await supabase.auth.getSession();
    const token = sess?.data?.session?.access_token;
    if (token) return token;
  } catch {}

  return null;
}

export async function saveJsonValue(key: string, value: unknown): Promise<void> {
  await setString(key, JSON.stringify(value));
}

export async function loadJsonValue<T = any>(key: string): Promise<T | null> {
  const raw = await getString(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function removeValue(key: string): Promise<void> {
  await deleteString(key);
}
