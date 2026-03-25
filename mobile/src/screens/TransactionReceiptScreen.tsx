import React, { useEffect, useState } from 'react';
import { View, Text, Button, Linking, TouchableOpacity } from 'react-native';
import { supabase } from '../lib/supabase';
import EvidenceUploader from '../components/EvidenceUploader';
import { COLORS } from '../lib/theme';

export default function TransactionReceiptScreen({ route, navigation }: any) {
  const { paymentAttemptId, escrowId } = route.params || {};
  const [attempt, setAttempt] = useState<any>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      if (!paymentAttemptId) return;
      const { data } = await supabase.from('payment_attempts').select('*').eq('id', paymentAttemptId).maybeSingle();
      setAttempt(data || null);
    }
    load();
    supabase.auth.getSession().then((s: any) => setCurrentUserId(s?.data?.session?.user?.id || null)).catch(() => {});
  }, [paymentAttemptId]);

  if (!attempt) return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>No transaction info available</Text>
    </View>
  );

  const providerUrl = attempt?.metadata?.explorer_url || null;

  return (
    <View style={{ padding: 16 }}>
      <View style={{ minHeight: 56, justifyContent: 'center', marginBottom: 8 }}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            borderWidth: 1,
            borderColor: '#E5E7EB',
            backgroundColor: '#FFFFFF',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: COLORS.primary, fontSize: 22, fontWeight: '700' }}>←</Text>
        </TouchableOpacity>
      </View>
      <Text style={{ fontSize: 18, fontWeight: '700' }}>Transaction Receipt</Text>
      <Text style={{ marginTop: 12 }}>Provider: {attempt.provider}</Text>
      <Text>Tx ID: {attempt.provider_tx_id}</Text>
      <Text>Amount: {attempt.amount || '—'}</Text>
      <Text>Status: {attempt.status}</Text>
      <Text>Time: {attempt.updated_at || attempt.created_at}</Text>
      {providerUrl && (
        <Button title="Open in explorer" onPress={() => Linking.openURL(providerUrl)} />
      )}
      <View style={{ marginTop: 12 }}>
        <Text style={{ fontWeight: '600', marginBottom: 6 }}>Upload Receipt Evidence</Text>
        <EvidenceUploader escrowId={escrowId || ''} disputeId={null} userId={currentUserId || ''} maxFiles={2} onUploaded={(r) => { /* optional */ }} />
      </View>
    </View>
  );
}
