import React, { useState, useCallback } from 'react';
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
import { EscrowCard } from '../components';
import { supabase } from '../lib/supabase';
import { getApiEndpoint } from '../lib/api';
import { getBestAuthTokenFromSupabase } from '../lib/appSession';
import { RootStackParamList, Escrow, EscrowStatus } from '../lib/types';
import { derror } from '../lib/dlog';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES, HEADER_TITLE_TEXT } from '../lib/theme';

type HistoryScreenProps = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'History'>;
  route: RouteProp<RootStackParamList, 'History'>;
};

type FilterType = 'all' | 'sent' | 'received' | 'active' | 'completed' | 'disputed' | 'refunded' | 'cancelled' | 'deposit_failed';

export default function HistoryScreen({ navigation, route }: HistoryScreenProps) {
  const { user } = route.params;
  const [escrows, setEscrows] = useState<Escrow[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');

  const getAvailableFilters = (): { label: string; value: FilterType }[] => {
    return [
      { label: 'All', value: 'all' },
      { label: 'Sent', value: 'sent' },
      { label: 'Received', value: 'received' },
      { label: 'Active', value: 'active' },
      { label: 'Completed', value: 'completed' },
      { label: 'Disputed', value: 'disputed' },
      { label: 'Refunded', value: 'refunded' },
      { label: 'Cancelled', value: 'cancelled' },
    ];
  };

  const FILTERS = getAvailableFilters();

  const fetchEscrows = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getBestAuthTokenFromSupabase(supabase);
      if (!token) {
        setEscrows([]);
        return;
      }

      const resp = await fetch(getApiEndpoint(`/api/escrow/v2/user/${user.id}?limit=100`), {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const body = await resp.json().catch(() => null);
      if (!resp.ok || !body?.success) {
        throw new Error(body?.error || 'Failed to fetch escrows');
      }

      const userEscrows = (body?.escrows || []) as Escrow[];
      setEscrows(userEscrows);
    } catch (err) {
      derror('Failed to fetch escrows, showing empty list', err);
      setEscrows([]);
    } finally {
      setLoading(false);
    }
  }, [user.id]);

  // Fetch on mount and when user changes
  React.useEffect(() => {
    fetchEscrows();
  }, [fetchEscrows]);

  const filteredEscrows = escrows.filter((escrow) => {
    const status = (escrow.status || '').toLowerCase() as EscrowStatus;
    const activeStatuses = new Set(['created', 'deposit_pending', 'deposit_confirmed', 'funds_held', 'delivery_in_progress', 'release_requested', 'release_pending', 'held']);
    const isUserSender = escrow.sender_id === user.id;
    const isUserRecipient = escrow.recipient_id === user.id;

    switch (activeFilter) {
      case 'sent':
        // Sender: all escrows initiated by current user
        return isUserSender;
      case 'received':
        // Recipient: all escrows addressed to current user
        return isUserRecipient;
      case 'active':
        return activeStatuses.has(status);
      case 'completed':
        return status === 'completed';
      case 'disputed':
        return status === 'disputed';
      case 'refunded':
        return status === 'refunded';
      case 'cancelled':
      case 'deposit_failed':
        return status === activeFilter;
      default:
        return true;
    }
  });

  const renderFilter = ({ item }: { item: typeof FILTERS[0] }) => (
    <TouchableOpacity
      style={[
        styles.filterChip,
        activeFilter === item.value && styles.filterChipActive,
      ]}
      onPress={() => setActiveFilter(item.value)}
    >
      <Text
        style={[
          styles.filterText,
          activeFilter === item.value && styles.filterTextActive,
        ]}
      >
        {item.label}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Transaction History</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Filters */}
      <View style={styles.filtersContainer}>
        <FlatList
          data={FILTERS}
          renderItem={renderFilter}
          keyExtractor={(item) => item.value}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filtersList}
        />
      </View>

      {/* Escrow List */}
      <FlatList
        data={filteredEscrows}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <EscrowCard
            escrow={item}
            currentUserId={user.id}
            onPress={() => navigation.navigate('EscrowDetail', { escrow: item, user })}
          />
        )}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={fetchEscrows} />
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>📋</Text>
            <Text style={styles.emptyTitle}>No Transactions</Text>
            <Text style={styles.emptyText}>
              {activeFilter === 'all'
                ? "You haven't made any escrow transactions yet"
                : `No ${activeFilter} transactions found`}
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
  headerTitle: {
    ...HEADER_TITLE_TEXT,
    color: '#FFFFFF',
  },
  filtersContainer: {
    backgroundColor: COLORS.card,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  filtersList: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  filterChip: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.full,
    backgroundColor: COLORS.surface,
    marginRight: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  filterChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  filterText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '500',
    color: COLORS.textSecondary,
  },
  filterTextActive: {
    color: '#FFFFFF',
  },
  listContent: {
    padding: SPACING.lg,
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
});

