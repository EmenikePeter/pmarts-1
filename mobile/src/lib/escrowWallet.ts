/**
 * PMARTS Escrow Wallet Service
 * 
 * Core business logic for escrow operations.
 * This service ensures:
 * - Double-entry bookkeeping
 * - Fraud prevention
 * - Audit trail
 * - Balance integrity
 */

import { supabase } from './supabase';
import { piSDK, PMARTS_ESCROW_WALLET } from './piSDK';
import { API_URL } from './api';
import { Escrow, User, EscrowStatus } from './types';
import dlog, { dwarn, derror } from './dlog';
import { getUserById, isUuid } from './userResolver';

export interface CreateEscrowParams {
  sender: User;
  recipientId: string;  // Pi ID or PMARTS ID (PMT-XXXXXX)
  amount: number;
  referenceId: string;
  note?: string;
  deadline?: Date;
  transactionType?: 'physical_product' | 'digital_product' | 'service' | 'currency_exchange' | 'instant' | 'donation' | 'custom' | 'other';
  completionMethod?: 'delivery_code' | 'sender_release' | 'service_approval' | 'receipt_evidence' | 'dispute_resolution' | 'mutual_cancellation';
  milestones?: { title: string; amount: number }[];
}

export interface EscrowResult {
  success: boolean;
  escrow?: Escrow;
  error?: string;
  pmarts_reference?: string;
}

/**
 * Escrow Wallet Service
 * Handles all escrow operations with proper security checks
 */
class EscrowWalletService {
  
  /**
   * Create a new escrow deposit
   * Flow:
   * 1. Validate recipient exists
    * 2. Create escrow record (status: deposit_pending)
   * 3. Initiate Pi SDK payment
    * 4. On payment verified → update escrow to 'funds_held'
   */
  async createEscrow(params: CreateEscrowParams): Promise<EscrowResult> {
    const { sender, recipientId, amount, referenceId, note, deadline, transactionType, completionMethod, milestones } = params;

    try {
      // Validation
      if (amount <= 0) {
        return { success: false, error: 'Amount must be greater than 0' };
      }

      if (sender.id === recipientId) {
        return { success: false, error: 'Cannot create escrow to yourself' };
      }

      // Normalize recipient input and try multiple lookup strategies
      const rid = (recipientId || '').trim().replace(/^@/, '');
      dlog('[createEscrow] lookup start', { senderId: sender.id, rawRecipientId: recipientId, rid });
      let recipient: User | null = null;

      // 1) PMARTS ID (PMT-...)
      if (rid.toUpperCase().startsWith('PMT-')) {
        const result = await supabase
          .from('users')
          .select('*')
          .eq('pmarts_id', rid)
          .maybeSingle();
        dlog('[createEscrow] pmarts_id lookup result', { rid, result });
        recipient = (result as any).data || null;
      }

      // 2) pi_id match
      if (!recipient) {
        const result = await supabase
          .from('users')
          .select('*')
          .eq('pi_id', rid)
          .maybeSingle();
        dlog('[createEscrow] pi_id lookup result', { rid, result });
        recipient = (result as any).data || null;
      }

      // 3) username match
      if (!recipient) {
        const result = await supabase
          .from('users')
          .select('*')
          .eq('username', rid)
          .maybeSingle();
        dlog('[createEscrow] username lookup result', { rid, result });
        recipient = (result as any).data || null;
      }

      // 4) fallback: id (UUID)
      if (!recipient && isUuid(rid)) {
        const result = await getUserById<User>(rid, '*', { maybeSingle: true });
        dlog('[createEscrow] id lookup result', { rid, result });
        recipient = (result as any).data || null;
      }

      dlog('[createEscrow] final recipient', { rid, found: !!recipient, recipientId: recipient?.id, recipient });

      if (!recipient) {
        return { success: false, error: 'Recipient not found' };
      }

      // Check for duplicate reference_id
      const { data: existing } = await supabase
        .from('escrows')
        .select('id')
        .eq('reference_id', referenceId)
        .eq('sender_id', sender.id)
        .single();

      if (existing) {
        return { success: false, error: 'Duplicate reference ID' };
      }

      // Create escrow record (status: deposit_pending until payment verified)
      const { data: escrow, error: createError } = await supabase
        .from('escrows')
        .insert({
          sender_id: sender.id,
          recipient_id: recipient.id,
          amount,
          reference_id: referenceId,
          note,
          deadline: deadline?.toISOString(),
          status: 'deposit_pending', // Will change to 'funds_held' after payment verified
          deposit_verified: false,
          transaction_type: transactionType,
          completion_method: completionMethod,
        })
        .select('*, pmarts_reference')
        .single();
      if (milestones && milestones.length > 0) {
        const payload = milestones.map((milestone, index) => ({
          escrow_id: escrow.id,
          title: milestone.title,
          amount: milestone.amount,
          position: index + 1,
          status: 'pending',
        }));

        await supabase.from('escrow_milestones').insert(payload);
      }

      if (createError || !escrow) {
        throw new Error(createError?.message || 'Failed to create escrow');
      }

      const { error: transactionError } = await supabase
        .from('transactions')
        .insert({
          escrow_id: escrow.id,
          sender_id: sender.id,
          recipient_id: recipient.id,
          amount: escrow.amount,
          platform_fee: escrow.fee || 0,
          status: 'created',
          reference_id: escrow.reference_id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

      if (transactionError) {
        dwarn('Create transaction error:', transactionError);
        try {
          await fetch(`${API_URL}/api/escrow/v2/log`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              escrowId: escrow.id,
              userId: sender.id,
              message: 'Transaction insert failed on mobile client',
              metadata: {
                error: transactionError,
                reference_id: escrow.reference_id,
              },
            }),
          });
        } catch (logError) {
          dwarn('Failed to log transaction error:', logError);
        }
      }

      // Log escrow creation
      await this.logAudit({
        action: 'escrow_created',
        escrow_id: escrow.id,
        user_id: sender.id,
        actor_id: sender.id,
        new_data: {
          sender_id: sender.id,
          recipient_id: recipient.id,
          amount,
          reference_id: referenceId,
          pmarts_reference: escrow.pmarts_reference,
        },
      });

      // Create notification for recipient
      await supabase.from('notifications').insert({
        user_id: recipient.id,
        type: 'received',
        title: 'New Escrow Payment',
        message: `@${sender.username || sender.pi_id} has created an escrow of ${amount} π for you. Reference: ${referenceId}`,
        escrow_id: escrow.id,
      });

      return {
        success: true,
        escrow: escrow as Escrow,
        pmarts_reference: escrow.pmarts_reference,
      };
    } catch (error) {
      derror('Create escrow failed:', error);
      
      await this.logAudit({
        action: 'escrow_created',
        user_id: sender.id,
        actor_id: sender.id,
        metadata: { error: (error as Error).message },
      });

      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Verify escrow deposit after Pi payment confirmed
   * Called after Pi SDK completes payment
   */
  async verifyDeposit(escrowId: string, piPaymentId: string, txHash: string): Promise<EscrowResult> {
    try {
      // Get escrow
      const { data: escrow, error } = await supabase
        .from('escrows')
        .select('*')
        .eq('id', escrowId)
        .single();

      if (error || !escrow) {
        throw new Error('Escrow not found');
      }

      // Check if already verified
      if (escrow.deposit_verified) {
        return { success: true, escrow };
      }

      // Verify on Pi blockchain
      const verified = await this.verifyTransaction(txHash, escrow.amount);
      
      if (!verified) {
        await supabase.from('security_alerts').insert({
          alert_type: 'fake_deposit',
          severity: 'critical',
          escrow_id: escrowId,
          description: `Deposit verification failed: ${txHash}`,
          evidence: { pi_payment_id: piPaymentId, tx_hash: txHash },
        });
        
        throw new Error('Deposit verification failed');
      }

      // Update escrow to funds_held status
      const { data: updated, error: updateError } = await supabase
        .from('escrows')
        .update({
          status: 'funds_held',
          pi_payment_id: piPaymentId,
          pi_transaction_hash: txHash,
          deposit_verified: true,
          deposit_verified_at: new Date().toISOString(),
        })
        .eq('id', escrowId)
        .select()
        .single();

      if (updateError) {
        throw new Error(updateError.message);
      }

      // Create ledger entries (double-entry)
      await this.createLedgerEntry({
        escrow_id: escrowId,
        entry_type: 'credit',
        action: 'deposit_received',
        amount: escrow.amount,
        pi_transaction_hash: txHash,
        verified: true,
      });

      await this.createLedgerEntry({
        escrow_id: escrowId,
        entry_type: 'credit',
        action: 'deposit_held',
        amount: escrow.amount,
        pi_transaction_hash: txHash,
        verified: true,
      });

      // Update sender stats
      await supabase.rpc('increment_user_escrows', { user_id: escrow.sender_id });

      // Log verification
      await this.logAudit({
        action: 'deposit_verified',
        escrow_id: escrowId,
        user_id: escrow.sender_id,
        new_data: { tx_hash: txHash, amount: escrow.amount },
      });

      // Notify sender
      await supabase.from('notifications').insert({
        user_id: escrow.sender_id,
        type: 'deposit',
        title: 'Escrow Deposit Confirmed',
        message: `Your deposit of ${escrow.amount} π for ${escrow.reference_id} has been confirmed and held in escrow.`,
        escrow_id: escrowId,
      });

      return { success: true, escrow: updated as Escrow };
    } catch (error) {
      derror('Verify deposit failed:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Release escrow funds to recipient
   * Only sender can release
   */
  async releaseEscrow(escrowId: string, senderId: string): Promise<EscrowResult> {
    try {
      // Get escrow
      const { data: escrow, error } = await supabase
        .from('escrows')
        .select('*')
        .eq('id', escrowId)
        .single();

      if (error || !escrow) {
        throw new Error('Escrow not found');
      }

      // Authorization check
      if (escrow.sender_id !== senderId) {
        await this.logSecurityAlert({
          alert_type: 'unauthorized_release',
          severity: 'high',
          escrow_id: escrowId,
          user_id: senderId,
          description: 'Unauthorized release attempt',
        });
        throw new Error('Only sender can release escrow');
      }

      // Status check
      if (!['funds_held', 'delivery_in_progress', 'release_requested', 'release_pending'].includes(escrow.status)) {
        throw new Error(`Escrow cannot be released from ${escrow.status} status`);
      }

      // Verify deposit was verified
      if (!escrow.deposit_verified) {
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
        await this.logSecurityAlert({
          alert_type: 'double_spend_attempt',
          severity: 'critical',
          escrow_id: escrowId,
          description: 'Double release attempt',
        });
        throw new Error('Escrow already released');
      }

      // Log release request
      await this.logAudit({
        action: 'release_requested',
        escrow_id: escrowId,
        user_id: senderId,
        actor_id: senderId,
      });

      // Initiate release via Pi SDK
      const released = await piSDK.initiateRelease(escrowId);
      
      if (!released) {
        throw new Error('Release transaction failed');
      }

      // Get updated escrow
      const { data: updated } = await supabase
        .from('escrows')
        .select('*')
        .eq('id', escrowId)
        .single();

      // Update user stats
      await supabase.rpc('complete_user_escrow', { 
        sender_user_id: escrow.sender_id,
        recipient_user_id: escrow.recipient_id 
      });

      // Notify both parties
      await Promise.all([
        supabase.from('notifications').insert({
          user_id: escrow.recipient_id,
          type: 'release',
          title: 'Payment Received',
          message: `${escrow.amount} π has been released to your wallet for ${escrow.reference_id}!`,
          escrow_id: escrowId,
        }),
        supabase.from('notifications').insert({
          user_id: escrow.sender_id,
          type: 'release',
          title: 'Payment Released',
          message: `You released ${escrow.amount} π to the recipient for ${escrow.reference_id}.`,
          escrow_id: escrowId,
        }),
      ]);

      return { success: true, escrow: updated as Escrow };
    } catch (error) {
      derror('Release escrow failed:', error);

      await this.logAudit({
        action: 'release_failed',
        escrow_id: escrowId,
        user_id: senderId,
        metadata: { error: (error as Error).message },
      });

      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Refund escrow funds to sender
   * Requires recipient approval or dispute resolution
   */
  async refundEscrow(
    escrowId: string, 
    requesterId: string, 
    reason: string
  ): Promise<EscrowResult> {
    try {
      // Get escrow
      const { data: escrow, error } = await supabase
        .from('escrows')
        .select('*')
        .eq('id', escrowId)
        .single();

      if (error || !escrow) {
        throw new Error('Escrow not found');
      }

      // Status check
      if (escrow.status !== 'funds_held' && escrow.status !== 'disputed') {
        throw new Error(`Escrow cannot be refunded from ${escrow.status} status`);
      }

      // Authorization: recipient can initiate refund, or admin for disputes
      if (escrow.recipient_id !== requesterId && escrow.sender_id !== requesterId) {
        throw new Error('Not authorized to refund this escrow');
      }

      // Sender requesting refund requires recipient approval (handled by dispute system)
      if (escrow.sender_id === requesterId && escrow.status !== 'disputed') {
        throw new Error('Sender must open dispute to request refund');
      }

      // Log refund request
      await this.logAudit({
        action: 'refund_requested',
        escrow_id: escrowId,
        user_id: requesterId,
        actor_id: requesterId,
        metadata: { reason },
      });

      // Initiate refund via Pi SDK
      const refunded = await piSDK.initiateRefund(escrowId, reason);
      
      if (!refunded) {
        throw new Error('Refund transaction failed');
      }

      // Get updated escrow
      const { data: updated } = await supabase
        .from('escrows')
        .select('*')
        .eq('id', escrowId)
        .single();

      // Notify both parties
      await Promise.all([
        supabase.from('notifications').insert({
          user_id: escrow.sender_id,
          type: 'refund',
          title: 'Escrow Refunded',
          message: `${escrow.amount} π has been refunded to your wallet for ${escrow.reference_id}.`,
          escrow_id: escrowId,
        }),
        supabase.from('notifications').insert({
          user_id: escrow.recipient_id,
          type: 'refund',
          title: 'Escrow Refunded',
          message: `The escrow of ${escrow.amount} π for ${escrow.reference_id} has been refunded to the sender.`,
          escrow_id: escrowId,
        }),
      ]);

      return { success: true, escrow: updated as Escrow };
    } catch (error) {
      derror('Refund escrow failed:', error);

      await this.logAudit({
        action: 'refund_failed',
        escrow_id: escrowId,
        user_id: requesterId,
        metadata: { error: (error as Error).message, reason },
      });

      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Open a dispute on an escrow
   */
  async openDispute(
    escrowId: string,
    userId: string,
    reason: string
  ): Promise<{ success: boolean; dispute_id?: string; error?: string }> {
    try {
      // Get escrow
      const { data: escrow, error } = await supabase
        .from('escrows')
        .select('*')
        .eq('id', escrowId)
        .single();

      if (error || !escrow) {
        throw new Error('Escrow not found');
      }

      // Only parties can dispute
      if (escrow.sender_id !== userId && escrow.recipient_id !== userId) {
        throw new Error('Not authorized to dispute this escrow');
      }

      // Status check
      if (!['funds_held', 'delivery_in_progress', 'release_requested', 'release_pending'].includes(escrow.status)) {
        throw new Error('Can only dispute active escrows');
      }

      // Create dispute
      const { data: dispute, error: disputeError } = await supabase
        .from('disputes')
        .insert({
          escrow_id: escrowId,
          reported_by: userId,
          reason,
          status: 'open',
        })
        .select()
        .single();

      if (disputeError) {
        throw new Error(disputeError.message);
      }

      // Update escrow status
      await supabase
        .from('escrows')
        .update({ status: 'disputed' })
        .eq('id', escrowId);

      // Create ledger entry for dispute hold
      await this.createLedgerEntry({
        escrow_id: escrowId,
        entry_type: 'credit',
        action: 'dispute_hold',
        amount: escrow.amount,
      });

      // Log dispute
      await this.logAudit({
        action: 'dispute_opened',
        escrow_id: escrowId,
        user_id: userId,
        actor_id: userId,
        metadata: { reason },
      });

      // Notify other party
      const otherParty = escrow.sender_id === userId ? escrow.recipient_id : escrow.sender_id;
      await supabase.from('notifications').insert({
        user_id: otherParty,
        type: 'dispute',
        title: 'Dispute Opened',
        message: `A dispute has been opened for escrow ${escrow.reference_id}. Please provide your evidence.`,
        escrow_id: escrowId,
      });

      return { success: true, dispute_id: dispute.id };
    } catch (error) {
      derror('Open dispute failed:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Get escrow balance summary for a user
   */
  async getUserEscrowBalance(userId: string): Promise<{
    held: number;       // In active escrows (as sender)
    incoming: number;   // Pending to receive (as recipient)
    total_sent: number;
    total_received: number;
  }> {
    const activeStatuses = ['funds_held', 'delivery_in_progress', 'release_requested', 'release_pending'];

    // Get active balance (as sender)
    const { data: heldEscrows } = await supabase
      .from('escrows')
      .select('amount')
      .eq('sender_id', userId)
      .in('status', activeStatuses);

    const held = (heldEscrows || []).reduce((sum: number, e: any) => sum + e.amount, 0);

    // Get incoming active (as recipient)
    const { data: incomingEscrows } = await supabase
      .from('escrows')
      .select('amount')
      .eq('recipient_id', userId)
      .in('status', activeStatuses);

    const incoming = (incomingEscrows || []).reduce((sum: number, e: any) => sum + e.amount, 0);     

    // Get total sent (completed escrows as sender)
    const { data: sentEscrows } = await supabase
      .from('escrows')
      .select('amount')
      .eq('sender_id', userId)
      .eq('status', 'completed');

    const total_sent = (sentEscrows || []).reduce((sum: number, e: any) => sum + e.amount, 0);       

    // Get total received (completed escrows as recipient)
    const { data: receivedEscrows } = await supabase
      .from('escrows')
      .select('amount')
      .eq('recipient_id', userId)
      .eq('status', 'completed');

    const total_received = (receivedEscrows || []).reduce((sum: number, e: any) => sum + e.amount, 0);

    return { held, incoming, total_sent, total_received };
  }

  /**
   * Verify a Pi transaction on blockchain
   */
  private async verifyTransaction(txHash: string, expectedAmount: number): Promise<boolean> {
    try {
      // Call backend API to verify with Pi Platform
      const response = await fetch(
        `${process.env.EXPO_PUBLIC_API_URL}/pi/verify-transaction`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tx_hash: txHash, expected_amount: expectedAmount }),
        }
      );

      const result = await response.json();
      return result.verified === true && result.amount === expectedAmount;
    } catch (error) {
      derror('Transaction verification failed:', error);
      return false;
    }
  }

  /**
   * Create a ledger entry
   */
  private async createLedgerEntry(entry: {
    escrow_id: string;
    entry_type: 'credit' | 'debit';
    action: string;
    amount: number;
    pi_transaction_hash?: string;
    verified?: boolean;
    notes?: string;
  }): Promise<void> {
    // Calculate running balance
    const { data: wallet } = await supabase
      .from('escrow_wallet')
      .select('total_balance')
      .eq('wallet_type', 'master')
      .single();

    const currentBalance = wallet?.total_balance || 0;
    const newBalance = entry.entry_type === 'credit' 
      ? currentBalance + entry.amount 
      : currentBalance - entry.amount;
    const impactsHeldBalance = ['deposit_received', 'deposit_held', 'release_completed', 'refund_completed', 'dispute_hold'].includes(entry.action);

    await supabase.from('escrow_ledger').insert({
      ...entry,
      running_balance: newBalance,
      verified_at: entry.verified ? new Date().toISOString() : null,
    });

    // Update wallet balance
    if (wallet) {
      await supabase
        .from('escrow_wallet')
        .update({
          total_balance: newBalance,
          held_balance: impactsHeldBalance
            ? (wallet as any).held_balance + (entry.entry_type === 'credit' ? entry.amount : -entry.amount)
            : (wallet as any).held_balance,
          updated_at: new Date().toISOString(),
        })
        .eq('wallet_type', 'master');
    }
  }

  /**
   * Log an audit entry
   */
  private async logAudit(entry: {
    action: string;
    escrow_id?: string;
    user_id?: string;
    actor_id?: string;
    old_data?: any;
    new_data?: any;
    metadata?: any;
  }): Promise<void> {
    await supabase.from('audit_logs').insert(entry);
  }

  /**
   * Log a security alert
   */
  private async logSecurityAlert(alert: {
    alert_type: string;
    severity: string;
    escrow_id?: string;
    user_id?: string;
    description: string;
  }): Promise<void> {
    await supabase.from('security_alerts').insert(alert);
  }
}

// Export singleton instance
export const escrowWallet = new EscrowWalletService();

