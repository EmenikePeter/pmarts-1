import React, { useState } from 'react';
import { View, Text, TextInput, Button, Alert, TouchableOpacity } from 'react-native';
import { useToast } from '../components/Toast';
import EvidenceUploader from '../components/EvidenceUploader';
import { COLORS } from '../lib/theme';

const API_URL = (process.env.EXPO_PUBLIC_API_URL || '').replace(/\/+$/, '');

export default function DisputeScreen({ route, navigation }: any) {
  const { escrowId: initialEscrowId, userId } = route.params || {};
  const toast = useToast();
  const [escrowId, setEscrowId] = useState<string>((initialEscrowId as string) || '');
  const [reason, setReason] = useState('');
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [createdDispute, setCreatedDispute] = useState<any>(null);

  async function createDispute() {
    if (!escrowId || !userId) {
      try { toast.push({ type: 'error', message: 'Escrow or user information is missing — please enter an Escrow ID' }); } catch(e) {}
      return;
    }
    if (!reason || !summary) {
      try { toast.push({ type: 'error', message: 'Please provide a reason and summary' }); } catch(e) {}
      return;
    }

    try {
      const res = await fetch(`${API_URL}/api/disputes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ escrowId, userId, reason, summary, description }),
      });
      const json = await res.json();
      if (!json || !json.success) {
        try { toast.push({ type: 'error', message: json?.error || 'Failed to create dispute' }); } catch(e) {}
        return;
      }
      setCreatedDispute(json.dispute);
      try { toast.push({ type: 'success', message: 'Dispute created — you can now upload evidence' }); } catch(e) {}
    } catch (e: any) {
      try { toast.push({ type: 'error', message: e?.message || String(e) }); } catch(e) {}
    }
  }

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
      <Text style={{ fontSize: 18, fontWeight: '700', marginBottom: 8 }}>Open Dispute</Text>
      {!initialEscrowId && (
        <>
          <Text>Escrow ID</Text>
          <TextInput value={escrowId} onChangeText={(t) => setEscrowId(t)} placeholder="Escrow ID (e.g. ESC-123)" style={{ borderWidth: 1, padding: 8, marginBottom: 8 }} />
        </>
      )}
      <Text>Reason</Text>
      <TextInput value={reason} onChangeText={setReason} placeholder="Brief reason" style={{ borderWidth: 1, padding: 8, marginBottom: 8 }} />
      <Text>Summary</Text>
      <TextInput value={summary} onChangeText={setSummary} placeholder="Short summary" style={{ borderWidth: 1, padding: 8, marginBottom: 8 }} />
      <Text>Description (optional)</Text>
      <TextInput value={description} onChangeText={setDescription} placeholder="More details" multiline style={{ borderWidth: 1, padding: 8, marginBottom: 12, minHeight: 80 }} />
      <Button title="Create Dispute" onPress={createDispute} />
      <View style={{ marginTop: 16 }}>
        <Text style={{ fontWeight: '600' }}>Upload Evidence</Text>
        <Text style={{ color: '#666', marginBottom: 8 }}>
          You can upload evidence now — it will be attached to the dispute once created.
        </Text>
        <EvidenceUploader
          escrowId={escrowId}
          disputeId={createdDispute ? createdDispute.id : null}
          userId={userId}
          onUploaded={(r) => {
            try { toast.push({ type: 'success', message: r?.publicUrl || 'Uploaded' }); } catch(e) {}
          }}
        />
        {createdDispute ? (
          <View style={{ marginTop: 12 }}>
            <Button title="Open Dispute Thread" onPress={() => navigation.navigate('DisputeThread', { disputeId: createdDispute.id })} />
          </View>
        ) : null}
      </View>
    </View>
  );
}
