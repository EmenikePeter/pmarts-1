import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { NotificationCard } from '../components';
import { supabase } from '../lib/supabase';
import { useNotificationRealtime } from '../lib/realtime';
import { API_URL } from '../lib/api';
import { getBestAuthTokenFromSupabase } from '../lib/appSession';
import { RootStackParamList, Notification, Escrow } from '../lib/types';
import { COLORS, SPACING, FONT_SIZES, HEADER_TITLE_TEXT } from '../lib/theme';

type NotificationsScreenProps = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Notifications'>;
  route: RouteProp<RootStackParamList, 'Notifications'>;
};

export default function NotificationsScreen({ navigation, route }: NotificationsScreenProps) {
  const { user } = route.params;
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      const mapped = ((data || []) as any[]).map((n) => ({
        ...n,
        title: n?.title || n?.type || 'Notification',
      }));
      setNotifications(mapped as Notification[]);
    } catch (err) {
      setNotifications([]);
    } finally {
      setLoading(false);
    }
  }, [user.id]);

  // Fetch on mount
  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Realtime subscription for instant updates
  useNotificationRealtime(user.id, (notification: Notification) => {
    setNotifications((prev) => [notification, ...prev]);
  });

  const handleNotificationPress = async (notification: Notification) => {
    // Mark as read
    if (!notification.is_read) {
      try {
        await supabase
          .from('notifications')
          .update({ is_read: true })
          .eq('id', notification.id);
      } catch (err) {}

      setNotifications((prev) =>
        prev.map((n) => (n.id === notification.id ? { ...n, is_read: true } : n))
      );
    }

    if (notification.type === 'new_message') {
      if (notification.escrow_id) {
        try {
          const { data: escrow, error } = await supabase
            .from('escrows')
            .select('id,sender_id,recipient_id')
            .eq('id', notification.escrow_id)
            .maybeSingle();

          if (!error && escrow) {
            const otherUserId = escrow.sender_id === user.id ? escrow.recipient_id : escrow.sender_id;
            const token = await getBestAuthTokenFromSupabase(supabase);

            if (token && otherUserId) {
              const startResp = await fetch(`${API_URL}/api/messages/start`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ userId: otherUserId }),
              });

              const startJson = await startResp.json().catch(() => ({}));
              if (startResp.ok && startJson?.success && startJson?.conversation?.id) {
                navigation.navigate('Chat', {
                  conversationId: startJson.conversation.id,
                  otherUser: startJson.otherUser || { id: otherUserId },
                  currentUser: user,
                });
                return;
              }
            }
          }
        } catch (err) {}
      }

      navigation.navigate('Inbox', { user });
      return;
    }

    // Navigate to escrow if applicable
    if (notification.escrow_id) {
      try {
        const { data, error } = await supabase
          .from('escrows')
          .select('*')
          .eq('id', notification.escrow_id)
          .maybeSingle();

        if (!error && data) {
          navigation.navigate('EscrowDetail', { escrow: data as Escrow, user });
          return;
        }
      } catch (err) {}
    }

    navigation.navigate('Home', { user });
  };

  const markAllAsRead = async () => {
    try {
      await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('user_id', user.id);
    } catch (err) {}

    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Notifications</Text>
          {unreadCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{unreadCount}</Text>
            </View>
          )}
        </View>
        {unreadCount > 0 ? (
          <TouchableOpacity onPress={markAllAsRead} style={styles.markReadButton}>
            <Text style={styles.markReadText}>Read All</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 60 }} />
        )}
      </View>

      {/* Notifications List */}
      <FlatList
        data={notifications}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <NotificationCard
            notification={item}
            onPress={() => handleNotificationPress(item)}
          />
        )}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={fetchNotifications} />
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🔔</Text>
            <Text style={styles.emptyTitle}>No Notifications</Text>
            <Text style={styles.emptyText}>
              You'll see updates about your escrow transactions here
            </Text>
          </View>
        }
      />
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
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    ...HEADER_TITLE_TEXT,
    color: '#FFFFFF',
  },
  badge: {
    backgroundColor: COLORS.error,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: SPACING.sm,
    paddingHorizontal: SPACING.xs,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: FONT_SIZES.xs,
    fontWeight: '700',
  },
  markReadButton: {
    paddingHorizontal: SPACING.sm,
  },
  markReadText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: FONT_SIZES.sm,
  },
  listContent: {
    padding: SPACING.md,
    paddingBottom: SPACING.xxl,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: SPACING.xxl,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: SPACING.md,
  },
  emptyTitle: {
    fontSize: FONT_SIZES.xl,
    fontWeight: '600',
    color: COLORS.text,
  },
  emptyText: {
    fontSize: FONT_SIZES.md,
    color: COLORS.textSecondary,
    marginTop: SPACING.xs,
    textAlign: 'center',
    paddingHorizontal: SPACING.xl,
  },
});

