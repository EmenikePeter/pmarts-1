/**
 * Pi Network SDK Integration for PMARTS
 * 
 * This module handles all Pi Network payment interactions following
 * Pi SDK rules and guidelines:
 * 
 * ✅ Uses Pi SDK for all payments (user approves in Pi Browser)
 * ✅ Never requests wallet passphrase
 * ✅ All transactions verified on blockchain
 * ✅ Proper error handling and logging
 * 
 * @see https://developers.minepi.com/
 */

import { supabase } from './supabase';
import dlog, { dwarn, derror } from '../lib/dlog';

// Pi SDK types
export interface PiPaymentDTO {
  identifier: string;          // Unique payment identifier
  user_uid: string;            // Pi user UID
  amount: number;              // Amount in Pi
  memo: string;                // Payment memo/description
  metadata: Record<string, any>; // Custom metadata
  from_address: string;        // Sender wallet address
  to_address: string;          // Recipient wallet address
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

export interface PiPaymentData {
  amount: number;
  memo: string;
  metadata: {
    escrow_id?: string;
    reference_id: string;
    sender_id: string;
    recipient_id: string;
    type: 'escrow_deposit' | 'escrow_release' | 'escrow_refund';
  };
}

export interface PiPaymentCallbacks {
  onReadyForServerApproval: (paymentId: string) => void;
  onReadyForServerCompletion: (paymentId: string, txid: string) => void;
  onCancel: (paymentId: string) => void;
  onError: (error: Error, payment?: PiPaymentDTO) => void;
}

// PMARTS Escrow Wallet Address (set in environment)
export const PMARTS_ESCROW_WALLET = process.env.EXPO_PUBLIC_PMARTS_WALLET || 'PMARTS_ESCROW_MAIN';

/**
 * Pi SDK wrapper class for PMARTS
 * Handles all Pi Network payment interactions
 */
class PiSDKService {
  private isInitialized = false;
  private piSDK: any = null;

  /**
   * Initialize Pi SDK
   * Must be called in Pi Browser context
   */
  async initialize(): Promise<boolean> {
    try {
      // In Pi Browser, the Pi SDK is available globally
      if (typeof window !== 'undefined' && (window as any).Pi) {
        this.piSDK = (window as any).Pi;
        
        // Initialize with app credentials
        await this.piSDK.init({
          version: '2.0',
          sandbox: __DEV__, // Use testnet in development
        });
        
        this.isInitialized = true;
        dlog('Pi SDK initialized successfully');
        return true;
      } else {
        dwarn('Pi SDK not available. Running outside Pi Browser.');
        return false;
      }
    } catch (error) {
      derror('Failed to initialize Pi SDK:', error);
      return false;
    }
  }

  /**
   * Authenticate user with Pi Network
   * Returns Pi user data including uid and username
   */
  async authenticate(): Promise<{
    user: { uid: string; username: string };
    accessToken: string;
  } | null> {
    if (!this.piSDK) {
      derror('Pi SDK not initialized');
      return null;
    }

    try {
      const scopes = ['username', 'payments', 'wallet_address'];
      const authResult = await this.piSDK.authenticate(
        scopes,
        this.handleIncompletePayment.bind(this)
      );
      
      return authResult;
    } catch (error) {
      derror('Pi authentication failed:', error);
      return null;
    }
  }

  /**
   * Handle incomplete payments from previous sessions
   * Pi SDK requires this callback during authentication
   */
  private async handleIncompletePayment(payment: PiPaymentDTO): Promise<void> {
    dlog('Found incomplete payment:', payment.identifier);
    
    try {
      // Check if this payment exists in our database
      const { data: piTx } = await supabase
        .from('pi_transactions')
        .select('*')
        .eq('pi_payment_id', payment.identifier)
        .single();

      if (piTx) {
        // Update status based on Pi SDK payment status
        if (payment.status.cancelled || payment.status.user_cancelled) {
          await this.cancelPayment(payment.identifier, 'User cancelled');
        } else if (payment.status.transaction_verified && !payment.status.developer_completed) {
          // Transaction verified but not completed - complete it now
          await this.completePayment(
            payment.identifier,
            payment.transaction?.txid || ''
          );
        }
      }
    } catch (error) {
      derror('Error handling incomplete payment:', error);
    }
  }

  /**
   * Create escrow deposit payment (User → PMARTS Wallet)
   * User approves this in Pi Browser
   */
  async createEscrowDeposit(
    paymentData: {
      amount: number;
      reference_id: string;
      recipient_id: string;
      sender_id: string;
      note?: string;
    },
    callbacks: PiPaymentCallbacks
  ): Promise<string | null> {
    if (!this.piSDK) {
      callbacks.onError(new Error('Pi SDK not initialized'));
      return null;
    }

    try {
      const payment = await this.piSDK.createPayment({
        amount: paymentData.amount,
        memo: `PMARTS Escrow: ${paymentData.reference_id}`,
        metadata: {
          type: 'escrow_deposit',
          reference_id: paymentData.reference_id,
          sender_id: paymentData.sender_id,
          recipient_id: paymentData.recipient_id,
          note: paymentData.note,
        },
      }, {
        // Called when user has approved payment in Pi Browser
        onReadyForServerApproval: async (paymentId: string) => {
          dlog('Payment ready for approval:', paymentId);
          
          // Record the pending transaction
          await this.recordPendingDeposit(paymentId, paymentData);
          
          // Server approves the payment
          await this.approvePayment(paymentId);
          
          callbacks.onReadyForServerApproval(paymentId);
        },
        
        // Called when payment is verified on blockchain
        onReadyForServerCompletion: async (paymentId: string, txid: string) => {
          dlog('Payment ready for completion:', paymentId, txid);
          
          // Verify and complete the payment
          await this.completePayment(paymentId, txid);
          
          callbacks.onReadyForServerCompletion(paymentId, txid);
        },
        
        // Called when user cancels
        onCancel: async (paymentId: string) => {
          dlog('Payment cancelled:', paymentId);
          
          await this.cancelPayment(paymentId, 'User cancelled');
          
          callbacks.onCancel(paymentId);
        },
        
        // Called on error
        onError: (error: Error, payment?: PiPaymentDTO) => {
          derror('Payment error:', error);
          callbacks.onError(error, payment);
        },
      });

      return payment.identifier;
    } catch (error) {
      callbacks.onError(error as Error);
      return null;
    }
  }

  /**
   * Record pending deposit in database
   */
  private async recordPendingDeposit(
    paymentId: string,
    paymentData: {
      amount: number;
      reference_id: string;
      recipient_id: string;
      sender_id: string;
      note?: string;
    }
  ): Promise<void> {
    await supabase.from('pi_transactions').insert({
      pi_payment_id: paymentId,
      direction: 'incoming',
      transaction_type: 'escrow_deposit',
      amount: paymentData.amount,
      status: 'pending',
      from_user_id: paymentData.sender_id,
      to_address: PMARTS_ESCROW_WALLET,
    });

    // Log audit
    await supabase.from('audit_logs').insert({
      action: 'deposit_initiated',
      user_id: paymentData.sender_id,
      actor_id: paymentData.sender_id,
      metadata: {
        pi_payment_id: paymentId,
        amount: paymentData.amount,
        reference_id: paymentData.reference_id,
      },
    });
  }

  /**
   * Server approves the payment (called from backend)
   */
  async approvePayment(paymentId: string): Promise<boolean> {
    try {
      // This would typically call your backend API which then calls Pi Platform API
      // POST /payments/{payment_id}/approve
      const response = await fetch(`${process.env.EXPO_PUBLIC_API_URL}/pi/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_id: paymentId }),
      });

      if (!response.ok) {
        throw new Error('Failed to approve payment');
      }

      // Update local status
      await supabase
        .from('pi_transactions')
        .update({ status: 'approved', approved_at: new Date().toISOString() })
        .eq('pi_payment_id', paymentId);

      return true;
    } catch (error) {
      derror('Failed to approve payment:', error);
      
      // Log failure
      await supabase.from('audit_logs').insert({
        action: 'deposit_failed',
        metadata: { pi_payment_id: paymentId, error: (error as Error).message },
      });
      
      return false;
    }
  }

  /**
   * Complete the payment after blockchain verification
   */
  async completePayment(paymentId: string, txid: string): Promise<boolean> {
    try {
      // Get the transaction record
      const { data: piTx } = await supabase
        .from('pi_transactions')
        .select('*, escrow_id')
        .eq('pi_payment_id', paymentId)
        .single();

      if (!piTx) {
        throw new Error('Transaction not found');
      }

      // Verify the transaction on blockchain (via backend)
      const verified = await this.verifyOnBlockchain(paymentId, txid);
      
      if (!verified) {
        // Log security alert for fake deposit
        await supabase.from('security_alerts').insert({
          alert_type: 'fake_deposit',
          severity: 'critical',
          escrow_id: piTx.escrow_id,
          description: `Blockchain verification failed for payment ${paymentId}`,
          evidence: { payment_id: paymentId, txid },
        });
        
        throw new Error('Blockchain verification failed');
      }

      // Update transaction
      await supabase
        .from('pi_transactions')
        .update({
          status: 'completed',
          pi_transaction_hash: txid,
          pi_txid: txid,
          verified: true,
          completed_at: new Date().toISOString(),
        })
        .eq('pi_payment_id', paymentId);

      // If this is an escrow deposit, update escrow status
      if (piTx.escrow_id) {
        await supabase
          .from('escrows')
          .update({
            pi_transaction_hash: txid,
            deposit_verified: true,
            deposit_verified_at: new Date().toISOString(),
          })
          .eq('id', piTx.escrow_id);

        // Add ledger entry
        await supabase.from('escrow_ledger').insert({
          escrow_id: piTx.escrow_id,
          entry_type: 'credit',
          action: 'deposit_received',
          amount: piTx.amount,
          pi_transaction_hash: txid,
          verified: true,
          verified_at: new Date().toISOString(),
          running_balance: piTx.amount, // Will need to calculate actual running balance
        });
      }

      // Complete on Pi Platform
      await fetch(`${process.env.EXPO_PUBLIC_API_URL}/pi/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_id: paymentId, txid }),
      });

      // Log success
      await supabase.from('audit_logs').insert({
        action: 'deposit_verified',
        escrow_id: piTx.escrow_id,
        user_id: piTx.from_user_id,
        metadata: { pi_payment_id: paymentId, txid, amount: piTx.amount },
      });

      return true;
    } catch (error) {
      derror('Failed to complete payment:', error);
      
      await supabase.from('audit_logs').insert({
        action: 'deposit_failed',
        metadata: { pi_payment_id: paymentId, txid, error: (error as Error).message },
      });
      
      return false;
    }
  }

  /**
   * Verify transaction on Pi blockchain
   */
  private async verifyOnBlockchain(paymentId: string, txid: string): Promise<boolean> {
    try {
      // Call backend to verify with Pi Platform API
      const response = await fetch(
        `${process.env.EXPO_PUBLIC_API_URL}/pi/verify`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payment_id: paymentId, txid }),
        }
      );

      const result = await response.json();
      return result.verified === true;
    } catch (error) {
      derror('Blockchain verification error:', error);
      return false;
    }
  }

  /**
   * Cancel a payment
   */
  async cancelPayment(paymentId: string, reason: string): Promise<void> {
    await supabase
      .from('pi_transactions')
      .update({
        status: 'cancelled',
        error_message: reason,
      })
      .eq('pi_payment_id', paymentId);

    await supabase.from('audit_logs').insert({
      action: 'deposit_failed',
      metadata: { pi_payment_id: paymentId, reason },
    });
  }

  /**
   * Create escrow release payment (PMARTS Wallet → Recipient)
   * Initiated by sender, executed by PMARTS server
   */
  async initiateRelease(escrowId: string): Promise<boolean> {
    try {
      // Get escrow details
      const { data: escrow, error } = await supabase
        .from('escrows')
        .select('*')
        .eq('id', escrowId)
        .single();

      if (error || !escrow) {
        throw new Error('Escrow not found');
      }

      // Verify deposit was verified
      if (!escrow.deposit_verified) {
        await supabase.from('security_alerts').insert({
          alert_type: 'unauthorized_release',
          severity: 'critical',
          escrow_id: escrowId,
          description: 'Attempted release of unverified deposit',
        });
        throw new Error('Cannot release unverified deposit');
      }

      // Check for double-release
      const { data: existingRelease } = await supabase
        .from('escrow_ledger')
        .select('id')
        .eq('escrow_id', escrowId)
        .eq('action', 'release_completed')
        .single();

      if (existingRelease) {
        await supabase.from('security_alerts').insert({
          alert_type: 'double_spend_attempt',
          severity: 'critical',
          escrow_id: escrowId,
          description: 'Attempted double release',
        });
        throw new Error('Escrow already released');
      }

      // Log release initiation
      await supabase.from('audit_logs').insert({
        action: 'release_requested',
        escrow_id: escrowId,
        user_id: escrow.sender_id,
        actor_id: escrow.sender_id,
      });

      // Create ledger entry for release initiation
      await supabase.from('escrow_ledger').insert({
        escrow_id: escrowId,
        entry_type: 'debit',
        action: 'release_initiated',
        amount: escrow.amount,
        running_balance: 0, // Will be calculated
      });

      // Call backend to execute release via Pi Platform API
      // This is an APP_TO_USER payment
      const response = await fetch(
        `${process.env.EXPO_PUBLIC_API_URL}/escrow/release`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            escrow_id: escrowId,
            recipient_id: escrow.recipient_id,
            amount: escrow.amount,
          }),
        }
      );

      if (!response.ok) {
        throw new Error('Release failed');
      }

      const result = await response.json();

      // Update escrow status
      await supabase
        .from('escrows')
        .update({
          status: 'completed',
          release_transaction_hash: result.txid,
          release_verified: true,
          release_verified_at: new Date().toISOString(),
          released_at: new Date().toISOString(),
        })
        .eq('id', escrowId);

      // Final ledger entry
      await supabase.from('escrow_ledger').insert({
        escrow_id: escrowId,
        entry_type: 'debit',
        action: 'release_completed',
        amount: escrow.amount,
        pi_transaction_hash: result.txid,
        verified: true,
        verified_at: new Date().toISOString(),
        running_balance: 0,
      });

      // Log completion
      await supabase.from('audit_logs').insert({
        action: 'release_completed',
        escrow_id: escrowId,
        user_id: escrow.sender_id,
        new_data: { txid: result.txid },
      });

      return true;
    } catch (error) {
      derror('Release failed:', error);
      
      await supabase.from('audit_logs').insert({
        action: 'release_failed',
        escrow_id: escrowId,
        metadata: { error: (error as Error).message },
      });
      
      return false;
    }
  }

  /**
   * Create escrow refund payment (PMARTS Wallet → Sender)
   * Only allowed under specific conditions
   */
  async initiateRefund(escrowId: string, reason: string): Promise<boolean> {
    try {
      // Get escrow details
      const { data: escrow, error } = await supabase
        .from('escrows')
        .select('*')
        .eq('id', escrowId)
        .single();

      if (error || !escrow) {
        throw new Error('Escrow not found');
      }

      // Verify deposit was verified
      if (!escrow.deposit_verified) {
        throw new Error('Cannot refund unverified deposit');
      }

      // Check status
      if (escrow.status !== 'funds_held' && escrow.status !== 'disputed') {
        throw new Error('Escrow not in refundable state');
      }

      // Log refund request
      await supabase.from('audit_logs').insert({
        action: 'refund_requested',
        escrow_id: escrowId,
        user_id: escrow.sender_id,
        metadata: { reason },
      });

      // Create ledger entry
      await supabase.from('escrow_ledger').insert({
        escrow_id: escrowId,
        entry_type: 'debit',
        action: 'refund_initiated',
        amount: escrow.amount,
        notes: reason,
        running_balance: 0,
      });

      // Call backend to execute refund
      const response = await fetch(
        `${process.env.EXPO_PUBLIC_API_URL}/escrow/refund`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            escrow_id: escrowId,
            sender_id: escrow.sender_id,
            amount: escrow.amount,
            reason,
          }),
        }
      );

      if (!response.ok) {
        throw new Error('Refund failed');
      }

      const result = await response.json();

      // Update escrow
      await supabase
        .from('escrows')
        .update({
          status: 'refunded',
          release_transaction_hash: result.txid,
          release_verified: true,
          release_verified_at: new Date().toISOString(),
        })
        .eq('id', escrowId);

      // Final ledger entry
      await supabase.from('escrow_ledger').insert({
        escrow_id: escrowId,
        entry_type: 'debit',
        action: 'refund_completed',
        amount: escrow.amount,
        pi_transaction_hash: result.txid,
        verified: true,
        verified_at: new Date().toISOString(),
        running_balance: 0,
      });

      // Log completion
      await supabase.from('audit_logs').insert({
        action: 'refund_completed',
        escrow_id: escrowId,
        user_id: escrow.sender_id,
        new_data: { txid: result.txid, reason },
      });

      return true;
    } catch (error) {
      derror('Refund failed:', error);
      
      await supabase.from('audit_logs').insert({
        action: 'refund_failed',
        escrow_id: escrowId,
        metadata: { error: (error as Error).message },
      });
      
      return false;
    }
  }
}

// Export singleton instance
export const piSDK = new PiSDKService();

