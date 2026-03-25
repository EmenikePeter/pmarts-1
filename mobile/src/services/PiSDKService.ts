/**
 * PMARTS Pi SDK Service (Mobile)
 *
 * Complete Pi Network integration with:
 * - Auto login in Pi Browser
 * - Fallback login for external browsers
 * - Secure server-side authentication verification
 * - Payment handling for escrow deposits
 * - Wallet connection for payouts
 *
 * @module PiSDKService
 */

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { supabase } from '../lib/supabase';
import { API_URL } from '../lib/api';
import { debugError, debugLog } from '../lib/debugLogger';

// ============================================
// TYPES
// ============================================

export interface PiUser {
  uid: string;
  username: string;
  accessToken: string;
  walletAddress?: string;
}

export interface PiPaymentData {
  identifier: string;
  user_uid: string;
  amount: number;
  memo: string;
  metadata: Record<string, unknown>;
  from_address: string;
  to_address: string;
  direction: 'user_to_app' | 'app_to_user';
  created_at: string;
  network: 'Pi Network' | 'Pi Testnet';
  status: {
    developer_approved: boolean;
    transaction_verified: boolean;
    developer_completed: boolean;
    cancelled: boolean;
    user_cancelled: boolean;
  };
  transaction?: {
    txid: string;
    verified: boolean;
    _link: string;
  };
}

export interface PiSDKConfig {
  version: string;
  sandbox: boolean;
  onReady?: () => void;
  onError?: (error: Error) => void;
}

export interface AuthResult {
  success: boolean;
  user?: PiUser;
  error?: string;
  isNewUser?: boolean;
}

export interface PaymentResult {
  success: boolean;
  paymentId?: string;
  txid?: string;
  error?: string;
}

// ============================================
// CONSTANTS
// ============================================

const PI_SDK_URL = 'https://sdk.minepi.com/pi-sdk.js';
const STORAGE_KEYS = {
  PI_USER: '@pmarts/pi_user',
  PI_TOKEN: '@pmarts/pi_token',
  DEVICE_ID: '@pmarts/device_id',
  APP_SESSION: '@pmarts/app_session',
};

// Scopes requested from Pi Network
const AUTH_SCOPES = ['username', 'payments', 'wallet_address'];

// ============================================
// PI SDK SINGLETON
// ============================================

class PiSDKService {
  private static instance: PiSDKService;
  private sdk: any = null;
  private isInitialized = false;
  private isInPiBrowser = false;
  private currentUser: PiUser | null = null;
  private resolvedSandbox: boolean | null = null;

  private constructor() {}

  static getInstance(): PiSDKService {
    if (!PiSDKService.instance) {
      PiSDKService.instance = new PiSDKService();
    }
    return PiSDKService.instance;
  }

  // ============================================
  // INITIALIZATION
  // ============================================

  /**
   * Initialize Pi SDK
   * Auto-detects Pi Browser and configures accordingly
   */
  async initialize(config?: Partial<PiSDKConfig>): Promise<boolean> {
    if (this.isInitialized) {
      return true;
    }

    try {
      // Initial detection (may be false before SDK loads)
      this.isInPiBrowser = this.detectPiBrowser();

      if (Platform.OS === 'web') {
        // Web - load SDK script
        await this.loadWebSDK(config);
      } else {
        // React Native - use bridge
        await this.initializeNativeSDK(config);
      }

      // Re-detect after SDK load to catch Pi Browser SDK injection
      this.isInPiBrowser = this.detectPiBrowser();

      this.isInitialized = true;

      // Try auto-login if in Pi Browser AND an app session exists
      if (this.isInPiBrowser) {
        try {
          const hasAppSession = await this.isAppSessionPresent();
          if (hasAppSession) {
            await this.autoLogin();
          } else {
            debugLog('[PiSDK] Skipping auto-login: no app session present');
          }
        } catch (e) {
          debugError('[PiSDK] Error checking app session', e);
        }
      }

      return true;
    } catch (error) {
      debugError('[PiSDK] Init error:', error);
      config?.onError?.(error as Error);
      return false;
    }
  }

  /**
   * Detect if running inside Pi Browser
   */
  private detectPiBrowser(): boolean {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const userAgent = window.navigator.userAgent.toLowerCase();
      const hasPiSDK = !!(window as any).Pi;
      return hasPiSDK || userAgent.includes('pibrowser') || userAgent.includes('pi browser') || userAgent.includes('pi network');
    }
    return false;
  }

  /**
   * Load Pi SDK for web
   */
  private async loadWebSDK(config?: Partial<PiSDKConfig>): Promise<void> {
    return new Promise((resolve, reject) => {
      if (typeof window === 'undefined') {
        reject(new Error('Window not available'));
        return;
      }

      // Check if already loaded
      if ((window as any).Pi) {
        this.sdk = (window as any).Pi;
        (async () => {
          const sandbox = await this.resolveSandboxMode(config);
          this.sdk.init({
            version: config?.version || '2.0',
            sandbox,
          });
          resolve();
        })().catch(reject);
        return;
      }

      // Load script
      // Dev override: ensure SDK posts messages to our origin when running locally
      try {
        const win: any = window;
        const allowOverride = process.env.NODE_ENV === 'development' || (win.location?.search || '').includes('debug=1');
        if (allowOverride) {
          win.__PI_SDK_TARGET_ORIGIN__ = win.location.origin;
          debugLog('[PiSDK] Set __PI_SDK_TARGET_ORIGIN__ to', win.location.origin);
        }
      } catch (e) {
        // ignore
      }

      const script = document.createElement('script');
      script.src = PI_SDK_URL;
      script.async = true;

      script.onload = () => {
        this.sdk = (window as any).Pi;
        (async () => {
          const sandbox = await this.resolveSandboxMode(config);
          this.sdk.init({
            version: config?.version || '2.0',
            sandbox,
          });
          config?.onReady?.();
          resolve();
        })().catch(reject);
      };

      script.onerror = () => {
        reject(new Error('Failed to load Pi SDK'));
      };

      document.head.appendChild(script);
    });
  }

  /**
   * Initialize SDK for React Native
   */
  private async initializeNativeSDK(config?: Partial<PiSDKConfig>): Promise<void> {
    // For React Native, we'll use WebView bridge with Pi SDK
    // This is a simplified version - in production, use proper WebView integration
    const sandbox = await this.resolveSandboxMode(config);
    debugLog('[PiSDK] Native SDK initialized (sandbox: %s)', sandbox);
  }

  private async resolveSandboxMode(config?: Partial<PiSDKConfig>): Promise<boolean> {
    if (typeof config?.sandbox === 'boolean') {
      this.resolvedSandbox = config.sandbox;
      return config.sandbox;
    }

    if (this.resolvedSandbox !== null) {
      return this.resolvedSandbox;
    }

    if (process.env.EXPO_PUBLIC_PI_SANDBOX === 'true') {
      this.resolvedSandbox = true;
      return true;
    }

    if (process.env.EXPO_PUBLIC_PI_SANDBOX === 'false') {
      this.resolvedSandbox = false;
      return false;
    }

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      try {
        const host = window.location?.hostname || '';
        if (process.env.NODE_ENV === 'development' || host === 'localhost' || host === '127.0.0.1') {
          this.resolvedSandbox = true;
          return true;
        }

        const cfgResp = await fetch(`${API_URL.replace(/\/$/, '')}/api/public-config`);
        if (cfgResp.ok) {
          const body = await cfgResp.json().catch(() => null);
          const piEnv = String(body?.config?.PI_ENV || '').trim().toLowerCase();
          if (piEnv) {
            this.resolvedSandbox = piEnv === 'testnet';
            return this.resolvedSandbox;
          }
        }
      } catch (error) {
        debugError('[PiSDK] Failed to resolve PI_ENV from public-config', error);
      }

      this.resolvedSandbox = false;
      return false;
    }

    this.resolvedSandbox = process.env.NODE_ENV !== 'production';
    return this.resolvedSandbox;
  }

  // ============================================
  // AUTHENTICATION
  // ============================================

  /**
   * Auto-login if in Pi Browser
   */
  private async autoLogin(): Promise<void> {
    try {
      debugLog('[PiSDK] Attempting auto-login...');
      const result = await this.authenticate();
      if (result.success) {
        debugLog('[PiSDK] Auto-login successful:', result.user?.username);
      }
    } catch (error) {
      debugError('[PiSDK] Auto-login failed:', error);
    }
  }

  /**
   * Authenticate with Pi Network
   * Uses native flow in Pi Browser, shows modal outside
   */
  async authenticate(): Promise<AuthResult> {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Try cached user first
      const cachedUser = await this.getCachedUser();
      if (cachedUser) {
          const valid = await this.verifyToken(cachedUser.accessToken);
          if (valid) return (this.currentUser = cachedUser), { success: true, user: cachedUser };
          // Token invalid/expired — clear cached credentials to avoid repeated failing checks
          try {
            if (Platform.OS === 'web') {
              window.localStorage.removeItem(STORAGE_KEYS.PI_USER);
              window.localStorage.removeItem(STORAGE_KEYS.PI_TOKEN);
              window.localStorage.removeItem(STORAGE_KEYS.APP_SESSION);
            } else {
              await SecureStore.deleteItemAsync(STORAGE_KEYS.PI_USER);
              await SecureStore.deleteItemAsync(STORAGE_KEYS.PI_TOKEN);
              await SecureStore.deleteItemAsync(STORAGE_KEYS.APP_SESSION);
            }
          } catch (e) {
            // ignore
          }
      }

      // Perform Pi authentication
      let authResult: any;

      if (this.sdk) {
        authResult = await this.sdk.authenticate(AUTH_SCOPES, (payment: any) => {
          // Handle incomplete payment from previous session
          this.handleIncompletePayment(payment);
        });
      } else {
        // Fallback for testing
        return { success: false, error: 'Pi SDK not available' };
      }

      if (!authResult?.user) {
        return { success: false, error: 'Authentication cancelled' };
      }

      // Build user object
      const user: PiUser = {
        uid: authResult.user.uid,
        username: authResult.user.username,
        accessToken: authResult.accessToken,
        walletAddress: authResult.user.wallet_address,
      };

      // Verify with server
      const serverVerification = await this.verifyWithServer(user);
      if (!serverVerification.success) {
        return { success: false, error: serverVerification.error };
      }

      // Cache user
      await this.cacheUser(user);
      this.currentUser = user;

      return {
        success: true,
        user,
        isNewUser: serverVerification.isNewUser,
      };
    } catch (error: any) {
      debugError('[PiSDK] Auth error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Verify access token with our server
   */
  private async verifyWithServer(user: PiUser): Promise<{
    success: boolean;
    error?: string;
    isNewUser?: boolean;
  }> {
    try {
      const deviceId = await this.getDeviceId();

      const response = await fetch(`${API_URL}/api/auth/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${user.accessToken}`,
        },
        body: JSON.stringify({
          piUid: user.uid,
          username: user.username,
          accessToken: user.accessToken,
          walletAddress: user.walletAddress,
          deviceInfo: {
            deviceId,
            platform: Platform.OS,
            isInPiBrowser: this.isInPiBrowser,
          },
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data.error || 'Verification failed' };
      }

      // Update Supabase session if token provided
      if (data.supabaseToken) {
        await supabase.auth.setSession({
          access_token: data.supabaseToken,
          refresh_token: data.refreshToken || '',
        });
        // Wait until session is persisted
        const start = Date.now();
        while (Date.now() - start < 2000) {
          try {
            const { data: sessionData } = await supabase.auth.getSession();
            if (sessionData?.session?.access_token) break;
          } catch (_) {}
          await new Promise((r) => setTimeout(r, 150));
        }
      }

      return {
        success: true,
        isNewUser: data.isNewUser,
      };
    } catch (error: any) {
      debugError('[PiSDK] Server verification error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Verify token is still valid
   */
  private async verifyToken(token: string): Promise<boolean> {
    try {
      // Prefer a provided token, but fallback to Supabase session token and app storage if needed
      let bearer = token;
      if (!bearer) {
        // If using Supabase session (cookie or local storage), use that token.
        const session = await supabase.auth.getSession();
        bearer = session?.data?.session?.access_token || '';
      }
      if (!bearer) {
        bearer = window.localStorage.getItem(STORAGE_KEYS.PI_TOKEN) || '';
      }
      if (!bearer) {
        return false;
      }

      const response = await fetch(`${API_URL}/api/auth/verify-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bearer}`,
        },
      });
      return response.ok;
    } catch (err) {
      debugError('[PiSDK] verifyToken error', err);
      return false;
    }
  }

  /**
   * Logout user
   */
  async logout(): Promise<boolean> {
    debugLog('[PiSDK] Logout start');
    try {
      // Clear persisted user/session storage depending on platform
      if (Platform.OS === 'web') {
        try {
          window.localStorage.removeItem(STORAGE_KEYS.PI_USER);
          window.localStorage.removeItem(STORAGE_KEYS.PI_TOKEN);
          window.localStorage.removeItem(STORAGE_KEYS.APP_SESSION);
        } catch (e) {
          // ignore
        }
      } else {
        try { await SecureStore.deleteItemAsync(STORAGE_KEYS.PI_USER); } catch (_) {}
        try { await SecureStore.deleteItemAsync(STORAGE_KEYS.PI_TOKEN); } catch (_) {}
        try { await SecureStore.deleteItemAsync(STORAGE_KEYS.APP_SESSION); } catch (_) {}
      }

      // Sign out from Supabase (best-effort)
      const { error } = await supabase.auth.signOut();
      if (error) {
        debugError('[PiSDK] Supabase signOut error', error);
      }
      this.currentUser = null;
      debugLog('[PiSDK] Logout complete');
      return true;
    } catch (err: any) {
      debugError('[PiSDK] Logout failed', err);
      // Best-effort clear
      try { await SecureStore.deleteItemAsync(STORAGE_KEYS.PI_USER); } catch (_) {}
      try { await SecureStore.deleteItemAsync(STORAGE_KEYS.PI_TOKEN); } catch (_) {}
      try { await SecureStore.deleteItemAsync(STORAGE_KEYS.APP_SESSION); } catch (_) {}
      this.currentUser = null;
      return false;
    }
  }

  // ============================================
  // PAYMENTS
  // ============================================

  /**
   * Create escrow deposit payment
   */
  async createEscrowDeposit(params: {
    escrowId: string;
    amount: number;
    recipientUsername: string;
    note?: string;
  }): Promise<PaymentResult> {
    try {
      debugLog('[PiSDK] Create escrow deposit start', {
        escrowId: params.escrowId,
        amount: params.amount,
        hasSdk: !!this.sdk,
        hasUser: !!this.currentUser,
      });

      if (!this.sdk) {
        return { success: false, error: 'Pi SDK not initialized' };
      }

      if (!this.currentUser) {
        return { success: false, error: 'Not authenticated' };
      }

      const memo = `PMARTS Escrow to @${params.recipientUsername}: ${params.note || 'Payment'}`;

      const payment = await this.sdk.createPayment(
        {
          amount: params.amount,
          memo: memo.substring(0, 140), // Pi memo limit
          metadata: {
            type: 'escrow_deposit',
            escrow_id: params.escrowId,
            app: 'PMARTS',
          },
        },
        {
          // Server-side callbacks
          onReadyForServerApproval: async (paymentId: string) => {
            await this.approvePayment(paymentId, params.escrowId);
          },
          onReadyForServerCompletion: async (paymentId: string, txid: string) => {
            await this.completePayment(paymentId, txid, params.escrowId);
          },
          onCancel: (paymentId: string) => {
            debugLog('[PiSDK] Payment cancelled:', paymentId);
            this.cancelPayment(paymentId, params.escrowId);
          },
          onError: (error: Error, payment?: any) => {
            debugError('[PiSDK] Payment error:', { error, payment });
          },
        }
      );

      return {
        success: true,
        paymentId: payment.identifier,
        txid: payment.transaction?.txid,
      };
    } catch (error: any) {
      debugError('[PiSDK] Payment error', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Approve payment on server
   */
  private async approvePayment(paymentId: string, escrowId: string): Promise<void> {
    try {
      debugLog('[PiSDK] Approve payment', { paymentId, escrowId });
      const response = await fetch(`${API_URL}/api/payments/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.currentUser?.accessToken}`,
        },
        body: JSON.stringify({
          paymentId,
          escrowId,
        }),
      });

      debugLog('[PiSDK] Approve response', { ok: response.ok, status: response.status });

      if (!response.ok) {
        throw new Error('Payment approval failed');
      }
    } catch (error) {
      debugError('[PiSDK] Approve payment error', error);
      throw error;
    }
  }

  /**
   * Complete payment on server
   */
  private async completePayment(paymentId: string, txid: string, escrowId: string): Promise<void> {
    try {
      debugLog('[PiSDK] Complete payment', { paymentId, txid, escrowId });
      const response = await fetch(`${API_URL}/api/payments/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.currentUser?.accessToken}`,
        },
        body: JSON.stringify({
          paymentId,
          txid,
          escrowId,
        }),
      });

      debugLog('[PiSDK] Complete response', { ok: response.ok, status: response.status });

      if (!response.ok) {
        throw new Error('Payment completion failed');
      }

      // Record deposit in escrow
      const depositResponse = await fetch(`${API_URL}/api/escrow/v2/deposit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.currentUser?.accessToken}`,
        },
        body: JSON.stringify({
          escrowId,
          paymentId,
          txid,
        }),
      });

      debugLog('[PiSDK] Deposit record response', {
        ok: depositResponse.ok,
        status: depositResponse.status,
      });
    } catch (error) {
      debugError('[PiSDK] Complete payment error', error);
      throw error;
    }
  }

  /**
   * Cancel payment
   */
  private async cancelPayment(paymentId: string, escrowId: string): Promise<void> {
    try {
      await fetch(`${API_URL}/api/payments/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.currentUser?.accessToken}`,
        },
        body: JSON.stringify({
          paymentId,
          escrowId,
        }),
      });
    } catch (error) {
      debugError('[PiSDK] Cancel payment error:', error);
    }
  }

  /**
   * Handle incomplete payment from previous session
   */
  private async handleIncompletePayment(payment: PiPaymentData): Promise<void> {
    try {
      debugLog('[PiSDK] Handling incomplete payment:', payment.identifier);

      if (payment.status.developer_approved && payment.transaction?.txid) {
        // Complete the payment
        await this.completePayment(
          payment.identifier,
          payment.transaction.txid,
          payment.metadata?.escrowId as string
        );
      } else if (!payment.status.developer_approved) {
        // Approve and wait for transaction
        await this.approvePayment(payment.identifier, payment.metadata?.escrowId as string);
      }
    } catch (error) {
      debugError('[PiSDK] Handle incomplete payment error:', error);
    }
  }

  // ============================================
  // WALLET
  // ============================================

  /**
   * Get user's wallet address (for receiving payouts)
   */
  async getWalletAddress(): Promise<string | null> {
    return this.currentUser?.walletAddress || null;
  }

  /**
   * Request app-to-user payout
   * Note: This requires Pi Network A2U approval
   */
  async requestPayout(amount: number, escrowId: string): Promise<PaymentResult> {
    try {
      const response = await fetch(`${API_URL}/api/payments/payout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.currentUser?.accessToken}`,
        },
        body: JSON.stringify({
          userId: this.currentUser?.uid,
          amount,
          escrowId,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data.error };
      }

      return {
        success: true,
        paymentId: data.paymentId,
        txid: data.txid,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  // ============================================
  // STORAGE HELPERS
  // ============================================

  private async getCachedUser(): Promise<PiUser | null> {
    try {
      if (Platform.OS === 'web') {
        const raw = window.localStorage.getItem(STORAGE_KEYS.PI_USER);
        return raw ? JSON.parse(raw) : null;
      }
      const userJson = await SecureStore.getItemAsync(STORAGE_KEYS.PI_USER);
      return userJson ? JSON.parse(userJson) : null;
    } catch {
      return null;
    }
  }

  private async cacheUser(user: PiUser): Promise<void> {
    try {
      if (Platform.OS === 'web') {
        window.localStorage.setItem(STORAGE_KEYS.PI_USER, JSON.stringify(user));
        window.localStorage.setItem(STORAGE_KEYS.PI_TOKEN, user.accessToken);
        window.localStorage.setItem(STORAGE_KEYS.APP_SESSION, '1');
      } else {
        await SecureStore.setItemAsync(STORAGE_KEYS.PI_USER, JSON.stringify(user));
        await SecureStore.setItemAsync(STORAGE_KEYS.PI_TOKEN, user.accessToken);
        await SecureStore.setItemAsync(STORAGE_KEYS.APP_SESSION, '1');
      }
    } catch (error) {
      debugError('[PiSDK] Cache user error:', error);
    }
  }

  /**
   * Create a developer session (for debug/testing) by caching the provided user
   */
  async createDevSession(user: PiUser): Promise<void> {
    try {
      await this.cacheUser(user);
    } catch (e) {
      debugError('[PiSDK] createDevSession error', e);
    }
  }

  async isAppSessionPresent(): Promise<boolean> {
    try {
      if (Platform.OS === 'web') {
        return !!window.localStorage.getItem(STORAGE_KEYS.APP_SESSION);
      }
      const v = await SecureStore.getItemAsync(STORAGE_KEYS.APP_SESSION);
      return !!v;
    } catch (e) {
      return false;
    }
  }

  private async getDeviceId(): Promise<string> {
    try {
      let deviceId = await SecureStore.getItemAsync(STORAGE_KEYS.DEVICE_ID);
      if (!deviceId) {
        deviceId = `${Platform.OS}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        await SecureStore.setItemAsync(STORAGE_KEYS.DEVICE_ID, deviceId);
      }
      return deviceId;
    } catch {
      return 'unknown';
    }
  }

  // ============================================
  // GETTERS
  // ============================================

  isReady(): boolean {
    return this.isInitialized;
  }

  isRunningInPiBrowser(): boolean {
    return this.isInPiBrowser;
  }

  getCurrentUser(): PiUser | null {
    return this.currentUser;
  }

  isAuthenticated(): boolean {
    return this.currentUser !== null;
  }
}

// Export singleton instance
export const piSDK = PiSDKService.getInstance();
export default piSDK;

