import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import { supabase } from '../lib/supabase';
import { API_URL } from '../lib/api';
import { useToast } from '../components/Toast';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES, HEADER_TITLE_TEXT } from '../lib/theme';
import EvidenceUploader from '../components/EvidenceUploader';

export default function DisputeThreadScreen({ route, navigation }: any) {
  const { disputeId, title } = route.params || {};
  const [messages, setMessages] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const channelRef = useRef<any>(null);
  const toast = useToast();

  useEffect(() => {
    navigation.setOptions({ title: title || `Dispute ${disputeId}` });
    loadMessages();
    subscribe();
    supabase.auth.getSession().then((s: any) => setCurrentUserId(s?.data?.session?.user?.id || null)).catch(() => {});
    return () => unsubscribe();
  }, [disputeId]);

  async function loadMessages() {
    try {
      const { data, error } = await supabase.from('dispute_messages').select('id,dispute_id,sender_id,message,attachments,created_at').eq('dispute_id', disputeId).order('created_at', { ascending: true });
      if (error) throw error;
      setMessages(data || []);
    } catch (e) {
      toast.push({ type: 'error', message: 'Failed to load messages' });
    }
  }

  function subscribe() {
    try {
      const ch = supabase.channel(`dispute-${disputeId}`);
      ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dispute_messages', filter: `dispute_id=eq.${disputeId}` }, (payload: any) => {
        const rec = payload.record || payload.new || payload;
        setMessages((prev) => {
          const tempIdx = prev.findIndex((m) => typeof m.id === 'string' && m.id.startsWith('temp-') && m.message === rec.message && m.sender_id === rec.sender_id);
          if (tempIdx !== -1) {
            const copy = [...prev];
            copy[tempIdx] = rec;
            return copy;
          }
          return [...prev, rec];
        });
      });
      ch.subscribe();
      channelRef.current = ch;
    } catch (e) {
      // ignore
    }
  }

  function unsubscribe() {
    try {
      const ch = channelRef.current;
      if (ch && typeof ch.unsubscribe === 'function') ch.unsubscribe();
      else if (supabase && typeof supabase.removeChannel === 'function' && ch) supabase.removeChannel(ch);
    } catch (e) {}
  }

  async function sendMessage() {
    if (!text.trim()) return;
    const bodyText = text.trim();
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
    const clientId = tempId;
    const tempMsg = { id: tempId, client_id: clientId, dispute_id: disputeId, sender_id: currentUserId || 'me', message: bodyText, created_at: new Date().toISOString(), pending: true };
    setMessages((s) => [...s, tempMsg]);
    setText('');
    try {
      const sess = await supabase.auth.getSession();
      const token = sess?.data?.session?.access_token;
      const resp = await fetch(`${API_URL}/api/disputes/${encodeURIComponent(disputeId)}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : '' },
        body: JSON.stringify({ message: bodyText, client_id: clientId }),
      });
      if (!resp.ok) {
        const b = await resp.json().catch(() => ({}));
        throw new Error(b?.error || 'Failed to send');
      }
      toast.push({ type: 'success', message: 'Message sent' });
    } catch (e) {
      // mark failed
      setMessages((prev) => {
        const copy = [...prev];
        const idx = copy.findIndex((m) => m.id === tempId || m.client_id === tempId);
        if (idx !== -1) copy[idx] = { ...copy[idx], pending: false, failed: true };
        return copy;
      });
      toast.push({ type: 'error', message: 'Failed to send message' });
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Text style={styles.backButtonText}>←</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{title || `Dispute ${disputeId}`}</Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={{ marginBottom: 8 }}>
          <Text style={{ fontWeight: '600', marginBottom: 6 }}>Dispute Evidence</Text>
          <EvidenceUploader escrowId={''} disputeId={disputeId} userId={currentUserId || ''} onUploaded={(r) => { try { toast.push({ type: 'success', message: r?.publicUrl || 'Uploaded' }); } catch(e) {} }} />
        </View>
        <FlatList
          data={messages}
          keyExtractor={(i) => i.id}
          renderItem={({ item }) => (
            <View style={[styles.bubble, item.sender_id && item.sender_id !== currentUserId ? styles.otherBubble : styles.userBubble]}>
              <Text style={styles.msgText}>{item.message}</Text>
              <Text style={styles.msgTime}>{new Date(item.created_at).toLocaleString()}</Text>
              {item.pending && <Text style={{ fontSize: 11, color: '#888' }}>Sending…</Text>}
              {item.failed && (
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
                  <Text style={{ fontSize: 11, color: '#e44', marginRight: 8 }}>Failed</Text>
                </View>
              )}
            </View>
          )}
        />

        <View style={styles.inputRow}>
          <TextInput value={text} onChangeText={setText} placeholder="Type a message..." style={styles.input} multiline />
          <TouchableOpacity style={styles.sendBtn} onPress={sendMessage}>
            <Text style={{ color: '#fff' }}>Send</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc', padding: SPACING.sm },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 56,
    marginBottom: SPACING.sm,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  backButtonText: {
    color: COLORS.primary,
    fontSize: 22,
    fontWeight: '700',
  },
  headerTitle: {
    color: COLORS.primary,
    ...HEADER_TITLE_TEXT,
  },
  bubble: { padding: SPACING.sm, borderRadius: BORDER_RADIUS.md, marginVertical: SPACING.xs, maxWidth: '85%' },
  userBubble: { backgroundColor: '#E5E7EB', alignSelf: 'flex-start' },
  otherBubble: { backgroundColor: '#2563EB', alignSelf: 'flex-end' },
  msgText: { color: '#111' },
  msgTime: { fontSize: 10, color: '#666', marginTop: 6 },
  inputRow: { flexDirection: 'row', alignItems: 'center', padding: SPACING.sm, borderTopWidth: 1, borderTopColor: '#eee' },
  input: { flex: 1, minHeight: 40, maxHeight: 120, padding: SPACING.sm, backgroundColor: '#fff', borderRadius: BORDER_RADIUS.md, marginRight: SPACING.sm },
  sendBtn: { backgroundColor: COLORS.primary, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderRadius: BORDER_RADIUS.md },
});
