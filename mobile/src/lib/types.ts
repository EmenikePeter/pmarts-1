// User type
export type User = {
  id: string;
  pi_id: string;
  username?: string;
  pmarts_id?: string;
  avatar_path?: string | null;
  avatar_url?: string | null;
  avatar_visibility?: 'public' | 'counterparties_only';
  photo_review_status?: 'pending' | 'approved' | 'rejected';
  bio?: string | null;
  location?: string | null;
  preferred_language?: string | null;
  theme_preset?: 'default' | 'business' | 'quiet';
  notification_preset?: 'balanced' | 'business' | 'minimal';
  is_verified?: boolean;
  balance: number;
  trust_score: number;
  total_escrows: number;
  completed_escrows: number;
  disputes: number;
  created_at: string;
};

// Escrow status type
export type EscrowStatus =
  | 'created'
  | 'deposit_pending'
  | 'deposit_confirmed'
  | 'funds_held'
  | 'delivery_in_progress'
  | 'release_requested'
  | 'release_pending'
  | 'completed'
  | 'refund_pending'
  | 'refunded'
  | 'disputed'
  | 'cancelled'
  | 'expired'
  | 'deposit_failed';

// Escrow type
export type Escrow = {
  id: string;
  sender_id: string;
  recipient_id: string;
  sender?: User;
  recipient?: User;
  amount: number;
  reference_id: string;
  note?: string;
  status: EscrowStatus;
  transaction_type?: 'physical_product' | 'digital_product' | 'service' | 'currency_exchange' | 'instant' | 'donation' | 'custom' | 'other';
  completion_method?: 'delivery_code' | 'sender_release' | 'service_approval' | 'receipt_evidence' | 'dispute_resolution' | 'mutual_cancellation';
  // Pi Network verification
  pi_payment_id?: string;
  pi_transaction_id?: string;
  pi_transaction_hash?: string;
  deposit_verified?: boolean;
  deposit_verified_at?: string;
  release_transaction_hash?: string;
  release_verified?: boolean;
  release_verified_at?: string;
  // PMARTS reference
  pmarts_reference?: string;
  created_at: string;
  released_at?: string;
  deadline?: string;
};

export type EscrowMilestoneStatus = 'pending' | 'in_progress' | 'completed' | 'approved' | 'released';

export type EscrowMilestone = {
  id: string;
  escrow_id: string;
  title: string;
  amount: number;
  position: number;
  status: EscrowMilestoneStatus;
  created_at: string;
  updated_at?: string;
  completed_at?: string | null;
  approved_at?: string | null;
  released_at?: string | null;
};

// Notification type
export type NotificationType =
  | 'deposit'
  | 'release'
  | 'refund'
  | 'dispute'
  | 'received'
  | 'milestone_release'
  | string;

export type Notification = {
  id: string;
  user_id: string;
  type: NotificationType;
  title?: string;
  message: string;
  escrow_id?: string;
  is_read: boolean;
  created_at: string;
};

// Escrow ledger action type
export type LedgerAction = 'deposit' | 'release' | 'refund' | 'dispute';

// Escrow ledger entry
export type EscrowLedger = {
  id: string;
  escrow_id: string;
  sender_id: string;
  amount: number;
  action: LedgerAction;
  created_at: string;
};

// Rating type
export type Rating = {
  id: string;
  escrow_id: string;
  rater_id: string;
  rated_id: string;
  score: number; // 1-5
  comment?: string;
  created_at: string;
};

// Dispute evidence type
export type DisputeEvidence = {
  id: string;
  escrow_id: string;
  user_id: string;
  image_url: string;
  description?: string;
  created_at: string;
};

// Pi Transaction type
export type PiTransaction = {
  id: string;
  pi_payment_id: string;
  pi_transaction_hash?: string;
  pi_txid?: string;
  direction: 'incoming' | 'outgoing';
  transaction_type: 'escrow_deposit' | 'escrow_release' | 'escrow_refund';
  amount: number;
  fee?: number;
  status: 'pending' | 'approved' | 'completed' | 'failed' | 'cancelled';
  from_user_id?: string;
  to_user_id?: string;
  escrow_id?: string;
  from_address?: string;
  to_address?: string;
  verified: boolean;
  error_message?: string;
  initiated_at: string;
  approved_at?: string;
  completed_at?: string;
};

// Audit Log type
export type AuditLog = {
  id: string;
  action: string;
  escrow_id?: string;
  user_id?: string;
  actor_id?: string;
  ip_address?: string;
  old_data?: Record<string, any>;
  new_data?: Record<string, any>;
  metadata?: Record<string, any>;
  created_at: string;
};

// Security Alert type
export type SecurityAlert = {
  id: string;
  alert_type: 
    | 'double_spend_attempt'
    | 'fake_deposit'
    | 'unauthorized_release'
    | 'balance_mismatch'
    | 'suspicious_activity'
    | 'rapid_transactions'
    | 'large_withdrawal'
    | 'verification_failure';
  severity: 'low' | 'medium' | 'high' | 'critical';
  escrow_id?: string;
  user_id?: string;
  description: string;
  evidence?: Record<string, any>;
  status: 'open' | 'investigating' | 'resolved' | 'false_positive';
  created_at: string;
};

// Escrow Ledger Entry type
export type EscrowLedgerEntry = {
  id: string;
  escrow_id: string;
  wallet_id?: string;
  entry_type: 'debit' | 'credit';
  action: string;
  amount: number;
  running_balance: number;
  pi_transaction_hash?: string;
  verified: boolean;
  verified_at?: string;
  notes?: string;
  created_at: string;
};

// Navigation param types
export type RootStackParamList = {
  Login: undefined;
  Home: { user: User };
  Deposit: {
    user: User;
    conversationId?: string;
    prefillRecipientId?: string;
  };
  EscrowDetail: { escrow: Escrow; user: User };
  History: { user: User };
  Notifications: { user: User };
  Profile: { user: User };
  NotificationSettings: { user: User };
  SecuritySettings: { user: User };
  HelpSupport: undefined;
  AboutUs: undefined;
  AppGuide: undefined;
  CommunityGuidelines: undefined;
  SupportChat: { ticketId: string; title?: string };
  VirtualAssistant: undefined;
  PrivacyPolicy: undefined;
  TermsOfService: undefined;
  EditProfile: { user: User; onUpdate?: (user: User) => void };
  Dispute: { escrowId?: string; userId: string };
  DepositPending: { escrowId?: string; paymentAttemptId?: string };
  TransactionReceipt: { paymentAttemptId?: string; escrowId?: string };
  DisputeThread: { disputeId: string };
  Inbox: { user: User };
  Chat: {
    conversationId: string;
    otherUser: { id: string; pi_id?: string; username?: string; trust_score?: number; avatar_url?: string | null };
    currentUser: User;
  };
  RefundRequest: { escrow: Escrow };
};

// Status colors
export const STATUS_COLORS: Record<EscrowStatus, string> = {
  created: '#9CA3AF',
  deposit_pending: '#3B82F6',
  deposit_confirmed: '#14B8A6',
  funds_held: '#EAB308',
  delivery_in_progress: '#F59E0B',
  release_requested: '#8B5CF6',
  release_pending: '#7C3AED',
  completed: '#22C55E',
  refund_pending: '#F97316',
  refunded: '#3B82F6',
  disputed: '#EF4444',
  cancelled: '#9CA3AF',
  expired: '#6B7280',
  deposit_failed: '#F97316',
};

// Format Pi amount
export const formatPi = (amount: number | undefined | null): string => {
  const n = (typeof amount === 'number' && Number.isFinite(amount)) ? amount : Number(amount) || 0;
  return `${n.toFixed(2)} π`;
};

// Get trust badge
export const getTrustBadge = (score: number): { label: string; color: string } => {
  if (score >= 85) return { label: '🏆 Elite', color: '#F4C542' };       // gold trophy
  if (score >= 70) return { label: '🌟 Trusted', color: '#22C55E' };     // glowing star — green
  if (score >= 50) return { label: '⭐ Average', color: '#EAB308' };      // plain star — yellow
  if (score >= 30) return { label: '⚠️ Risky', color: '#F97316' };       // warning — orange
  return { label: '🔘 New', color: '#9CA3AF' };                           // grey dot — unverified
};

// Generate escrow ID
export const generateEscrowId = (): string => {
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `ESC-${random}`;
};

// Format date
export const formatDate = (dateStr: string): string => {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

// ============================================
// API Integration Types
// ============================================

// Extended Escrow Status for state machine
export type EnhancedEscrowStatus =
  | 'created'
  | 'deposit_pending'
  | 'deposit_failed'
  | 'funds_held'
  | 'release_requested'
  | 'release_pending'
  | 'completed'
  | 'refund_requested'
  | 'refund_pending'
  | 'refunded'
  | 'disputed'
  | 'expired';

// API App type
export type APIApp = {
  id: string;
  app_name: string;
  app_description?: string;
  owner_user_id: string;
  api_key: string;
  webhook_url?: string;
  webhook_secret_hash?: string;
  is_active: boolean;
  is_verified: boolean;
  rate_limit_per_minute: number;
  total_escrows: number;
  total_volume: number;
  created_at: string;
};

// API Request Log
export type APIRequestLog = {
  id: string;
  app_id: string;
  endpoint: string;
  method: string;
  request_body?: Record<string, any>;
  response_status?: number;
  response_body?: Record<string, any>;
  ip_address?: string;
  created_at: string;
};

// Admin Approval Queue
export type AdminApproval = {
  id: string;
  escrow_id: string;
  approval_type: 'large_escrow' | 'suspicious_activity' | 'manual_review';
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by?: string;
  reviewed_at?: string;
  notes?: string;
  created_at: string;
};

// Withdrawal Tracking
export type WithdrawalTracking = {
  id: string;
  escrow_id: string;
  user_id: string;
  amount: number;
  transaction_type: 'release' | 'refund';
  created_at: string;
};

// State Transition Rule
export type StateTransitionRule = {
  id: string;
  from_status: EnhancedEscrowStatus;
  to_status: EnhancedEscrowStatus;
  allowed_roles: string[];
  requires_verification: boolean;
};

