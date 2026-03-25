/**
 * PMARTS Pi SDK Service
 * Complete Pi Network integration for authentication and payments
 * 
 * Features:
 * - Automatic Pi Browser detection
 * - Seamless "Continue with Pi" authentication
 * - Secure escrow payment processing
 * - Backend verification for all payments
 * - Transaction tracking and verification
 * 
 * @see https://developers.minepi.com/
 */

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from './supabase';
import dlog, { derror } from './dlog';

// API URL - uses environment variable or defaults
const API_BASE_URL = Constants.expoConfig?.extra?.apiUrl || 
  process.env.EXPO_PUBLIC_API_URL || 
  'http://localhost:4000';

// ============================================
// TYPES
// ============================================

export interface PiUser {
  uid: string;
  username: string;
  accessToken?: string;
  walletAddress?: string;
}

export interface PiAuthResult {
  user: PiUser;
  accessToken: string;
}

export interface PiPaymentDTO {
  identifier: string;
  user_uid: string;
  amount: number;
  memo: string;
  metadata: Record<string, any>;
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
  transaction: {
    txid: string;
    verified: boolean;
    _link: string;
  } | null;
}

export interface PaymentCallbacks {
  onReadyForServerApproval: (paymentId: string) => Promise<void>;
  onReadyForServerCompletion: (paymentId: string, txid: string) => Promise<void>;
  onCancel: (paymentId: string) => void;
  onError: (error: Error, payment?: PiPaymentDTO) => void;
}

export interface EscrowPaymentParams {
  amount: number;
  escrowId: string;
  recipientId: string;
  senderId: string;
  referenceId: string;
  description?: string;
}

export type PaymentStatus = 
  | 'pending'
  | 'approved'
  | 'completed'
  | 'cancelled'
  | 'failed';

// ============================================
// PI BROWSER DETECTION
// ============================================

/**
 * Check if the app is running inside Pi Browser
 * Pi Browser injects the Pi SDK into the window object
 */
export function isInPiBrowser(): boolean {
  if (Platform.OS !== 'web') {
    return false;
  }
  
  if (typeof window === 'undefined') {
    return false;
  }
  
  // Check for Pi SDK
  const hasPiSDK = !!(window as any).Pi;
  
  // Check user agent for Pi Browser
  const userAgent = navigator?.userAgent?.toLowerCase() || '';
  const isPiBrowserUA = userAgent.includes('pibrowser') || userAgent.includes('pi browser');
  
  return hasPiSDK || isPiBrowserUA;
}

/**
 * Get the Pi SDK instance from the browser window
 */
function getPiSDK(): any {
  if (typeof window !== 'undefined' && (window as any).Pi) {
    return (window as any).Pi;
  }
  return null;
}

function getPiNetwork(): 'testnet' | 'mainnet' {
  if (typeof window !== 'undefined') {
    const host = (window.location?.hostname || '').toLowerCase();
    const href = (window.location?.href || '').toLowerCase();
    const referrer = (document?.referrer || '').toLowerCase();
    if (
      host.includes('sandbox.minepi.com') ||
      href.includes('sandbox.minepi.com') ||
      referrer.includes('sandbox.minepi.com')
    ) {
      return 'testnet';
    }
  }
  return __DEV__ ? 'testnet' : 'mainnet';
}

function isPiSandbox(): boolean {
  return getPiNetwork() === 'testnet';
}

// ============================================
// PI SDK SERVICE CLASS
// ============================================

class PiSDKService {
  private initialized = false;
  private sdk: any = null;
  private currentUser: PiUser | null = null;
  private pendingPayments: Map<string, EscrowPaymentParams> = new Map();

  // ============================================
  // INITIALIZATION
  // ============================================

  /**
   * Initialize the Pi SDK
   * Must be called before any authentication or payment operations
   */
  async initialize(): Promise<boolean> {
    if (this.initialized && this.sdk) {
      return true;
    }

    try {
      this.sdk = getPiSDK();
      
      if (!this.sdk) {
        dlog('[PiSDK] Not running in Pi Browser');
        return false;
      }

      // Initialize with configuration
      await this.sdk.init({
        version: '2.0',
        sandbox: isPiSandbox(),
      });

      this.initialized = true;
      dlog('[PiSDK] Initialized successfully');
      return true;
    } catch (error) {
      derror('[PiSDK] Initialization failed:', error);
      return false;
    }
  }

  /**
   * Check if SDK is ready
   */
  isReady(): boolean {
    return this.initialized && !!this.sdk;
  }

  /**
   * Get current authenticated user
   */
  getCurrentUser(): PiUser | null {
    return this.currentUser;
  }

  // ============================================
  // AUTHENTICATION
  // ============================================

  /**
   * Authenticate user with Pi Network
   * Shows the official Pi Network login popup in Pi Browser
   * 
   * @returns PiAuthResult with user info and access token, or null if cancelled
   */
  async authenticate(): Promise<PiAuthResult | null> {
    if (!this.isReady()) {
      const initialized = await this.initialize();
      if (!initialized) {
        throw new Error('Pi SDK not available. Please open in Pi Browser.');
      }
    }

    try {
      // Request authentication with required scopes
      const scopes = ['username', 'payments', 'wallet_address'];
      
      const authResult = await this.sdk.authenticate(
        scopes,
        this.handleIncompletePayment.bind(this)
      );

      if (!authResult || !authResult.user) {
        dlog('[PiSDK] Authentication cancelled');
        return null;
      }

      // Store user info
      this.currentUser = {
        uid: authResult.user.uid,
        username: authResult.user.username,
        accessToken: authResult.accessToken,
      };

      dlog('[PiSDK] Authenticated:', this.currentUser.username);

      // Sync user to our database
      await this.syncUserToDatabase(this.currentUser, authResult.accessToken);

      return {
        user: this.currentUser,
        accessToken: authResult.accessToken,
      };
    } catch (error) {
      derror('[PiSDK] Authentication failed:', error);
      throw error;
    }
  }

  /**
   * Sync Pi user to Supabase database
   */
  private async syncUserToDatabase(user: PiUser, accessToken: string): Promise<void> {
    // Route through backend API (service-role key) to bypass RLS on the users table.
    try {
      const response = await fetch(`${API_BASE_URL}/api/user/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessToken,
          username: user.username,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        derror('[PiSDK] Failed to sync user:', body?.error || response.status);
      }
    } catch (err) {
      derror('[PiSDK] Database sync error:', err);
    }
  }

  /**
   * Sign out current user
   */
  signOut(): void {
    this.currentUser = null;
    dlog('[PiSDK] User signed out');
  }

  // ============================================
  // PAYMENTS
  // ============================================

  /**
   * Create an escrow deposit payment
   * User pays Pi that is held in PMARTS escrow
   * 
   * @param params Payment parameters
   * @returns Payment identifier or null if cancelled
   */
  async createEscrowDeposit(
    params: EscrowPaymentParams
  ): Promise<{ success: boolean; paymentId?: string; txid?: string; error?: string }> {
    if (!this.isReady()) {
      return { success: false, error: 'Pi SDK not initialized' };
    }

    // Pi SDK requires authenticate() with 'payments' scope BEFORE createPayment().
    // Even if the SDK was initialized, a prior session may lack the payments scope.
    if (!this.currentUser) {
      try {
        const authResult = await this.authenticate();
        if (!authResult) {
          return { success: false, error: 'Please sign in with Pi Network to proceed.' };
        }
      } catch (authError: any) {
        return {
          success: false,
          error: `Pi Network sign-in required: ${authError.message}`,
        };
      }
    }

    return new Promise((resolve) => {
      try {
        // Store payment params for later reference
        const tempId = `temp_${Date.now()}`;
        this.pendingPayments.set(tempId, params);

        this.sdk.createPayment(
          {
            amount: params.amount,
            memo: `PMARTS Escrow: ${params.referenceId}`,
            metadata: {
              type: 'escrow_deposit',
              escrow_id: params.escrowId,
              sender_id: params.senderId,
              recipient_id: params.recipientId,
              reference_id: params.referenceId,
              description: params.description,
            },
          },
          {
            // User approved the payment
            onReadyForServerApproval: async (paymentId: string) => {
              dlog('[PiSDK] Payment ready for approval:', paymentId);
              
              // Move to real payment ID
              this.pendingPayments.set(paymentId, params);
              this.pendingPayments.delete(tempId);

              // Approve the payment on server side
              await this.approvePayment(paymentId);
            },

            // Payment verified on blockchain
            onReadyForServerCompletion: async (paymentId: string, txid: string) => {
              dlog('[PiSDK] Payment verified:', paymentId, txid);
              
              // Complete the payment and update escrow
              await this.completePayment(paymentId, txid);
              
              this.pendingPayments.delete(paymentId);
              resolve({ success: true, paymentId, txid });
            },

            // User cancelled
            onCancel: (paymentId: string) => {
              dlog('[PiSDK] Payment cancelled:', paymentId);
              this.pendingPayments.delete(paymentId);
              this.pendingPayments.delete(tempId);
              resolve({ success: false, error: 'Payment cancelled by user' });
            },

            // Error occurred
            onError: (error: Error, payment?: PiPaymentDTO) => {
              derror('[PiSDK] Payment error:', error);
              this.pendingPayments.delete(tempId);
              if (payment?.identifier) {
                this.pendingPayments.delete(payment.identifier);
              }
              resolve({ success: false, error: error.message });
            },
          }
        );
      } catch (error: any) {
        this.pendingPayments.delete(`temp_${Date.now()}`);
        const errorMsg: string = error?.message || 'Payment failed';
        // Provide an actionable message for the most common scope error
        if (errorMsg.toLowerCase().includes('scope') || errorMsg.toLowerCase().includes('payments scope')) {
          resolve({
            success: false,
            error: 'Payment permissions not granted. Please sign out and sign back in through Pi Browser.',
          });
        } else {
          resolve({ success: false, error: errorMsg });
        }
      }
    });
  }

  /**
   * Handle incomplete payments from previous sessions
   * Pi SDK calls this during authentication
   */
  private async handleIncompletePayment(payment: PiPaymentDTO): Promise<void> {
    dlog('[PiSDK] Found incomplete payment:', payment.identifier);

    try {
      const { status, identifier, transaction } = payment;

      if (status.cancelled || status.user_cancelled) {
        // Payment was cancelled
        await this.cancelPayment(identifier, 'User cancelled');
      } else if (status.transaction_verified && !status.developer_completed) {
        // Payment is verified but not completed - complete it now
        if (transaction?.txid) {
          await this.completePayment(identifier, transaction.txid);
        }
      } else if (status.developer_approved && !status.transaction_verified) {
        // Payment approved but not yet on blockchain - wait
          dlog('[PiSDK] Payment pending blockchain confirmation:', identifier);
      }
    } catch (error) {
      derror('[PiSDK] Error handling incomplete payment:', error);
    }
  }

  /**
   * Record pending payment in database
   */
  private async recordPendingPayment(
    paymentId: string,
    params: EscrowPaymentParams
  ): Promise<void> {
    try {
      await supabase.from('pi_transactions').insert({
        pi_payment_id: paymentId,
        escrow_id: params.escrowId,
        sender_id: params.senderId,
        amount: params.amount,
        status: 'pending',
        transaction_type: 'deposit',
        created_at: new Date().toISOString(),
      });

      // Update escrow status to deposit_pending
      await supabase
        .from('escrows')
        .update({ status: 'deposit_pending' })
        .eq('id', params.escrowId);

    } catch (error) {
      derror('[PiSDK] Failed to record payment:', error);
    }
  }

  /**
   * Approve payment via backend API
   * Backend calls Pi Network's /payments/{payment_id}/approve
   */
  private async approvePayment(paymentId: string): Promise<void> {
    try {
      // Get escrow ID from pending payments
      const params = this.pendingPayments.get(paymentId);
      
      // Call backend API to approve payment with Pi Network
      const response = await fetch(`${API_BASE_URL}/api/payments/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          paymentId,
          escrowId: params?.escrowId,
          network: getPiNetwork(),
        }),
      });

      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to approve payment');
      }

      dlog('[PiSDK] Payment approved via backend:', paymentId);
    } catch (error) {
      derror('[PiSDK] Failed to approve payment:', error);
      // Don't throw - let Pi SDK continue the flow
    }
  }

  /**
   * Complete payment via backend API
   * Backend calls Pi Network's /payments/{payment_id}/complete
   * This also updates escrow status and creates notifications
   */
  private async completePayment(paymentId: string, txid: string): Promise<void> {
    try {
      // Get escrow ID from pending payments
      const params = this.pendingPayments.get(paymentId);

      // Call backend API to complete payment with Pi Network
      const response = await fetch(`${API_BASE_URL}/api/payments/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          paymentId,
          txid,
          escrowId: params?.escrowId,
          network: getPiNetwork(),
        }),
      });

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || 'Failed to complete payment');
      }

      dlog('[PiSDK] Payment completed via backend:', paymentId, txid);
    } catch (error) {
      derror('[PiSDK] Failed to complete payment:', error);
      throw error;
    }
  }

  /**
   * Cancel a payment via backend API
   */
  private async cancelPayment(paymentId: string, reason: string): Promise<void> {
    try {
      // Get escrow ID from pending payments
      const params = this.pendingPayments.get(paymentId);

      // Call backend API to cancel payment
      const response = await fetch(`${API_BASE_URL}/api/payments/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          paymentId,
          escrowId: params?.escrowId,
        }),
      });

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || 'Failed to cancel payment');
      }

      // Also update local database
      await supabase
        .from('pi_transactions')
        .update({
          status: 'cancelled',
          error_message: reason,
        })
        .eq('pi_payment_id', paymentId);

      // Get escrow and revert status
      const { data: txRecord } = await supabase
        .from('pi_transactions')
        .select('escrow_id')
        .eq('pi_payment_id', paymentId)
        .single();

      if (txRecord?.escrow_id) {
        await supabase
          .from('escrows')
          .update({ status: 'created' })
          .eq('id', txRecord.escrow_id);
      }

      dlog('[PiSDK] Payment cancelled:', paymentId);
    } catch (error) {
      derror('[PiSDK] Failed to cancel payment:', error);
    }
  }

  /**
   * Get payment amount from database
   */
  private async getPaymentAmount(paymentId: string): Promise<number | null> {
    const { data } = await supabase
      .from('pi_transactions')
      .select('amount')
      .eq('pi_payment_id', paymentId)
      .single();
    
    return data?.amount || null;
  }

  // ============================================
  // PAYMENT QUERIES
  // ============================================

  /**
   * Get payment status
   */
  async getPaymentStatus(paymentId: string): Promise<PaymentStatus | null> {
    const { data } = await supabase
      .from('pi_transactions')
      .select('status')
      .eq('pi_payment_id', paymentId)
      .single();

    return data?.status || null;
  }

  /**
   * Get transaction by ID
   */
  async getTransaction(paymentId: string): Promise<any> {
    const { data } = await supabase
      .from('pi_transactions')
      .select('*')
      .eq('pi_payment_id', paymentId)
      .single();

    return data;
  }
}

// ============================================
// SINGLETON EXPORT
// ============================================

export const piSDKService = new PiSDKService();

// Export convenience functions
export const initializePiSDK = () => piSDKService.initialize();
export const authenticateWithPi = () => piSDKService.authenticate();
export const createPiPayment = (params: EscrowPaymentParams) => 
  piSDKService.createEscrowDeposit(params);

