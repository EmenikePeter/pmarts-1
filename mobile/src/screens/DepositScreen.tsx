import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  TouchableOpacity,
  Modal,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useToast } from '../components/Toast';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { Button } from '../components';
import { TransactionTypeSelector, type TransactionType } from '../components/TransactionTypeSelector';
import { piSDKService, isInPiBrowser } from '../lib/PiSDKService';
import { API_URL } from '../lib/api';
import { supabase } from '../lib/supabase';
import { RootStackParamList, formatPi, generateEscrowId } from '../lib/types';
import { getBestAuthTokenFromSupabase, loadJsonValue, removeValue, saveJsonValue } from '../lib/appSession';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES, HEADER_TITLE_TEXT } from '../lib/theme';
import { fetchTransactionRules, resolveCompletionMethod, type TransactionRule } from '../lib/transactionRules';
import DebugLogPanel from '../components/DebugLogPanel';
import { debugError, debugLog, debugWarn, isDebugEnabled } from '../lib/debugLogger';

type DepositScreenProps = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Deposit'>;
  route: RouteProp<RootStackParamList, 'Deposit'>;
};

export default function DepositScreen({ navigation, route }: DepositScreenProps) {
  const { user, conversationId, prefillRecipientId } = route.params;
  const [sdkReady, setSdkReady] = useState(false);
  const isPiBrowser = isInPiBrowser();
  
  const [recipientId, setRecipientId] = useState(prefillRecipientId || '');
  const [amount, setAmount] = useState('');
  const [referenceId, setReferenceId] = useState('');
  const [note, setNote] = useState('');
  const [transactionType, setTransactionType] = useState<TransactionType>('physical_product');
  const [completionMethod, setCompletionMethod] = useState('delivery_code');
  const [rules, setRules] = useState<TransactionRule[]>([]);
  const [milestones, setMilestones] = useState<Array<{ title: string; amount: string }>>([]);
  const [loading, setLoading] = useState(false);
  const showDebug = isDebugEnabled();
  const toast = useToast();
  const draftKey = `deposit_draft_${user.id}`;

  // QR scanner state
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [qrScanned, setQrScanned] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [showQuickInstantModal, setShowQuickInstantModal] = useState(false);
  const [quickAmount, setQuickAmount] = useState('');
  const [quickReason, setQuickReason] = useState('');
  const [fastPathMode, setFastPathMode] = useState(false);

  const openQRScanner = async () => {
    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission();
      if (!result.granted) {
        Alert.alert('Camera permission required', 'Allow camera access to scan a payment QR code.');
        return;
      }
    }
    setQrScanned(false);
    setShowQRScanner(true);
  };

  const handleQRScanned = ({ data }: { data: string }) => {
    if (qrScanned) return;
    setQrScanned(true);
    setShowQRScanner(false);
    try {
      const payload = JSON.parse(data);
      if (payload?.t === 'pmarts' && payload?.rid) {
        setRecipientId(payload.rid);
        // Auto-select Instant Transfer — both parties are present at scan time
        setTransactionType('instant');
        setCompletionMethod(resolveCompletionMethod('instant', rules));
        setFastPathMode(true);
        setQuickAmount('');
        setQuickReason('');
        setShowQuickInstantModal(true);
        toast.push({ type: 'success', message: `Recipient @${payload.rid} filled in` });
      } else {
        Alert.alert('Invalid QR', 'This QR code is not a PMARTS payment code.');
      }
    } catch {
      Alert.alert('Invalid QR', 'Could not read this QR code.');
    }
  };

  const cancelQuickInstantAndRescan = async () => {
    setShowQuickInstantModal(false);
    setFastPathMode(false);
    await openQRScanner();
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const draft = await loadJsonValue<any>(draftKey);
        if (!mounted || !draft) return;

        if (!prefillRecipientId && draft.recipientId) setRecipientId(String(draft.recipientId));
        if (draft.amount) setAmount(String(draft.amount));
        if (draft.referenceId) setReferenceId(String(draft.referenceId));
        if (draft.note) setNote(String(draft.note));
        if (draft.transactionType) setTransactionType(draft.transactionType as TransactionType);
        if (draft.completionMethod) setCompletionMethod(String(draft.completionMethod));
        if (Array.isArray(draft.milestones)) setMilestones(draft.milestones);

        try { toast.push({ type: 'info', message: 'Restored your in-progress escrow draft' }); } catch (e) {}
      } catch (e) {
        debugWarn('[Deposit] failed to restore draft', e);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [draftKey, prefillRecipientId]);

  useEffect(() => {
    const payload = {
      recipientId,
      amount,
      referenceId,
      note,
      transactionType,
      completionMethod,
      milestones,
      updatedAt: new Date().toISOString(),
    };
    saveJsonValue(draftKey, payload).catch(() => {});
  }, [draftKey, recipientId, amount, referenceId, note, transactionType, completionMethod, milestones]);

  // Initialize Pi SDK
  useEffect(() => {
    if (isPiBrowser) {
      piSDKService.initialize().then(setSdkReady);
    }
  }, [isPiBrowser]);

  useEffect(() => {
    let mounted = true;

    const loadRules = async () => {
      const fetched = await fetchTransactionRules();
      if (!mounted) return;
      setRules(fetched);
      setCompletionMethod(resolveCompletionMethod(transactionType, fetched));
    };

    void loadRules();
    return () => {
      mounted = false;
    };
  }, [transactionType]);

  const parsedAmount = parseFloat(amount) || 0;
  const milestoneTotal = milestones.reduce((sum, milestone) => sum + (parseFloat(milestone.amount) || 0), 0);
  const milestonesValid = milestones.length === 0 || Math.abs(milestoneTotal - parsedAmount) < 0.01;
  const isValid = recipientId.trim() && parsedAmount > 0 && referenceId.trim() && milestonesValid;

  const getTransactionTypeLabel = (type: TransactionType): string => {
    if (type === 'currency_exchange') return 'Trade Agreement';
    return type.replace('_', ' ');
  };

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const waitForEscrowFunding = async (escrowId: string, timeoutMs = 60_000) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      try {
        const response = await fetch(`${API_URL}/api/escrow/v2/${escrowId}`);
        const payload = await response.json().catch(() => null);
        const status = String(payload?.escrow?.status || '').toLowerCase();
        if (['funds_held', 'held', 'delivery_in_progress'].includes(status)) {
          return payload?.escrow;
        }
      } catch (error) {
        debugWarn('[Deposit] waitForEscrowFunding fetch failed', error);
      }
      await sleep(3000);
    }
    return null;
  };

  const handleDeposit = async (options?: { amountOverride?: string; noteOverride?: string; quickInstant?: boolean }) => {
    const isQuickInstant = !!options?.quickInstant;
    const effectiveRecipient = recipientId.trim();
    const effectiveTransactionType: TransactionType = isQuickInstant ? 'instant' : transactionType;
    const effectiveCompletionMethod = resolveCompletionMethod(effectiveTransactionType, rules);
    const effectiveAmountRaw = isQuickInstant ? (options?.amountOverride ?? amount) : amount;
    const effectiveAmount = parseFloat(effectiveAmountRaw) || 0;
    const effectiveNote = isQuickInstant ? (options?.noteOverride ?? '') : note;
    const effectiveReferenceId = isQuickInstant
      ? `INSTANT-${Date.now().toString(36).toUpperCase()}`
      : referenceId.trim();

    const isQuickValid = effectiveRecipient && effectiveAmount > 0;
    const isFormValid = isValid;

    if ((isQuickInstant && !isQuickValid) || (!isQuickInstant && !isFormValid)) {
      try { toast.push({ type: 'error', message: 'Please fill in all required fields' }); } catch(e) {}
      return;
    }

    setLoading(true);

    try {
      debugLog('[Deposit] Start', {
        recipientId: effectiveRecipient,
        amount: effectiveAmount,
        referenceId: effectiveReferenceId,
        transactionType: effectiveTransactionType,
        completionMethod: effectiveCompletionMethod,
        milestoneCount: milestones.length,
        isPiBrowser,
        sdkReady,
        quickInstant: isQuickInstant,
      });

      // Step 1: Create escrow record via backend API (server/service-role write)
      const createResponse = await fetch(`${API_URL}/api/escrow/v2/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderId: user.id,
          recipientId: effectiveRecipient,
          amount: effectiveAmount,
          referenceId: effectiveReferenceId,
          note: effectiveNote.trim() || undefined,
          transactionType: effectiveTransactionType,
          completionMethod: effectiveCompletionMethod,
          milestones: milestones
            .filter((milestone) => milestone.title.trim() && parseFloat(milestone.amount) > 0)
            .map((milestone) => ({
              title: milestone.title.trim(),
              amount: parseFloat(milestone.amount),
            })),
        }),
      });

      const createPayload = await createResponse.json().catch(() => null);
      const result = {
        success: createResponse.ok && !!createPayload?.success,
        escrow: createPayload?.escrow,
        pmarts_reference: createPayload?.pmartsReference,
        error: createPayload?.error || (!createResponse.ok ? `Failed to create escrow (${createResponse.status})` : null),
      };

      debugLog('[Deposit] Create escrow result', {
        success: result.success,
        escrowId: result.escrow?.id,
        error: result.error,
      });

      if (!result.success || !result.escrow) {
        try { toast.push({ type: 'error', message: result.error || 'Failed to create escrow' }); } catch(e) {}
        return;
      }

      // Clear draft once escrow is created successfully
      await removeValue(draftKey);

      const escrow = result.escrow;
      const pmartsRef = result.pmarts_reference || generateEscrowId();

      // Best-effort: if this escrow was created from a chat, link it back to that conversation
      if (conversationId && escrow?.id) {
        try {
          const token = await getBestAuthTokenFromSupabase(supabase);
          const linkResp = await fetch(`${API_URL}/api/messages/conversations/${encodeURIComponent(conversationId)}/link-escrow`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: token ? `Bearer ${token}` : '',
            },
            body: JSON.stringify({ escrowId: escrow.id }),
          });
          if (!linkResp.ok) {
            const b = await linkResp.json().catch(() => ({}));
            debugWarn('[Deposit] Failed to link escrow to chat', b?.error || linkResp.status);
          } else {
            debugLog('[Deposit] Linked escrow to conversation', { conversationId, escrowId: escrow.id });
          }
        } catch (linkErr) {
          debugWarn('[Deposit] Error linking escrow to conversation', linkErr);
        }
      }

      // Step 2: Initiate Pi payment via Pi SDK (if in Pi Browser)
      if (isPiBrowser && sdkReady) {
        debugLog('[Deposit] Initiating Pi payment', { escrowId: escrow.id });
        const paymentResult = await piSDKService.createEscrowDeposit({
          escrowId: escrow.id,
          amount: effectiveAmount,
          senderId: user.pi_id || user.id,
          recipientId: effectiveRecipient,
          referenceId: effectiveReferenceId,
          description: effectiveNote.trim() || `Escrow for ${effectiveReferenceId}`,
        });

        debugLog('[Deposit] Pi payment result', {
          success: paymentResult.success,
          paymentId: paymentResult.paymentId,
          txid: paymentResult.txid,
          error: paymentResult.error,
        });

        if (paymentResult.success && paymentResult.paymentId) {
          let latestEscrow = escrow;

          try {
            const response = await fetch(`${API_URL}/api/escrow/v2/${escrow.id}`);
            debugLog('[Deposit] Refresh escrow response', {
              ok: response.ok,
              status: response.status,
            });
            const data = await response.json();
            if (response.ok && data?.escrow) {
              latestEscrow = data.escrow;
            }
          } catch (fetchError) {
            debugWarn('Failed to refresh escrow', fetchError);
          }

          if (effectiveTransactionType === 'instant') {
            try {
              const fundedEscrow = await waitForEscrowFunding(escrow.id, 60_000);
              if (fundedEscrow) {
                const token = await getBestAuthTokenFromSupabase(supabase);
                const releaseResp = await fetch(`${API_URL}/api/escrow/v2/release`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: token ? `Bearer ${token}` : '',
                  },
                  body: JSON.stringify({ escrowId: escrow.id, userId: user.id }),
                });
                const releasePayload = await releaseResp.json().catch(() => null);
                if (releaseResp.ok && releasePayload?.success) {
                  latestEscrow = releasePayload.escrow || latestEscrow;
                  try { toast.push({ type: 'success', message: 'Instant payment released automatically' }); } catch (e) {}
                } else {
                  debugWarn('[Deposit] Instant auto-release failed', releasePayload?.error || releaseResp.status);
                }
              } else {
                debugWarn('[Deposit] Escrow funding not confirmed within 60 seconds for instant release', { escrowId: escrow.id });
              }
            } catch (instantReleaseError) {
              debugWarn('[Deposit] Instant auto-release exception', instantReleaseError);
            }
          }

          Alert.alert(
            'Escrow Created! 🎉',
            `${formatPi(effectiveAmount)} is now held in escrow.\n\nPMARTS Ref: ${pmartsRef}\nRecipient: @${effectiveRecipient}`,
            [
              {
                text: 'View Details',
                onPress: () => navigation.replace('EscrowDetail', { 
                  escrow: latestEscrow, 
                  user 
                }),
              },
              {
                text: 'Done',
                onPress: () => navigation.goBack(),
              },
            ]
          );
        } else {
          try { toast.push({ type: 'error', message: paymentResult.error || 'Payment was cancelled' }); } catch(e) {}
        }
      } else {
        // Demo mode - not in Pi Browser
        Alert.alert(
          'Escrow Created (Demo) 🎉',
          `${formatPi(effectiveAmount)} would be held in escrow.\n\nPMARTS Ref: ${pmartsRef}\nRecipient: @${effectiveRecipient}\n\n⚠️ Open in Pi Browser to complete real payment`,
          [
            {
              text: 'View Details',
              onPress: () => navigation.replace('EscrowDetail', { escrow, user }),
            },
            {
              text: 'Done',
              onPress: () => navigation.goBack(),
            },
          ]
        );
      }
    } catch (err: any) {
      debugError('Deposit error', err);
      try { toast.push({ type: 'error', message: err.message || 'Failed to create escrow' }); } catch(e) {}
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Create Escrow</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Info Card */}
        <View style={styles.infoCard}>
          <Text style={styles.infoIcon}>🔒</Text>
          <Text style={styles.infoText}>
            Funds will be held securely until you confirm delivery
          </Text>
        </View>

        {/* Form */}
        <View style={styles.form}>
          {/* Recipient */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Recipient Pi ID *</Text>
            <View style={styles.recipientRow}>
              <TextInput
                style={styles.recipientInput}
                placeholder="Enter recipient's Pi username"
                placeholderTextColor={COLORS.textMuted}
                value={recipientId}
                onChangeText={setRecipientId}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                style={styles.scanQRButton}
                onPress={openQRScanner}
                activeOpacity={0.7}
              >
                <Text style={styles.scanQRIcon}>📷</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.recipientHint}>
              Tap 📷 to scan recipient's Payment QR — fills this field automatically
            </Text>
          </View>

          {fastPathMode && (
            <View style={styles.fastPathNotice}>
              <Text style={styles.fastPathNoticeText}>
                Fast QR mode active: amount and optional reason are handled in the instant modal.
              </Text>
            </View>
          )}

          {!fastPathMode && (
          <>
          {/* Amount */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Amount (Pi) *</Text>
            <View style={styles.amountContainer}>
              <Text style={styles.piSymbol}>π</Text>
              <TextInput
                style={styles.amountInput}
                placeholder="0.00"
                placeholderTextColor={COLORS.textMuted}
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
              />
            </View>
            <Text style={styles.balanceHint}>
              Available: {formatPi(user.balance)}
            </Text>
          </View>

          {/* Reference ID */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Reference ID *</Text>
            <TextInput
              style={styles.input}
              placeholder="ORDER-123, INVOICE-456, etc."
              placeholderTextColor={COLORS.textMuted}
              value={referenceId}
              onChangeText={setReferenceId}
              autoCapitalize="characters"
            />
          </View>

          {/* Note */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Note (Optional)</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="What is this payment for?"
              placeholderTextColor={COLORS.textMuted}
              value={note}
              onChangeText={setNote}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
          </View>

          {/* Transaction Type */}
          <View style={styles.inputGroup}>
            <TransactionTypeSelector
              value={transactionType}
              onChange={(type) => {
                setTransactionType(type);
                setCompletionMethod(resolveCompletionMethod(type, rules));
              }}
              disabled={loading}
            />
            <Text style={styles.helperText}>Completion method: {completionMethod.replace('_', ' ')}</Text>
            <Text style={styles.complianceNotice}>
              PMARTS does not facilitate currency exchange. All external payments are user agreements outside the platform.
            </Text>
          </View>

          {/* Milestones */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Milestones (Optional)</Text>
            {milestones.map((milestone, index) => (
              <View key={`${index}`} style={styles.milestoneRow}>
                <TextInput
                  style={[styles.input, styles.milestoneTitle]}
                  placeholder={`Milestone ${index + 1} title`}
                  placeholderTextColor={COLORS.textMuted}
                  value={milestone.title}
                  onChangeText={(value) =>
                    setMilestones((prev) =>
                      prev.map((item, idx) => (idx === index ? { ...item, title: value } : item))
                    )
                  }
                />
                <TextInput
                  style={[styles.input, styles.milestoneAmount]}
                  placeholder="0"
                  placeholderTextColor={COLORS.textMuted}
                  value={milestone.amount}
                  onChangeText={(value) =>
                    setMilestones((prev) =>
                      prev.map((item, idx) => (idx === index ? { ...item, amount: value } : item))
                    )
                  }
                  keyboardType="decimal-pad"
                />
                <TouchableOpacity
                  onPress={() =>
                    setMilestones((prev) => prev.filter((_, idx) => idx !== index))
                  }
                  style={styles.removeMilestone}
                >
                  <Text style={styles.removeMilestoneText}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}

            <TouchableOpacity
              onPress={() => setMilestones((prev) => [...prev, { title: '', amount: '' }])}
              style={styles.addMilestoneButton}
            >
              <Text style={styles.addMilestoneText}>+ Add Milestone</Text>
            </TouchableOpacity>

            {milestones.length > 0 && (
              <Text style={styles.helperText}>
                Milestone total: {formatPi(milestoneTotal)} {milestonesValid ? '' : '(must equal total amount)'}
              </Text>
            )}
          </View>
          </>
          )}
        </View>

        {/* Summary */}
        {!fastPathMode && parsedAmount > 0 && (
          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>Summary</Text>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Amount to hold</Text>
              <Text style={styles.summaryValue}>{formatPi(parsedAmount)}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Recipient</Text>
              <Text style={styles.summaryValue}>@{recipientId || '---'}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Transaction Type</Text>
              <Text style={styles.summaryValue}>{getTransactionTypeLabel(transactionType)}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Completion</Text>
              <Text style={styles.summaryValue}>{completionMethod.replace('_', ' ')}</Text>
            </View>
            <View style={styles.divider} />
            <Text style={styles.summaryNote}>
              ℹ️ The recipient will be notified. You can release or dispute at any time.
            </Text>
          </View>
        )}

        {/* Submit Button */}
        {!fastPathMode && (
          <Button
            title={loading ? 'Creating Escrow...' : 'Deposit & Hold Payment'}
            onPress={handleDeposit}
            disabled={!isValid}
            loading={loading}
          />
        )}

        {showDebug && <DebugLogPanel title="Deposit Debug" />}

        {!fastPathMode && (
          <Text style={styles.disclaimer}>
            By creating this escrow, you agree to hold funds until delivery is confirmed.
          </Text>
        )}
      </ScrollView>
    </KeyboardAvoidingView>

    {/* QR Scanner Modal */}
    <Modal
      visible={showQRScanner}
      animationType="slide"
      onRequestClose={() => setShowQRScanner(false)}
    >
      <View style={styles.scannerContainer}>
        <Text style={styles.scannerTitle}>Scan Payment QR</Text>
        <Text style={styles.scannerSubtitle}>
          Ask the recipient to show their Payment QR from their Profile screen
        </Text>
        <CameraView
          style={styles.camera}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={handleQRScanned}
        />
        <TouchableOpacity
          style={styles.cancelScanButton}
          onPress={() => setShowQRScanner(false)}
          activeOpacity={0.8}
        >
          <Text style={styles.cancelScanText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </Modal>
    <Modal
      visible={showQuickInstantModal}
      animationType="slide"
      transparent
      onRequestClose={cancelQuickInstantAndRescan}
    >
      <View style={styles.quickModalBackdrop}>
        <View style={styles.quickModalCard}>
          <Text style={styles.quickModalTitle}>Instant Transfer</Text>
          <Text style={styles.quickModalSubtitle}>Recipient: @{recipientId || '—'}</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Amount (Pi) *</Text>
            <View style={styles.amountContainer}>
              <Text style={styles.piSymbol}>π</Text>
              <TextInput
                style={styles.amountInput}
                placeholder="0.00"
                placeholderTextColor={COLORS.textMuted}
                value={quickAmount}
                onChangeText={setQuickAmount}
                keyboardType="decimal-pad"
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Reason (Optional)</Text>
            <TextInput
              style={styles.input}
              placeholder="Short note for dispute/reconciliation"
              placeholderTextColor={COLORS.textMuted}
              value={quickReason}
              onChangeText={setQuickReason}
            />
          </View>

          <View style={styles.quickModalActions}>
            <TouchableOpacity
              style={styles.quickCancelButton}
              onPress={cancelQuickInstantAndRescan}
              disabled={loading}
            >
              <Text style={styles.quickCancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.quickConfirmButton}
              onPress={async () => {
                if ((parseFloat(quickAmount) || 0) <= 0) {
                  try { toast.push({ type: 'error', message: 'Enter a valid amount' }); } catch(e) {}
                  return;
                }
                setShowQuickInstantModal(false);
                await handleDeposit({ amountOverride: quickAmount, noteOverride: quickReason, quickInstant: true });
              }}
              disabled={loading}
            >
              <Text style={styles.quickConfirmButtonText}>{loading ? 'Processing...' : 'Confirm'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
    </>
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
  infoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.lg,
  },
  infoIcon: {
    fontSize: 24,
    marginRight: SPACING.sm,
  },
  infoText: {
    flex: 1,
    fontSize: FONT_SIZES.sm,
    color: '#92400E',
  },
  form: {
    backgroundColor: COLORS.card,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.lg,
  },
  inputGroup: {
    marginBottom: SPACING.lg,
  },
  label: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: SPACING.sm,
  },
  recipientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  recipientInput: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    fontSize: FONT_SIZES.lg,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  scanQRButton: {
    backgroundColor: COLORS.primary,
    borderRadius: BORDER_RADIUS.md,
    width: 48,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanQRIcon: {
    fontSize: 22,
  },
  recipientHint: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.textMuted,
    marginTop: 4,
  },
  fastPathNotice: {
    backgroundColor: '#E8F5E9',
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  fastPathNoticeText: {
    color: '#1B5E20',
    fontSize: FONT_SIZES.sm,
    lineHeight: 20,
  },
  input: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    fontSize: FONT_SIZES.lg,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  textArea: {
    minHeight: 80,
    paddingTop: SPACING.md,
  },
  amountContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  piSymbol: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.secondary,
    marginRight: SPACING.sm,
  },
  amountInput: {
    flex: 1,
    fontSize: 28,
    fontWeight: '600',
    color: COLORS.text,
    paddingVertical: SPACING.md,
  },
  balanceHint: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
    marginTop: SPACING.xs,
  },
  scannerContainer: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scannerTitle: {
    color: '#FFFFFF',
    fontSize: FONT_SIZES.xl,
    fontWeight: '700',
    marginBottom: SPACING.xs,
    paddingTop: SPACING.xxl,
  },
  scannerSubtitle: {
    color: '#AAAAAA',
    fontSize: FONT_SIZES.sm,
    textAlign: 'center',
    paddingHorizontal: SPACING.xl,
    marginBottom: SPACING.lg,
  },
  camera: {
    width: 280,
    height: 280,
    borderRadius: BORDER_RADIUS.md,
    overflow: 'hidden',
  },
  cancelScanButton: {
    marginTop: SPACING.xl,
    backgroundColor: '#333333',
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.xxl,
  },
  cancelScanText: {
    color: '#FFFFFF',
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
  },
  quickModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
  },
  quickModalCard: {
    backgroundColor: COLORS.card,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
  },
  quickModalTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: SPACING.xs,
  },
  quickModalSubtitle: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
    marginBottom: SPACING.md,
  },
  quickModalActions: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginTop: SPACING.sm,
  },
  quickCancelButton: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  quickCancelButtonText: {
    color: COLORS.text,
    fontWeight: '600',
    fontSize: FONT_SIZES.md,
  },
  quickConfirmButton: {
    flex: 1,
    backgroundColor: COLORS.primary,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  quickConfirmButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: FONT_SIZES.md,
  },
  summaryCard: {
    backgroundColor: COLORS.card,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.lg,
    borderWidth: 2,
    borderColor: COLORS.secondary,
  },
  summaryTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: SPACING.md,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  summaryLabel: {
    fontSize: FONT_SIZES.md,
    color: COLORS.textSecondary,
  },
  summaryValue: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '600',
    color: COLORS.text,
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: SPACING.md,
  },
  summaryNote: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textSecondary,
    lineHeight: 20,
  },
  disclaimer: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: SPACING.md,
    lineHeight: 18,
  },
  helperText: {
    marginTop: SPACING.sm,
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
  },
  complianceNotice: {
    marginTop: SPACING.sm,
    fontSize: FONT_SIZES.xs,
    color: COLORS.textMuted,
    lineHeight: 18,
  },
  milestoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  milestoneTitle: {
    flex: 1,
  },
  milestoneAmount: {
    width: 80,
    textAlign: 'center',
  },
  removeMilestone: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface,
  },
  removeMilestoneText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.sm,
  },
  addMilestoneButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.surface,
  },
  addMilestoneText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary,
    fontWeight: '600',
  },
});

