import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  StatusBar,
  Alert,
  Linking,
  Image,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { EscrowCard, Button } from '../components';
import { useRealtimeEscrows, useRealtimeNotifications } from '../lib/useRealtimeEscrows';
import { useEscrowRealtime, useNotificationRealtime } from '../lib/realtime';
import { useToast } from '../components/Toast';
import { RootStackParamList, Escrow, Notification, formatPi, getTrustBadge } from '../lib/types';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../lib/theme';
import { supabase } from '../lib/supabase';
import { getApiEndpoint } from '../lib/api';
import { getBestAuthTokenFromSupabase } from '../lib/appSession';

type HomeScreenProps = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Home'>;
  route: RouteProp<RootStackParamList, 'Home'>;
};

export default function HomeScreen({ navigation, route }: HomeScreenProps) {
  const { user } = route.params;

  const activeFundsStatuses = new Set([
    'funds_held',
    'delivery_in_progress',
    'release_requested',
    'release_pending',
    'held',
  ]);
  const terminalStatuses = new Set(['completed', 'refunded', 'cancelled', 'expired', 'released']);
  
  // Use realtime hooks for live updates
  const { escrows, loading, refetch } = useRealtimeEscrows(user.id);
  const { unreadCount } = useRealtimeNotifications(user.id);
  const [balance, setBalance] = useState(0);
  const [avatarUrl, setAvatarUrl] = useState<string | null>((user as any)?.avatar_url || null);
  const toast = useToast();

  const trustBadge = getTrustBadge(user.trust_score);

  // Realtime alerts for escrow updates
  useEscrowRealtime(user.id, (escrow: Escrow) => {
    // Show concise toast and navigate to receipt/detail where appropriate
    try {
      if (escrow.status === 'funds_held') {
        toast.push({ type: 'success', message: `Deposit received: ${formatPi(escrow.amount)}` });
        navigation.navigate('TransactionReceipt', { escrowId: escrow.id });
      } else if (escrow.status === 'deposit_failed' || escrow.status === 'cancelled' || escrow.status === 'expired') {
        toast.push({ type: 'error', message: `Deposit failed for ${escrow.reference_id}` });
        navigation.navigate('EscrowDetail', { escrow, user });
      }
    } catch (e) {
      // If toast fails, fallback to navigation + console warning (avoid blocking alert dialogs)
      try { console.warn('[HomeScreen] toast failed', e); } catch(_) {}
      navigation.navigate('EscrowDetail', { escrow, user });
    }
    refetch();
  });

  // Realtime alerts for new notifications
  useNotificationRealtime(user.id, (notification: Notification) => {
    try {
      toast.push({ type: 'info', message: notification.message });
    } catch (e) {
      // Avoid blocking alert; just log and navigate to notifications screen
      try { console.warn('[HomeScreen] toast failed for notification', e); } catch(_) {}
      navigation.navigate('Notifications', { user });
    }
  });

  // Calculate sender's currently locked funds
  useEffect(() => {
    const heldBalance = escrows
      .filter(e => e.sender_id === user.id)
      .filter(e => activeFundsStatuses.has((e.status || '').toLowerCase()) && !terminalStatuses.has((e.status || '').toLowerCase()))
      .reduce((sum, e) => sum + e.amount, 0);
    setBalance(heldBalance);
  }, [escrows, user.id]);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const token = await getBestAuthTokenFromSupabase(supabase);
        if (!token) return;

        const resp = await fetch(getApiEndpoint('/api/user/profile/avatar-url'), {
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => null);

        if (!resp?.ok) return;
        const body = await resp.json().catch(() => null);
        if (mounted && body?.avatar_url) {
          setAvatarUrl(body.avatar_url);
        }
      } catch (e) {
        // Keep fallback avatar when fetch fails
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const renderHeader = () => (
    <View>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View>
            <Text style={styles.greeting}>Welcome back,</Text>
            <Text style={styles.username}>@{user.username || user.pi_id}</Text>
          </View>
          <TouchableOpacity
            style={styles.profileButton}
            onPress={() => navigation.navigate('Profile', { user })}
          >
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.profileAvatar} />
            ) : (
              <Text style={styles.profileIcon}>👤</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Balance Card */}
      <View style={styles.balanceCard}>
        <View style={styles.balanceRow}>
          <View>
            <Text style={styles.balanceLabel}>Balance in Escrow</Text>
            <Text style={styles.balanceValue}>{formatPi(balance)}</Text>
          </View>
          <View style={styles.trustContainer}>
            <Text style={styles.trustLabel}>Trust Score</Text>
            <View style={[styles.trustBadge, { backgroundColor: trustBadge.color }]}>
              <Text style={styles.trustBadgeText}>{trustBadge.label}</Text>
            </View>
          </View>
        </View>
      </View>

      {/* Quick Actions */}
      <View style={styles.actionsContainer}>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => navigation.navigate('Deposit', { user })}
        >
          <Text style={styles.actionIcon}>💰</Text>
          <Text style={styles.actionText}>Deposit</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionButton, styles.actionButtonAlt]}
          onPress={() => navigation.navigate('History', { user })}
        >
          <Text style={styles.actionIcon}>📜</Text>
          <Text style={styles.actionText}>History</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => navigation.navigate('Notifications', { user })}
        >
          <View>
            <Text style={styles.actionIcon}>🔔</Text>
            {unreadCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
              </View>
            )}
          </View>
          <Text style={styles.actionText}>Alerts</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: '#ef4444' }]}
          onPress={() => navigation.navigate('Dispute', { userId: user.id })}
        >
          <Text style={styles.actionIcon}>🚨</Text>
          <Text style={styles.actionText}>Dispute</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: '#128C7E' }]}
          onPress={() => navigation.navigate('Inbox', { user })}
        >
          <Text style={styles.actionIcon}>💬</Text>
          <Text style={styles.actionText}>Messages</Text>
        </TouchableOpacity>
      </View>

      {/* Section Title */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Recent Escrows</Text>
        <TouchableOpacity onPress={() => navigation.navigate('History', { user })}>
          <Text style={styles.seeAll}>See All</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderFooter = () => (
    <View style={styles.helpFooter}>
      <View style={styles.helpFooterHeader}>
        <Text style={styles.helpFooterTitle}>Help & Support</Text>
        <TouchableOpacity onPress={() => navigation.navigate('HelpSupport')}>
          <Text style={styles.helpFooterSeeAll}>See All</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={styles.helpContactRow}
        onPress={() => Linking.openURL('mailto:support@pmarts.org?subject=PMARTS Support Request')}
      >
        <Text style={styles.helpContactIcon}>📧</Text>
        <View style={styles.helpContactInfo}>
          <Text style={styles.helpContactLabel}>Email</Text>
          <Text style={styles.helpContactValue}>support@pmarts.org</Text>
        </View>
        <Text style={styles.helpContactArrow}>→</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.helpContactRow}
        onPress={() => Linking.openURL('https://t.me/pmarts_support')}
      >
        <Text style={styles.helpContactIcon}>💬</Text>
        <View style={styles.helpContactInfo}>
          <Text style={styles.helpContactLabel}>Telegram</Text>
          <Text style={styles.helpContactValue}>@pmarts_support</Text>
        </View>
        <Text style={styles.helpContactArrow}>→</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.helpContactRow}
        onPress={() => Linking.openURL('https://x.com/pmarts_support')}
      >
        <Text style={styles.helpContactIcon}>🐦</Text>
        <View style={styles.helpContactInfo}>
          <Text style={styles.helpContactLabel}>Twitter</Text>
          <Text style={styles.helpContactValue}>@pmarts_support</Text>
        </View>
        <Text style={styles.helpContactArrow}>→</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.helpContactRow, styles.helpContactRowLast]}
        onPress={() => Linking.openURL('mailto:info@pmarts.org?subject=PMARTS Inquiry')}
      >
        <Text style={styles.helpContactIcon}>✉️</Text>
        <View style={styles.helpContactInfo}>
          <Text style={styles.helpContactLabel}>General Inquiries</Text>
          <Text style={styles.helpContactValue}>info@pmarts.org</Text>
        </View>
        <Text style={styles.helpContactArrow}>→</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.helpAboutUsRow}
        onPress={() => navigation.navigate('AboutUs')}
      >
        <Text style={styles.helpContactIcon}>🏢</Text>
        <View style={styles.helpContactInfo}>
          <Text style={styles.helpAboutUsLabel}>About Us</Text>
          <Text style={styles.helpContactValue}>Learn more about PMARTS</Text>
        </View>
        <Text style={styles.helpContactArrow}>→</Text>
      </TouchableOpacity>
    </View>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <Text style={styles.emptyIcon}>📭</Text>
      <Button
        title="Create Deposit"
        onPress={() => navigation.navigate('Deposit', { user })}
        fullWidth={false}
        style={{ marginTop: SPACING.md }}
      />
    </View>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.primary} />
      <FlatList
        data={escrows.slice(0, 5)}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <EscrowCard
            escrow={item}
            currentUserId={user.id}
            onPress={() => navigation.navigate('EscrowDetail', { escrow: item, user })}
          />
        )}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={renderEmptyState}
        ListFooterComponent={renderFooter}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={refetch} />
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
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.xxl + 20,
    paddingBottom: SPACING.xxl + 40,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  greeting: {
    fontSize: FONT_SIZES.md,
    color: 'rgba(255,255,255,0.8)',
  },
  username: {
    fontSize: FONT_SIZES.xxl,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  profileButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileIcon: {
    fontSize: 24,
  },
  profileAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
  },
  balanceCard: {
    backgroundColor: COLORS.card,
    marginHorizontal: SPACING.lg,
    marginTop: -40,
    borderRadius: BORDER_RADIUS.xl,
    padding: SPACING.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 5,
    boxShadow: '0 4px 12px rgba(0,0,0,0.10)',
  },
  balanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  balanceLabel: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textSecondary,
  },
  balanceValue: {
    fontSize: 32,
    fontWeight: '700',
    color: COLORS.primary,
    marginTop: SPACING.xs,
  },
  trustContainer: {
    alignItems: 'flex-end',
  },
  trustLabel: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xs,
  },
  trustBadge: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: BORDER_RADIUS.full,
  },
  trustBadgeText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  actionsContainer: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.lg,
    marginTop: SPACING.lg,
    gap: SPACING.md,
  },
  actionButton: {
    flex: 1,
    backgroundColor: COLORS.primary,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    alignItems: 'center',
  },
  actionButtonAlt: {
    backgroundColor: COLORS.secondary,
  },
  actionIcon: {
    fontSize: 24,
    marginBottom: SPACING.xs,
  },
  actionText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    marginTop: SPACING.lg,
    marginBottom: SPACING.md,
  },
  sectionTitle: {
    fontSize: FONT_SIZES.xl,
    fontWeight: '700',
    color: COLORS.text,
  },
  seeAll: {
    fontSize: FONT_SIZES.md,
    color: COLORS.primary,
    fontWeight: '600',
  },
  listContent: {
    paddingHorizontal: SPACING.lg,
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
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -8,
    backgroundColor: COLORS.error,
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  helpFooter: {
    marginTop: SPACING.xl,
    marginBottom: SPACING.lg,
    backgroundColor: COLORS.card,
    borderRadius: BORDER_RADIUS.xl,
    padding: SPACING.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  helpFooterHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
    paddingBottom: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  helpFooterTitle: {
    fontSize: FONT_SIZES.md,
    fontWeight: '700',
    color: COLORS.text,
  },
  helpFooterSeeAll: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary,
    fontWeight: '600',
  },
  helpContactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  helpContactRowLast: {
    borderBottomWidth: 0,
  },
  helpContactIcon: {
    fontSize: 22,
    width: 36,
    textAlign: 'center',
    marginRight: SPACING.sm,
  },
  helpContactInfo: {
    flex: 1,
  },
  helpContactLabel: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 2,
  },
  helpContactValue: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.textSecondary,
  },
  helpContactArrow: {
    fontSize: FONT_SIZES.md,
    color: COLORS.primary,
    fontWeight: '600',
  },
  helpAboutUsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    marginTop: SPACING.xs,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    paddingHorizontal: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  helpAboutUsLabel: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '700',
    color: COLORS.primary,
    marginBottom: 2,
  },
});

