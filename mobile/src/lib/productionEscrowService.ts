/**
 * PMARTS Production Escrow Service
 * Full escrow lifecycle with ledger integration
 */

import { supabase } from './supabase';
import { ledgerService } from './ledgerService';
import { feeService } from './feeService';
import { fraudService } from './fraudService';
import { getUserById, isUuid, resolveUserByIdOrPiId, updateUserById } from './userResolver';
import type { 
  Escrow, 
  EscrowStatus, 
  EscrowWithUsers,
  CreateEscrowRequest,
  CreateEscrowResponse
} from '../types/database';

// PMARTS escrow wallet address (would be from env in production)
const PMARTS_ESCROW_WALLET = process.env.PMARTS_ESCROW_WALLET || 'GPMARTS_ESCROW_WALLET_ADDRESS';

class ProductionEscrowService {
  // ============================================
  // ESCROW CREATION
  // ============================================

  /**
   * Create a new escrow with full validation
   */
  async createEscrow(
    senderId: string,
    request: CreateEscrowRequest
  ): Promise<CreateEscrowResponse> {
    // 1. Validate sender exists (accept UUID or pi_id)
    const sender = await resolveUserByIdOrPiId(senderId);
    const senderUserId = sender?.id;

    if (!sender || !senderUserId) {
      throw new Error('Sender not found');
    }

    if (sender.is_suspended) {
      throw new Error('Account is suspended');
    }

    // 2. Resolve recipient (by ID or PMARTS ID)
    let recipientId = request.recipient_id;
    if (request.recipient_pmarts_id) {
      const { data: recipient } = await supabase
        .from('users')
        .select('id')
        .eq('pmarts_id', request.recipient_pmarts_id)
        .single();
      
      if (!recipient) {
        throw new Error('Recipient not found');
      }
      recipientId = recipient.id;
    }

    // If recipient_id was provided as a non-UUID identifier, resolve it via pi_id
    if (recipientId && !isUuid(recipientId)) {
      const resolvedRecipient = await resolveUserByIdOrPiId(recipientId);
      if (!resolvedRecipient) {
        throw new Error('Recipient not found');
      }
      recipientId = resolvedRecipient.id;
    }

    if (senderUserId === recipientId) {
      throw new Error('Cannot create escrow with yourself');
    }

    // 3. Fraud check
    const riskCheck = await fraudService.checkTransactionRisk({
      userId: senderUserId,
      amount: request.amount,
      recipientId: recipientId,
    });

    if (riskCheck.risk_level === 'blocked') {
      throw new Error('Transaction blocked due to risk assessment');
    }

    if (riskCheck.risk_level === 'critical') {
      // Allow but flag for review
      await this.createFraudFlag(senderUserId, 'high_risk_pattern', 'critical', 
        `High risk transaction: ${request.amount} Pi`);
    }

    // 4. Calculate fee
    const feeResult = await feeService.calculateFee(request.amount, senderUserId);
    const fee = feeResult.fee?.feeAmount || request.amount * 0.01;
    const netAmount = request.amount - fee;

    // 5. Calculate auto-release time if specified
    let autoReleaseAt: string | null = null;
    if (request.auto_release_hours) {
      const releaseDate = new Date();
      releaseDate.setHours(releaseDate.getHours() + request.auto_release_hours);
      autoReleaseAt = releaseDate.toISOString();
    }

    // 6. Create escrow
    const { data: escrow, error } = await supabase
      .from('escrows')
      .insert({
        sender_id: senderUserId,
        recipient_id: recipientId,
        amount: request.amount,
        fee,
        net_amount: netAmount,
        description: request.description,
        reference_id: request.reference_id,
        auto_release_at: autoReleaseAt,
        status: 'created',
      })
      .select()
      .single();

    if (error) throw error;

    // 7. Create audit log
    await this.createAuditLog(senderUserId, 'escrow_created', 'escrow', escrow.id, {
      amount: request.amount,
      fee,
      recipient_id: recipientId,
    });

    return {
      escrow,
      fee,
      net_amount: netAmount,
      payment_instructions: {
        amount: request.amount,
        wallet_address: PMARTS_ESCROW_WALLET,
        memo: `PMARTS_${escrow.escrow_code}`,
      },
    };
  }

  // ============================================
  // DEPOSIT HANDLING
  // ============================================

  /**
   * Process deposit from Pi SDK
   */
  async processDeposit(
    escrowId: string,
    piPaymentId: string,
    txHash?: string
  ): Promise<Escrow> {
    // 1. Get escrow
    const escrow = await this.getEscrow(escrowId);
    
    if (!escrow) {
      throw new Error('Escrow not found');
    }

    if (escrow.status !== 'created' && escrow.status !== 'deposit_pending') {
      throw new Error(`Invalid escrow status: ${escrow.status}`);
    }

    // 2. Create payment record
    const payment = await ledgerService.createPayment(
      escrowId,
      'deposit',
      escrow.amount,
      {
        sender_wallet: undefined, // Will be filled from Pi SDK
        pmarts_wallet: PMARTS_ESCROW_WALLET,
      }
    );

    // 3. Update payment with Pi SDK details
    const updatedPayment = await ledgerService.updatePaymentSubmitted(
      payment.id,
      piPaymentId
    );

    // 4. Update escrow status
    await this.updateEscrowStatus(escrowId, 'deposit_pending');

    // If we have tx_hash, confirm immediately
    if (txHash) {
      return this.confirmDeposit(escrowId, piPaymentId, txHash);
    }

    return this.getEscrow(escrowId) as Promise<Escrow>;
  }

  /**
   * Confirm deposit on blockchain
   */
  async confirmDeposit(
    escrowId: string,
    piPaymentId: string,
    txHash: string
  ): Promise<Escrow> {
    const escrow = await this.getEscrow(escrowId);
    
    if (!escrow) {
      throw new Error('Escrow not found');
    }

    // 1. Get payment record
    const { data: payment } = await supabase
      .from('payments')
      .select('*')
      .eq('escrow_id', escrowId)
      .eq('payment_type', 'deposit')
      .single();

    if (payment) {
      // 2. Confirm payment
      await ledgerService.confirmPayment(payment.id, txHash);

      // 3. Record ledger entries
      await ledgerService.recordDeposit(
        escrowId,
        escrow.sender_id,
        escrow.amount,
        payment.id
      );

      await ledgerService.recordHold(escrowId, escrow.amount);
    }

    // 4. Update escrow to funds_held
    await this.updateEscrowStatus(escrowId, 'funds_held');

    // 5. Send notifications
    await this.notify(escrow.sender_id, 'deposit_received', 
      `Your deposit of ${escrow.amount} Pi is now held in escrow`);
    await this.notify(escrow.recipient_id, 'escrow_created',
      `New escrow of ${escrow.amount} Pi created for you`);

    // 6. Audit
    await this.createAuditLog(escrow.sender_id, 'deposit_confirmed', 'escrow', escrowId, {
      tx_hash: txHash,
      amount: escrow.amount,
    });

    return this.getEscrow(escrowId) as Promise<Escrow>;
  }

  // ============================================
  // DELIVERY CONFIRMATION
  // ============================================

  /**
   * Recipient confirms delivery, triggers release
   */
  async confirmDelivery(
    escrowId: string,
    recipientId: string
  ): Promise<Escrow> {
    const escrow = await this.getEscrow(escrowId);
    
    if (!escrow) {
      throw new Error('Escrow not found');
    }

    if (escrow.recipient_id !== recipientId) {
      throw new Error('Only recipient can confirm delivery');
    }

    if (escrow.status !== 'funds_held' && escrow.status !== 'delivery_in_progress') {
      throw new Error(`Cannot confirm delivery in status: ${escrow.status}`);
    }

    // Update delivery status
    await supabase
      .from('escrows')
      .update({
        delivery_confirmed: true,
        delivery_confirmed_at: new Date().toISOString(),
        status: 'release_requested',
      })
      .eq('id', escrowId);

    // Audit
    await this.createAuditLog(recipientId, 'delivery_confirmed', 'escrow', escrowId);

    return this.getEscrow(escrowId) as Promise<Escrow>;
  }

  // ============================================
  // RELEASE & REFUND
  // ============================================

  /**
   * Release funds to recipient
   */
  async releaseFunds(
    escrowId: string,
    releasedBy: string,
    isAdmin: boolean = false
  ): Promise<Escrow> {
    const escrow = await this.getEscrow(escrowId);
    
    if (!escrow) {
      throw new Error('Escrow not found');
    }

    // Validate who can release
    if (!isAdmin && escrow.sender_id !== releasedBy) {
      throw new Error('Only sender or admin can release funds');
    }

    if (!['funds_held', 'release_requested', 'delivery_in_progress'].includes(escrow.status)) {
      throw new Error(`Cannot release in status: ${escrow.status}`);
    }

    // 1. Create release payment
    const payment = await ledgerService.createPayment(
      escrowId,
      'release',
      escrow.net_amount,
      {
        pmarts_wallet: PMARTS_ESCROW_WALLET,
        // recipient_wallet would come from user profile
      }
    );

    // 2. Record ledger entries
    await ledgerService.recordRelease(
      escrowId,
      escrow.recipient_id,
      escrow.net_amount,
      payment.id
    );

    // 3. Collect fee
    if (escrow.fee > 0) {
      await ledgerService.recordFeeCollection(escrowId, escrow.fee);
      await feeService.collectFee({
        escrowId,
        grossAmount: escrow.amount,
        feeAmount: escrow.fee,
        netAmount: escrow.net_amount,
        feeRate: escrow.fee / escrow.amount,
        discountApplied: 0,
        senderId: escrow.sender_id,
      });
    }

    // 4. Update escrow status
    await this.updateEscrowStatus(escrowId, 'completed');

    // 5. Update user stats
    await this.updateUserStats(escrow.sender_id, escrow.recipient_id);

    // 6. Notifications
    await this.notify(escrow.recipient_id, 'payment_released',
      `${escrow.net_amount} Pi has been released to you`);
    await this.notify(escrow.sender_id, 'escrow_completed',
      `Your escrow of ${escrow.amount} Pi is complete`);

    // 7. Audit
    await this.createAuditLog(releasedBy, 'funds_released', 'escrow', escrowId, {
      net_amount: escrow.net_amount,
      fee: escrow.fee,
      is_admin: isAdmin,
    });

    return this.getEscrow(escrowId) as Promise<Escrow>;
  }

  /**
   * Refund funds to sender
   */
  async refundFunds(
    escrowId: string,
    refundedBy: string,
    isAdmin: boolean = false,
    reason?: string
  ): Promise<Escrow> {
    const escrow = await this.getEscrow(escrowId);
    
    if (!escrow) {
      throw new Error('Escrow not found');
    }

    // Validate who can refund
    if (!isAdmin && escrow.recipient_id !== refundedBy) {
      throw new Error('Only recipient or admin can initiate refund');
    }

    if (!['funds_held', 'disputed'].includes(escrow.status)) {
      throw new Error(`Cannot refund in status: ${escrow.status}`);
    }

    // 1. Create refund payment
    const payment = await ledgerService.createPayment(
      escrowId,
      'refund',
      escrow.amount, // Full amount refund (no fee on refund)
      {
        pmarts_wallet: PMARTS_ESCROW_WALLET,
        // sender_wallet would come from user profile
      }
    );

    // 2. Record ledger entry
    await ledgerService.recordRefund(
      escrowId,
      escrow.sender_id,
      escrow.amount,
      payment.id
    );

    // 3. Update escrow status
    await supabase
      .from('escrows')
      .update({
        status: 'refunded',
        cancelled_by: refundedBy,
        cancelled_reason: reason || 'Refund requested',
      })
      .eq('id', escrowId);

    // 4. Notifications
    await this.notify(escrow.sender_id, 'payment_refunded',
      `${escrow.amount} Pi has been refunded to you`);
    await this.notify(escrow.recipient_id, 'escrow_refunded',
      `Escrow of ${escrow.amount} Pi has been refunded`);

    // 5. Audit
    await this.createAuditLog(refundedBy, 'funds_refunded', 'escrow', escrowId, {
      amount: escrow.amount,
      reason,
      is_admin: isAdmin,
    });

    return this.getEscrow(escrowId) as Promise<Escrow>;
  }

  /**
   * Cancel escrow (only if not yet funded)
   */
  async cancelEscrow(
    escrowId: string,
    cancelledBy: string,
    reason?: string
  ): Promise<Escrow> {
    const escrow = await this.getEscrow(escrowId);
    
    if (!escrow) {
      throw new Error('Escrow not found');
    }

    if (escrow.sender_id !== cancelledBy && escrow.recipient_id !== cancelledBy) {
      throw new Error('Only parties can cancel escrow');
    }

    if (escrow.status !== 'created' && escrow.status !== 'deposit_pending') {
      throw new Error('Cannot cancel funded escrow');
    }

    await supabase
      .from('escrows')
      .update({
        status: 'cancelled',
        cancelled_by: cancelledBy,
        cancelled_reason: reason || 'Cancelled by user',
      })
      .eq('id', escrowId);

    await this.createAuditLog(cancelledBy, 'escrow_cancelled', 'escrow', escrowId, {
      reason,
    });

    return this.getEscrow(escrowId) as Promise<Escrow>;
  }

  // ============================================
  // QUERIES
  // ============================================

  /**
   * Get escrow by ID
   */
  async getEscrow(escrowId: string): Promise<Escrow | null> {
    const { data, error } = await supabase
      .from('escrows')
      .select('*')
      .eq('id', escrowId)
      .single();

    if (error) return null;
    return data;
  }

  /**
   * Get escrow by public code
   */
  async getEscrowByCode(escrowCode: string): Promise<Escrow | null> {
    const { data, error } = await supabase
      .from('escrows')
      .select('*')
      .eq('escrow_code', escrowCode)
      .single();

    if (error) return null;
    return data;
  }

  /**
   * Get escrow with full details
   */
  async getEscrowWithDetails(escrowId: string): Promise<EscrowWithUsers | null> {
    const { data, error } = await supabase
      .from('escrows')
      .select(`
        *,
        sender:users!escrows_sender_id_fkey(*),
        recipient:users!escrows_recipient_id_fkey(*)
      `)
      .eq('id', escrowId)
      .single();

    if (error) return null;
    return data as EscrowWithUsers;
  }

  /**
   * Get user's escrows
   */
  async getUserEscrows(
    userId: string,
    role?: 'sender' | 'recipient',
    status?: EscrowStatus[]
  ): Promise<Escrow[]> {
    let query = supabase.from('escrows').select('*');

    if (role === 'sender') {
      query = query.eq('sender_id', userId);
    } else if (role === 'recipient') {
      query = query.eq('recipient_id', userId);
    } else {
      query = query.or(`sender_id.eq.${userId},recipient_id.eq.${userId}`);
    }

    if (status && status.length > 0) {
      query = query.in('status', status);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  /**
   * Get escrows due for auto-release
   */
  async getAutoReleaseEscrows(): Promise<Escrow[]> {
    const { data, error } = await supabase
      .from('escrows')
      .select('*')
      .eq('status', 'funds_held')
      .not('auto_release_at', 'is', null)
      .lte('auto_release_at', new Date().toISOString());

    if (error) throw error;
    return data || [];
  }

  // ============================================
  // HELPER METHODS
  // ============================================

  private async updateEscrowStatus(
    escrowId: string,
    status: EscrowStatus
  ): Promise<void> {
    await supabase
      .from('escrows')
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', escrowId);
  }

  private async updateUserStats(
    senderId: string,
    recipientId: string
  ): Promise<void> {
    try {
      // Increment completed transactions for both users
      const { error: senderError } = await supabase.rpc('increment_user_transactions', { 
        p_user_id: senderId 
      });
      
      if (senderError) {
        // Fallback: manual increment
        const { data: sender } = await getUserById<{ completed_transactions: number }>(senderId, 'completed_transactions');
        
        if (sender) {
          await updateUserById(senderId, { completed_transactions: (sender.completed_transactions || 0) + 1 });
        }
      }

      await supabase.rpc('increment_user_transactions', { 
        p_user_id: recipientId 
      });
    } catch {
      // Silently handle errors
    }
  }

  private async notify(
    userId: string,
    type: string,
    message: string
  ): Promise<void> {
    try {
      await supabase.from('notifications').insert({
        user_id: userId,
        type,
        notification_type: type,
        message,
        title: type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      });
    } catch {
      // Don't fail if notification fails
    }
  }

  private async createAuditLog(
    userId: string,
    action: string,
    entityType: string,
    entityId: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    try {
      await supabase.from('audit_logs').insert({
        user_id: userId,
        actor_id: userId,
        action,
        entity_type: entityType,
        entity_id: entityId,
        metadata: metadata || {},
      });
    } catch {
      // Silent fail
    }
  }

  private async createFraudFlag(
    userId: string,
    flagType: string,
    severity: string,
    description: string
  ): Promise<void> {
    try {
      await supabase.from('fraud_flags').insert({
        user_id: userId,
        flag_type: flagType,
        severity,
        description,
      });
    } catch {
      // Silent fail
    }
  }
}

export const productionEscrowService = new ProductionEscrowService();

