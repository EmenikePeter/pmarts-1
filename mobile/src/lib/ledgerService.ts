/**
 * PMARTS Ledger Service
 * Financial accounting with append-only ledger entries
 * Ensures: total deposits = total releases + fees + refunds
 */

import { supabase } from './supabase';
import type { 
  LedgerEntry, 
  LedgerEntryType, 
  Payment, 
  PaymentType, 
  PaymentStatus,
  Escrow,
  BalanceReconciliation
} from '../types/database';

class LedgerService {
  // ============================================
  // LEDGER ENTRIES (Append Only)
  // ============================================

  /**
   * Record a deposit to escrow
   */
  async recordDeposit(
    escrowId: string,
    senderId: string,
    amount: number,
    paymentId: string
  ): Promise<LedgerEntry> {
    return this.createEntry({
      escrow_id: escrowId,
      user_id: senderId,
      payment_id: paymentId,
      entry_type: 'escrow_deposit',
      amount,
      debit_account: 'USER_WALLET',
      credit_account: 'PMARTS_ESCROW',
      description: `Deposit of ${amount} Pi to escrow`,
    });
  }

  /**
   * Record funds being held in escrow
   */
  async recordHold(
    escrowId: string,
    amount: number
  ): Promise<LedgerEntry> {
    return this.createEntry({
      escrow_id: escrowId,
      entry_type: 'escrow_hold',
      amount,
      debit_account: 'PMARTS_ESCROW',
      credit_account: 'ESCROW_HELD',
      description: `${amount} Pi held in escrow`,
    });
  }

  /**
   * Record release to recipient
   */
  async recordRelease(
    escrowId: string,
    recipientId: string,
    amount: number,
    paymentId: string
  ): Promise<LedgerEntry> {
    return this.createEntry({
      escrow_id: escrowId,
      user_id: recipientId,
      payment_id: paymentId,
      entry_type: 'escrow_release',
      amount,
      debit_account: 'ESCROW_HELD',
      credit_account: 'USER_WALLET',
      description: `Release of ${amount} Pi to recipient`,
    });
  }

  /**
   * Record refund to sender
   */
  async recordRefund(
    escrowId: string,
    senderId: string,
    amount: number,
    paymentId: string
  ): Promise<LedgerEntry> {
    return this.createEntry({
      escrow_id: escrowId,
      user_id: senderId,
      payment_id: paymentId,
      entry_type: 'escrow_refund',
      amount,
      debit_account: 'ESCROW_HELD',
      credit_account: 'USER_WALLET',
      description: `Refund of ${amount} Pi to sender`,
    });
  }

  /**
   * Record fee collection
   */
  async recordFeeCollection(
    escrowId: string,
    feeAmount: number
  ): Promise<LedgerEntry> {
    return this.createEntry({
      escrow_id: escrowId,
      entry_type: 'fee_collection',
      amount: feeAmount,
      debit_account: 'ESCROW_HELD',
      credit_account: 'PMARTS_FEES',
      description: `Fee collection of ${feeAmount} Pi`,
    });
  }

  /**
   * Record fee refund (dispute resolution)
   */
  async recordFeeRefund(
    escrowId: string,
    userId: string,
    amount: number
  ): Promise<LedgerEntry> {
    return this.createEntry({
      escrow_id: escrowId,
      user_id: userId,
      entry_type: 'fee_refund',
      amount,
      debit_account: 'PMARTS_FEES',
      credit_account: 'USER_WALLET',
      description: `Fee refund of ${amount} Pi`,
    });
  }

  /**
   * Record manual adjustment (admin only)
   */
  async recordAdjustment(
    escrowId: string | null,
    userId: string | null,
    amount: number,
    reason: string,
    adminId: string
  ): Promise<LedgerEntry> {
    return this.createEntry({
      escrow_id: escrowId,
      user_id: userId,
      entry_type: 'adjustment',
      amount,
      description: reason,
      metadata: { adjusted_by: adminId, reason },
    });
  }

  /**
   * Record reversal entry
   */
  async recordReversal(
    originalEntryId: string,
    reason: string,
    adminId: string
  ): Promise<LedgerEntry> {
    // Get original entry
    const { data: original, error } = await supabase
      .from('ledger_entries')
      .select('*')
      .eq('id', originalEntryId)
      .single();

    if (error || !original) {
      throw new Error('Original entry not found');
    }

    return this.createEntry({
      escrow_id: original.escrow_id,
      user_id: original.user_id,
      entry_type: 'reversal',
      amount: -original.amount,
      debit_account: original.credit_account,
      credit_account: original.debit_account,
      reference_code: `REV_${originalEntryId}`,
      description: `Reversal: ${reason}`,
      metadata: { 
        original_entry_id: originalEntryId, 
        reversed_by: adminId, 
        reason 
      },
    });
  }

  /**
   * Core method to create ledger entry
   */
  private async createEntry(
    entry: Partial<LedgerEntry>
  ): Promise<LedgerEntry> {
    const referenceCode = entry.reference_code || 
      `LED_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    const { data, error } = await supabase
      .from('ledger_entries')
      .insert({
        ...entry,
        reference_code: referenceCode,
        metadata: entry.metadata || {},
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // ============================================
  // PAYMENTS
  // ============================================

  /**
   * Create a new payment record
   */
  async createPayment(
    escrowId: string,
    paymentType: PaymentType,
    amount: number,
    wallets: {
      sender_wallet?: string;
      recipient_wallet?: string;
      pmarts_wallet?: string;
    }
  ): Promise<Payment> {
    const { data, error } = await supabase
      .from('payments')
      .insert({
        escrow_id: escrowId,
        payment_type: paymentType,
        amount,
        ...wallets,
        status: 'pending',
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Update payment with Pi SDK details
   */
  async updatePaymentSubmitted(
    paymentId: string,
    piPaymentId: string
  ): Promise<Payment> {
    const { data, error } = await supabase
      .from('payments')
      .update({
        pi_payment_id: piPaymentId,
        status: 'submitted',
        submitted_at: new Date().toISOString(),
      })
      .eq('id', paymentId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Confirm payment on blockchain
   */
  async confirmPayment(
    paymentId: string,
    txHash: string,
    blockNumber?: number
  ): Promise<Payment> {
    const { data, error } = await supabase
      .from('payments')
      .update({
        tx_hash: txHash,
        block_number: blockNumber,
        status: 'confirmed',
        confirmed: true,
        confirmed_at: new Date().toISOString(),
      })
      .eq('id', paymentId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Mark payment as failed
   */
  async failPayment(
    paymentId: string,
    errorCode: string,
    errorMessage: string
  ): Promise<Payment> {
    const { data: current } = await supabase
      .from('payments')
      .select('retry_count')
      .eq('id', paymentId)
      .single();

    const { data, error } = await supabase
      .from('payments')
      .update({
        status: 'failed',
        error_code: errorCode,
        error_message: errorMessage,
        retry_count: (current?.retry_count || 0) + 1,
      })
      .eq('id', paymentId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Get payments for an escrow
   */
  async getEscrowPayments(escrowId: string): Promise<Payment[]> {
    const { data, error } = await supabase
      .from('payments')
      .select('*')
      .eq('escrow_id', escrowId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return data || [];
  }

  /**
   * Get pending payments
   */
  async getPendingPayments(): Promise<Payment[]> {
    const { data, error } = await supabase
      .from('payments')
      .select('*, escrows(*)')
      .in('status', ['pending', 'submitted', 'confirming'])
      .order('initiated_at', { ascending: true });

    if (error) throw error;
    return data || [];
  }

  // ============================================
  // LEDGER QUERIES
  // ============================================

  /**
   * Get ledger entries for an escrow
   */
  async getEscrowLedger(escrowId: string): Promise<LedgerEntry[]> {
    const { data, error } = await supabase
      .from('ledger_entries')
      .select('*')
      .eq('escrow_id', escrowId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return data || [];
  }

  /**
   * Get ledger entries for a user
   */
  async getUserLedger(
    userId: string,
    limit: number = 50
  ): Promise<LedgerEntry[]> {
    const { data, error } = await supabase
      .from('ledger_entries')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  }

  /**
   * Get total stats from ledger
   */
  async getLedgerStats(): Promise<{
    total_deposits: number;
    total_releases: number;
    total_refunds: number;
    total_fees: number;
    balance_held: number;
  }> {
    const { data, error } = await supabase.rpc('get_ledger_stats');
    
    if (error) {
      // Fallback to manual calculation
      const { data: entries } = await supabase
        .from('ledger_entries')
        .select('entry_type, amount');

      const stats = {
        total_deposits: 0,
        total_releases: 0,
        total_refunds: 0,
        total_fees: 0,
        balance_held: 0,
      };

      (entries || []).forEach((entry: any) => {
        switch (entry.entry_type) {
          case 'escrow_deposit':
            stats.total_deposits += entry.amount;
            break;
          case 'escrow_release':
            stats.total_releases += entry.amount;
            break;
          case 'escrow_refund':
            stats.total_refunds += entry.amount;
            break;
          case 'fee_collection':
            stats.total_fees += entry.amount;
            break;
        }
      });

      stats.balance_held = stats.total_deposits - stats.total_releases - stats.total_refunds - stats.total_fees;
      return stats;
    }

    return data;
  }

  // ============================================
  // VERIFICATION & RECONCILIATION
  // ============================================

  /**
   * Verify ledger integrity (deposits = releases + refunds + held + fees)
   */
  async verifyLedgerIntegrity(): Promise<{
    valid: boolean;
    deposits: number;
    releases: number;
    refunds: number;
    fees: number;
    held: number;
    discrepancy: number;
  }> {
    const stats = await this.getLedgerStats();
    
    const expectedHeld = 
      stats.total_deposits - stats.total_releases - stats.total_refunds - stats.total_fees;
    
    const discrepancy = Math.abs(expectedHeld - stats.balance_held);
    
    return {
      valid: discrepancy < 0.00001, // Allow tiny floating point differences
      deposits: stats.total_deposits,
      releases: stats.total_releases,
      refunds: stats.total_refunds,
      fees: stats.total_fees,
      held: stats.balance_held,
      discrepancy,
    };
  }

  /**
   * Verify a specific escrow's ledger
   */
  async verifyEscrowLedger(escrowId: string): Promise<{
    valid: boolean;
    message: string;
  }> {
    const entries = await this.getEscrowLedger(escrowId);
    
    let deposits = 0;
    let releases = 0;
    let refunds = 0;
    let fees = 0;

    entries.forEach((entry) => {
      switch (entry.entry_type) {
        case 'escrow_deposit':
          deposits += entry.amount;
          break;
        case 'escrow_release':
          releases += entry.amount;
          break;
        case 'escrow_refund':
          refunds += entry.amount;
          break;
        case 'fee_collection':
          fees += entry.amount;
          break;
      }
    });

    const totalOut = releases + refunds + fees;
    const isBalanced = Math.abs(deposits - totalOut) < 0.00001 || totalOut === 0;

    return {
      valid: isBalanced,
      message: isBalanced 
        ? 'Escrow ledger is balanced'
        : `Discrepancy: deposited ${deposits}, out ${totalOut}`,
    };
  }

  /**
   * Get daily reconciliation report
   */
  async getDailyReconciliation(
    date?: Date
  ): Promise<BalanceReconciliation | null> {
    const targetDate = date || new Date();
    const dateStr = targetDate.toISOString().split('T')[0];

    const { data, error } = await supabase
      .from('balance_reconciliation')
      .select('*')
      .eq('reconciliation_date', dateStr)
      .eq('account_name', 'PMARTS_ESCROW_WALLET')
      .single();

    if (error) return null;
    return data;
  }

  /**
   * Run daily reconciliation
   */
  async runDailyReconciliation(): Promise<void> {
    await supabase.rpc('generate_daily_reconciliation');
  }

  // ============================================
  // SYSTEM ACCOUNTS
  // ============================================

  /**
   * Get system account balances
   */
  async getSystemAccounts(): Promise<{
    escrow_wallet: number;
    fee_wallet: number;
    reserve_wallet: number;
  }> {
    const { data, error } = await supabase
      .from('system_accounts')
      .select('account_type, balance');

    if (error) throw error;

    const result = {
      escrow_wallet: 0,
      fee_wallet: 0,
      reserve_wallet: 0,
    };

    (data || []).forEach((account: any) => {
      if (account.account_type === 'escrow_wallet') {
        result.escrow_wallet = account.balance;
      } else if (account.account_type === 'fee_wallet') {
        result.fee_wallet = account.balance;
      } else if (account.account_type === 'reserve_wallet') {
        result.reserve_wallet = account.balance;
      }
    });

    return result;
  }

  /**
   * Update system account balance
   */
  async updateSystemAccountBalance(
    accountName: string,
    amount: number,
    isInflow: boolean
  ): Promise<void> {
    const { error } = await supabase.rpc('update_system_account', {
      p_account_name: accountName,
      p_amount: amount,
      p_is_inflow: isInflow,
    });

    if (error) {
      // Fallback to direct update
      const { data: current } = await supabase
        .from('system_accounts')
        .select('balance, total_inflow, total_outflow')
        .eq('account_name', accountName)
        .single();

      if (current) {
        await supabase
          .from('system_accounts')
          .update({
            balance: isInflow 
              ? current.balance + amount 
              : current.balance - amount,
            total_inflow: isInflow 
              ? current.total_inflow + amount 
              : current.total_inflow,
            total_outflow: !isInflow 
              ? current.total_outflow + amount 
              : current.total_outflow,
            updated_at: new Date().toISOString(),
          })
          .eq('account_name', accountName);
      }
    }
  }
}

export const ledgerService = new LedgerService();

