/**
 * Pi SDK Context Provider
 * Provides Pi Network authentication and payment functionality
 * throughout the app via React Context
 */

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { Platform } from 'react-native';
import { supabase } from './supabase';
import dlog, { dwarn, derror } from './dlog';

// ============================================
// Types
// ============================================

export interface PiUser {
  uid: string;
  username: string;
  accessToken?: string;
}

export interface PiPaymentData {
  amount: number;
  memo: string;
  metadata?: Record<string, any>;
}

export interface PiPaymentResult {
  identifier: string;
  user_uid: string;
  amount: number;
  memo: string;
  metadata: Record<string, any>;
  from_address: string;
  to_address: string;
  direction: 'user_to_app' | 'app_to_user';
  status: {
    developer_approved: boolean;
    transaction_verified: boolean;
    developer_completed: boolean;
    cancelled: boolean;
    user_cancelled: boolean;
  };
  transaction: {
    txid: string;
    verified: boolean;
    _link: string;
  } | null;
}

export interface PiContextType {
  // State
  isInitialized: boolean;
  isAuthenticated: boolean;
  user: PiUser | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  initialize: () => Promise<boolean>;
  authenticate: () => Promise<PiUser | null>;
  signOut: () => Promise<void>;
  createPayment: (data: PiPaymentData) => Promise<string | null>;
  
  // App-specific
  createEscrowDeposit: (params: {
    escrowId: string;
    amount: number;
    recipientId: string;
    description?: string;
  }) => Promise<{ success: boolean; paymentId?: string; error?: string }>;
}

// ============================================
// Context
// ============================================

const PiContext = createContext<PiContextType | undefined>(undefined);

// Global Pi SDK reference
let piSDK: any = null;

// ============================================
// Provider Component
// ============================================

interface PiProviderProps {
  children: ReactNode;
}

export function PiProvider({ children }: PiProviderProps) {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<PiUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Handle incomplete payments from previous sessions
  const handleIncompletePayment = useCallback(async (payment: PiPaymentResult) => {
    dlog('[Pi SDK] Found incomplete payment:', payment.identifier);
    
    try {
      if (payment.status.cancelled || payment.status.user_cancelled) {
        // Payment was cancelled, update our records
        await fetch('/api/pi/cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payment_id: payment.identifier }),
        });
      } else if (payment.status.transaction_verified && !payment.status.developer_completed) {
        // Payment verified but not completed - complete it now
        await fetch('/api/pi/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            payment_id: payment.identifier,
            txid: payment.transaction?.txid,
          }),
        });
      }
    } catch (err) {
      derror('[Pi SDK] Error handling incomplete payment:', err);
    }
  }, []);

  // Initialize Pi SDK
  const initialize = useCallback(async (): Promise<boolean> => {
    try {
      setIsLoading(true);
      setError(null);

      // Check if running in Pi Browser (web context with Pi SDK)
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        // Wait for Pi SDK to be available
        if ((window as any).Pi) {
          piSDK = (window as any).Pi;
          
          await piSDK.init({ 
            version: '2.0',
            sandbox: process.env.NODE_ENV === 'development',
          });
          
          setIsInitialized(true);
          dlog('[Pi SDK] Initialized successfully');
          return true;
        } else {
          dwarn('[Pi SDK] Not running in Pi Browser');
          setError('Please open this app in Pi Browser');
          return false;
        }
      } else {
        // Running in native app - Pi SDK not available
        dlog('[Pi SDK] Running in native mode (Pi SDK not available)');
        setError('Pi SDK requires Pi Browser');
        return false;
      }
    } catch (err) {
      derror('[Pi SDK] Initialization failed:', err);
      setError('Failed to initialize Pi SDK');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Authenticate with Pi Network
  const authenticate = useCallback(async (): Promise<PiUser | null> => {
    if (!piSDK) {
      setError('Pi SDK not initialized');
      return null;
    }

    try {
      setIsLoading(true);
      setError(null);

      const scopes = ['username', 'payments', 'wallet_address'];
      const authResult = await piSDK.authenticate(scopes, handleIncompletePayment);

      if (authResult && authResult.user) {
        const piUser: PiUser = {
          uid: authResult.user.uid,
          username: authResult.user.username,
          accessToken: authResult.accessToken,
        };

        // Verify with our backend and create/update user in Supabase
        const { data: dbUser, error: dbError } = await supabase
          .from('users')
          .upsert({
            pi_uid: piUser.uid,
            username: piUser.username,
            last_active_at: new Date().toISOString(),
          }, {
            onConflict: 'pi_uid',
          })
          .select()
          .single();

        if (dbError) {
          derror('[Pi SDK] Failed to sync user:', dbError);
        }

        setUser(piUser);
        setIsAuthenticated(true);
        
        dlog('[Pi SDK] Authenticated:', piUser.username);
        return piUser;
      }

      return null;
    } catch (err) {
      derror('[Pi SDK] Authentication failed:', err);
      setError('Authentication failed. Please try again.');
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [handleIncompletePayment]);

  // Sign out
  const signOut = useCallback(async () => {
    setUser(null);
    setIsAuthenticated(false);
    // Note: Pi SDK doesn't have a sign out method - just clear local state
  }, []);

  // Create a generic payment
  const createPayment = useCallback(async (data: PiPaymentData): Promise<string | null> => {
    if (!piSDK) {
      setError('Pi SDK not initialized');
      return null;
    }

    try {
      return new Promise((resolve, reject) => {
        piSDK.createPayment(data, {
          onReadyForServerApproval: async (paymentId: string) => {
            dlog('[Pi SDK] Payment ready for approval:', paymentId);
            
            // Call backend to approve
            try {
              const response = await fetch('/api/pi/approve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ payment_id: paymentId }),
              });
              
              if (!response.ok) {
                throw new Error('Server approval failed');
              }
            } catch (err) {
              derror('[Pi SDK] Approval failed:', err);
              reject(err);
            }
          },
          
          onReadyForServerCompletion: async (paymentId: string, txid: string) => {
            dlog('[Pi SDK] Payment ready for completion:', paymentId, txid);
            
            try {
              const response = await fetch('/api/pi/complete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ payment_id: paymentId, txid }),
              });
              
              if (!response.ok) {
                throw new Error('Server completion failed');
              }
              
              resolve(paymentId);
            } catch (err) {
              derror('[Pi SDK] Completion failed:', err);
              reject(err);
            }
          },
          
          onCancel: (paymentId: string) => {
            dlog('[Pi SDK] Payment cancelled:', paymentId);
            resolve(null);
          },
          
          onError: (error: Error) => {
            derror('[Pi SDK] Payment error:', error);
            reject(error);
          },
        });
      });
    } catch (err) {
      derror('[Pi SDK] Create payment failed:', err);
      setError('Failed to create payment');
      return null;
    }
  }, []);

  // Create escrow deposit (PMARTS-specific)
  const createEscrowDeposit = useCallback(async (params: {
    escrowId: string;
    amount: number;
    recipientId: string;
    description?: string;
  }): Promise<{ success: boolean; paymentId?: string; error?: string }> => {
    if (!piSDK || !user) {
      return { success: false, error: 'Not authenticated' };
    }

    try {
      const paymentId = await createPayment({
        amount: params.amount,
        memo: `PMARTS Escrow: ${params.description || params.escrowId}`,
        metadata: {
          type: 'escrow_deposit',
          escrow_id: params.escrowId,
          sender_id: user.uid,
          recipient_id: params.recipientId,
        },
      });

      if (paymentId) {
        // Update escrow with payment info
        await supabase
          .from('escrows')
          .update({
            status: 'deposit_pending',
            updated_at: new Date().toISOString(),
          })
          .eq('id', params.escrowId);

        return { success: true, paymentId };
      }

      return { success: false, error: 'Payment was cancelled' };
    } catch (err) {
      derror('[Pi SDK] Escrow deposit failed:', err);
      return { success: false, error: (err as Error).message };
    }
  }, [createPayment, user]);

  // Auto-initialize on mount
  useEffect(() => {
    initialize();
  }, [initialize]);

  const value: PiContextType = {
    isInitialized,
    isAuthenticated,
    user,
    isLoading,
    error,
    initialize,
    authenticate,
    signOut,
    createPayment,
    createEscrowDeposit,
  };

  return <PiContext.Provider value={value}>{children}</PiContext.Provider>;
}

// ============================================
// Hook
// ============================================

export function usePi(): PiContextType {
  const context = useContext(PiContext);
  
  if (context === undefined) {
    throw new Error('usePi must be used within a PiProvider');
  }
  
  return context;
}

// ============================================
// Utility Functions
// ============================================

/**
 * Check if running in Pi Browser
 */
export function isInPiBrowser(): boolean {
  if (Platform.OS !== 'web') return false;
  if (typeof window === 'undefined') return false;
  return !!(window as any).Pi;
}

/**
 * Get the Pi SDK instance directly (use with caution)
 */
export function getPiSDK(): any {
  return piSDK;
}

