import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  Image,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Modal,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { useToast } from '../components/Toast';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { Button, RatingModal, DisputeEvidenceModal } from '../components';
import EvidenceUploader from '../components/EvidenceUploader';
import DeliveryCodeDisplay from '../components/DeliveryCodeDisplay';
import CodeEntryScreen from '../components/CodeEntryScreen';
import { API_URL } from '../lib/api';
import { supabase } from '../lib/supabase';
import { getBestAuthTokenFromSupabase } from '../lib/appSession';
import {
  getEscrowCompletionHint,
  getEscrowCounterpartyRoleLabel,
  getEscrowRoleLabel,
  getEscrowStatusGuidance,
  getEscrowSummary,
  getEscrowTypeLabel,
} from '../lib/escrowPresentation';
import { getEscrowMilestones, updateMilestoneStatus } from '../lib/escrowMilestones';
import { releaseEscrow as releaseEscrowRequest } from '../services/EscrowService';
import { useRealtimeEscrow } from '../lib/useRealtimeEscrows';
import { RootStackParamList, STATUS_COLORS, formatPi, formatDate, getTrustBadge, Escrow } from '../lib/types';
import { debugError } from '../lib/debugLogger';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES, HEADER_TITLE_TEXT } from '../lib/theme';

type EscrowDetailScreenProps = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'EscrowDetail'>;
  route: RouteProp<RootStackParamList, 'EscrowDetail'>;
};

export default function EscrowDetailScreen({ navigation, route }: EscrowDetailScreenProps) {
  const { escrow, user } = route.params;
  const [currentEscrow, setCurrentEscrow] = useState<Escrow>(escrow);
  const [loading, setLoading] = useState(false);
  const [showDisputeModal, setShowDisputeModal] = useState(false);
  const [showRefundEvidenceUploader, setShowRefundEvidenceUploader] = useState(false);
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [showCodeEntryModal, setShowCodeEntryModal] = useState(false);
  const [deliveryCode, setDeliveryCode] = useState<string | null>(null);
  const [deliveryQr, setDeliveryQr] = useState<string | null>(null);
  const [deliveryCodeExpiresAt, setDeliveryCodeExpiresAt] = useState<string | null>(null);
  const [deliveryCodeInput, setDeliveryCodeInput] = useState('');
  const [milestones, setMilestones] = useState<Array<{ id: string; title: string; amount: number; status: string; position: number }>>([]);
  const [milestonesLoading, setMilestonesLoading] = useState(false);
  
  // Subscribe to realtime updates for this escrow
  const { escrow: realtimeEscrow } = useRealtimeEscrow(escrow.id);
  const toast = useToast();
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const prevStatusRef = React.useRef<string | null>(escrow.status || null);

  const activeActionStatuses = new Set(['funds_held', 'delivery_in_progress', 'release_requested', 'release_pending', 'held']);
  const senderReleaseStatuses = new Set(['funds_held', 'delivery_in_progress', 'held']);
  const completedStatuses = new Set(['completed']);
  
  // Update local state when realtime updates come in
  useEffect(() => {
    if (realtimeEscrow) {
      setCurrentEscrow((prev) => {
        const next = { ...prev, ...realtimeEscrow };
        // Show inline notice when status changes
        const prevStatus = prevStatusRef.current;
        if (prevStatus && realtimeEscrow.status && realtimeEscrow.status !== prevStatus) {
          const status = (realtimeEscrow.status || '').toLowerCase();
          const friendly = status === 'funds_held' ? 'Deposit received' : `Status: ${status}`;
          const toastType = status === 'funds_held' ? 'success' : 'info';
          setStatusNotice(friendly);
          toast.push({ type: toastType, message: friendly });
          setTimeout(() => setStatusNotice(null), 5000);
        }
        prevStatusRef.current = realtimeEscrow.status || null;
        return next;
      });
    }
  }, [realtimeEscrow]);

  useEffect(() => {
    let mounted = true;

    const loadMilestones = async () => {
      setMilestonesLoading(true);
      const data = await getEscrowMilestones(escrow.id, user.id);
      if (mounted) {
        setMilestones(data);
        setMilestonesLoading(false);
      }
    };

    void loadMilestones();
    return () => {
      mounted = false;
    };
  }, [escrow.id]);

  const isSender = currentEscrow.sender_id === user.id;
  const otherParty = isSender ? currentEscrow.recipient : currentEscrow.sender;
  const otherPartyName = otherParty?.username || (isSender ? currentEscrow.recipient_id : currentEscrow.sender_id);
  const otherPartyTrust = otherParty ? getTrustBadge(otherParty.trust_score) : null;
  const roleLabel = getEscrowRoleLabel(currentEscrow, user.id);
  const counterpartyRoleLabel = getEscrowCounterpartyRoleLabel(currentEscrow, user.id);
  const transactionTypeLabel = getEscrowTypeLabel(currentEscrow.transaction_type);
  const agreementSummary = getEscrowSummary(currentEscrow, user.id);
  const completionHint = getEscrowCompletionHint(currentEscrow, user.id);
  const statusGuidance = getEscrowStatusGuidance(currentEscrow, user.id);
  const deliveryItemLabel = currentEscrow.note || `${transactionTypeLabel} ${currentEscrow.reference_id ? `(${currentEscrow.reference_id})` : ''}`.trim();
  const senderPiId =
    currentEscrow.sender?.pi_id ||
    (currentEscrow as any)?.sender?.pi_uid ||
    (isSender ? user.pi_id : null);
  const recipientPiId =
    currentEscrow.recipient?.pi_id ||
    (currentEscrow as any)?.recipient?.pi_uid ||
    (!isSender ? user.pi_id : null);

  const escrowStatus = (currentEscrow.status || '').toLowerCase();
  const canRelease = isSender && senderReleaseStatuses.has(escrowStatus);
  const canRefund = isSender && activeActionStatuses.has(escrowStatus);
  const canDispute = activeActionStatuses.has(escrowStatus);
  const usesDeliveryCode = currentEscrow.completion_method === 'delivery_code';

  const copyPiId = (label: 'Sender Pi ID' | 'Recipient Pi ID', value?: string | null) => {
    if (!value) {
      toast.push({ type: 'info', message: `${label} is not available yet` });
      return;
    }
    Clipboard.setString(value);
    toast.push({ type: 'success', message: `${label} copied` });
  };

  const fetchDeliveryCode = async () => {
    if (!isSender) return;

    try {
      setLoading(true);
      const response = await fetch(
        `${API_URL}/api/completion/code/${currentEscrow.id}?userId=${user.id}`
      );
      const result = await response.json();

      if (!result.success) {
        toast.push({ type: 'error', message: result.error || 'Unable to fetch delivery code' });
        return;
      }

      setDeliveryCode(result.code);
      setDeliveryQr(result.qrPayload || null);
      setDeliveryCodeExpiresAt(result.expiresAt || null);
    } catch (error: any) {
      toast.push({ type: 'error', message: error.message || 'Unable to fetch delivery code' });
    } finally {
      setLoading(false);
    }
  };

  const verifyDeliveryCode = async () => {
    if (!deliveryCodeInput.trim()) return;

    try {
      setLoading(true);
      const response = await fetch(`${API_URL}/api/completion/code/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrowId: currentEscrow.id,
          code: deliveryCodeInput.trim(),
          userId: user.id,
        }),
      });

      const result = await response.json();
      if (!result.success) {
        toast.push({ type: 'error', message: result.error || 'Invalid code' });
        return;
      }

      if (result.escrow) {
        setCurrentEscrow(result.escrow);
      }
      toast.push({ type: 'success', message: 'Delivery code verified. Escrow will be released.' });
    } catch (error: any) {
      toast.push({ type: 'error', message: error.message || 'Unable to verify code' });
    } finally {
      setLoading(false);
    }
  };

  const verifyDeliveryCodeForEntry = async (code: string) => {
    try {
      const response = await fetch(`${API_URL}/api/completion/code/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrowId: currentEscrow.id,
          code,
          userId: user.id,
        }),
      });

      const result = await response.json();
      if (!result.success) {
        return { success: false, message: result.error || 'Invalid code' };
      }

      if (result.escrow) {
        setCurrentEscrow((prev) => ({ ...prev, ...result.escrow }));
      } else {
        setCurrentEscrow((prev) => ({ ...prev, status: 'completed' }));
      }

      return { success: true, message: result.message || 'Delivery verified' };
    } catch (error: any) {
      return { success: false, message: error.message || 'Unable to verify code' };
    }
  };

  const verifyDeliveryQrForEntry = async (qrPayload: string) => {
    try {
      const response = await fetch(`${API_URL}/api/completion/code/verify-qr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          qrPayload,
          userId: user.id,
        }),
      });

      const result = await response.json();
      if (!result.success) {
        return { success: false, message: result.error || 'Invalid QR code' };
      }

      if (result.escrow) {
        setCurrentEscrow((prev) => ({ ...prev, ...result.escrow }));
      } else {
        setCurrentEscrow((prev) => ({ ...prev, status: 'completed' }));
      }

      return { success: true, message: result.message || 'Delivery verified' };
    } catch (error: any) {
      return { success: false, message: error.message || 'Unable to verify QR code' };
    }
  };

  const handleMilestoneAction = async (milestoneId: string, status: 'completed' | 'approved') => {
    const success = await updateMilestoneStatus(currentEscrow.id, milestoneId, user.id, status);
    if (!success) {
      toast.push({ type: 'error', message: 'Unable to update milestone. Please try again.' });
      return;
    }

    const refreshed = await getEscrowMilestones(currentEscrow.id, user.id);
    setMilestones(refreshed);
  };

  const handleRelease = async () => {
    Alert.alert(
      'Release Payment',
      `Are you sure you want to release ${formatPi(currentEscrow.amount)} to @${otherPartyName}?\n\nThis will send ${currentEscrow.amount} π from the PMARTS escrow wallet to the recipient.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Release',
          style: 'default',
          onPress: async () => {
            setLoading(true);
            try {
              const result = await releaseEscrowRequest(currentEscrow.id);

              if (!result.success) {
                toast.push({ type: 'error', message: result.error || 'Failed to release payment' });
                setLoading(false);
                return;
              }

              if (result.requestSubmitted) {
                setCurrentEscrow((prev) => ({
                  ...prev,
                  status: 'release_requested',
                  ...(result.escrow ? result.escrow : {}),
                }));
                try {
                  toast.push({
                    type: 'info',
                    message: result.message || 'Release request submitted. Waiting for admin/support approval.',
                  });
                } catch (e) {}
              } else {
                setCurrentEscrow((prev) => ({
                  ...prev,
                  status: 'completed',
                  ...(result.escrow ? result.escrow : {}),
                }));
                try { toast.push({ type: 'success', message: result.message || 'Payment has been released to the recipient.' }); } catch(e) {}
                setShowRatingModal(true);
              }
            } catch (err: any) {
              debugError('Release error', err);
              try { toast.push({ type: 'error', message: err.message || 'Failed to release payment' }); } catch(e) {}
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  const handleRefund = async () => {
    if (!canRefund) {
      toast.push({ type: 'error', message: `Refund is not available while escrow is ${currentEscrow.status}.` });
      return;
    }

    // Navigate to RefundRequest screen to submit a governed refund request
    try {
      navigation.navigate('RefundRequest', { escrow: currentEscrow });
    } catch (err) {
      // Fallback: show inline uploader if navigation fails
      setShowRefundEvidenceUploader(true);
      toast.push({ type: 'info', message: 'Upload payment evidence. It will be shared in chat and the recipient will be notified.' });
    }
  };

  const shareRefundEvidenceInChat = async (evidenceUrl: string) => {
    const counterpartyId = isSender ? currentEscrow.recipient_id : currentEscrow.sender_id;
    if (!counterpartyId) {
      throw new Error('Unable to resolve counterparty for chat');
    }

    const token = await getBestAuthTokenFromSupabase(supabase);
    if (!token) throw new Error('You are not authenticated for chat');

    const startResp = await fetch(`${API_URL}/api/messages/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ userId: counterpartyId }),
    });

    const startJson = await startResp.json().catch(() => ({}));
    if (!startResp.ok || !startJson?.success || !startJson?.conversation?.id) {
      throw new Error(startJson?.error || 'Unable to open conversation');
    }

    const conversationId = startJson.conversation.id;
    const label = currentEscrow.reference_id || currentEscrow.id;
    const messageContent = `Refund evidence uploaded for ${label}: ${evidenceUrl}`;

    const sendResp = await fetch(`${API_URL}/api/messages/conversations/${encodeURIComponent(conversationId)}/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        content: messageContent,
        escrowId: currentEscrow.id,
      }),
    });

    const sendJson = await sendResp.json().catch(() => ({}));
    if (!sendResp.ok || !sendJson?.success) {
      throw new Error(sendJson?.error || 'Failed to send evidence in chat');
    }

    return {
      conversationId,
      otherUser: startJson.otherUser,
      counterpartyId,
    };
  };

  const handleDisputeSuccess = async () => {
    setShowDisputeModal(false);
    // Refresh escrow state
    setCurrentEscrow({ ...currentEscrow, status: 'disputed' });
    try { toast.push({ type: 'info', message: 'Your dispute has been submitted. Our team will review and contact both parties.' }); } catch(e) {}
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Escrow Details</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.scrollContent}>
        {/* Status Banner */}
        <View style={[styles.statusBanner, { backgroundColor: STATUS_COLORS[currentEscrow.status] || COLORS.muted }]}> 
          <Text style={styles.statusIcon}>
            {escrowStatus === 'funds_held' && '🔒'}
            {completedStatuses.has(escrowStatus) && '✅'}
            {escrowStatus === 'disputed' && '⚠️'}
            {(escrowStatus === 'refunded' || escrowStatus === 'refund_pending') && '↩️'}
            {(escrowStatus === 'cancelled' || escrowStatus === 'expired' || escrowStatus === 'deposit_failed') && '❌'}
          </Text>
          <Text style={styles.statusText}>{currentEscrow.status.toUpperCase()}</Text>
        </View>

        <View style={styles.guidanceCard}>
          <Text style={styles.guidanceEyebrow}>{transactionTypeLabel}</Text>
          <Text style={styles.guidanceTitle}>{roleLabel} view</Text>
          <Text style={styles.guidanceText}>{agreementSummary}</Text>
          <Text style={styles.guidanceSubtext}>{statusGuidance}</Text>
          {completionHint ? <Text style={styles.guidanceHint}>{completionHint}</Text> : null}
        </View>

        {/* Amount Card */}
        <View style={styles.amountCard}>
          <Text style={styles.amountLabel}>{isSender ? 'You are sending' : 'You are receiving'}</Text>
          <Text style={styles.amountValue}>{formatPi(currentEscrow.amount)}</Text>
        </View>

        {/* Details Card */}
        <View style={styles.detailsCard}>
          <Text style={styles.sectionTitle}>Transaction Details</Text>

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Escrow ID</Text>
            <Text style={styles.detailValue} selectable>{currentEscrow.id.toUpperCase()}</Text>
          </View>

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>{counterpartyRoleLabel}</Text>
            <View style={styles.userInfo}>
              <View style={styles.counterpartyRow}>
                {otherParty?.avatar_url ? (
                  <Image source={{ uri: otherParty.avatar_url }} style={styles.counterpartyAvatar} />
                ) : (
                  <View style={styles.counterpartyAvatarFallback}>
                    <Text style={styles.counterpartyAvatarText}>{String(otherPartyName || 'U').charAt(0).toUpperCase()}</Text>
                  </View>
                )}
                <Text style={styles.detailValue}>@{otherPartyName}</Text>
              </View>
              {otherPartyTrust && (
                <View style={[styles.trustBadge, { backgroundColor: otherPartyTrust.color }]}>
                  <Text style={styles.trustBadgeText}>{otherPartyTrust.label}</Text>
                </View>
              )}
            </View>
          </View>

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Sender Pi ID</Text>
            <View style={styles.detailValueContainer}>
              <Text style={styles.detailValue} selectable numberOfLines={1} ellipsizeMode="middle">{senderPiId || 'Not available'}</Text>
              <TouchableOpacity onPress={() => copyPiId('Sender Pi ID', senderPiId)} style={styles.copyButton}>
                <Text style={styles.copyButtonText}>Copy</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Recipient Pi ID</Text>
            <View style={styles.detailValueContainer}>
              <Text style={styles.detailValue} selectable numberOfLines={1} ellipsizeMode="middle">{recipientPiId || 'Not available'}</Text>
              <TouchableOpacity onPress={() => copyPiId('Recipient Pi ID', recipientPiId)} style={styles.copyButton}>
                <Text style={styles.copyButtonText}>Copy</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Transaction Type</Text>
            <Text style={styles.detailValue}>{transactionTypeLabel}</Text>
          </View>

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Your Role</Text>
            <Text style={styles.detailValue}>{roleLabel}</Text>
          </View>

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Completion Rule</Text>
            <Text style={styles.detailValue}>{currentEscrow.completion_method || 'sender_release'}</Text>
          </View>

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Reference</Text>
            <Text style={styles.detailValue}>{currentEscrow.reference_id}</Text>
          </View>

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Created</Text>
            <Text style={styles.detailValue}>{formatDate(currentEscrow.created_at)}</Text>
          </View>

          {currentEscrow.deadline && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Deadline</Text>
              <Text style={styles.detailValue}>{formatDate(currentEscrow.deadline)}</Text>
            </View>
          )}

          {currentEscrow.deposit_verified_at && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Deposit Confirmed</Text>
              <Text style={styles.detailValue}>{formatDate(currentEscrow.deposit_verified_at)}</Text>
            </View>
          )}

          {currentEscrow.released_at && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Released</Text>
              <Text style={styles.detailValue}>{formatDate(currentEscrow.released_at)}</Text>
            </View>
          )}

          {currentEscrow.pi_payment_id && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Pi Payment ID</Text>
              <Text style={styles.detailValue} selectable numberOfLines={1} ellipsizeMode="middle">{currentEscrow.pi_payment_id}</Text>
            </View>
          )}

          {currentEscrow.pi_transaction_id && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Pi Tx ID</Text>
              <Text style={styles.detailValue} selectable numberOfLines={1} ellipsizeMode="middle">{currentEscrow.pi_transaction_id}</Text>
            </View>
          )}

          {currentEscrow.pi_transaction_hash && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Deposit Tx Hash</Text>
              <Text style={styles.detailValue} selectable numberOfLines={1} ellipsizeMode="middle">{currentEscrow.pi_transaction_hash}</Text>
            </View>
          )}

          {currentEscrow.release_transaction_hash && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Release Tx Hash</Text>
              <Text style={styles.detailValue} selectable numberOfLines={1} ellipsizeMode="middle">{currentEscrow.release_transaction_hash}</Text>
            </View>
          )}

          {currentEscrow.note && (
            <View style={styles.noteContainer}>
              <Text style={styles.detailLabel}>Note</Text>
              <Text style={styles.noteText}>"{currentEscrow.note}"</Text>
            </View>
          )}
        </View>

        {/* Delivery Code */}
        {usesDeliveryCode && (
          <View style={styles.detailsCard}>
            <Text style={styles.sectionTitle}>Delivery Code</Text>
            {isSender ? (
              <View>
                <Text style={styles.detailLabel}>You hold the delivery QR/code. Show or share it only after you have received and checked the physical item.</Text>
                {deliveryCode && deliveryCodeExpiresAt ? (
                  <DeliveryCodeDisplay
                    code={deliveryCode}
                    qrPayload={deliveryQr || undefined}
                    expiresAt={deliveryCodeExpiresAt}
                    escrowId={currentEscrow.id}
                    recipientName={otherPartyName}
                    productTitle={deliveryItemLabel}
                  />
                ) : (
                  <Button
                    title={loading ? 'Loading...' : 'Get Delivery QR / Code'}
                    onPress={fetchDeliveryCode}
                    loading={loading}
                  />
                )}
              </View>
            ) : (
              <View>
                <Text style={styles.detailLabel}>Recipient or delivery side scans the sender's QR, or enters the sender-provided code, to confirm handoff and trigger automatic release.</Text>
                <TouchableOpacity
                  style={styles.deliveryEntryButton}
                  onPress={() => setShowCodeEntryModal(true)}
                  disabled={loading}
                >
                  <Text style={styles.deliveryEntryButtonText}>Open QR Scan / Code Entry</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {/* Milestones */}
        {milestones.length > 0 && (
          <View style={styles.detailsCard}>
            <Text style={styles.sectionTitle}>Milestones</Text>
            {milestonesLoading ? (
              <Text style={styles.detailLabel}>Loading milestones...</Text>
            ) : (
              milestones.map((milestone) => (
                <View key={milestone.id} style={styles.milestoneItem}>
                  <View>
                    <Text style={styles.detailValue}>{milestone.title}</Text>
                    <Text style={styles.helperText}>Amount: {formatPi(milestone.amount)}</Text>
                  </View>
                  <View style={styles.milestoneActions}>
                    <Text style={styles.milestoneStatus}>{milestone.status}</Text>
                    {milestone.status === 'pending' && !isSender && (
                      <TouchableOpacity
                        onPress={() => handleMilestoneAction(milestone.id, 'completed')}
                        style={styles.milestoneButton}
                      >
                        <Text style={styles.milestoneButtonText}>Mark Complete</Text>
                      </TouchableOpacity>
                    )}
                    {milestone.status === 'completed' && isSender && (
                      <TouchableOpacity
                        onPress={() => handleMilestoneAction(milestone.id, 'approved')}
                        style={styles.milestoneButton}
                      >
                        <Text style={styles.milestoneButtonText}>Approve</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              ))
            )}
          </View>
        )}

        {/* Actions */}
        {(canRelease || canRefund || canDispute || (currentEscrow.completion_method === 'receipt_evidence' && isSender)) && (
          <View style={styles.actionsContainer}>
            {canRelease && (
              <Button
                title="Release Payment"
                onPress={handleRelease}
                variant="success"
                loading={loading}
              />
            )}

            {canRefund && (
              <Button
                title="Refund Payment"
                onPress={handleRefund}
                variant="secondary"
                style={{ marginTop: SPACING.md }}
              />
            )}

            {canRefund && showRefundEvidenceUploader && (
              <View style={{ marginTop: SPACING.md }}>
                <Text style={{ fontWeight: '600', marginBottom: 6 }}>Upload Refund Payment Evidence</Text>
                <EvidenceUploader
                  escrowId={currentEscrow.id}
                  disputeId={null}
                  userId={user.id}
                  maxFiles={5}
                  onUploaded={async (result) => {
                    const evidenceUrl = result?.publicUrl || result?.imageUrl || result?.thumbnailPublicUrl;
                    if (!evidenceUrl) {
                      toast.push({ type: 'error', message: 'Evidence uploaded but no shareable URL was returned.' });
                      return;
                    }

                    setLoading(true);
                    try {
                      const chat = await shareRefundEvidenceInChat(evidenceUrl);
                      toast.push({ type: 'success', message: 'Evidence shared in chat. Recipient has been notified.' });

                      navigation.navigate('Chat', {
                        conversationId: chat.conversationId,
                        otherUser: chat.otherUser || {
                          id: chat.counterpartyId,
                          username: otherPartyName,
                        },
                        currentUser: user,
                      });
                    } catch (err: any) {
                      debugError('Refund evidence chat share failed', err);
                      toast.push({ type: 'error', message: err?.message || 'Failed to share evidence in chat' });
                    } finally {
                      setLoading(false);
                    }
                  }}
                />
              </View>
            )}

            {canDispute && (
              <Button
                title="Open Dispute"
                onPress={() => setShowDisputeModal(true)}
                variant="danger"
                style={{ marginTop: SPACING.md }}
              />
            )}
            {currentEscrow.completion_method === 'receipt_evidence' && isSender && (
              <View style={{ marginTop: SPACING.md }}>
                <Text style={{ fontWeight: '600', marginBottom: 6 }}>Upload Receipt Evidence</Text>
                <EvidenceUploader escrowId={currentEscrow.id} disputeId={null} userId={user.id} maxFiles={3} onUploaded={(r) => { try { toast.push({ type: 'success', message: r?.publicUrl || 'Uploaded' }); } catch(e) {} }} />
              </View>
            )}
          </View>
        )}

        {/* Timeline */}
        <View style={styles.timelineCard}>
          <Text style={styles.sectionTitle}>Timeline</Text>
          
          <View style={styles.timelineItem}>
            <View style={[styles.timelineDot, { backgroundColor: COLORS.success }]} />
            <View style={styles.timelineContent}>
              <Text style={styles.timelineTitle}>Escrow Created</Text>
              <Text style={styles.timelineDate}>{formatDate(currentEscrow.created_at)}</Text>
            </View>
          </View>

          {currentEscrow.deposit_verified_at && (
            <View style={styles.timelineItem}>
              <View style={[styles.timelineDot, { backgroundColor: COLORS.success }]} />
              <View style={styles.timelineContent}>
                <Text style={styles.timelineTitle}>Deposit Confirmed</Text>
                <Text style={styles.timelineDate}>{formatDate(currentEscrow.deposit_verified_at)}</Text>
              </View>
            </View>
          )}

          {usesDeliveryCode && completedStatuses.has(escrowStatus) && currentEscrow.released_at && (
            <View style={styles.timelineItem}>
              <View style={[styles.timelineDot, { backgroundColor: COLORS.success }]} />
              <View style={styles.timelineContent}>
                <Text style={styles.timelineTitle}>Delivery Code Verified</Text>
                <Text style={styles.timelineDate}>{formatDate(currentEscrow.released_at)}</Text>
              </View>
            </View>
          )}

          {completedStatuses.has(escrowStatus) && currentEscrow.released_at && (
            <View style={styles.timelineItem}>
              <View style={[styles.timelineDot, { backgroundColor: COLORS.success }]} />
              <View style={styles.timelineContent}>
                <Text style={styles.timelineTitle}>Payment Released</Text>
                <Text style={styles.timelineDate}>{formatDate(currentEscrow.released_at)}</Text>
              </View>
            </View>
          )}

          {currentEscrow.status === 'refunded' && (
            <View style={styles.timelineItem}>
              <View style={[styles.timelineDot, { backgroundColor: COLORS.warning }]} />
              <View style={styles.timelineContent}>
                <Text style={styles.timelineTitle}>Payment Refunded</Text>
                <Text style={styles.timelineDate}>Funds returned to sender</Text>
              </View>
            </View>
          )}

          {currentEscrow.status === 'release_requested' && (
            <View style={styles.timelineItem}>
              <View style={[styles.timelineDot, { backgroundColor: COLORS.warning }]} />
              <View style={styles.timelineContent}>
                <Text style={styles.timelineTitle}>Release Requested</Text>
                <Text style={styles.timelineDate}>Awaiting admin approval</Text>
              </View>
            </View>
          )}

          {currentEscrow.status === 'disputed' && (
            <View style={styles.timelineItem}>
              <View style={[styles.timelineDot, { backgroundColor: COLORS.error }]} />
              <View style={styles.timelineContent}>
                <Text style={styles.timelineTitle}>Dispute Opened</Text>
                <Text style={styles.timelineDate}>Under review</Text>
              </View>
            </View>
          )}

          {currentEscrow.deadline && (
            <View style={styles.timelineItem}>
              <View style={[styles.timelineDot, { backgroundColor: COLORS.muted }]} />
              <View style={styles.timelineContent}>
                <Text style={styles.timelineTitle}>Deadline</Text>
                <Text style={styles.timelineDate}>{formatDate(currentEscrow.deadline)}</Text>
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Dispute Evidence Modal */}
      <DisputeEvidenceModal
        visible={showDisputeModal}
        onClose={() => setShowDisputeModal(false)}
        escrow={currentEscrow}
        currentUser={user}
        onSubmit={() => {
          setCurrentEscrow({ ...currentEscrow, status: 'disputed' });
          navigation.goBack();
        }}
      />

      {/* Rating Modal */}
      <RatingModal
        visible={showRatingModal}
        onClose={() => {
          setShowRatingModal(false);
          navigation.goBack();
        }}
        escrow={currentEscrow}
        currentUser={user}
        onRated={() => navigation.goBack()}
      />

      <Modal
        visible={showCodeEntryModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowCodeEntryModal(false)}
      >
        <CodeEntryScreen
          escrowId={currentEscrow.id}
          senderName={currentEscrow.sender?.username || undefined}
          productTitle={deliveryItemLabel}
          amountPi={Number(currentEscrow.amount || 0)}
          onVerify={verifyDeliveryCodeForEntry}
          onVerifyQR={verifyDeliveryQrForEntry}
          onSuccess={() => {
            setShowCodeEntryModal(false);
            toast.push({ type: 'success', message: 'Delivery verified. Escrow released automatically.' });
          }}
          onCancel={() => setShowCodeEntryModal(false)}
        />
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.primary,
    paddingTop: SPACING.xxl + 10,
    paddingBottom: SPACING.md,
    paddingHorizontal: SPACING.md,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backIcon: {
    fontSize: 22,
    color: COLORS.primary,
    fontWeight: '700',
  },
  headerTitle: {
    ...HEADER_TITLE_TEXT,
    color: '#FFFFFF',
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    padding: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.lg,
  },
  statusIcon: {
    fontSize: 20,
    marginRight: SPACING.sm,
  },
  statusText: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  amountCard: {
    backgroundColor: COLORS.card,
    borderRadius: BORDER_RADIUS.xl,
    padding: SPACING.xl,
    alignItems: 'center',
    marginBottom: SPACING.lg,
    borderWidth: 2,
    borderColor: COLORS.primary,
  },
  guidanceCard: {
    backgroundColor: COLORS.card,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  guidanceEyebrow: {
    fontSize: FONT_SIZES.xs,
    fontWeight: '700',
    color: COLORS.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: SPACING.xs,
  },
  guidanceTitle: {
    fontSize: FONT_SIZES.xl,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: SPACING.sm,
  },
  guidanceText: {
    fontSize: FONT_SIZES.md,
    lineHeight: 22,
    color: COLORS.text,
    marginBottom: SPACING.sm,
  },
  guidanceSubtext: {
    fontSize: FONT_SIZES.sm,
    lineHeight: 20,
    color: COLORS.textSecondary,
  },
  guidanceHint: {
    fontSize: FONT_SIZES.sm,
    lineHeight: 20,
    color: COLORS.primary,
    fontWeight: '600',
    marginTop: SPACING.sm,
  },
  amountLabel: {
    fontSize: FONT_SIZES.md,
    color: COLORS.textSecondary,
  },
  amountValue: {
    fontSize: 42,
    fontWeight: '700',
    color: COLORS.primary,
    marginTop: SPACING.xs,
  },
  detailsCard: {
    backgroundColor: COLORS.card,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.lg,
  },
  sectionTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: SPACING.md,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  detailLabel: {
    fontSize: FONT_SIZES.md,
    color: COLORS.textSecondary,
  },
  detailValue: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    color: COLORS.text,
  },
  detailValueContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: '62%',
    gap: SPACING.sm,
  },
  copyButton: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: BORDER_RADIUS.sm,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  copyButtonText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.primary,
    fontWeight: '700',
  },
  userInfo: {
    alignItems: 'flex-end',
  },
  counterpartyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  counterpartyAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
  },
  counterpartyAvatarFallback: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counterpartyAvatarText: {
    color: '#FFFFFF',
    fontSize: FONT_SIZES.xs,
    fontWeight: '700',
  },
  trustBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.sm,
    marginTop: SPACING.xs,
  },
  trustBadgeText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  noteContainer: {
    paddingTop: SPACING.md,
  },
  noteText: {
    fontSize: FONT_SIZES.md,
    color: COLORS.text,
    fontStyle: 'italic',
    marginTop: SPACING.xs,
    lineHeight: 22,
  },
  actionsContainer: {
    marginBottom: SPACING.lg,
  },
  timelineCard: {
    backgroundColor: COLORS.card,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
  },
  timelineItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: SPACING.md,
  },
  timelineDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: SPACING.md,
    marginTop: 4,
  },
  timelineContent: {
    flex: 1,
  },
  timelineTitle: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    color: COLORS.text,
  },
  timelineDate: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  helperText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
    marginTop: SPACING.xs,
  },
  codeContainer: {
    marginTop: SPACING.md,
    padding: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
  },
  codeText: {
    fontSize: FONT_SIZES.xl,
    fontWeight: '700',
    letterSpacing: 4,
    color: COLORS.text,
  },
  codeInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginTop: SPACING.md,
  },
  codeInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.sm,
    backgroundColor: COLORS.card,
    color: COLORS.text,
  },
  verifyButton: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.primary,
  },
  verifyButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  deliveryEntryButton: {
    marginTop: SPACING.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
  },
  deliveryEntryButtonText: {
    color: '#FFFFFF',
    fontSize: FONT_SIZES.md,
    fontWeight: '700',
  },
  milestoneItem: {
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  milestoneActions: {
    marginTop: SPACING.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  milestoneStatus: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textSecondary,
    textTransform: 'capitalize',
  },
  milestoneButton: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.surface,
  },
  milestoneButtonText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary,
    fontWeight: '600',
  },
});
