import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  Image,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  SafeAreaView,
  TextInput,
  Modal,
  Platform,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp, useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { API_URL } from '../lib/api';
import { getBestAuthTokenFromSupabase } from '../lib/appSession';
import { useToast } from '../components/Toast';
import { RootStackParamList, User } from '../lib/types';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES, HEADER_TITLE_TEXT } from '../lib/theme';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Inbox'>;
  route: RouteProp<RootStackParamList, 'Inbox'>;
};

export default function InboxScreen({ navigation, route }: Props) {
  const { user } = route.params;
  const [conversations, setConversations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [newChatVisible, setNewChatVisible] = useState(false);
  const [searchPiId, setSearchPiId] = useState('');
  const [starting, setStarting] = useState(false);
  const toast = useToast();

  // Reload conversations whenever screen comes into focus
  useFocusEffect(
    useCallback(() => {
      loadConversations();
    }, [user.id])
  );

  async function getToken(): Promise<string> {
    const token = await getBestAuthTokenFromSupabase(supabase);
    return token || '';
  }

  async function loadConversations(refresh = false) {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    try {
      const token = await getToken();
      const resp = await fetch(`${API_URL}/api/messages/conversations`, {
        headers: { Authorization: token ? `Bearer ${token}` : '' },
      });
      const json = await resp.json();
      if (json.success) setConversations(json.conversations || []);
    } catch {
      toast.push({ type: 'error', message: 'Failed to load messages' });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function startChat() {
    const piId = searchPiId.trim();
    if (!piId) return;
    setStarting(true);
    try {
      const token = await getToken();
      const resp = await fetch(`${API_URL}/api/messages/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : '' },
        body: JSON.stringify({ piId }),
      });
      const json = await resp.json();
      if (!json.success) throw new Error(json.error || 'User not found');
      setNewChatVisible(false);
      setSearchPiId('');
      navigation.navigate('Chat', {
        conversationId: json.conversation.id,
        otherUser: json.otherUser,
        currentUser: user,
      });
    } catch (e: any) {
      toast.push({ type: 'error', message: e.message || 'Failed to start chat' });
    } finally {
      setStarting(false);
    }
  }

  function openConversation(conv: any) {
    const otherUser = conv.user_a_id === user.id ? conv.user_b : conv.user_a;
    navigation.navigate('Chat', {
      conversationId: conv.id,
      otherUser,
      currentUser: user,
    });
  }

  function getUnread(conv: any): number {
    return conv.user_a_id === user.id ? (conv.unread_a || 0) : (conv.unread_b || 0);
  }

  function getOtherUser(conv: any) {
    return conv.user_a_id === user.id ? conv.user_b : conv.user_a;
  }

  function formatTime(t: string): string {
    if (!t) return '';
    const d = new Date(t);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    // Within the last week — show day name
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
    if (diffDays < 7) {
      return d.toLocaleDateString([], { weekday: 'short' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  const renderItem = ({ item }: { item: any }) => {
    const other = getOtherUser(item);
    const unread = getUnread(item);
    const name = other?.username || other?.pi_id || 'Unknown';
    const initials = name[0].toUpperCase();
    const isUnread = unread > 0;

    return (
      <TouchableOpacity
        style={styles.row}
        onPress={() => openConversation(item)}
        activeOpacity={0.7}
      >
        {/* Avatar */}
        {other?.avatar_url ? (
          <Image source={{ uri: other.avatar_url }} style={[styles.avatar, isUnread && styles.avatarUnread]} />
        ) : (
          <View style={[styles.avatar, isUnread && styles.avatarUnread]}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
        )}

        {/* Content */}
        <View style={{ flex: 1 }}>
          <View style={styles.rowTop}>
            <Text style={[styles.name, isUnread && styles.nameBold]} numberOfLines={1}>
              {name}
            </Text>
            <Text style={[styles.time, isUnread && styles.timeUnread]}>
              {formatTime(item.last_message_at)}
            </Text>
          </View>
          <View style={styles.rowBot}>
            <Text
              style={[styles.preview, isUnread && styles.previewBold]}
              numberOfLines={1}
            >
              {item.last_message || 'Tap to start chatting'}
            </Text>
            {isUnread ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unread > 99 ? '99+' : unread}</Text>
              </View>
            ) : null}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          accessibilityLabel="Go back"
        >
          <Text style={styles.backBtnText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Messages</Text>
        <TouchableOpacity
          style={styles.newBtn}
          onPress={() => setNewChatVisible(true)}
          accessibilityLabel="Start new chat"
        >
          <Text style={{ color: '#fff', fontSize: 20, fontWeight: '700' }}>✏</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator color={COLORS.primary} size="large" />
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(i) => i.id}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => loadConversations(true)}
              tintColor={COLORS.primary}
            />
          }
          ItemSeparatorComponent={() => <View style={styles.divider} />}
          ListEmptyComponent={() => (
            <View style={styles.empty}>
              <Text style={styles.emptyEmoji}>💬</Text>
              <Text style={styles.emptyTitle}>No conversations yet</Text>
              <Text style={styles.emptySub}>
                Tap ✏ to message someone and negotiate before creating an escrow.
              </Text>
            </View>
          )}
        />
      )}

      {/* New Chat Modal — enter Pi ID or username */}
      <Modal
        visible={newChatVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setNewChatVisible(false)}
      >
        <TouchableOpacity
          style={styles.overlay}
          activeOpacity={1}
          onPress={() => setNewChatVisible(false)}
        >
          <TouchableOpacity
            style={styles.modalBox}
            activeOpacity={1}
            onPress={() => {}}
          >
            <Text style={styles.modalTitle}>New Chat</Text>
            <Text style={styles.modalSub}>Enter the Pi ID or @username of the person you want to chat with:</Text>
            <TextInput
              value={searchPiId}
              onChangeText={setSearchPiId}
              placeholder="e.g. pi_user123 or @alice"
              style={styles.modalInput}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="send"
              onSubmitEditing={startChat}
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: '#eee', flex: 1 }]}
                onPress={() => { setNewChatVisible(false); setSearchPiId(''); }}
              >
                <Text style={{ color: '#444', fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: COLORS.primary, flex: 1, opacity: (!searchPiId.trim() || starting) ? 0.6 : 1 }]}
                onPress={startChat}
                disabled={starting || !searchPiId.trim()}
              >
                {starting
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={{ color: '#fff', fontWeight: '700' }}>Start Chat</Text>
                }
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
    backgroundColor: '#fff',
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  backBtnText: {
    color: COLORS.primary,
    fontSize: 22,
    fontWeight: '700',
  },
  headerTitle: {
    ...HEADER_TITLE_TEXT,
    color: COLORS.primary,
  },
  newBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#fff',
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  avatarUnread: {
    backgroundColor: '#128C7E',
  },
  avatarText: {
    color: '#fff',
    fontSize: 21,
    fontWeight: '700',
  },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 3,
  },
  rowBot: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  name: {
    fontSize: 16,
    color: '#111',
    flex: 1,
    marginRight: 8,
  },
  nameBold: {
    fontWeight: '700',
  },
  time: {
    fontSize: 12,
    color: '#aaa',
  },
  timeUnread: {
    color: '#128C7E',
    fontWeight: '600',
  },
  preview: {
    fontSize: 14,
    color: '#888',
    flex: 1,
    marginRight: 8,
  },
  previewBold: {
    color: '#333',
    fontWeight: '500',
  },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#128C7E',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 5,
  },
  badgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  divider: {
    height: 1,
    backgroundColor: '#F5F5F5',
    marginLeft: 82,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 80,
    paddingHorizontal: 40,
  },
  emptyEmoji: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
    marginBottom: 8,
  },
  emptySub: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
    lineHeight: 20,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  modalBox: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 36 : 24,
  },
  modalTitle: {
    fontSize: 19,
    fontWeight: '700',
    color: COLORS.primary,
    marginBottom: 6,
  },
  modalSub: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
    lineHeight: 20,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
    fontSize: 15,
    marginBottom: 18,
    backgroundColor: '#FAFAFA',
  },
  modalBtn: {
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: 'center',
  },
});
