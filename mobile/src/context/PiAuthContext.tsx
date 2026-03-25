/**
 * PMARTS Pi Authentication Context
 *
 * Provides Pi authentication state throughout the app with:
 * - Auto-login detection in Pi Browser
 * - Secure session management
 * - User state persistence
 *
 * @module PiAuthContext
 */

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import piSDK, { PiUser, AuthResult } from '../services/PiSDKService';
import { supabase } from '../lib/supabase';
import { clearAppSession } from '../lib/appSession';
import NavigationService from '../navigation/NavigationService';
import { debugLog, debugError } from '../lib/debugLogger';

// ============================================
// TYPES
// ============================================

interface PiAuthState {
  user: PiUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isInPiBrowser: boolean;
  error: string | null;
}

interface PiAuthContextValue extends PiAuthState {
  login: () => Promise<AuthResult>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

// ============================================
// CONTEXT
// ============================================

const PiAuthContext = createContext<PiAuthContextValue | null>(null);

// ============================================
// PROVIDER
// ============================================

interface PiAuthProviderProps {
  children: ReactNode;
  onAuthChange?: (user: PiUser | null) => void;
}

export function PiAuthProvider({ children, onAuthChange }: PiAuthProviderProps) {
  const [state, setState] = useState<PiAuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
    isInPiBrowser: false,
    error: null,
  });

  // ============================================
  // INITIALIZATION
  // ============================================

  useEffect(() => {
    initializeAuth();
  }, []);

  const initializeAuth = async () => {
    try {
      setState(prev => ({ ...prev, isLoading: true, error: null }));

      // Initialize Pi SDK
      const sdkReady = await piSDK.initialize({
        version: '2.0',
        sandbox: __DEV__, // Use sandbox in development
        onReady: () => debugLog('[PiAuth] SDK ready'),
        onError: (error) => debugError('[PiAuth] SDK error:', error),
      });

      if (!sdkReady) {
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: 'Failed to initialize Pi SDK',
        }));
        return;
      }


      // Check Pi Browser
      const isInPiBrowser = piSDK.isRunningInPiBrowser();

      // Determine if an app session exists (we must avoid auto-login in Pi Browser)
      let currentUser = piSDK.getCurrentUser();
      try {
        if (isInPiBrowser) {
          const hasAppSession = await piSDK.isAppSessionPresent();
          if (!hasAppSession) {
            debugLog('[PiAuth] In Pi Browser but no app session - not auto-authenticating');
            currentUser = null;
          }
        }
      } catch (e) {
        // ignore and fall back to currentUser
      }

      setState({
        user: currentUser,
        isAuthenticated: !!currentUser,
        isLoading: false,
        isInPiBrowser,
        error: null,
      });

      // Notify parent of auth state
      onAuthChange?.(currentUser);
    } catch (error: any) {
      debugError('[PiAuth] Init error:', error);
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error.message,
      }));
    }
  };

  // ============================================
  // LOGIN
  // ============================================

  const login = useCallback(async (): Promise<AuthResult> => {
    try {
      setState(prev => ({ ...prev, isLoading: true, error: null }));

      const result = await piSDK.authenticate();

      if (result.success && result.user) {
        setState({
          user: result.user,
          isAuthenticated: true,
          isLoading: false,
          isInPiBrowser: piSDK.isRunningInPiBrowser(),
          error: null,
        });

        onAuthChange?.(result.user);
      } else {
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: result.error || 'Authentication failed',
        }));
      }

      return result;
    } catch (error: any) {
      const errorMsg = error.message || 'Authentication error';
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: errorMsg,
      }));
      return { success: false, error: errorMsg };
    }
  }, [onAuthChange]);

  // ============================================
  // LOGOUT
  // ============================================

  const logout = useCallback(async () => {
    try {
      debugLog('[PiAuth] Logout invoked');

      // Log supabase session before logout
      try {
        const currentSess = await supabase.auth.getSession().catch(() => null);
        debugLog('[PiAuth] supabase session before logout', { hasSession: !!currentSess?.data?.session });
      } catch (e) {
        debugError('[PiAuth] failed reading supabase session before logout', e);
      }

      const result = await piSDK.logout();
      debugLog('[PiAuth] piSDK.logout result', { success: !!result });

      // Ensure supabase session cleared as a fallback
      try {
        await supabase.auth.signOut();
      } catch (e) {
        debugError('[PiAuth] supabase.signOut fallback error:', e);
      }

      try {
        await clearAppSession();
      } catch (e) {
        debugError('[PiAuth] clearAppSession fallback error:', e);
      }

      setState({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        isInPiBrowser: piSDK.isRunningInPiBrowser(),
        error: result ? null : 'Logout encountered an error',
      });

      // Ensure navigation resets to login screen after logout
      try {
        NavigationService.resetToLogin();
        debugLog('[PiAuth] resetToLogin dispatched');
      } catch (e) {
        debugError('[PiAuth] resetToLogin failed', e);
      }

      try {
        NavigationService.replaceToLogin();
        debugLog('[PiAuth] replaceToLogin dispatched');
      } catch (e) {
        debugError('[PiAuth] replaceToLogin failed', e);
      }

      try {
        NavigationService.navigationRef.current?.navigate?.('Login');
        debugLog('[PiAuth] navigation.navigate(Login) called');
      } catch (e) {
        debugError('[PiAuth] navigation.navigate fallback failed', e);
      }

      onAuthChange?.(null);
    } catch (error: any) {
      debugError('[PiAuth] Logout error:', error);
    }
  }, [onAuthChange]);

  // ============================================
  // REFRESH USER
  // ============================================

  const refreshUser = useCallback(async () => {
    const currentUser = piSDK.getCurrentUser();
    if (currentUser !== state.user) {
      setState(prev => ({
        ...prev,
        user: currentUser,
        isAuthenticated: !!currentUser,
      }));
      onAuthChange?.(currentUser);
    }
  }, [state.user, onAuthChange]);

  // ============================================
  // CONTEXT VALUE
  // ============================================

  const contextValue: PiAuthContextValue = {
    ...state,
    login,
    logout,
    refreshUser,
  };

  return (
    <PiAuthContext.Provider value={contextValue}>
      {children}
    </PiAuthContext.Provider>
  );
}

// ============================================
// HOOK
// ============================================

export function usePiAuth(): PiAuthContextValue {
  const context = useContext(PiAuthContext);
  if (!context) {
    throw new Error('usePiAuth must be used within a PiAuthProvider');
  }
  return context;
}

// ============================================
// HOC FOR PROTECTED ROUTES
// ============================================

interface WithPiAuthProps {
  piAuth: PiAuthContextValue;
}

export function withPiAuth<P extends WithPiAuthProps>(
  WrappedComponent: React.ComponentType<P>
): React.FC<Omit<P, keyof WithPiAuthProps>> {
  return function WithPiAuthComponent(props: Omit<P, keyof WithPiAuthProps>) {
    const piAuth = usePiAuth();
    return <WrappedComponent {...(props as P)} piAuth={piAuth} />;
  };
}

export default PiAuthContext;
