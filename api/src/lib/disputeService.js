const logger = require('./logger');

/**
 * PMARTS Dispute Resolution Service
 * 
 * Full dispute workflow:
 * 1. User files dispute with reason + evidence
 * 2. Counter-party can respond with evidence
 * 3. Admin reviews case
 * 4. Resolution: RELEASE or REFUND
 * 
 * Evidence types supported:
 * - Screenshots
 * - Chat logs
 * - Contracts/agreements
 * - Delivery proofs
 * - Third-party confirmations
 */

const supabase = require('./supabase');
const audit = require('./audit');
const escrowWalletService = require('./escrowWalletService');
const { updateUserById } = require('./userResolver');

/**
 * Dispute statuses
 */
const DISPUTE_STATUS = {
  OPEN: 'open',
  PENDING_RESPONSE: 'pending_response',
  UNDER_REVIEW: 'under_review',
  ESCALATED: 'escalated',
  RESOLVED: 'resolved',
  CLOSED: 'closed',
};

/**
 * Dispute reasons (predefined categories)
 */
const DISPUTE_REASONS = {
  NOT_RECEIVED: 'item_not_received',
  NOT_AS_DESCRIBED: 'not_as_described',
  DAMAGED: 'item_damaged',
  PARTIAL_DELIVERY: 'partial_delivery',
  WRONG_ITEM: 'wrong_item',
  SERVICE_NOT_COMPLETED: 'service_not_completed',
  QUALITY_ISSUE: 'quality_issue',
  SCAM: 'suspected_scam',
  OTHER: 'other',
};

/**
 * Resolution types
 */
const RESOLUTION_TYPES = {
  FULL_REFUND: 'full_refund',
  PARTIAL_REFUND: 'partial_refund',
  RELEASE_TO_RECIPIENT: 'release_to_recipient',
  SPLIT: 'split', // Split between sender and recipient
  NO_ACTION: 'no_action', // Invalid dispute, no change
};

/**
 * Evidence types
 */
const EVIDENCE_TYPES = {
  SCREENSHOT: 'screenshot',
  CHAT_LOG: 'chat_log',
  CONTRACT: 'contract',
  DELIVERY_PROOF: 'delivery_proof',
  TRACKING_INFO: 'tracking_info',
  PHOTO: 'photo',
  VIDEO: 'video',
  OTHER: 'other',
};

// ============================================
// DISPUTE CREATION
// ============================================

/**
 * Create a new dispute
 * 
 * @param {Object} params - Dispute parameters
 * @returns {Promise<Object>} Created dispute
 */
async function createDispute(params) {
  const { escrowId, reportedBy, reason, description, evidenceUrls = [] } = params;

  try {
    // Get escrow details
    const { data: escrow, error: escrowError } = await supabase
      .from('escrows')
      .select('*, sender:sender_id(*), recipient:recipient_id(*)')
      .eq('id', escrowId)
      .single();

    if (escrowError || !escrow) {
      return { success: false, error: 'Escrow not found' };
    }

    // Validate escrow can be disputed
    if (!['held', 'releasing'].includes(escrow.status)) {
      return {
        success: false,
        error: `Cannot dispute escrow in ${escrow.status} status`,
      };
    }

    // Validate user is party to escrow
    if (reportedBy !== escrow.sender_id && reportedBy !== escrow.recipient_id) {
      return {
        success: false,
        error: 'Only sender or recipient can file dispute',
      };
    }

    // Check for existing open dispute
    const { data: existingDispute } = await supabase
      .from('disputes')
      .select('id')
      .eq('escrow_id', escrowId)
      .in('status', [DISPUTE_STATUS.OPEN, DISPUTE_STATUS.PENDING_RESPONSE, DISPUTE_STATUS.UNDER_REVIEW])
      .single();

    if (existingDispute) {
      return {
        success: false,
        error: 'A dispute is already open for this escrow',
      };
    }

    // Determine counter-party
    const counterParty = reportedBy === escrow.sender_id ? escrow.recipient_id : escrow.sender_id;
    const filedByRole = reportedBy === escrow.sender_id ? 'sender' : 'recipient';

    // Create dispute
    const { data: dispute, error: createError } = await supabase
      .from('disputes')
      .insert({
        escrow_id: escrowId,
        reported_by: reportedBy,
        reported_by_role: filedByRole,
        counter_party: counterParty,
        reason,
        description,
        status: DISPUTE_STATUS.OPEN,
        priority: escrow.amount > 100 ? 'high' : 'normal', // High priority for large amounts
        response_deadline: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(), // 48h to respond
      })
      .select()
      .single();

    if (createError) {
      logger.error('Create dispute error:', createError);
      return { success: false, error: 'Failed to create dispute' };
    }

    // Add initial evidence
    if (evidenceUrls.length > 0) {
      await addEvidence(dispute.id, reportedBy, evidenceUrls);
    }

    // Update escrow status
    await supabase
      .from('escrows')
      .update({
        status: 'disputed',
        disputed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', escrowId);

    // Update user's dispute count
    await updateUserById(reportedBy, {
      disputes_opened: supabase.raw('disputes_opened + 1'),
    });

    // Notify counter-party
    await supabase
      .from('notifications')
      .insert({
        user_id: counterParty,
        type: 'dispute_filed',
        title: '⚠️ Dispute Filed',
        message: `A dispute has been filed for ${escrow.amount} Pi escrow. Please respond within 48 hours.`,
        escrow_id: escrowId,
        data: { dispute_id: dispute.id },
      });

    // Create audit log
    await createAuditLog({
      action: 'dispute_created',
      disputeId: dispute.id,
      escrowId,
      actor: reportedBy,
      details: { reason, amount: escrow.amount },
    });

    return {
      success: true,
      dispute,
      responseDeadline: dispute.response_deadline,
    };

  } catch (error) {
    logger.error('Create dispute error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================
// EVIDENCE MANAGEMENT
// ============================================

/**
 * Add evidence to dispute
 */
async function addEvidence(disputeId, submittedBy, evidenceItems) {
  try {
    const entries = evidenceItems.map(item => ({
      dispute_id: disputeId,
      submitted_by: submittedBy,
      type: item.type || EVIDENCE_TYPES.OTHER,
      url: item.url,
      description: item.description,
      file_name: item.fileName,
    }));

    const { data, error } = await supabase
      .from('dispute_evidence')
      .insert(entries)
      .select();

    if (error) throw error;

    return { success: true, evidence: data };

  } catch (error) {
    logger.error('Add evidence error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get all evidence for a dispute
 */
async function getDisputeEvidence(disputeId) {
  const { data, error } = await supabase
    .from('dispute_evidence')
    .select('*, submitter:submitted_by(id, username)')
    .eq('dispute_id', disputeId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data;
}

// ============================================
// DISPUTE RESPONSE
// ============================================

/**
 * Counter-party responds to dispute
 */
async function respondToDispute(params) {
  const { disputeId, respondedBy, response, evidenceUrls = [] } = params;

  try {
    // Get dispute
    const { data: dispute, error: fetchError } = await supabase
      .from('disputes')
      .select('*')
      .eq('id', disputeId)
      .single();

    if (fetchError || !dispute) {
      return { success: false, error: 'Dispute not found' };
    }

    // Validate responder is counter-party
    if (respondedBy !== dispute.counter_party) {
      return {
        success: false,
        error: 'Only the counter-party can respond',
      };
    }

    // Validate dispute is open
    if (dispute.status !== DISPUTE_STATUS.OPEN) {
      return {
        success: false,
        error: `Cannot respond to dispute in ${dispute.status} status`,
      };
    }

    // Add response
    const { error: updateError } = await supabase
      .from('disputes')
      .update({
        counter_response: response,
        counter_responded_at: new Date().toISOString(),
        status: DISPUTE_STATUS.UNDER_REVIEW,
        updated_at: new Date().toISOString(),
      })
      .eq('id', disputeId);

    if (updateError) throw updateError;

    // Add evidence
    if (evidenceUrls.length > 0) {
      await addEvidence(disputeId, respondedBy, evidenceUrls);
    }

    // Notify original filer
    await supabase
      .from('notifications')
      .insert({
        user_id: dispute.reported_by,
        type: 'dispute_response',
        title: '📝 Dispute Response Received',
        message: 'The other party has responded to your dispute. An admin will review the case.',
        escrow_id: dispute.escrow_id,
      });

    return {
      success: true,
      message: 'Response submitted. Dispute is now under review.',
    };

  } catch (error) {
    logger.error('Respond to dispute error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================
// ADMIN RESOLUTION
// ============================================

/**
 * Admin resolves the dispute
 */
async function resolveDispute(params) {
  const { disputeId, adminId, resolution, resolutionNotes, splitPercentage } = params;

  try {
    // Get dispute with escrow
    const { data: dispute, error: fetchError } = await supabase
      .from('disputes')
      .select('*, escrow:escrow_id(*)')
      .eq('id', disputeId)
      .single();

    if (fetchError || !dispute) {
      return { success: false, error: 'Dispute not found' };
    }

    // Validate dispute is resolvable
    if (![DISPUTE_STATUS.UNDER_REVIEW, DISPUTE_STATUS.ESCALATED, DISPUTE_STATUS.OPEN].includes(dispute.status)) {
      return {
        success: false,
        error: `Cannot resolve dispute in ${dispute.status} status`,
      };
    }

    const escrow = dispute.escrow;
    let finalResolution = resolution;
    let senderAmount = 0;
    let recipientAmount = 0;

    // Calculate amounts based on resolution
    switch (resolution) {
      case RESOLUTION_TYPES.FULL_REFUND:
        senderAmount = escrow.amount;
        recipientAmount = 0;
        // Process refund
        await escrowWalletService.refundEscrow(
          escrow.id,
          `Dispute resolved: ${resolutionNotes}`,
          adminId
        );
        break;

      case RESOLUTION_TYPES.RELEASE_TO_RECIPIENT:
        senderAmount = 0;
        recipientAmount = escrow.amount;
        // Process release
        await escrowWalletService.releaseEscrow(escrow.id, adminId);
        break;

      case RESOLUTION_TYPES.PARTIAL_REFUND:
        // Split based on admin decision
        const refundPercent = splitPercentage || 50;
        senderAmount = escrow.amount * (refundPercent / 100);
        recipientAmount = escrow.amount - senderAmount;
        // Would need custom split logic (advanced feature)
        logger.info(`Split: ${senderAmount} to sender, ${recipientAmount} to recipient`);
        break;

      case RESOLUTION_TYPES.NO_ACTION:
        // Invalid dispute, no funds movement
        break;

      default:
        return { success: false, error: 'Invalid resolution type' };
    }

    // Update dispute
    const { error: updateError } = await supabase
      .from('disputes')
      .update({
        status: DISPUTE_STATUS.RESOLVED,
        resolution,
        resolution_notes: resolutionNotes,
        admin_id: adminId,
        resolved_at: new Date().toISOString(),
        sender_amount: senderAmount,
        recipient_amount: recipientAmount,
        updated_at: new Date().toISOString(),
      })
      .eq('id', disputeId);

    if (updateError) throw updateError;

    // Update loser's dispute_lost count
    if (resolution === RESOLUTION_TYPES.FULL_REFUND) {
      // Recipient lost
      await updateUserById(escrow.recipient_id, { disputes_lost: supabase.raw('disputes_lost + 1') });
    } else if (resolution === RESOLUTION_TYPES.RELEASE_TO_RECIPIENT) {
      // Sender lost (filed invalid dispute)
      await updateUserById(dispute.reported_by, { disputes_lost: supabase.raw('disputes_lost + 1') });
    }

    // Recalculate trust scores
    await escrowWalletService.recalculateTrustScore(escrow.sender_id);
    await escrowWalletService.recalculateTrustScore(escrow.recipient_id);

    // Notify both parties
    const notifyBoth = [
      {
        user_id: escrow.sender_id,
        type: 'dispute_resolved',
        title: '✅ Dispute Resolved',
        message: `Your dispute has been resolved: ${resolution.replace(/_/g, ' ')}`,
        escrow_id: escrow.id,
      },
      {
        user_id: escrow.recipient_id,
        type: 'dispute_resolved',
        title: '✅ Dispute Resolved',
        message: `A dispute involving you has been resolved: ${resolution.replace(/_/g, ' ')}`,
        escrow_id: escrow.id,
      },
    ];

    await supabase.from('notifications').insert(notifyBoth);

    // Audit log
    await createAuditLog({
      action: 'dispute_resolved',
      disputeId,
      escrowId: escrow.id,
      actor: adminId,
      details: { resolution, senderAmount, recipientAmount },
    });

    return {
      success: true,
      resolution,
      senderAmount,
      recipientAmount,
    };

  } catch (error) {
    logger.error('Resolve dispute error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================
// DISPUTE QUERIES
// ============================================

/**
 * Get dispute by ID
 */
async function getDispute(disputeId) {
    const { data, error } = await supabase
    .from('disputes')
    .select(`
      *,
      escrow:escrow_id(*),
      filer:reported_by(id, username, trust_score),
      counter:counter_party(id, username, trust_score),
      admin:admin_id(id, username)
    `)
    .eq('id', disputeId)
    .single();

  if (error) throw error;
  return data;
}

/**
 * Get disputes for user
 */
async function getUserDisputes(userId, status = null) {
  let query = supabase
    .from('disputes')
    .select('*, escrow:escrow_id(amount, reference_id)')
    .or(`reported_by.eq.${userId},counter_party.eq.${userId}`)
    .order('created_at', { ascending: false });

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

/**
 * Get disputes for admin review
 */
async function getDisputesForReview(adminId = null) {
  let query = supabase
    .from('disputes')
    .select(`
      *,
      escrow:escrow_id(*, sender:sender_id(username), recipient:recipient_id(username))
    `)
    .in('status', [DISPUTE_STATUS.OPEN, DISPUTE_STATUS.UNDER_REVIEW, DISPUTE_STATUS.ESCALATED])
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true });

  if (adminId) {
    query = query.or(`admin_id.is.null,admin_id.eq.${adminId}`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

/**
 * Admin claims a dispute for review
 */
async function claimDispute(disputeId, adminId) {
  try {
    const { data, error } = await supabase
      .from('disputes')
      .update({
        admin_id: adminId,
        status: DISPUTE_STATUS.UNDER_REVIEW,
        claimed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', disputeId)
      .is('admin_id', null)
      .select('*');

    if (error) throw error;

    // If no rows were updated, it was already claimed
    if (!data || (Array.isArray(data) && data.length === 0)) {
      // fetch current dispute to return who claimed it
      const current = await getDispute(disputeId).catch(() => null);
      return { success: false, error: 'Already claimed', status: 409, claimedBy: current?.admin || null };
    }

    // Return full dispute record including admin info
    const dispute = await getDispute(disputeId);
    return { success: true, dispute };
  } catch (error) {
    throw error;
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

async function createAuditLog(params) {
  try {
    const r = await audit.insertAuditLog({
      action: params.action,
      entity_type: 'dispute',
      entity_id: params.disputeId,
      metadata: { related_entity_type: params.escrowId ? 'escrow' : null, related_entity_id: params.escrowId, details: params.details },
      actor_id: params.actor,
    });
    if (!r.success) logger.error('Audit RPC error:', r.error || r);
  } catch (error) {
    logger.error('Audit log error:', error);
  }
}

module.exports = {
  // Core operations
  createDispute,
  respondToDispute,
  resolveDispute,

  // Evidence
  addEvidence,
  getDisputeEvidence,

  // Queries
  getDispute,
  getUserDisputes,
  getDisputesForReview,
  claimDispute,

  // Constants
  DISPUTE_STATUS,
  DISPUTE_REASONS,
  RESOLUTION_TYPES,
  EVIDENCE_TYPES,
};

