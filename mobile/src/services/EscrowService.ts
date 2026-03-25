/**
 * PMARTS Escrow Service
 *
 * Client-side service for escrow operations:
 * - Create escrow with fraud check
 * - Deposit via Pi payment
 * - Release/Refund funds
 * - Dispute management
 *
 * @module EscrowService
 */

import piSDK from './PiSDKService';
import { API_URL } from '../lib/api';
import { debugError } from '../lib/debugLogger';

// ============================================
// TYPES
// ============================================

export type TransactionType =
  | 'physical_product'
  | 'digital_product'
  | 'service'
  | 'currency_exchange'
  | 'instant'
  | 'donation'
  | 'custom'
  | 'other';

export type CompletionMethod =
  | 'delivery_code'
  | 'sender_release'
  | 'service_approval'
  | 'receipt_evidence'
  | 'dispute_resolution'
  | 'mutual_cancellation';

export interface Escrow {
  id: string;
  sender_id: string;
  recipient_id: string;
  amount: number;
  status: EscrowStatus;
  reference_id: string;
  pmarts_reference: string;
  note?: string;
  expires_at: string;
  created_at: string;
  risk_score?: number;
  sender?: { username: string };
  recipient?: { username: string };
  // Transaction type & completion
  transaction_type?: TransactionType;
  completion_method?: CompletionMethod;
  delivery_code?: string; // Only for sender
  code_expires_at?: string;
  code_attempts?: number;
  code_used?: boolean;
  service_completed_at?: string;
  receipt_uploaded_at?: string;
}

export type EscrowStatus =
  | 'pending'
  | 'held'
  | 'releasing'
  | 'released'
  | 'refunding'
  | 'refunded'
  | 'disputed'
  | 'expired';

export interface CreateEscrowParams {
  recipientId: string;
  amount: number;
  referenceId: string;
  note?: string;
  expiryHours?: number;
  transactionType?: TransactionType;
}

export interface Dispute {
  id: string;
  escrow_id: string;
  reported_by: string;
  reason: string;
  description?: string;
  status: DisputeStatus;
  created_at: string;
  response_deadline?: string;
}

export type DisputeStatus =
  | 'open'
  | 'pending_response'
  | 'under_review'
  | 'escalated'
  | 'resolved';

// ============================================
// API HELPERS
// ============================================

async function getAuthHeaders(): Promise<HeadersInit> {
  const user = piSDK.getCurrentUser();
  return {
    'Content-Type': 'application/json',
    ...(user?.accessToken && { Authorization: `Bearer ${user.accessToken}` }),
  };
}

async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<{ success: boolean; data?: T; error?: string }> {
  try {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers: { ...headers, ...options.headers },
    });

    const data = await response.json();

    if (!response.ok) {
      return { success: false, error: data.error || 'Request failed' };
    }

    return { success: true, data };
  } catch (error: any) {
    debugError(`[EscrowService] ${endpoint} error:`, error);
    return { success: false, error: error.message || 'Network error' };
  }
}

// ============================================
// ESCROW OPERATIONS
// ============================================

/**
 * Create a new escrow with fraud checking
 */
export async function createEscrow(params: CreateEscrowParams): Promise<{
  success: boolean;
  escrow?: Escrow;
  pmartsReference?: string;
  fraudCheck?: { riskLevel: string; requiresReview: boolean };
  deliveryCode?: string;
  qrPayload?: string;
  completionMethod?: CompletionMethod;
  error?: string;
}> {
  const user = piSDK.getCurrentUser();
  if (!user) {
    return { success: false, error: 'Not authenticated' };
  }

  const result = await apiRequest<{
    escrow: Escrow;
    pmartsReference: string;
    fraudCheck: { riskLevel: string; requiresReview: boolean };
    transactionType: TransactionType;
    completionMethod: CompletionMethod;
    deliveryCode?: string;
    qrPayload?: string;
  }>('/api/escrow/v2/create', {
    method: 'POST',
    body: JSON.stringify({
      senderId: user.uid,
      recipientId: params.recipientId,
      amount: params.amount,
      referenceId: params.referenceId,
      note: params.note,
      expiryHours: params.expiryHours,
      transactionType: params.transactionType,
    }),
  });

  if (result.success && result.data) {
    return {
      success: true,
      escrow: result.data.escrow,
      pmartsReference: result.data.pmartsReference,
      fraudCheck: result.data.fraudCheck,
      deliveryCode: result.data.deliveryCode,
      qrPayload: result.data.qrPayload,
      completionMethod: result.data.completionMethod,
    };
  }

  return { success: false, error: result.error };
}

/**
 * Deposit Pi into escrow via Pi payment
 */
export async function depositEscrow(escrow: Escrow): Promise<{
  success: boolean;
  txid?: string;
  error?: string;
}> {
  const user = piSDK.getCurrentUser();
  if (!user) {
    return { success: false, error: 'Not authenticated' };
  }

  // Initiate Pi payment
  const paymentResult = await piSDK.createEscrowDeposit({
    escrowId: escrow.id,
    amount: escrow.amount,
    recipientUsername: escrow.recipient?.username || 'recipient',
    note: escrow.note,
  });

  return paymentResult;
}

/**
 * Release escrow to recipient
 */
export async function releaseEscrow(escrowId: string): Promise<{
  success: boolean;
  netAmount?: number;
  feeAmount?: number;
  message?: string;
  requestSubmitted?: boolean;
  escrow?: any;
  error?: string;
}> {
  const user = piSDK.getCurrentUser();
  if (!user) {
    return { success: false, error: 'Not authenticated' };
  }

  const result = await apiRequest<{
    netAmount?: number;
    feeAmount?: number;
    message?: string;
    requestSubmitted?: boolean;
    escrow?: any;
  }>('/api/escrow/v2/release', {
    method: 'POST',
    body: JSON.stringify({
      escrowId,
      userId: user.uid,
    }),
  });

  if (result.success && result.data) {
    return {
      success: true,
      netAmount: result.data.netAmount,
      feeAmount: result.data.feeAmount,
      message: result.data.message,
      requestSubmitted: !!result.data.requestSubmitted,
      escrow: result.data.escrow,
    };
  }

  return { success: false, error: result.error };
}

/**
 * Refund escrow to sender
 */
export async function refundEscrow(
  escrowId: string,
  reason: string,
  options?: {
    justification?: string;
    evidenceUrls?: string[];
    contactAttempted?: boolean;
  }
): Promise<{ success: boolean; error?: string; refundRequest?: any }> {
  const user = piSDK.getCurrentUser();
  if (!user) {
    return { success: false, error: 'Not authenticated' };
  }

  const body: any = {
    escrowId,
    userId: user.uid,
    reason,
  };
  if (options?.justification) body.justification = String(options.justification);
  if (Array.isArray(options?.evidenceUrls)) body.evidenceUrls = options?.evidenceUrls;
  if (typeof options?.contactAttempted === 'boolean') body.contactAttempted = !!options.contactAttempted;

  const result = await apiRequest('/api/escrow/v2/refund', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  return { success: result.success, error: result.error, refundRequest: (result as any).data?.refundRequest };
}

// ============================================
// DISPUTE OPERATIONS
// ============================================

/**
 * Open a dispute
 */
export async function openDispute(params: {
  escrowId: string;
  reason: string;
  description?: string;
  evidenceUrls?: string[];
}): Promise<{
  success: boolean;
  dispute?: Dispute;
  responseDeadline?: string;
  error?: string;
}> {
  const user = piSDK.getCurrentUser();
  if (!user) {
    return { success: false, error: 'Not authenticated' };
  }

  const result = await apiRequest<{
    dispute: Dispute;
    responseDeadline: string;
  }>('/api/escrow/v2/dispute', {
    method: 'POST',
    body: JSON.stringify({
      ...params,
      userId: user.uid,
    }),
  });

  if (result.success && result.data) {
    return {
      success: true,
      dispute: result.data.dispute,
      responseDeadline: result.data.responseDeadline,
    };
  }

  return { success: false, error: result.error };
}

/**
 * Respond to a dispute
 */
export async function respondToDispute(
  disputeId: string,
  response: string,
  evidenceUrls?: string[]
): Promise<{ success: boolean; error?: string }> {
  const user = piSDK.getCurrentUser();
  if (!user) {
    return { success: false, error: 'Not authenticated' };
  }

  const result = await apiRequest('/api/escrow/v2/dispute/respond', {
    method: 'POST',
    body: JSON.stringify({
      disputeId,
      userId: user.uid,
      response,
      evidenceUrls,
    }),
  });

  return { success: result.success, error: result.error };
}

/**
 * Add evidence to a dispute
 */
export async function addDisputeEvidence(
  disputeId: string,
  evidence: {
    type: string;
    title: string;
    description?: string;
    fileUrl: string;
  }
): Promise<{ success: boolean; error?: string }> {
  const user = piSDK.getCurrentUser();
  if (!user) {
    return { success: false, error: 'Not authenticated' };
  }

  const result = await apiRequest('/api/escrow/v2/dispute/evidence', {
    method: 'POST',
    body: JSON.stringify({
      disputeId,
      userId: user.uid,
      evidence,
    }),
  });

  return { success: result.success, error: result.error };
}

// ============================================
// QUERY OPERATIONS
// ============================================

/**
 * Get escrow by ID
 */
export async function getEscrow(escrowId: string): Promise<{
  success: boolean;
  escrow?: Escrow;
  ledger?: any[];
  dispute?: Dispute;
  error?: string;
}> {
  const result = await apiRequest<{
    escrow: Escrow;
    ledger: any[];
    dispute: Dispute;
  }>(`/api/escrow/v2/${escrowId}`);

  if (result.success && result.data) {
    return {
      success: true,
      escrow: result.data.escrow,
      ledger: result.data.ledger,
      dispute: result.data.dispute,
    };
  }

  return { success: false, error: result.error };
}

/**
 * Get user's escrows
 */
export async function getUserEscrows(params?: {
  status?: EscrowStatus;
  role?: 'sender' | 'recipient';
  limit?: number;
}): Promise<{
  success: boolean;
  escrows?: Escrow[];
  balance?: number;
  error?: string;
}> {
  const user = piSDK.getCurrentUser();
  if (!user) {
    return { success: false, error: 'Not authenticated' };
  }

  const queryParams = new URLSearchParams();
  if (params?.status) queryParams.set('status', params.status);
  if (params?.role) queryParams.set('role', params.role);
  if (params?.limit) queryParams.set('limit', params.limit.toString());

  const result = await apiRequest<{
    escrows: Escrow[];
    balance: number;
  }>(`/api/escrow/v2/user/${user.uid}?${queryParams.toString()}`);

  if (result.success && result.data) {
    return {
      success: true,
      escrows: result.data.escrows,
      balance: result.data.balance,
    };
  }

  return { success: false, error: result.error };
}

/**
 * Get dispute details
 */
export async function getDispute(disputeId: string): Promise<{
  success: boolean;
  dispute?: Dispute;
  evidence?: any[];
  error?: string;
}> {
  const result = await apiRequest<{
    dispute: Dispute;
    evidence: any[];
  }>(`/api/escrow/v2/dispute/${disputeId}`);

  if (result.success && result.data) {
    return {
      success: true,
      dispute: result.data.dispute,
      evidence: result.data.evidence,
    };
  }

  return { success: false, error: result.error };
}

// ============================================
// COMPLETION OPERATIONS
// ============================================

/**
 * Get delivery code (sender only)
 */
export async function getDeliveryCode(escrowId: string): Promise<{
  success: boolean;
  code?: string;
  qrPayload?: string;
  expiresAt?: string;
  isUsed?: boolean;
  error?: string;
}> {
  const result = await apiRequest<{
    code: string;
    qrPayload: string;
    expiresAt: string;
    isUsed: boolean;
  }>(`/api/completion/code/${escrowId}`);

  if (result.success && result.data) {
    return {
      success: true,
      code: result.data.code,
      qrPayload: result.data.qrPayload,
      expiresAt: result.data.expiresAt,
      isUsed: result.data.isUsed,
    };
  }

  return { success: false, error: result.error };
}

/**
 * Verify delivery code (recipient)
 */
export async function verifyDeliveryCode(
  escrowId: string,
  code: string
): Promise<{
  success: boolean;
  message?: string;
  attemptsRemaining?: number;
  error?: string;
}> {
  const user = piSDK.getCurrentUser();
  if (!user) {
    return { success: false, error: 'Not authenticated' };
  }

  const result = await apiRequest<{
    message: string;
    attemptsRemaining?: number;
  }>('/api/completion/code/verify', {
    method: 'POST',
    body: JSON.stringify({
      escrowId,
      code,
      userId: user.uid,
    }),
  });

  if (result.success && result.data) {
    return {
      success: true,
      message: result.data.message,
    };
  }

  return {
    success: false,
    error: result.error,
    attemptsRemaining: (result as any).data?.attemptsRemaining,
  };
}

/**
 * Verify QR code (recipient)
 */
export async function verifyDeliveryQR(
  escrowId: string,
  qrPayload: string
): Promise<{
  success: boolean;
  message?: string;
  error?: string;
}> {
  const user = piSDK.getCurrentUser();
  if (!user) {
    return { success: false, error: 'Not authenticated' };
  }

  const result = await apiRequest<{
    message: string;
  }>('/api/completion/code/verify-qr', {
    method: 'POST',
    body: JSON.stringify({
      escrowId,
      qrPayload,
      userId: user.uid,
    }),
  });

  if (result.success && result.data) {
    return {
      success: true,
      message: result.data.message,
    };
  }

  return { success: false, error: result.error };
}

/**
 * Manual sender release (for digital products)
 */
export async function senderRelease(escrowId: string): Promise<{
  success: boolean;
  message?: string;
  error?: string;
}> {
  const user = piSDK.getCurrentUser();
  if (!user) {
    return { success: false, error: 'Not authenticated' };
  }

  const result = await apiRequest<{
    message: string;
  }>('/api/completion/release', {
    method: 'POST',
    body: JSON.stringify({
      escrowId,
      userId: user.uid,
    }),
  });

  if (result.success && result.data) {
    return { success: true, message: result.data.message };
  }

  return { success: false, error: result.error };
}

/**
 * Recipient marks service as completed
 */
export async function markServiceCompleted(
  escrowId: string,
  proofUrl?: string,
  notes?: string
): Promise<{
  success: boolean;
  message?: string;
  error?: string;
}> {
  const user = piSDK.getCurrentUser();
  if (!user) {
    return { success: false, error: 'Not authenticated' };
  }

  const result = await apiRequest<{
    message: string;
  }>('/api/completion/service/complete', {
    method: 'POST',
    body: JSON.stringify({
      escrowId,
      userId: user.uid,
      proofUrl,
      notes,
    }),
  });

  if (result.success && result.data) {
    return { success: true, message: result.data.message };
  }

  return { success: false, error: result.error };
}

/**
 * Sender approves service and releases payment
 */
export async function approveServiceRelease(escrowId: string): Promise<{
  success: boolean;
  message?: string;
  error?: string;
}> {
  const user = piSDK.getCurrentUser();
  if (!user) {
    return { success: false, error: 'Not authenticated' };
  }

  const result = await apiRequest<{
    message: string;
  }>('/api/completion/service/approve', {
    method: 'POST',
    body: JSON.stringify({
      escrowId,
      userId: user.uid,
    }),
  });

  if (result.success && result.data) {
    return { success: true, message: result.data.message };
  }

  return { success: false, error: result.error };
}

/**
 * Upload receipt evidence (for trade agreement / external payment arrangement)
 */
export async function uploadReceiptEvidence(
  escrowId: string,
  receiptUrl: string,
  receiptType: string,
  description?: string
): Promise<{
  success: boolean;
  evidence?: any;
  message?: string;
  error?: string;
}> {
  const user = piSDK.getCurrentUser();
  if (!user) {
    return { success: false, error: 'Not authenticated' };
  }

  const result = await apiRequest<{
    evidence: any;
    message: string;
  }>('/api/completion/receipt/upload', {
    method: 'POST',
    body: JSON.stringify({
      escrowId,
      userId: user.uid,
      receiptUrl,
      receiptType,
      description,
    }),
  });

  if (result.success && result.data) {
    return {
      success: true,
      evidence: result.data.evidence,
      message: result.data.message,
    };
  }

  return { success: false, error: result.error };
}

/**
 * Recipient confirms receipt and releases payment
 */
export async function confirmReceiptRelease(escrowId: string): Promise<{
  success: boolean;
  message?: string;
  error?: string;
}> {
  const user = piSDK.getCurrentUser();
  if (!user) {
    return { success: false, error: 'Not authenticated' };
  }

  const result = await apiRequest<{
    message: string;
  }>('/api/completion/receipt/confirm', {
    method: 'POST',
    body: JSON.stringify({
      escrowId,
      userId: user.uid,
    }),
  });

  if (result.success && result.data) {
    return { success: true, message: result.data.message };
  }

  return { success: false, error: result.error };
}

/**
 * Request mutual cancellation
 */
export async function requestCancellation(
  escrowId: string,
  reason: string
): Promise<{
  success: boolean;
  message?: string;
  error?: string;
}> {
  const user = piSDK.getCurrentUser();
  if (!user) {
    return { success: false, error: 'Not authenticated' };
  }

  const result = await apiRequest<{
    message: string;
  }>('/api/completion/cancel/request', {
    method: 'POST',
    body: JSON.stringify({
      escrowId,
      userId: user.uid,
      reason,
    }),
  });

  if (result.success && result.data) {
    return { success: true, message: result.data.message };
  }

  return { success: false, error: result.error };
}

/**
 * Approve mutual cancellation
 */
export async function approveCancellation(escrowId: string): Promise<{
  success: boolean;
  message?: string;
  error?: string;
}> {
  const user = piSDK.getCurrentUser();
  if (!user) {
    return { success: false, error: 'Not authenticated' };
  }

  const result = await apiRequest<{
    message: string;
  }>('/api/completion/cancel/approve', {
    method: 'POST',
    body: JSON.stringify({
      escrowId,
      userId: user.uid,
    }),
  });

  if (result.success && result.data) {
    return { success: true, message: result.data.message };
  }

  return { success: false, error: result.error };
}

/**
 * Get completion info for an escrow
 */
export async function getCompletionInfo(escrowId: string): Promise<{
  success: boolean;
  completionMethod?: CompletionMethod;
  status?: string;
  details?: any;
  error?: string;
}> {
  const result = await apiRequest<{
    completionMethod: CompletionMethod;
    status: string;
    details: any;
  }>(`/api/completion/info/${escrowId}`);

  if (result.success && result.data) {
    return {
      success: true,
      completionMethod: result.data.completionMethod,
      status: result.data.status,
      details: result.data.details,
    };
  }

  return { success: false, error: result.error };
}

export default {
  createEscrow,
  depositEscrow,
  releaseEscrow,
  refundEscrow,
  openDispute,
  respondToDispute,
  addDisputeEvidence,
  getEscrow,
  getUserEscrows,
  getDispute,
  // Completion methods
  getDeliveryCode,
  verifyDeliveryCode,
  verifyDeliveryQR,
  senderRelease,
  markServiceCompleted,
  approveServiceRelease,
  uploadReceiptEvidence,
  confirmReceiptRelease,
  requestCancellation,
  approveCancellation,
  getCompletionInfo,
};

