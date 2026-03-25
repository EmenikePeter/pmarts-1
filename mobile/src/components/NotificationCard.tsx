import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Notification, formatDate } from '../lib/types';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../lib/theme';

type NotificationCardProps = {
  notification: Notification;
  onPress: () => void;
};

const getNotificationIcon = (type: Notification['type']): string => {
  switch (type) {
    case 'deposit':
      return '💰';
    case 'release':
      return '✅';
    case 'refund':
      return '↩️';
    case 'dispute':
      return '⚠️';
    case 'received':
      return '📥';
    case 'milestone_release':
      return '🏁';
    default:
      return '📬';
  }
};

const getNotificationColor = (type: Notification['type']): string => {
  switch (type) {
    case 'deposit':
      return COLORS.warning;
    case 'release':
      return COLORS.success;
    case 'refund':
      return COLORS.info;
    case 'dispute':
      return COLORS.error;
    case 'received':
      return COLORS.primary;
    case 'milestone_release':
      return COLORS.success;
    default:
      return COLORS.muted;
  }
};

export default function NotificationCard({ notification, onPress }: NotificationCardProps) {
  return (
    <TouchableOpacity
      style={[
        styles.card,
        !notification.is_read && styles.unread,
      ]}
      onPress={onPress}
    >
      <View style={[styles.iconContainer, { backgroundColor: getNotificationColor(notification.type) }]}>
        <Text style={styles.icon}>{getNotificationIcon(notification.type)}</Text>
      </View>
      
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={1}>{notification.title}</Text>
          {!notification.is_read && <View style={styles.unreadDot} />}
        </View>
        <Text style={styles.message} numberOfLines={2}>{notification.message}</Text>
        <Text style={styles.time}>{formatDate(notification.created_at)}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: COLORS.card,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  unread: {
    backgroundColor: '#F0F7FF',
    borderColor: COLORS.primary,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.md,
  },
  icon: {
    fontSize: 20,
  },
  content: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.xs,
  },
  title: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    color: COLORS.text,
    flex: 1,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.primary,
    marginLeft: SPACING.sm,
  },
  message: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textSecondary,
    lineHeight: 20,
    marginBottom: SPACING.xs,
  },
  time: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.textMuted,
  },
});

