import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  Image,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  ActivityIndicator,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { API_URL } from '../lib/api';
import { getBestAuthTokenFromSupabase } from '../lib/appSession';
import { useToast } from '../components/Toast';
import { RootStackParamList, STATUS_COLORS } from '../lib/types';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES, HEADER_TITLE_TEXT } from '../lib/theme';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Chat'>;
  route: RouteProp<RootStackParamList, 'Chat'>;
};

type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  escrow_id?: string | null;
  escrow?: {
    id: string;
    status?: string;
    amount?: number;
    reference_id?: string;
  } | null;
  type?: 'user' | 'system';
  status?: 'sent' | 'delivered' | 'read';
  content: string;
  is_read: boolean;
  delivered_at?: string | null;
  read_at?: string | null;
  created_at: string;
  pending?: boolean;
  failed?: boolean;
};

export default function ChatScreen({ navigation, route }: Props) {
  const { conversationId, otherUser, currentUser } = route.params;
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const channelRef = useRef<any>(null);
  const flatRef = useRef<FlatList>(null);
  const toast = useToast();

  const otherName = otherUser?.username || otherUser?.pi_id || 'Chat';
  const otherInitial = otherName[0].toUpperCase();

  useEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerStyle: { backgroundColor: COLORS.primary },
      headerTintColor: '#fff',
      headerTitle: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {otherUser?.avatar_url ? (
            <Image source={{ uri: otherUser.avatar_url }} style={headerStyles.avatar} />
          ) : (
            <View style={headerStyles.avatar}>
              <Text style={headerStyles.avatarText}>{otherInitial}</Text>
            </View>
          )}
          <View>
            <Text style={headerStyles.name}>{otherName}</Text>
            <Text style={headerStyles.sub}>PMARTS User</Text>
          </View>
        </View>
      ),
      headerRight: () => (
        <TouchableOpacity
          onPress={() => navigation.navigate('Deposit', {
            user: currentUser,
            conversationId,
            prefillRecipientId: otherUser?.username || otherUser?.pi_id || '',
          })}
          style={headerStyles.escrowBtn}
        >
          <Text style={headerStyles.escrowBtnText}>+ Escrow</Text>
        </TouchableOpacity>
      ),
    });

    loadMessages();
    subscribe();
    markRead();

    return () => unsubscribe();
  }, [conversationId]);

  async function getToken(): Promise<string> {
    const token = await getBestAuthTokenFromSupabase(supabase);
    return token || '';
  }

  async function loadMessages() {
    setLoading(true);
    try {
      const token = await getToken();
      const resp = await fetch(
        `${API_URL}/api/messages/conversations/${conversationId}/messages`,
        { headers: { Authorization: token ? `Bearer ${token}` : '' } }
      );
      const json = await resp.json();
      if (json.success) {
        setMessages(json.messages || []);
        setTimeout(() => flatRef.current?.scrollToEnd({ animated: false }), 100);
      }
    } catch {
      toast.push({ type: 'error', message: 'Failed to load messages' });
    } finally {
      setLoading(false);
    }
  }

  function subscribe() {
    try {
      const ch = supabase.channel(`conv-${conversationId}`);
      ch.on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload: any) => {
          const rec: Message = payload.record || payload.new;
          setMessages((prev) => {
            // Replace optimistic message if it matches (same sender + content)
            const tempIdx = prev.findIndex(
              (m) =>
                typeof m.id === 'string' &&
                m.id.startsWith('temp-') &&
                m.content === rec.content &&
                m.sender_id === rec.sender_id
            );
            if (tempIdx !== -1) {
              const copy = [...prev];
              copy[tempIdx] = rec;
              return copy;
            }
            return [...prev, rec];
          });
          setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 80);
          markRead();
        }
      );
      ch.subscribe();
      channelRef.current = ch;
    } catch {
      // ignore subscribe errors
    }
  }

  function unsubscribe() {
    try {
      const ch = channelRef.current;
      if (ch?.unsubscribe) ch.unsubscribe();
      else if (supabase?.removeChannel && ch) supabase.removeChannel(ch);
    } catch {
      // ignore
    }
  }

  async function markRead() {
    try {
      const token = await getToken();
      await fetch(`${API_URL}/api/messages/conversations/${conversationId}/read`, {
        method: 'POST',
        headers: { Authorization: token ? `Bearer ${token}` : '' },
      });
    } catch {
      // best-effort
    }
  }

  async function openEscrowFromMessage(escrowId: string) {
    try {
      const token = await getToken();
      const resp = await fetch(`${API_URL}/api/escrow/v2/${encodeURIComponent(escrowId)}`, {
        headers: { Authorization: token ? `Bearer ${token}` : '' },
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data?.escrow) {
        throw new Error(data?.error || 'Failed to load escrow details');
      }
      navigation.navigate('EscrowDetail', { escrow: data.escrow, user: currentUser });
    } catch (e: any) {
      toast.push({ type: 'error', message: e?.message || 'Unable to open escrow details' });
    }
  }

  async function copyValue(value: string, label: string) {
    try {
      await Clipboard.setStringAsync(value);
      toast.push({ type: 'success', message: `${label} copied` });
    } catch {
      toast.push({ type: 'error', message: `Failed to copy ${label.toLowerCase()}` });
    }
  }

  async function sendMessage() {
    const bodyText = text.trim();
    if (!bodyText) return;

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimistic: Message = {
      id: tempId,
      conversation_id: conversationId,
      sender_id: currentUser.id,
      content: bodyText,
      is_read: false,
      created_at: new Date().toISOString(),
      pending: true,
    };

    setMessages((prev) => [...prev, optimistic]);
    setText('');
    setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 50);

    try {
      const token = await getToken();
      const resp = await fetch(
        `${API_URL}/api/messages/conversations/${conversationId}/send`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: token ? `Bearer ${token}` : '',
          },
          body: JSON.stringify({ content: bodyText }),
        }
      );
      if (!resp.ok) throw new Error('Failed to send');
    } catch {
      setMessages((prev) => {
        const copy = [...prev];
        const idx = copy.findIndex((m) => m.id === tempId);
        if (idx !== -1) copy[idx] = { ...copy[idx], pending: false, failed: true };
        return copy;
      });
      toast.push({ type: 'error', message: 'Message failed to send' });
    }
  }

  function formatMsgTime(t: string): string {
    return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function resolveEscrowStatus(message: Message): string | null {
    if (message.escrow?.status) return String(message.escrow.status).toLowerCase();
    const match = String(message.content || '').match(/status\s+([a-z_]+)/i);
    return match?.[1]?.toLowerCase() || null;
  }

  function getStatusColor(status: string | null): string {
    if (!status) return '#6B7280';
    const key = status as keyof typeof STATUS_COLORS;
    return STATUS_COLORS[key] || '#6B7280';
  }

  // Group messages by date so we can show date separators
  function buildRows(msgs: Message[]) {
    const rows: Array<Message | { type: 'date'; label: string; id: string }> = [];
    let lastDate = '';
    for (const msg of msgs) {
      const d = new Date(msg.created_at).toDateString();
      if (d !== lastDate) {
        lastDate = d;
        const now = new Date();
        const isToday = d === now.toDateString();
        const label = isToday
          ? 'Today'
          : new Date(msg.created_at).toLocaleDateString([], {
              weekday: 'long', month: 'long', day: 'numeric',
            });
        rows.push({ type: 'date', label, id: `date-${d}` });
      }
      rows.push(msg);
    }
    return rows;
  }

  const renderRow = ({ item }: { item: any }) => {
    // Date separator
    if (item.type === 'date') {
      return (
        <View style={styles.dateSep}>
          <Text style={styles.dateSepText}>{item.label}</Text>
        </View>
      );
    }

    const isSystem = item.type === 'system';
    const isMe = item.sender_id === currentUser.id;

    if (isSystem) {
      const hasEscrow = !!item.escrow_id;
      const escrowStatus = resolveEscrowStatus(item as Message);
      const statusColor = getStatusColor(escrowStatus);
      const escrowAmount = typeof item.escrow?.amount === 'number' ? `${item.escrow.amount.toFixed(2)} π` : null;
      const escrowReference = item.escrow?.reference_id ? String(item.escrow.reference_id) : null;
      return (
        <View style={styles.systemWrap}>
          <Text style={styles.systemText}>{item.content}</Text>
          {hasEscrow && (
            <View style={styles.systemCard}>
              <Text style={styles.systemCardTitle}>Escrow Linked</Text>
              <Text style={styles.systemCardMeta}>ID: {String(item.escrow_id).slice(0, 8).toUpperCase()}</Text>
              {escrowAmount && (
                <TouchableOpacity onPress={() => copyValue(escrowAmount, 'Amount')}>
                  <Text style={[styles.systemCardMeta, styles.copyableMeta]}>Amount: {escrowAmount}</Text>
                </TouchableOpacity>
              )}
              {escrowReference && (
                <TouchableOpacity onPress={() => copyValue(escrowReference, 'Reference')}>
                  <Text style={[styles.systemCardMeta, styles.copyableMeta]}>Ref: {escrowReference}</Text>
                </TouchableOpacity>
              )}
              {escrowStatus && (
                <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
                  <Text style={styles.statusBadgeText}>{escrowStatus.replace(/_/g, ' ').toUpperCase()}</Text>
                </View>
              )}
              <TouchableOpacity
                style={styles.systemCardBtn}
                onPress={() => openEscrowFromMessage(item.escrow_id as string)}
              >
                <Text style={styles.systemCardBtnText}>View Escrow</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      );
    }

    return (
      <View style={[styles.msgRow, isMe ? styles.msgRowMe : styles.msgRowOther]}>
        {/* Other person avatar (only for received messages) */}
        {!isMe && (
          <View style={styles.msgAvatar}>
            <Text style={styles.msgAvatarText}>{otherInitial}</Text>
          </View>
        )}

        <View
          style={[
            styles.bubble,
            isMe ? styles.bubbleMe : styles.bubbleOther,
            item.failed && styles.bubbleFailed,
          ]}
        >
          <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>
            {item.content}
          </Text>

          {/* Timestamp + delivery tick */}
          <View style={styles.bubbleMeta}>
            <Text style={[styles.metaTime, isMe && styles.metaTimeMe]}>
              {formatMsgTime(item.created_at)}
            </Text>
            {isMe && (
              <Text style={[styles.tick, item.failed && styles.tickFailed]}>
                {item.pending
                  ? ' ⏳'
                  : item.failed
                    ? ' ✗'
                    : item.status === 'read'
                      ? ' ✓✓'
                      : item.status === 'delivered'
                        ? ' ✓✓'
                        : ' ✓'}
              </Text>
            )}
          </View>
        </View>
      </View>
    );
  };

  const rows = buildRows(messages);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#ECE5DD' }}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.primary} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        {loading ? (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <ActivityIndicator color={COLORS.primary} size="large" />
          </View>
        ) : (
          <FlatList
            ref={flatRef}
            data={rows}
            keyExtractor={(i) => i.id}
            renderItem={renderRow}
            contentContainerStyle={{ padding: SPACING.sm, paddingBottom: 12 }}
            onContentSizeChange={() =>
              flatRef.current?.scrollToEnd({ animated: false })
            }
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyText}>
                  No messages yet.{'\n'}Say hi and start negotiating! 👋
                </Text>
              </View>
            }
          />
        )}

        {/* Input bar */}
        <View style={styles.inputBar}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Message…"
            placeholderTextColor="#aaa"
            style={styles.input}
            multiline
            maxLength={2000}
          />
          <TouchableOpacity
            style={[styles.sendBtn, !text.trim() && { opacity: 0.45 }]}
            onPress={sendMessage}
            disabled={!text.trim()}
          >
            <Text style={{ color: '#fff', fontSize: 20 }}>➤</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const headerStyles = StyleSheet.create({
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.25)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  name: { color: '#fff', ...HEADER_TITLE_TEXT },
  sub: { color: 'rgba(255,255,255,0.75)', fontSize: 12 },
  escrowBtn: {
    backgroundColor: '#F4C542',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginRight: 4,
  },
  escrowBtnText: { color: COLORS.primary, fontWeight: '700', fontSize: 12 },
});

const styles = StyleSheet.create({
  dateSep: {
    alignItems: 'center',
    marginVertical: 10,
  },
  systemWrap: {
    alignItems: 'center',
    marginVertical: 8,
  },
  systemText: {
    fontSize: 12,
    color: '#4B5563',
    backgroundColor: '#E5E7EB',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    textAlign: 'center',
    maxWidth: '92%',
  },
  systemCard: {
    marginTop: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    width: '92%',
    alignItems: 'center',
  },
  systemCardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 4,
  },
  systemCardMeta: {
    fontSize: 11,
    color: '#6B7280',
    marginBottom: 8,
  },
  copyableMeta: {
    textDecorationLine: 'underline',
    color: COLORS.primary,
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 8,
  },
  statusBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  systemCardBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  systemCardBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  dateSepText: {
    backgroundColor: 'rgba(0,0,0,0.12)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    fontSize: 12,
    color: '#555',
  },
  msgRow: {
    flexDirection: 'row',
    marginVertical: 2,
    alignItems: 'flex-end',
    paddingHorizontal: 4,
  },
  msgRowMe: { justifyContent: 'flex-end' },
  msgRowOther: { justifyContent: 'flex-start' },
  msgAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 6,
    marginBottom: 2,
  },
  msgAvatarText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  bubble: {
    maxWidth: '78%',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.07,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  bubbleMe: {
    backgroundColor: '#128C7E',
    borderBottomRightRadius: 4,
  },
  bubbleOther: {
    backgroundColor: '#ffffff',
    borderBottomLeftRadius: 4,
  },
  bubbleFailed: {
    backgroundColor: '#fee2e2',
  },
  bubbleText: {
    fontSize: 15,
    lineHeight: 21,
    color: '#111',
  },
  bubbleTextMe: {
    color: '#fff',
  },
  bubbleMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 4,
  },
  metaTime: {
    fontSize: 10,
    color: 'rgba(0,0,0,0.35)',
  },
  metaTimeMe: {
    color: 'rgba(255,255,255,0.65)',
  },
  tick: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.65)',
  },
  tickFailed: {
    color: '#ef4444',
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 80,
    paddingHorizontal: 40,
  },
  emptyText: {
    fontSize: 15,
    color: '#777',
    textAlign: 'center',
    lineHeight: 22,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 8,
    paddingVertical: 8,
    backgroundColor: '#F0F0F0',
    borderTopWidth: 1,
    borderTopColor: '#ddd',
  },
  input: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'ios' ? 11 : 8,
    fontSize: 15,
    maxHeight: 130,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#E8E8E8',
    color: '#111',
  },
  sendBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#128C7E',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
