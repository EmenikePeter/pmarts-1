import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Escrow, STATUS_COLORS, formatPi, formatDate } from '../lib/types';
import { getEscrowRoleLabel, getEscrowStatusGuidance, getEscrowTypeLabel } from '../lib/escrowPresentation';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../lib/theme';

type EscrowCardProps = {
  escrow: Escrow;
  currentUserId: string;
  onPress: () => void;
};

export default function EscrowCard({ escrow, currentUserId, onPress }: EscrowCardProps) {
  const isSender = escrow.sender_id === currentUserId;
  const direction = isSender ? 'To' : 'From';
  const roleLabel = getEscrowRoleLabel(escrow, currentUserId);
  const transactionTypeLabel = getEscrowTypeLabel(escrow.transaction_type);
  const guidance = getEscrowStatusGuidance(escrow, currentUserId);
  const otherParty = isSender 
    ? escrow.recipient?.username || escrow.recipient_id 
    : escrow.sender?.username || escrow.sender_id;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress}>
      <View style={styles.header}>
        <View style={styles.directionBadge}>
          <Text style={styles.directionText}>{isSender ? '↑ SENT' : '↓ RECEIVED'}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[escrow.status] }]}>
          <Text style={styles.statusText}>{escrow.status.toUpperCase()}</Text>
        </View>
      </View>

      <View style={styles.body}>
        <View style={styles.metaRow}>
          <Text style={styles.metaBadge}>{roleLabel}</Text>
          <Text style={styles.metaType}>{transactionTypeLabel}</Text>
        </View>

        <View style={styles.row}>
          <Text style={styles.label}>{direction}</Text>
          <Text style={styles.value}>@{otherParty}</Text>
        </View>

        <View style={styles.row}>
          <Text style={styles.label}>Amount</Text>
          <Text style={styles.amount}>{formatPi(escrow.amount)}</Text>
        </View>

        <View style={styles.row}>
          <Text style={styles.label}>Reference</Text>
          <Text style={styles.value}>{escrow.reference_id}</Text>
        </View>

        {escrow.note && (
          <Text style={styles.note} numberOfLines={1}>"{escrow.note}"</Text>
        )}

        <Text style={styles.guidance} numberOfLines={2}>{guidance}</Text>
      </View>

      <View style={styles.footer}>
        <Text style={styles.date}>{formatDate(escrow.created_at)}</Text>
        <Text style={styles.viewDetails}>View Details →</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.card,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  directionBadge: {
    backgroundColor: COLORS.surface,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: BORDER_RADIUS.sm,
  },
  directionText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  statusBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: BORDER_RADIUS.sm,
  },
  statusText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  body: {
    paddingVertical: SPACING.sm,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
    gap: SPACING.sm,
  },
  metaBadge: {
    fontSize: FONT_SIZES.xs,
    fontWeight: '700',
    color: COLORS.primary,
    backgroundColor: COLORS.surface,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: BORDER_RADIUS.full,
  },
  metaType: {
    flex: 1,
    textAlign: 'right',
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.xs,
  },
  label: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textSecondary,
  },
  value: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    color: COLORS.text,
  },
  amount: {
    fontSize: FONT_SIZES.xl,
    fontWeight: '700',
    color: COLORS.primary,
  },
  note: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
    fontStyle: 'italic',
    marginTop: SPACING.xs,
  },
  guidance: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textSecondary,
    marginTop: SPACING.sm,
    lineHeight: 18,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    marginTop: SPACING.sm,
  },
  date: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.textMuted,
  },
  viewDetails: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary,
    fontWeight: '600',
  },
});

