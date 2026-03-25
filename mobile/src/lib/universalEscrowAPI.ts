/**
 * PMARTS Universal Escrow API
 * 
 * This API allows any Pi app to integrate escrow services.
 * Third-party apps can:
 * - Create escrows on behalf of users
 * - Query escrow status
 * - Receive webhook notifications
 * - Handle disputes
 * 
 * Integration flow:
 * 1. Register app → Get API key
 * 2. Create escrow via API
 * 3. User approves Pi payment
 * 4. PMARTS holds funds
 * 5. App triggers release/refund
 * 6. PMARTS transfers funds
 */

import { supabase } from './supabase';
import { Escrow, User } from './types';
import { escrowWallet } from './escrowWallet';
import { piSDK } from './piSDK';
import { feeService } from './feeService';
import { fraudService } from './fraudService';
import { debugError } from './debugLogger';

// ============================================
// API Types
// ============================================

export interface APIApp {
  id: string;
  app_name: string;
  app_description?: string;
  api_key: string;
  webhook_url?: string;
  is_active: boolean;
  is_verified: boolean;
  total_escrows: number;
  total_volume: number;
}

export interface CreateEscrowRequest {
  sender_pi_id: string;           // Sender's Pi Network ID
  recipient_pi_id: string;        // Recipient's Pi Network ID
  amount: number;                // Amount in Pi
  reference_id: string;          // External reference (order ID, invoice, etc)
  description?: string;          // Description of the transaction
  deadline_hours?: number;       // Hours until escrow expires (default: 72)
  metadata?: Record<string, any>; // Custom metadata
  webhook_events?: string[];     // Events to receive webhooks for
}

export interface EscrowResponse {
  success: boolean;
  escrow_id?: string;
  pmarts_reference?: string;
  status?: string;
  payment_url?: string;          // URL for sender to complete payment
  fee_amount?: number;           // Fee that will be charged
  net_amount?: number;           // Amount recipient will get
  error?: string;
  error_code?: string;
}

export interface EscrowStatusResponse {
  success: boolean;
  escrow?: {
    id: string;
    pmarts_reference: string;
    status: string;
    amount: number;
    sender_pi_id: string;
    recipient_pi_id: string;
    reference_id: string;
    deposit_verified: boolean;
    release_verified: boolean;
    created_at: string;
    updated_at: string;
    expires_at?: string;
    metadata?: Record<string, any>;
  };
  error?: string;
}

export interface ReleaseRequest {
  escrow_id: string;
  authorized_by: string;         // Pi ID of the authorizer (sender)
  release_note?: string;
}

export interface RefundRequest {
  escrow_id: string;
  authorized_by: string;         // Pi ID of authorizer  
  refund_reason: string;
}

export interface WebhookPayload {
  event: string;
  timestamp: string;
  escrow_id: string;
  pmarts_reference: string;
  data: Record<string, any>;
  signature: string;             // HMAC signature for verification
}

// Webhook events
export const WEBHOOK_EVENTS = {
  ESCROW_CREATED: 'escrow.created',
  DEPOSIT_PENDING: 'escrow.deposit_pending',
  DEPOSIT_CONFIRMED: 'escrow.deposit_confirmed',
  FUNDS_HELD: 'escrow.funds_held',
  RELEASE_REQUESTED: 'escrow.release_requested',
  RELEASE_COMPLETED: 'escrow.release_completed',
  REFUND_REQUESTED: 'escrow.refund_requested',
  REFUND_COMPLETED: 'escrow.refund_completed',
  DISPUTED: 'escrow.disputed',
  DISPUTE_RESOLVED: 'escrow.dispute_resolved',
  EXPIRED: 'escrow.expired',
} as const;

// ============================================
// Universal Escrow API Class
// ============================================

class UniversalEscrowAPI {
  private apiKey: string | null = null;
  private appId: string | null = null;

  /**
   * Initialize API with app credentials
   */
  async init(apiKey: string): Promise<{ success: boolean; app?: APIApp; error?: string }> {
    try {
      const { data: app, error } = await supabase
        .from('api_apps')
        .select('*')
        .eq('api_key', apiKey)
        .eq('is_active', true)
        .single();

      if (error || !app) {
        return { success: false, error: 'Invalid API key' };
      }

      this.apiKey = apiKey;
      this.appId = app.id;

      return { success: true, app };
    } catch (err) {
      return { success: false, error: 'API initialization failed' };
    }
  }

  /**
   * Create a new escrow
   * POST /api/v1/escrows
   */
  async createEscrow(request: CreateEscrowRequest): Promise<EscrowResponse> {
    if (!this.appId) {
      return { success: false, error: 'API not initialized', error_code: 'NOT_INITIALIZED' };
    }

    try {
      // Log API request
      await this.logRequest('POST', '/escrows', request);

      // Validate request
      if (!request.sender_pi_id || !request.recipient_pi_id || !request.amount || !request.reference_id) {
        return { 
          success: false, 
          error: 'Missing required fields: sender_pi_id, recipient_pi_id, amount, reference_id',
          error_code: 'INVALID_REQUEST'
        };
      }

      if (request.amount <= 0) {
        return { success: false, error: 'Amount must be greater than 0', error_code: 'INVALID_AMOUNT' };
      }

      if (request.sender_pi_id === request.recipient_pi_id) {
        return { success: false, error: 'Sender and recipient cannot be the same', error_code: 'SAME_USER' };
      }

      // Find sender
      const { data: sender } = await supabase
        .from('users')
        .select('*')
        .eq('pi_id', request.sender_pi_id)
        .single();

      if (!sender) {
        return { success: false, error: 'Sender not found. User must register with PMARTS first.', error_code: 'PAYER_NOT_FOUND' };
      }

      // Find recipient
      const { data: recipient } = await supabase
        .from('users')
        .select('*')
        .eq('pi_id', request.recipient_pi_id)
        .single();

      if (!recipient) {
        return { success: false, error: 'Recipient not found. User must register with PMARTS first.', error_code: 'RECEIVER_NOT_FOUND' };
      }

      // Check fraud risk before proceeding
      const riskCheck = await fraudService.checkTransactionRisk({
        userId: sender.id,
        amount: request.amount,
        recipientId: recipient.id,
      });

      if (!riskCheck.allowed) {
        return { 
          success: false, 
          error: riskCheck.block_reason || 'Transaction blocked due to risk assessment',
          error_code: 'RISK_BLOCKED'
        };
      }

      // Calculate fees
      const feeCalc = await feeService.calculateFee(request.amount, sender.id, this.appId || undefined);
      const feeAmount = feeCalc.fee?.feeAmount || 0;
      const netAmount = feeCalc.fee?.netAmount || request.amount;

      // Calculate deadline
      const deadlineHours = request.deadline_hours || 72;
      const expiresAt = new Date(Date.now() + deadlineHours * 60 * 60 * 1000);

      // Create escrow with external app tracking
      const { data: escrow, error: createError } = await supabase
        .from('escrows')
        .insert({
          sender_id: sender.id,
          recipient_id: recipient.id,
          amount: request.amount,
          reference_id: request.reference_id,
          note: request.description,
          status: 'created',
          deposit_verified: false,
          external_app_id: this.appId,
          external_reference: request.reference_id,
          expires_at: expiresAt.toISOString(),
          requires_admin_approval: riskCheck.requires_approval,
          metadata: {
            ...request.metadata,
            webhook_events: request.webhook_events || Object.values(WEBHOOK_EVENTS),
            source: 'api',
            app_id: this.appId,
            fee_amount: feeAmount,
            net_amount: netAmount,
            risk_flags: riskCheck.flags,
            risk_level: riskCheck.risk_level,
          },
        })
        .select('*, pmarts_reference')
        .single();

      if (createError || !escrow) {
        return { 
          success: false, 
          error: createError?.message || 'Failed to create escrow',
          error_code: 'CREATE_FAILED'
        };
      }

      // Update app stats
      await supabase.rpc('increment_api_app_escrows', { app_id: this.appId });

      // Trigger webhook
      await this.triggerWebhook(WEBHOOK_EVENTS.ESCROW_CREATED, escrow);

      // Generate payment URL (deep link to PMARTS)
      const paymentUrl = `pmarts://deposit?escrow_id=${escrow.id}&amount=${request.amount}`;

      return {
        success: true,
        escrow_id: escrow.id,
        pmarts_reference: escrow.pmarts_reference,
        status: escrow.status,
        payment_url: paymentUrl,
        fee_amount: feeAmount,
        net_amount: netAmount,
      };
    } catch (err: any) {
      return { success: false, error: err.message, error_code: 'INTERNAL_ERROR' };
    }
  }

  /**
   * Get escrow status
   * GET /api/v1/escrows/:escrow_id
   */
  async getEscrow(escrowId: string): Promise<EscrowStatusResponse> {
    if (!this.appId) {
      return { success: false, error: 'API not initialized' };
    }

    try {
      await this.logRequest('GET', `/escrows/${escrowId}`, {});

      const { data: escrow, error } = await supabase
        .from('escrows')
        .select(`
          *,
          sender:users!sender_id(pi_id),
          recipient:users!recipient_id(pi_id)
        `)
        .eq('id', escrowId)
        .eq('external_app_id', this.appId)
        .single();

      if (error || !escrow) {
        return { success: false, error: 'Escrow not found' };
      }

      return {
        success: true,
        escrow: {
          id: escrow.id,
          pmarts_reference: escrow.pmarts_reference,
          status: escrow.status,
          amount: escrow.amount,
          sender_pi_id: (escrow.sender as any)?.pi_id,
          recipient_pi_id: (escrow.recipient as any)?.pi_id,
          reference_id: escrow.reference_id,
          deposit_verified: escrow.deposit_verified,
          release_verified: escrow.release_verified,
          created_at: escrow.created_at,
          updated_at: escrow.updated_at,
          expires_at: escrow.expires_at,
          metadata: escrow.metadata,
        },
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Get escrow by external reference
   * GET /api/v1/escrows/reference/:reference_id
   */
  async getEscrowByReference(referenceId: string): Promise<EscrowStatusResponse> {
    if (!this.appId) {
      return { success: false, error: 'API not initialized' };
    }

    try {
      await this.logRequest('GET', `/escrows/reference/${referenceId}`, {});

      const { data: escrow, error } = await supabase
        .from('escrows')
        .select(`
          *,
          sender:users!sender_id(pi_id),
          recipient:users!recipient_id(pi_id)
        `)
        .eq('external_reference', referenceId)
        .eq('external_app_id', this.appId)
        .single();

      if (error || !escrow) {
        return { success: false, error: 'Escrow not found' };
      }

      return {
        success: true,
        escrow: {
          id: escrow.id,
          pmarts_reference: escrow.pmarts_reference,
          status: escrow.status,
          amount: escrow.amount,
          sender_pi_id: (escrow.sender as any)?.pi_id,
          recipient_pi_id: (escrow.recipient as any)?.pi_id,
          reference_id: escrow.reference_id,
          deposit_verified: escrow.deposit_verified,
          release_verified: escrow.release_verified,
          created_at: escrow.created_at,
          updated_at: escrow.updated_at,
          expires_at: escrow.expires_at,
          metadata: escrow.metadata,
        },
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * List escrows for this app
   * GET /api/v1/escrows
   */
  async listEscrows(params: {
    status?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ success: boolean; escrows?: any[]; total?: number; error?: string }> {
    if (!this.appId) {
      return { success: false, error: 'API not initialized' };
    }

    try {
      await this.logRequest('GET', '/escrows', params);

      let query = supabase
        .from('escrows')
        .select(`
          *,
          sender:users!sender_id(pi_id),
          recipient:users!recipient_id(pi_id)
        `, { count: 'exact' })
        .eq('external_app_id', this.appId)
        .order('created_at', { ascending: false });

      if (params.status) {
        query = query.eq('status', params.status);
      }

      const limit = Math.min(params.limit || 20, 100);
      const offset = params.offset || 0;
      query = query.range(offset, offset + limit - 1);

      const { data: escrows, error, count } = await query;

      if (error) {
        return { success: false, error: error.message };
      }

      return {
        success: true,
        escrows: escrows?.map((e: any) => ({
          id: e.id,
          pmarts_reference: e.pmarts_reference,
          status: e.status,
          amount: e.amount,
          sender_pi_id: (e.sender as any)?.pi_id,
          recipient_pi_id: (e.recipient as any)?.pi_id,
          reference_id: e.reference_id,
          created_at: e.created_at,
        })),
        total: count || 0,
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Release escrow funds
   * POST /api/v1/escrows/:escrow_id/release
   */
  async releaseEscrow(request: ReleaseRequest): Promise<EscrowResponse> {
    if (!this.appId) {
      return { success: false, error: 'API not initialized', error_code: 'NOT_INITIALIZED' };
    }

    try {
      await this.logRequest('POST', `/escrows/${request.escrow_id}/release`, request);

      // Get escrow
      const { data: escrow, error } = await supabase
        .from('escrows')
        .select('*, sender:users!sender_id(*)')
        .eq('id', request.escrow_id)
        .eq('external_app_id', this.appId)
        .single();

      if (error || !escrow) {
        return { success: false, error: 'Escrow not found', error_code: 'NOT_FOUND' };
      }

      // Verify authorizer is the sender
      if ((escrow.sender as any)?.pi_id !== request.authorized_by) {
        return { success: false, error: 'Only sender can release escrow', error_code: 'UNAUTHORIZED' };
      }

      // Check rate limits
      const { data: limitCheck } = await supabase
        .rpc('check_withdrawal_limits', { 
          p_amount: escrow.amount, 
          p_user_id: escrow.sender_id 
        });

      if (limitCheck && !limitCheck[0]?.allowed) {
        if (limitCheck[0]?.requires_admin) {
          // Queue for admin approval
          await supabase.from('admin_approval_queue').insert({
            escrow_id: escrow.id,
            approval_type: 'large_escrow',
            reason: limitCheck[0]?.reason,
          });
          return { 
            success: false, 
            error: 'Escrow requires admin approval due to amount',
            error_code: 'ADMIN_APPROVAL_REQUIRED'
          };
        }
        return { 
          success: false, 
          error: limitCheck[0]?.reason || 'Rate limit exceeded',
          error_code: 'RATE_LIMITED'
        };
      }

      // Use escrowWallet service for release
      const result = await escrowWallet.releaseEscrow(escrow.id, escrow.sender_id);

      if (!result.success) {
        return { 
          success: false, 
          error: result.error || 'Release failed',
          error_code: 'RELEASE_FAILED'
        };
      }

      // Track withdrawal
      await supabase.from('withdrawal_tracking').insert({
        escrow_id: escrow.id,
        user_id: escrow.sender_id,
        amount: escrow.amount,
        transaction_type: 'release',
      });

      // Update app stats
      await supabase.rpc('add_api_app_volume', { 
        app_id: this.appId, 
        volume: escrow.amount 
      });

      // Trigger webhook
      await this.triggerWebhook(WEBHOOK_EVENTS.RELEASE_COMPLETED, {
        ...escrow,
        status: 'completed',
      });

      return {
        success: true,
        escrow_id: escrow.id,
        pmarts_reference: escrow.pmarts_reference,
        status: 'completed',
      };
    } catch (err: any) {
      return { success: false, error: err.message, error_code: 'INTERNAL_ERROR' };
    }
  }

  /**
   * Refund escrow funds
   * POST /api/v1/escrows/:escrow_id/refund
   */
  async refundEscrow(request: RefundRequest): Promise<EscrowResponse> {
    if (!this.appId) {
      return { success: false, error: 'API not initialized', error_code: 'NOT_INITIALIZED' };
    }

    try {
      await this.logRequest('POST', `/escrows/${request.escrow_id}/refund`, request);

      // Get escrow
      const { data: escrow, error } = await supabase
        .from('escrows')
        .select('*, recipient:users!recipient_id(*)')
        .eq('id', request.escrow_id)
        .eq('external_app_id', this.appId)
        .single();

      if (error || !escrow) {
        return { success: false, error: 'Escrow not found', error_code: 'NOT_FOUND' };
      }

      // Verify authorizer is the recipient (or admin via dispute)
      if ((escrow.recipient as any)?.pi_id !== request.authorized_by) {
        return { 
          success: false, 
          error: 'Only recipient can initiate refund. Sender must open dispute.',
          error_code: 'UNAUTHORIZED'
        };
      }

      // Use escrowWallet service for refund
      const result = await escrowWallet.refundEscrow(
        escrow.id, 
        escrow.recipient_id, 
        request.refund_reason
      );

      if (!result.success) {
        return { 
          success: false, 
          error: result.error || 'Refund failed',
          error_code: 'REFUND_FAILED'
        };
      }

      // Track withdrawal
      await supabase.from('withdrawal_tracking').insert({
        escrow_id: escrow.id,
        user_id: escrow.sender_id,
        amount: escrow.amount,
        transaction_type: 'refund',
      });

      // Trigger webhook
      await this.triggerWebhook(WEBHOOK_EVENTS.REFUND_COMPLETED, {
        ...escrow,
        status: 'refunded',
        refund_reason: request.refund_reason,
      });

      return {
        success: true,
        escrow_id: escrow.id,
        pmarts_reference: escrow.pmarts_reference,
        status: 'refunded',
      };
    } catch (err: any) {
      return { success: false, error: err.message, error_code: 'INTERNAL_ERROR' };
    }
  }

  /**
   * Open a dispute
   * POST /api/v1/escrows/:escrow_id/dispute
   */
  async openDispute(params: {
    escrow_id: string;
    opened_by: string;  // Pi ID
    reason: string;
    evidence?: string[];  // URLs to evidence
  }): Promise<{ success: boolean; dispute_id?: string; error?: string }> {
    if (!this.appId) {
      return { success: false, error: 'API not initialized' };
    }

    try {
      await this.logRequest('POST', `/escrows/${params.escrow_id}/dispute`, params);

      // Get escrow
      const { data: escrow } = await supabase
        .from('escrows')
        .select('*, sender:users!sender_id(id, pi_id), recipient:users!recipient_id(id, pi_id)')
        .eq('id', params.escrow_id)
        .eq('external_app_id', this.appId)
        .single();

      if (!escrow) {
        return { success: false, error: 'Escrow not found' };
      }

      // Find user
      const user = (escrow.sender as any)?.pi_id === params.opened_by 
        ? escrow.sender 
        : (escrow.recipient as any)?.pi_id === params.opened_by 
          ? escrow.recipient 
          : null;

      if (!user) {
        return { success: false, error: 'User not authorized for this escrow' };
      }

      const result = await escrowWallet.openDispute(
        params.escrow_id,
        (user as any).id,
        params.reason
      );

      if (!result.success) {
        return { success: false, error: result.error };
      }

      // Trigger webhook
      await this.triggerWebhook(WEBHOOK_EVENTS.DISPUTED, {
        ...escrow,
        status: 'disputed',
        dispute_reason: params.reason,
      });

      return {
        success: true,
        dispute_id: result.dispute_id,
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Get user reputation score
   * GET /api/v1/users/:user_id/reputation
   */
  async getUserReputation(userPiId: string): Promise<{
    success: boolean;
    reputation?: {
      trust_score: number;
      completed_transactions: number;
      risk_level: string;
      dispute_rate: number;
      account_age_days: number;
    };
    error?: string;
  }> {
    if (!this.appId) {
      return { success: false, error: 'API not initialized' };
    }

    try {
      await this.logRequest('GET', `/users/${userPiId}/reputation`, {});

      // Find user by Pi ID
      const { data: user } = await supabase
        .from('users')
        .select('id')
        .eq('pi_id', userPiId)
        .single();

      if (!user) {
        return { success: false, error: 'User not found' };
      }

      const result = await fraudService.getReputationScore(user.id);
      return result;
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Check user fraud risk
   * GET /api/v1/users/:user_id/risk
   */
  async checkUserRisk(userPiId: string, amount?: number): Promise<{
    success: boolean;
    risk?: {
      risk_level: string;
      risk_score: number;
      allowed: boolean;
      flags: string[];
      requires_approval: boolean;
      reason?: string;
    };
    error?: string;
  }> {
    if (!this.appId) {
      return { success: false, error: 'API not initialized' };
    }

    try {
      await this.logRequest('GET', `/users/${userPiId}/risk`, { amount });

      // Find user by Pi ID
      const { data: user } = await supabase
        .from('users')
        .select('id')
        .eq('pi_id', userPiId)
        .single();

      if (!user) {
        return { success: false, error: 'User not found' };
      }

      const riskCheck = await fraudService.checkTransactionRisk({
        userId: user.id,
        amount: amount || 0,
      });

      return {
        success: true,
        risk: {
          risk_level: riskCheck.risk_level,
          risk_score: riskCheck.risk_score,
          allowed: riskCheck.allowed,
          flags: riskCheck.flags,
          requires_approval: riskCheck.requires_approval,
          reason: riskCheck.block_reason,
        },
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Get fee estimate for an amount
   * GET /api/v1/fees/estimate
   */
  async getFeeEstimate(amount: number, senderPiId?: string): Promise<{
    success: boolean;
    fee?: {
      fee_amount: number;
      net_amount: number;
      fee_rate: number;
      discount_percent: number;
    };
    error?: string;
  }> {
    if (!this.appId) {
      return { success: false, error: 'API not initialized' };
    }

    try {
      await this.logRequest('GET', '/fees/estimate', { amount, senderPiId });

      // Find sender if provided
      let senderId: string | undefined;
      if (senderPiId) {
        const { data: sender } = await supabase
          .from('users')
          .select('id')
          .eq('pi_id', senderPiId)
          .single();
        senderId = sender?.id;
      }

      const result = await feeService.calculateFee(amount, senderId || '', this.appId);
      
      if (!result.success || !result.fee) {
        return { success: false, error: result.error || 'Fee calculation failed' };
      }

      return {
        success: true,
        fee: {
          fee_amount: result.fee.feeAmount,
          net_amount: result.fee.netAmount,
          fee_rate: result.fee.feeRate,
          discount_percent: result.fee.discountPercent,
        },
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Get app analytics/stats
   * GET /api/v1/stats
   */
  async getAppStats(): Promise<{
    success: boolean;
    stats?: {
      total_escrows: number;
      total_volume: number;
      escrows_by_status: Record<string, number>;
      monthly_volume: number;
      monthly_escrows: number;
      avg_escrow_amount: number;
    };
    error?: string;
  }> {
    if (!this.appId) {
      return { success: false, error: 'API not initialized' };
    }

    try {
      await this.logRequest('GET', '/stats', {});

      // Get app totals
      const { data: app } = await supabase
        .from('api_apps')
        .select('total_escrows, total_volume')
        .eq('id', this.appId)
        .single();

      // Get escrows by status
      const { data: escrows } = await supabase
        .from('escrows')
        .select('status, amount')
        .eq('external_app_id', this.appId);

      const escrowsByStatus: Record<string, number> = {};
      let totalAmount = 0;
      
      escrows?.forEach((e: any) => {
        escrowsByStatus[e.status] = (escrowsByStatus[e.status] || 0) + 1;
        totalAmount += parseFloat(e.amount);
      });

      // Get monthly stats
      const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data: monthlyEscrows } = await supabase
        .from('escrows')
        .select('amount')
        .eq('external_app_id', this.appId)
        .gte('created_at', monthAgo);

      const monthlyVolume = monthlyEscrows?.reduce((sum: number, e: any) => sum + parseFloat(e.amount), 0) || 0;

      return {
        success: true,
        stats: {
          total_escrows: app?.total_escrows || 0,
          total_volume: parseFloat(app?.total_volume) || 0,
          escrows_by_status: escrowsByStatus,
          monthly_volume: monthlyVolume,
          monthly_escrows: monthlyEscrows?.length || 0,
          avg_escrow_amount: escrows?.length ? totalAmount / escrows.length : 0,
        },
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Trigger webhook to app
   */
  private async triggerWebhook(event: string, escrow: any): Promise<void> {
    if (!this.appId) return;

    try {
      // Get app webhook URL
      const { data: app } = await supabase
        .from('api_apps')
        .select('webhook_url, api_secret_hash')
        .eq('id', this.appId)
        .single();

      if (!app?.webhook_url) return;

      // Check if event is requested
      const webhookEvents = escrow.metadata?.webhook_events || Object.values(WEBHOOK_EVENTS);
      if (!webhookEvents.includes(event)) return;

      const payload: WebhookPayload = {
        event,
        timestamp: new Date().toISOString(),
        escrow_id: escrow.id,
        pmarts_reference: escrow.pmarts_reference,
        data: {
          status: escrow.status,
          amount: escrow.amount,
          reference_id: escrow.reference_id,
        },
        signature: '', // Would be HMAC signature using app secret
      };

      // Send webhook (fire and forget)
      fetch(app.webhook_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PMARTS-Signature': payload.signature,
          'X-PMARTS-Event': event,
        },
        body: JSON.stringify(payload),
      }).catch(err => debugError('Webhook failed:', err));

    } catch (err) {
      debugError('Failed to trigger webhook:', err);
    }
  }

  /**
   * Log API request
   */
  private async logRequest(method: string, endpoint: string, body: any): Promise<void> {
    if (!this.appId) return;

    await supabase.from('api_request_logs').insert({
      app_id: this.appId,
      endpoint,
      method,
      request_body: body,
    });
  }
}

// ============================================
// Export API instance
// ============================================
export const pmartsAPI = new UniversalEscrowAPI();

// ============================================
// API Registration Functions
// ============================================

/**
 * Register a new app to use PMARTS API
 */
export async function registerApp(params: {
  app_name: string;
  app_description?: string;
  owner_pi_id: string;
  webhook_url?: string;
}): Promise<{ success: boolean; api_key?: string; api_secret?: string; error?: string }> {
  try {
    // Find owner
    const { data: owner } = await supabase
      .from('users')
      .select('id')
      .eq('pi_id', params.owner_pi_id)
      .single();

    if (!owner) {
      return { success: false, error: 'Owner must be a registered PMARTS user' };
    }

    // Generate API credentials
    const apiKey = `pmarts_${generateRandomString(32)}`;
    const apiSecret = `pms_${generateRandomString(48)}`;
    const apiSecretHash = await hashSecret(apiSecret);

    const { data: app, error } = await supabase
      .from('api_apps')
      .insert({
        app_name: params.app_name,
        app_description: params.app_description,
        owner_user_id: owner.id,
        api_key: apiKey,
        api_secret_hash: apiSecretHash,
        webhook_url: params.webhook_url,
      })
      .select()
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return {
      success: true,
      api_key: apiKey,
      api_secret: apiSecret, // Only returned once!
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// Helper functions
function generateRandomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function hashSecret(secret: string): Promise<string> {
  // In production, use proper crypto hashing
  // This is a placeholder
  const encoder = new TextEncoder();
  const data = encoder.encode(secret);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

