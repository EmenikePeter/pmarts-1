/**
 * PMARTS Production Database Types
 * Fintech-grade escrow system type definitions
 */

// ============================================
// USERS
// ============================================

export interface User {
  id: string;
  pi_uid: string;
  username: string;
  wallet_address: string | null;
  pmarts_id: string;
  trust_score: number;
  completed_transactions: number;
  disputes_opened: number;
  disputes_lost: number;
  is_verified: boolean;
  is_suspended: boolean;
  suspended_reason: string | null;
  is_admin: boolean;
  last_active_at: string | null;
  created_at: string;
}

// ============================================
// ESCROWS
// ============================================

export type EscrowStatus = 
  | 'created'
  | 'deposit_pending'
  | 'funds_held'
  | 'delivery_in_progress'
  | 'release_requested'
  | 'completed'
  | 'refunded'
  | 'disputed'
  | 'cancelled';

export interface Escrow {
  id: string;
  escrow_code: string;
  sender_id: string;
  recipient_id: string;
  amount: number;
  fee: number;
  net_amount: number;
  reference_id: string | null;
  description: string | null;
  status: EscrowStatus;
  delivery_confirmed: boolean;
  delivery_confirmed_at: string | null;
  auto_release_at: string | null;
  cancelled_by: string | null;
  cancelled_reason: string | null;
  external_app_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface EscrowWithUsers extends Escrow {
  sender: User;
  recipient: User;
}

// ============================================
// PAYMENTS
// ============================================

export type PaymentType = 'deposit' | 'release' | 'refund' | 'fee_collection';

export type PaymentStatus = 
  | 'pending'
  | 'submitted'
  | 'confirming'
  | 'confirmed'
  | 'failed'
  | 'cancelled';

export interface Payment {
  id: string;
  escrow_id: string;
  pi_payment_id: string | null;
  tx_hash: string | null;
  txid: string | null;
  sender_wallet: string | null;
  recipient_wallet: string | null;
  pmarts_wallet: string | null;
  amount: number;
  fee: number;
  blockchain_fee: number;
  payment_type: PaymentType;
  status: PaymentStatus;
  confirmed: boolean;
  confirmed_at: string | null;
  block_number: number | null;
  confirmations: number;
  error_code: string | null;
  error_message: string | null;
  retry_count: number;
  initiated_at: string;
  submitted_at: string | null;
  created_at: string;
}

// ============================================
// LEDGER
// ============================================

export type LedgerEntryType = 
  | 'escrow_deposit'
  | 'escrow_hold'
  | 'escrow_release'
  | 'escrow_refund'
  | 'fee_collection'
  | 'fee_refund'
  | 'adjustment'
  | 'reversal';

export interface LedgerEntry {
  id: string;
  escrow_id: string | null;
  user_id: string | null;
  payment_id: string | null;
  entry_type: LedgerEntryType;
  amount: number;
  balance_before: number | null;
  balance_after: number | null;
  debit_account: string | null;
  credit_account: string | null;
  reference_code: string | null;
  description: string | null;
  metadata: Record<string, any>;
  verified: boolean;
  verified_by: string | null;
  verified_at: string | null;
  created_at: string;
}

// ============================================
// DISPUTES
// ============================================

export type DisputeStatus = 
  | 'OPEN'
  | 'EVIDENCE_REQUESTED'
  | 'UNDER_REVIEW'
  | 'MEDIATION'
  | 'ESCALATED'
  | 'RESOLVED'
  | 'REJECTED'
  | 'WITHDRAWN';

export type DisputeCategory = 
  | 'non_delivery'
  | 'not_as_described'
  | 'quality_issue'
  | 'fraud'
  | 'unauthorized'
  | 'other';

export type DisputeResolution = 
  | 'full_refund'
  | 'partial_refund'
  | 'release_to_recipient'
  | 'split'
  | 'dismissed'
  | 'withdrawn';

export interface Dispute {
  id: string;
  dispute_code: string;
  escrow_id: string;
  opened_by: string;
  against_user: string;
  reason: string;
  category: DisputeCategory | null;
  description: string | null;
  evidence_url: string | null;
  evidence_description: string | null;
  status: DisputeStatus;
  resolution: DisputeResolution | null;
  resolution_amount: number | null;
  resolution_notes: string | null;
  assigned_to: string | null;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  evidence_deadline: string | null;
  resolution_deadline: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

export interface DisputeWithDetails extends Dispute {
  escrow: Escrow;
  opener: User;
  against: User;
  evidence: DisputeEvidence[];
}

// ============================================
// DISPUTE EVIDENCE
// ============================================

export type EvidenceType = 
  | 'image'
  | 'document'
  | 'screenshot'
  | 'video'
  | 'text'
  | 'link';

export interface DisputeEvidence {
  id: string;
  dispute_id: string;
  uploaded_by: string;
  file_url: string;
  file_type: EvidenceType;
  description: string | null;
  verified: boolean;
  verified_by: string | null;
  created_at: string;
}

// ============================================
// FRAUD FLAGS
// ============================================

export type FraudFlagType = 
  | 'multiple_disputes'
  | 'rapid_transactions'
  | 'suspicious_wallet'
  | 'duplicate_reference'
  | 'velocity_exceeded'
  | 'high_risk_pattern'
  | 'failed_verifications'
  | 'account_anomaly'
  | 'reported_by_user'
  | 'system_detected';

export type FraudSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface FraudFlag {
  id: string;
  user_id: string;
  escrow_id: string | null;
  flag_type: FraudFlagType;
  severity: FraudSeverity;
  description: string | null;
  evidence: Record<string, any>;
  status: 'active' | 'investigating' | 'resolved' | 'dismissed';
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
  action_taken: string | null;
  created_at: string;
}

// ============================================
// API PARTNERS
// ============================================

export interface ApiPartner {
  id: string;
  app_name: string;
  app_description: string | null;
  owner_id: string | null;
  contact_email: string | null;
  website_url: string | null;
  api_key: string;
  api_secret_hash: string;
  webhook_url: string | null;
  webhook_secret: string | null;
  webhook_events: string[];
  rate_limit_per_minute: number;
  rate_limit_per_day: number;
  is_active: boolean;
  is_verified: boolean;
  verified_at: string | null;
  total_api_calls: number;
  total_escrows_created: number;
  total_volume: number;
  created_at: string;
  last_used_at: string | null;
}

// ============================================
// RATINGS
// ============================================

export interface Rating {
  id: string;
  escrow_id: string;
  reviewer_id: string;
  reviewed_user_id: string;
  rating: number; // 1-5 stars
  comment: string | null;
  created_at: string;
}

// ============================================
// NOTIFICATIONS
// ============================================

export type NotificationType = 
  | 'escrow_created'
  | 'deposit_received'
  | 'payment_released'
  | 'payment_refunded'
  | 'dispute_opened'
  | 'dispute_resolved'
  | 'evidence_requested'
  | 'rating_received'
  | 'fraud_flag'
  | 'system';

export interface Notification {
  id: string;
  user_id: string;
  notification_type: NotificationType;
  type: string; // Legacy field
  message: string;
  title: string | null;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  action_url: string | null;
  metadata: Record<string, any>;
  read: boolean;
  delivered: boolean;
  delivered_at: string | null;
  read_at: string | null;
  created_at: string;
}

// ============================================
// AUDIT LOGS
// ============================================

export interface AuditLog {
  id: string;
  user_id: string | null;
  actor_id: string | null;
  actor_type: 'user' | 'system' | 'api';
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  old_data: Record<string, any> | null;
  new_data: Record<string, any> | null;
  metadata: Record<string, any>;
  ip_address: string | null;
  user_agent: string | null;
  session_id: string | null;
  request_id: string | null;
  created_at: string;
}

// ============================================
// SYSTEM ACCOUNTS
// ============================================

export type SystemAccountType = 
  | 'escrow_wallet'
  | 'fee_wallet'
  | 'reserve_wallet'
  | 'operations_wallet';

export interface SystemAccount {
  id: string;
  account_name: string;
  account_type: SystemAccountType;
  wallet_address: string | null;
  balance: number;
  total_inflow: number;
  total_outflow: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ============================================
// BALANCE RECONCILIATION
// ============================================

export type ReconciliationStatus = 'matched' | 'discrepancy' | 'investigating' | 'resolved';

export interface BalanceReconciliation {
  id: string;
  reconciliation_date: string;
  account_name: string;
  expected_balance: number;
  actual_balance: number;
  difference: number;
  total_deposits: number;
  total_releases: number;
  total_refunds: number;
  total_fees: number;
  status: ReconciliationStatus;
  discrepancy_notes: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

// ============================================
// VIEW TYPES
// ============================================

export interface UserFinancialSummary {
  id: string;
  username: string;
  pmarts_id: string;
  trust_score: number;
  escrows_as_sender: number;
  escrows_as_recipient: number;
  total_paid: number;
  total_received: number;
  disputes_opened: number;
  disputes_lost: number;
  active_fraud_flags: number;
}

export interface SystemHealthDashboard {
  active_escrows: number;
  total_held_pi: number;
  escrows_24h: number;
  open_disputes: number;
  critical_fraud_flags: number;
  pending_payments: number;
  active_users_24h: number;
}

export interface ApiPartnerDashboard {
  id: string;
  app_name: string;
  is_verified: boolean;
  total_api_calls: number;
  total_escrows_created: number;
  total_volume: number;
  completed_escrows: number;
  disputed_escrows: number;
  last_used_at: string | null;
  created_at: string;
}

// ============================================
// REQUEST/RESPONSE TYPES
// ============================================

export interface CreateEscrowRequest {
  sender_id?: string;
  recipient_id: string;
  recipient_pmarts_id?: string; // Can use PMARTS ID instead
  amount: number;
  description?: string;
  reference_id?: string;
  auto_release_hours?: number;
}

export interface CreateEscrowResponse {
  escrow: Escrow;
  fee: number;
  net_amount: number;
  payment_instructions: {
    amount: number;
    wallet_address: string;
    memo: string;
  };
}

export interface ProcessPaymentRequest {
  escrow_id: string;
  pi_payment_id: string;
  tx_hash?: string;
}

export interface DisputeRequest {
  escrow_id: string;
  reason: string;
  category: DisputeCategory;
  description?: string;
  evidence_url?: string;
}

export interface ResolveDisputeRequest {
  dispute_id: string;
  resolution: DisputeResolution;
  resolution_amount?: number;
  notes?: string;
}

// ============================================
// ERROR TYPES
// ============================================

export type ErrorCode = 
  | 'INVALID_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'ESCROW_NOT_FOUND'
  | 'USER_NOT_FOUND'
  | 'PAYMENT_FAILED'
  | 'INSUFFICIENT_BALANCE'
  | 'ESCROW_ALREADY_COMPLETED'
  | 'ESCROW_DISPUTED'
  | 'DISPUTE_NOT_FOUND'
  | 'EVIDENCE_REQUIRED'
  | 'RATE_LIMIT_EXCEEDED'
  | 'ACCOUNT_SUSPENDED'
  | 'FRAUD_DETECTED'
  | 'INTERNAL_ERROR';

export interface ApiError {
  code: ErrorCode;
  message: string;
  details?: Record<string, any>;
}

// ============================================
// WEBHOOK EVENTS
// ============================================

export type WebhookEventType = 
  | 'escrow.created'
  | 'escrow.deposit_confirmed'
  | 'escrow.funds_held'
  | 'escrow.release_requested'
  | 'escrow.completed'
  | 'escrow.refunded'
  | 'escrow.disputed'
  | 'escrow.cancelled'
  | 'dispute.opened'
  | 'dispute.updated'
  | 'dispute.resolved'
  | 'payment.confirmed'
  | 'payment.failed'
  | 'fraud.detected';

export interface WebhookPayload<T = any> {
  event: WebhookEventType;
  timestamp: string;
  data: T;
  escrow_code?: string;
  signature: string;
}

