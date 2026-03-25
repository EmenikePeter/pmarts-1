import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../lib/types';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES, HEADER_TITLE_TEXT } from '../lib/theme';
import { supabase } from '../lib/supabase';
import { API_URL } from '../lib/api';
import { debugLog, debugWarn, debugError } from '../lib/debugLogger';
import { useToast } from '../components/Toast';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'SupportChat'>;
  route: RouteProp<RootStackParamList, 'SupportChat'>;
};

export default function SupportChatScreen({ navigation, route }: Props) {
  const { ticketId, title } = route.params;
  const [messages, setMessages] = useState<any[]>([]);
  const [text, setText] = useState('');
  const toast = useToast();
  const channelRef = useRef<any>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [typingUsers, setTypingUsers] = useState<Record<string, number>>({});
  const lastActivityRef = useRef<number | null>(null);

  useEffect(() => {
    navigation.setOptions({ title: title || 'Support Chat' });
    loadMessages();
    subscribe();
    // get current user id for optimistic UI and typing checks
    supabase.auth.getSession().then((s: any) => setCurrentUserId(s?.data?.session?.user?.id || null)).catch(() => {});
    return () => {
      unsubscribe();
    };
  }, [ticketId]);

  async function loadMessages(page = 0) {
    try {
      const pageSize = 50;
      const offset = page * pageSize;
      const { data, error } = await supabase.from('support_ticket_messages').select('id,ticket_id,sender_id,message,attachments,created_at').eq('ticket_id', ticketId).order('created_at', { ascending: true }).range(offset, offset + pageSize - 1);
      if (error) throw error;
      if (page === 0) setMessages(data || []);
      else setMessages((prev) => [...prev, ...(data || [])]);
    } catch (e) {
      debugWarn('loadMessages failed', e);
      toast.push({ type: 'error', message: 'Failed to load messages' });
    }
  }

  function subscribe() {
    try {
      const ch = supabase.channel(`ticket-${ticketId}`);

      ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_ticket_messages', filter: `ticket_id=eq.${ticketId}` }, (payload: any) => {
        const rec = payload.record || payload.new || payload;
        lastActivityRef.current = Date.now();
        setMessages((prev) => {
          // dedupe: if a temp optimistic message matches this text, replace it
          const tempIdx = prev.findIndex((m) => typeof m.id === 'string' && m.id.startsWith('temp-') && m.message === rec.message && m.sender_id === rec.sender_id);
          if (tempIdx !== -1) {
            const copy = [...prev];
            copy[tempIdx] = rec;
            return copy;
          }
          return [...prev, rec];
        });
      });

      // subscribe to typing indications
      ch.on('postgres_changes', { event: '*', schema: 'public', table: 'support_typing', filter: `ticket_id=eq.${ticketId}` }, (payload: any) => {
        const rec = payload.record || payload.new || payload;
        const uid = rec?.user_id || rec?.sender_id;
        if (!uid) return;
        // mark typing timestamp
        setTypingUsers((prev) => ({ ...prev, [uid]: Date.now() }));
        // clear after 4s
        setTimeout(() => {
          setTypingUsers((prev) => {
            const cp = { ...prev };
            if (cp[uid] && Date.now() - cp[uid] > 3500) delete cp[uid];
            return cp;
          });
        }, 4000);
      });

      ch.subscribe();
      channelRef.current = ch;
    } catch (e) {
      debugWarn('subscribe error', e);
    }
  }

  function unsubscribe() {
    try {
      const ch = channelRef.current;
      if (ch && typeof ch.unsubscribe === 'function') ch.unsubscribe();
      else if (supabase && typeof supabase.removeChannel === 'function' && ch) supabase.removeChannel(ch);
    } catch (e) {
      // ignore
    }
  }

  // throttled typing ping
  const typingTimer = useRef<any>(null);
  function sendTyping() {
    try {
      supabase.auth.getSession().then(async (s: any) => {
        const token = s?.data?.session?.access_token;
        if (!token) return;
        await fetch(`${API_URL}/api/support/tickets/${ticketId}/typing`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: '{}' });
      }).catch(() => {});
    } catch (e) {
      // ignore
    }
  }

  async function sendMessage() {
    if (!text.trim()) return;
    const bodyText = text;
    // optimistic UI with client_id for reconciliation
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
    const clientId = tempId;
    const tempMsg = { id: tempId, client_id: clientId, ticket_id: ticketId, sender_id: currentUserId || 'me', message: bodyText, created_at: new Date().toISOString(), pending: true };
    setMessages((s) => [...s, tempMsg]);
    setText('');
    try {
      const sess = await supabase.auth.getSession();
      const token = sess?.data?.session?.access_token;
      const resp = await fetch(`${API_URL}/api/support/tickets/${ticketId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : '' },
        body: JSON.stringify({ message: bodyText, client_id: clientId }),
      });
      if (!resp.ok) {
        const b = await resp.json().catch(() => ({}));
        throw new Error(b?.error || 'Failed to send');
      }
      const body = await resp.json().catch(() => ({}));
      // if server echoed the created message with id, reconcile will happen via realtime subscription
      toast.push({ type: 'success', message: 'Message sent' });
    } catch (e) {
      debugWarn('sendMessage error', e);
      // mark last temp message as failed
      setMessages((prev) => {
        const copy = [...prev];
        const idx = copy.findIndex((m) => m.id === tempId || m.client_id === tempId);
        if (idx !== -1) copy[idx] = { ...copy[idx], pending: false, failed: true };
        return copy;
      });
      toast.push({ type: 'error', message: 'Failed to send message' });
    }
  }

  // retry a failed message: remove old failed item and send a new optimistic message
  async function retryMessage(failedMsg: any) {
    try {
      // remove the failed marker
      setMessages((prev) => prev.filter((m) => m.id !== failedMsg.id));
      // send again as new optimistic message
      const newText = failedMsg.message;
      setText('');
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
      const clientId = tempId;
      const tempMsg = { id: tempId, client_id: clientId, ticket_id: ticketId, sender_id: currentUserId || 'me', message: newText, created_at: new Date().toISOString(), pending: true };
      setMessages((s) => [...s, tempMsg]);
      const sess = await supabase.auth.getSession();
      const token = sess?.data?.session?.access_token;
      const resp = await fetch(`${API_URL}/api/support/tickets/${ticketId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : '' },
        body: JSON.stringify({ message: newText, client_id: clientId }),
      });
      if (!resp.ok) {
        throw new Error('retry failed');
      }
    } catch (e) {
      toast.push({ type: 'error', message: 'Retry failed' });
    }
  }

  function handleTyping(textVal: string) {
    setText(textVal);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    sendTyping();
    typingTimer.current = setTimeout(() => {
      // typing timeout
    }, 3000);
  }

  const otherTyping = Object.keys(typingUsers).filter((u) => u !== currentUserId);
  const supportActive = (() => {
    // support considered active if last activity from others within 5 minutes
    if (!lastActivityRef.current) return false;
    return Date.now() - lastActivityRef.current < 1000 * 60 * 5;
  })();

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
            <Text style={styles.backButtonText}>←</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{title || 'Support Chat'}</Text>
          <View style={{ width: 36 }} />
        </View>
        <FlatList
          data={messages}
          keyExtractor={(i) => i.id}
          onEndReached={() => loadMessages(messages.length / 50)}
          onEndReachedThreshold={0.5}
          renderItem={({ item }) => (
            <View style={[styles.bubble, item.sender_id && item.sender_id !== currentUserId ? styles.adminBubble : styles.userBubble]}>
              <Text style={styles.msgText}>{item.message}</Text>
              <Text style={styles.msgTime}>{new Date(item.created_at).toLocaleString()}</Text>
              {item.pending && <Text style={{ fontSize: 11, color: '#888' }}>Sending…</Text>}
              {item.failed && (
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
                  <Text style={{ fontSize: 11, color: '#e44', marginRight: 8 }}>Failed</Text>
                  <TouchableOpacity onPress={() => retryMessage(item)}>
                    <Text style={{ color: COLORS.primary, fontWeight: '600' }}>Retry</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
        />

        <View style={{ paddingHorizontal: SPACING.sm, paddingBottom: 6 }}>
          {otherTyping.length > 0 && <Text style={{ color: COLORS.muted }}>{otherTyping.length > 1 ? 'Multiple people are typing…' : 'Support is typing…'}</Text>}
          {!otherTyping.length && supportActive && <Text style={{ color: COLORS.muted }}>Support active</Text>}
        </View>

        <View style={styles.inputRow}>
          <TextInput value={text} onChangeText={handleTyping} placeholder="Type a message..." style={styles.input} multiline />
          <TouchableOpacity style={styles.sendBtn} onPress={sendMessage}>
            <Text style={{ color: '#fff' }}>Send</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.surface, padding: SPACING.sm },
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
    ...HEADER_TITLE_TEXT,
    color: COLORS.primary,
  },
  bubble: { padding: SPACING.sm, borderRadius: BORDER_RADIUS.md, marginVertical: SPACING.xs, maxWidth: '85%' },
  userBubble: { backgroundColor: '#E5E7EB', alignSelf: 'flex-start' },
  adminBubble: { backgroundColor: '#2563EB', alignSelf: 'flex-end' },
  msgText: { color: '#111' },
  msgTime: { fontSize: 10, color: '#666', marginTop: 6 },
  inputRow: { flexDirection: 'row', alignItems: 'center', padding: SPACING.sm, borderTopWidth: 1, borderTopColor: '#eee' },
  input: { flex: 1, minHeight: 40, maxHeight: 120, padding: SPACING.sm, backgroundColor: '#fff', borderRadius: BORDER_RADIUS.md, marginRight: SPACING.sm },
  sendBtn: { backgroundColor: COLORS.primary, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderRadius: BORDER_RADIUS.md },
});
