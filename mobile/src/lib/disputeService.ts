/**
 * PMARTS Dispute Resolution Service
 * Handles dispute workflow, evidence, and resolution
 */

import { supabase } from './supabase';

// ============================================
// Types
// ============================================

export type DisputeType = 
  | 'non_delivery'
  | 'not_as_described'
  | 'quality_issue'
  | 'fraud'
  | 'communication'
  | 'other';

export type DisputeStatus = 
  | 'open'
  | 'evidence_collection'
  | 'under_review'
  | 'mediation'
  | 'escalated'
  | 'resolved_sender'
  | 'resolved_recipient'
  | 'resolved_split'
  | 'withdrawn'
  | 'expired';

export type ResolutionType = 
  | 'full_refund'
  | 'partial_refund'
  | 'release_to_recipient'
  | 'split'
  | 'withdrawn'
  | 'expired';

export interface DisputeCase {
  id: string;
  escrow_id: string;
  opened_by: string;
  respondent_id: string;
  dispute_type: DisputeType;
  description: string;
  amount_disputed: number;
  status: DisputeStatus;
  resolution_type?: ResolutionType;
  resolution_amount?: number;
  resolution_notes?: string;
  assigned_admin?: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  evidence_deadline: string;
  resolution_deadline: string;
  created_at: string;
  resolved_at?: string;
}

export interface DisputeMessage {
  id: string;
  dispute_id: string;
  sender_id: string;
  message: string;
  is_admin_message: boolean;
  is_system_message: boolean;
  attachments?: string[];
  created_at: string;
}

export interface DisputeTimelineEntry {
  id: string;
  dispute_id: string;
  action: string;
  actor_id?: string;
  actor_type: 'sender' | 'recipient' | 'admin' | 'system';
  details?: Record<string, any>;
  created_at: string;
}

// ============================================
// Dispute Service Class
// ============================================

class DisputeService {
  /**
   * Open a new dispute
   */
  async openDispute(params: {
    escrowId: string;
    openedBy: string;
    disputeType: DisputeType;
    description: string;
  }): Promise<{ success: boolean; dispute?: DisputeCase; error?: string }> {
    try {
      // Get escrow details
      const { data: escrow, error: escrowError } = await supabase
        .from('escrows')
        .select('*, sender:users!sender_id(id), recipient:users!recipient_id(id)')
        .eq('id', params.escrowId)
        .single();

      if (escrowError || !escrow) {
        return { success: false, error: 'Escrow not found' };
      }

      // Determine respondent
      const isOpenerSender = (escrow.sender as any).id === params.openedBy;
      const respondentId = isOpenerSender 
        ? (escrow.recipient as any).id 
        : (escrow.sender as any).id;

      // Check if dispute already exists
      const { data: existingDispute } = await supabase
        .from('dispute_cases')
        .select('id')
        .eq('escrow_id', params.escrowId)
        .not('status', 'in', '("resolved_sender","resolved_recipient","resolved_split","withdrawn","expired")')
        .single();

      if (existingDispute) {
        return { success: false, error: 'An active dispute already exists for this escrow' };
      }

      // Create dispute case
      const { data: dispute, error: createError } = await supabase
        .from('dispute_cases')
        .insert({
          escrow_id: params.escrowId,
          opened_by: params.openedBy,
          respondent_id: respondentId,
          dispute_type: params.disputeType,
          description: params.description,
          amount_disputed: escrow.amount,
          status: 'open',
          priority: escrow.amount > 100 ? 'high' : 'normal',
        })
        .select()
        .single();

      if (createError) {
        return { success: false, error: createError.message };
      }

      // Update escrow status
      await supabase
        .from('escrows')
        .update({ status: 'disputed' })
        .eq('id', params.escrowId);

      // Add timeline entry
      await this.addTimelineEntry(dispute.id, 'dispute_opened', params.openedBy, 
        isOpenerSender ? 'sender' : 'recipient', 
        { dispute_type: params.disputeType }
      );

      // Add system message
      await this.addMessage({
        disputeId: dispute.id,
        senderId: params.openedBy,
        message: `Dispute opened: ${params.description}`,
        isSystemMessage: true,
      });

      // Notify respondent
      await supabase.from('notifications').insert({
        user_id: respondentId,
        type: 'dispute',
        title: 'Dispute Opened',
        message: `A dispute has been opened for escrow ${escrow.pmarts_reference || escrow.id}`,
        escrow_id: params.escrowId,
      });

      return { success: true, dispute };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Get dispute by ID
   */
  async getDispute(disputeId: string): Promise<{ 
    success: boolean; 
    dispute?: DisputeCase; 
    error?: string 
  }> {
    try {
      const { data, error } = await supabase
        .from('dispute_cases')
        .select(`
          *,
          opener:users!opened_by(id, username, pi_id),
          respondent:users!respondent_id(id, username, pi_id),
          escrow:escrows(*)
        `)
        .eq('id', disputeId)
        .single();

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true, dispute: data };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Get disputes for an escrow
   */
  async getDisputesForEscrow(escrowId: string): Promise<{
    success: boolean;
    disputes?: DisputeCase[];
    error?: string;
  }> {
    try {
      const { data, error } = await supabase
        .from('dispute_cases')
        .select('*')
        .eq('escrow_id', escrowId)
        .order('created_at', { ascending: false });

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true, disputes: data };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Get user's disputes
   */
  async getUserDisputes(userId: string): Promise<{
    success: boolean;
    disputes?: DisputeCase[];
    error?: string;
  }> {
    try {
      const { data, error } = await supabase
        .from('dispute_cases')
        .select(`
          *,
          escrow:escrows(amount, reference_id, pmarts_reference)
        `)
        .or(`opened_by.eq.${userId},respondent_id.eq.${userId}`)
        .order('created_at', { ascending: false });

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true, disputes: data };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Add message to dispute thread
   */
  async addMessage(params: {
    disputeId: string;
    senderId: string;
    message: string;
    isAdminMessage?: boolean;
    isSystemMessage?: boolean;
    attachments?: string[];
  }): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const { data, error } = await supabase
        .from('dispute_messages')
        .insert({
          dispute_id: params.disputeId,
          sender_id: params.senderId,
          message: params.message,
          is_admin_message: params.isAdminMessage || false,
          is_system_message: params.isSystemMessage || false,
          attachments: params.attachments,
        })
        .select()
        .single();

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true, messageId: data.id };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Get messages for a dispute
   */
  async getMessages(disputeId: string): Promise<{
    success: boolean;
    messages?: DisputeMessage[];
    error?: string;
  }> {
    try {
      const { data, error } = await supabase
        .from('dispute_messages')
        .select(`
          *,
          sender:users!sender_id(id, username)
        `)
        .eq('dispute_id', disputeId)
        .order('created_at', { ascending: true });

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true, messages: data };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Add timeline entry
   */
  async addTimelineEntry(
    disputeId: string,
    action: string,
    actorId: string,
    actorType: 'sender' | 'recipient' | 'admin' | 'system',
    details?: Record<string, any>
  ): Promise<void> {
    await supabase.from('dispute_timeline').insert({
      dispute_id: disputeId,
      action,
      actor_id: actorId,
      actor_type: actorType,
      details,
    });
  }

  /**
   * Get timeline for a dispute
   */
  async getTimeline(disputeId: string): Promise<{
    success: boolean;
    timeline?: DisputeTimelineEntry[];
    error?: string;
  }> {
    try {
      const { data, error } = await supabase
        .from('dispute_timeline')
        .select('*')
        .eq('dispute_id', disputeId)
        .order('created_at', { ascending: true });

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true, timeline: data };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Submit evidence
   */
  async submitEvidence(params: {
    disputeId: string;
    userId: string;
    imageUrl: string;
    description?: string;
  }): Promise<{ success: boolean; evidenceId?: string; error?: string }> {
    try {
      // Get escrow ID from dispute
      const { data: dispute } = await supabase
        .from('dispute_cases')
        .select('escrow_id')
        .eq('id', params.disputeId)
        .single();

      if (!dispute) {
        return { success: false, error: 'Dispute not found' };
      }

      const { data, error } = await supabase
        .from('dispute_evidence')
        .insert({
          escrow_id: dispute.escrow_id,
          user_id: params.userId,
          image_url: params.imageUrl,
          description: params.description,
        })
        .select()
        .single();

      if (error) {
        return { success: false, error: error.message };
      }

      // Add timeline entry
      await this.addTimelineEntry(
        params.disputeId,
        'evidence_submitted',
        params.userId,
        'sender', // Will be corrected based on actual role
        { evidence_id: data.id }
      );

      return { success: true, evidenceId: data.id };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Update dispute status
   */
  async updateStatus(
    disputeId: string,
    newStatus: DisputeStatus,
    actorId: string,
    actorType: 'sender' | 'recipient' | 'admin' | 'system'
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase
        .from('dispute_cases')
        .update({ 
          status: newStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', disputeId);

      if (error) {
        return { success: false, error: error.message };
      }

      await this.addTimelineEntry(disputeId, `status_changed_to_${newStatus}`, actorId, actorType);

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Resolve dispute
   */
  async resolveDispute(params: {
    disputeId: string;
    resolutionType: ResolutionType;
    resolvedInFavorOf: 'sender' | 'recipient' | 'split';
    resolutionAmount?: number;
    resolutionNotes: string;
    adminId: string;
  }): Promise<{ success: boolean; error?: string }> {
    try {
      const statusMap = {
        sender: 'resolved_sender' as DisputeStatus,
        recipient: 'resolved_recipient' as DisputeStatus,
        split: 'resolved_split' as DisputeStatus,
      };

      const { data: dispute, error: fetchError } = await supabase
        .from('dispute_cases')
        .select('*, escrow:escrows(*)')
        .eq('id', params.disputeId)
        .single();

      if (fetchError || !dispute) {
        return { success: false, error: 'Dispute not found' };
      }

      // Update dispute
      const { error: updateError } = await supabase
        .from('dispute_cases')
        .update({
          status: statusMap[params.resolvedInFavorOf],
          resolution_type: params.resolutionType,
          resolution_amount: params.resolutionAmount || dispute.amount_disputed,
          resolution_notes: params.resolutionNotes,
          resolved_at: new Date().toISOString(),
        })
        .eq('id', params.disputeId);

      if (updateError) {
        return { success: false, error: updateError.message };
      }

      // Update escrow based on resolution
      let escrowStatus: string;
      if (params.resolutionType === 'full_refund' || params.resolutionType === 'partial_refund') {
        escrowStatus = 'refund_pending';
      } else if (params.resolutionType === 'release_to_recipient') {
        escrowStatus = 'release_pending';
      } else if (params.resolutionType === 'split') {
        escrowStatus = 'release_pending'; // Handle split separately
      } else {
        escrowStatus = 'cancelled';
      }

      await supabase
        .from('escrows')
        .update({ status: escrowStatus })
        .eq('id', dispute.escrow_id);

      // Add timeline entry
      await this.addTimelineEntry(
        params.disputeId,
        'dispute_resolved',
        params.adminId,
        'admin',
        {
          resolution_type: params.resolutionType,
          in_favor_of: params.resolvedInFavorOf,
          amount: params.resolutionAmount,
        }
      );

      // Add system message
      await this.addMessage({
        disputeId: params.disputeId,
        senderId: params.adminId,
        message: `Dispute resolved: ${params.resolutionNotes}`,
        isSystemMessage: true,
        isAdminMessage: true,
      });

      // Notify both parties
      const escrow = dispute.escrow as any;
      await supabase.from('notifications').insert([
        {
          user_id: escrow.sender_id,
          type: 'dispute',
          title: 'Dispute Resolved',
          message: `Your dispute has been resolved: ${params.resolutionType}`,
          escrow_id: dispute.escrow_id,
        },
        {
          user_id: escrow.recipient_id,
          type: 'dispute',
          title: 'Dispute Resolved',
          message: `The dispute has been resolved: ${params.resolutionType}`,
          escrow_id: dispute.escrow_id,
        },
      ]);

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Withdraw dispute
   */
  async withdrawDispute(
    disputeId: string,
    userId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Verify user opened the dispute
      const { data: dispute } = await supabase
        .from('dispute_cases')
        .select('opened_by, escrow_id')
        .eq('id', disputeId)
        .single();

      if (!dispute) {
        return { success: false, error: 'Dispute not found' };
      }

      if (dispute.opened_by !== userId) {
        return { success: false, error: 'Only the dispute opener can withdraw' };
      }

      // Update dispute
      await supabase
        .from('dispute_cases')
        .update({
          status: 'withdrawn',
          resolution_type: 'withdrawn',
          resolved_at: new Date().toISOString(),
        })
        .eq('id', disputeId);

      // Restore escrow status
      await supabase
        .from('escrows')
        .update({ status: 'funds_held' })
        .eq('id', dispute.escrow_id);

      await this.addTimelineEntry(disputeId, 'dispute_withdrawn', userId, 'sender');

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Get pending disputes for admin queue
   */
  async getAdminQueue(adminId?: string): Promise<{
    success: boolean;
    disputes?: DisputeCase[];
    error?: string;
  }> {
    try {
      let query = supabase
        .from('dispute_cases')
        .select(`
          *,
          escrow:escrows(amount, reference_id),
          opener:users!opened_by(username),
          respondent:users!respondent_id(username)
        `)
        .in('status', ['open', 'evidence_collection', 'under_review', 'mediation', 'escalated'])
        .order('priority', { ascending: false })
        .order('created_at', { ascending: true });

      if (adminId) {
        query = query.eq('assigned_admin', adminId);
      }

      const { data, error } = await query;

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true, disputes: data };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
}

export const disputeService = new DisputeService();

