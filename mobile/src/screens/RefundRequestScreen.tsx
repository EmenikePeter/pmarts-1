import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { API_URL } from '../lib/api';
import { getBestAuthTokenFromSupabase } from '../lib/appSession';
import { supabase } from '../lib/supabase';
import piSDK from '../services/PiSDKService';
import { debugError } from '../lib/debugLogger';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../lib/types';
import { COLORS, SPACING, FONT_SIZES, BORDER_RADIUS } from '../lib/theme';
import * as EscrowService from '../services/EscrowService';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'RefundRequest'>;
  route: RouteProp<RootStackParamList, 'RefundRequest'> & { params?: { escrow?: any } };
};

const REASONS = [
  { value: 'non_delivery', label: 'Item not delivered' },
  { value: 'partial_delivery', label: 'Partial delivery' },
  { value: 'wrong_item', label: 'Wrong item' },
  { value: 'quality_issue', label: 'Quality or quality issues' },
  { value: 'fraud', label: 'Suspected fraud' },
  { value: 'mutual_agreement', label: 'Mutual agreement' },
  { value: 'payment_failure', label: 'Payment failure' },
  { value: 'platform_error', label: 'Platform error' },
  { value: 'other', label: 'Other' },
];

export default function RefundRequestScreen({ navigation, route }: Props) {
  const escrow = route?.params?.escrow;
  const [reason, setReason] = useState<string>('non_delivery');
  const [justification, setJustification] = useState('');
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [evidence, setEvidence] = useState<string[]>([]);
  const [contactAttempted, setContactAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);

  function addEvidence() {
    const url = evidenceUrl.trim();
    if (!url) return;
    setEvidence((s) => [...s, url]);
    setEvidenceUrl('');
  }

  async function pickImageAndUpload() {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission required', 'Please allow photo access to upload evidence.');
        return;
      }

      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: false, quality: 0.7, base64: true });
      if ((res as any).canceled) return;

      // Try to upload to API endpoint; fallback to data URL
      setUploading(true);
      try {
        const asset = Array.isArray((res as any).assets) ? (res as any).assets[0] : null;
        const uri = asset?.uri as string | undefined;
        const base64 = asset?.base64 as string | undefined;

        if (!uri) {
          Alert.alert('Upload failed', 'No image selected');
          return;
        }

        const form = new FormData();
        const uriParts = uri.split('/');
        const name = uriParts[uriParts.length - 1] || `evidence_${Date.now()}.jpg`;
        // @ts-ignore
        form.append('file', { uri, name, type: 'image/jpeg' } as any);

        const token = await getBestAuthTokenFromSupabase(supabase);
        const resp = await fetch(`${API_URL}/api/uploads/evidence`, {
          method: 'POST',
          body: form as any,
          headers: {
            Accept: 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });

        if (resp.ok) {
          const body = await resp.json().catch(() => null);
          const url = body?.publicUrl || body?.url || body?.fileUrl;
          const thumb = body?.thumbnailPublicUrl || body?.thumbnailUrl || null;
          if (url) {
            setEvidence((s) => [...s, url]);

            // Best-effort: record refund evidence server-side so it attaches to future refund submissions
            try {
              const token = await getBestAuthTokenFromSupabase(supabase);
              const currentUser = piSDK.getCurrentUser();
              await fetch(`${API_URL}/api/refund-evidence`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                body: JSON.stringify({ escrowId: escrow?.id, userId: currentUser?.uid || null, imageUrl: url, thumbnailUrl: thumb, filename: name, mime: 'image/jpeg' }),
              }).catch(() => {});
            } catch (e) {
              // non-fatal
            }

            return;
          }
        }

        // Fallback: use base64 data URL if upload not available
        if (base64) {
          const dataUrl = `data:image/jpeg;base64,${base64}`;
          setEvidence((s) => [...s, dataUrl]);
        } else {
          Alert.alert('Upload failed', 'Unable to upload image and no fallback available.');
        }
      } finally {
        setUploading(false);
      }
    } catch (err) {
      setUploading(false);
      debugError('[RefundRequest] pickImage error', err as any);
      Alert.alert('Error', 'Failed to pick image');
    }
  }

  function removeEvidence(idx: number) {
    setEvidence((s) => s.filter((_, i) => i !== idx));
  }

  async function submit() {
    if (!escrow?.id) {
      Alert.alert('Missing escrow', 'Cannot request refund without escrow context');
      return;
    }

    // Basic client validation matching backend rules
    const systemReason = reason === 'payment_failure' || reason === 'platform_error';
    if (!systemReason) {
      if (!justification || justification.trim().length < 20) {
        Alert.alert('Validation', 'Justification must be at least 20 characters');
        return;
      }
      if (reason !== 'mutual_agreement' && evidence.length === 0) {
        Alert.alert('Validation', 'At least one piece of evidence is required for this reason');
        return;
      }
      if (reason === 'fraud' && evidence.length < 2) {
        Alert.alert('Validation', 'Fraud claims require at least 2 pieces of evidence');
        return;
      }
      if (!contactAttempted) {
        Alert.alert('Validation', 'You must attempt to contact the recipient before requesting a refund');
        return;
      }
    }

    setSubmitting(true);
    try {
      const res = await EscrowService.refundEscrow(escrow.id, reason, {
        justification,
        evidenceUrls: evidence,
        contactAttempted,
      });

      if (!res.success) {
        Alert.alert('Error', res.error || 'Failed to submit refund request');
        setSubmitting(false);
        return;
      }

      Alert.alert('Refund Requested', 'Your refund request was submitted and will be reviewed by our support team.');
      navigation.goBack();
    } catch (err) {
      Alert.alert('Error', 'Unexpected error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Request a Refund</Text>
      <Text style={styles.subtitle}>Escrow: {escrow?.reference_id || escrow?.id}</Text>

      <View style={styles.section}>
        <Text style={styles.label}>Reason</Text>
        {REASONS.map((r) => (
          <TouchableOpacity key={r.value} style={styles.optionRow} onPress={() => setReason(r.value)}>
            <View style={[styles.radio, reason === r.value && styles.radioSelected]} />
            <Text style={styles.optionLabel}>{r.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Justification</Text>
        <TextInput
          value={justification}
          onChangeText={setJustification}
          placeholder="Explain why you are requesting a refund (min 20 chars)"
          multiline
          numberOfLines={4}
          style={styles.textarea}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Evidence URLs</Text>
        <View style={styles.row}>
          <TextInput
            value={evidenceUrl}
            onChangeText={setEvidenceUrl}
            placeholder="Paste an evidence URL (image, tracking, chat)"
            style={[styles.input, { flex: 1 }]}
          />
          <TouchableOpacity onPress={addEvidence} style={styles.addButton}>
            <Text style={styles.addButtonText}>Add</Text>
          </TouchableOpacity>
        </View>
        {evidence.map((url, idx) => (
          <View key={idx} style={styles.evidenceRow}>
            <Text style={styles.evidenceText} numberOfLines={1}>{url}</Text>
            <TouchableOpacity onPress={() => removeEvidence(idx)}>
              <Text style={styles.removeText}>Remove</Text>
            </TouchableOpacity>
          </View>
        ))}
      </View>

      <View style={styles.sectionRow}>
        <TouchableOpacity onPress={() => setContactAttempted((s) => !s)} style={styles.checkbox}>
          <Text style={{ fontSize: 14 }}>{contactAttempted ? '☑' : '☐'}</Text>
        </TouchableOpacity>
        <Text style={styles.checkboxLabel}>I attempted to contact the recipient before requesting refund</Text>
      </View>

      <TouchableOpacity style={styles.submitButton} onPress={submit} disabled={submitting}>
        <Text style={styles.submitButtonText}>{submitting ? 'Submitting…' : 'Submit Refund Request'}</Text>
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.md },
  title: { fontSize: FONT_SIZES.xxl, fontWeight: '700', color: COLORS.text },
  subtitle: { fontSize: FONT_SIZES.md, color: COLORS.textMuted, marginTop: 6 },
  section: { marginTop: SPACING.md },
  sectionRow: { marginTop: SPACING.md, flexDirection: 'row', alignItems: 'center' },
  label: { fontSize: FONT_SIZES.md, fontWeight: '600', color: COLORS.textSecondary, marginBottom: 8 },
  optionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: COLORS.border, marginRight: 12 },
  radioSelected: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  optionLabel: { fontSize: FONT_SIZES.md, color: COLORS.textSecondary },
  textarea: { borderWidth: 1, borderColor: COLORS.border, borderRadius: BORDER_RADIUS.sm, padding: SPACING.sm, minHeight: 100, textAlignVertical: 'top' },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.sm },
  input: { borderWidth: 1, borderColor: COLORS.border, borderRadius: BORDER_RADIUS.sm, padding: SPACING.sm, height: 44 },
  addButton: { marginLeft: 8, backgroundColor: COLORS.primary, paddingHorizontal: 12, paddingVertical: 10, borderRadius: BORDER_RADIUS.sm },
  addButtonText: { color: 'white', fontWeight: '600' },
  evidenceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  evidenceText: { color: COLORS.textSecondary, flex: 1, marginRight: 8 },
  removeText: { color: COLORS.error, fontSize: FONT_SIZES.sm },
  checkbox: { marginRight: 8 },
  checkboxLabel: { flex: 1, color: COLORS.textSecondary },
  submitButton: { marginTop: SPACING.lg, backgroundColor: COLORS.secondary, paddingVertical: 14, borderRadius: BORDER_RADIUS.md, alignItems: 'center' },
  submitButtonText: { color: '#000', fontWeight: '700' },
});
