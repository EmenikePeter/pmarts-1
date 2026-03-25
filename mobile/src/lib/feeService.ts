/**
 * PMARTS Fee Management Service
 * Handles fee calculation, collection, and treasury management
 */

import { supabase } from './supabase';

// ============================================
// Types
// ============================================

export interface FeeCalculation {
  feeAmount: number;
  netAmount: number;
  feeRate: number;
  discountPercent: number;
}

export interface FeeLedgerEntry {
  id: string;
  escrow_id: string;
  fee_type: string;
  gross_amount: number;
  fee_amount: number;
  net_amount: number;
  fee_rate_applied: number;
  discount_applied: number;
  collected_at: string;
}

export interface Treasury {
  balance: number;
  total_fees_collected: number;
  total_withdrawn: number;
}

// ============================================
// Fee Service Class
// ============================================

class FeeService {
  /**
   * Calculate fee for an escrow amount
   */
  async calculateFee(
    amount: number,
    userId: string,
    apiAppId?: string
  ): Promise<{ success: boolean; fee?: FeeCalculation; error?: string }> {
    try {
      const { data, error } = await supabase.rpc('calculate_escrow_fee', {
        p_amount: amount,
        p_user_id: userId,
        p_api_app_id: apiAppId || null,
      });

      if (error) {
        return { success: false, error: error.message };
      }

      if (data && data.length > 0) {
        const result = data[0];
        return {
          success: true,
          fee: {
            feeAmount: parseFloat(result.fee_amount),
            netAmount: parseFloat(result.net_amount),
            feeRate: parseFloat(result.fee_rate),
            discountPercent: parseFloat(result.discount_percent),
          },
        };
      }

      // Default fee calculation if RPC fails
      const defaultRate = 0.01; // 1%
      const feeAmount = Math.max(0.01, Math.min(50, amount * defaultRate));
      return {
        success: true,
        fee: {
          feeAmount: parseFloat(feeAmount.toFixed(4)),
          netAmount: parseFloat((amount - feeAmount).toFixed(4)),
          feeRate: 1.0,
          discountPercent: 0,
        },
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Collect fee for a completed escrow
   */
  async collectFee(params: {
    escrowId: string;
    grossAmount: number;
    feeAmount: number;
    netAmount: number;
    feeRate: number;
    discountApplied: number;
    senderId: string;
    apiAppId?: string;
  }): Promise<{ success: boolean; ledgerEntryId?: string; error?: string }> {
    try {
      // Record fee in ledger
      const { data: ledgerEntry, error: ledgerError } = await supabase
        .from('fee_ledger')
        .insert({
          escrow_id: params.escrowId,
          fee_type: 'escrow_fee',
          gross_amount: params.grossAmount,
          fee_amount: params.feeAmount,
          net_amount: params.netAmount,
          fee_rate_applied: params.feeRate,
          discount_applied: params.discountApplied,
          sender_id: params.senderId,
          api_app_id: params.apiAppId,
        })
        .select()
        .single();

      if (ledgerError) {
        return { success: false, error: ledgerError.message };
      }

      // Record treasury transaction
      await supabase.from('treasury_transactions').insert({
        transaction_type: 'fee_collection',
        amount: params.feeAmount,
        fee_ledger_id: ledgerEntry.id,
        description: `Fee from escrow ${params.escrowId}`,
      });

      // Update treasury balance
      await supabase.rpc('add_to_treasury', { p_amount: params.feeAmount });

      return { success: true, ledgerEntryId: ledgerEntry.id };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Get treasury summary
   */
  async getTreasury(): Promise<{ success: boolean; treasury?: Treasury; error?: string }> {
    try {
      const { data, error } = await supabase
        .from('treasury')
        .select('*')
        .single();

      if (error) {
        return { success: false, error: error.message };
      }

      return {
        success: true,
        treasury: {
          balance: parseFloat(data.balance),
          total_fees_collected: parseFloat(data.total_fees_collected),
          total_withdrawn: parseFloat(data.total_withdrawn),
        },
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Get fee ledger entries for an escrow
   */
  async getFeesForEscrow(escrowId: string): Promise<{
    success: boolean;
    entries?: FeeLedgerEntry[];
    error?: string;
  }> {
    try {
      const { data, error } = await supabase
        .from('fee_ledger')
        .select('*')
        .eq('escrow_id', escrowId)
        .order('collected_at', { ascending: false });

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true, entries: data };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Get user's fee tier
   */
  async getUserFeeTier(userId: string): Promise<{
    success: boolean;
    tier?: { name: string; discount: number; volume: number };
    error?: string;
  }> {
    try {
      // Calculate user's 30-day volume
      const { data: volumeData } = await supabase
        .from('escrows')
        .select('amount')
        .eq('sender_id', userId)
        .in('status', ['completed', 'funds_held'])
        .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

      const totalVolume = volumeData?.reduce((sum: number, e: any) => sum + parseFloat(e.amount), 0) || 0;

      // Get matching tier
      const { data: tierData } = await supabase
        .from('fee_tiers')
        .select('*')
        .eq('applies_to', 'user')
        .lte('min_volume', totalVolume)
        .order('min_volume', { ascending: false })
        .limit(1)
        .single();

      return {
        success: true,
        tier: {
          name: tierData?.tier_name || 'Bronze',
          discount: tierData?.fee_discount_percent || 0,
          volume: totalVolume,
        },
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
}

export const feeService = new FeeService();

