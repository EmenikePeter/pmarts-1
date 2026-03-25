import React from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { RootStackParamList } from '../lib/types';
import { BORDER_RADIUS, COLORS, FONT_SIZES, SPACING } from '../lib/theme';

type InfoDrawerRoute =
  | 'AboutUs'
  | 'AppGuide'
  | 'CommunityGuidelines'
  | 'PrivacyPolicy'
  | 'TermsOfService'
  | 'HelpSupport';

type InfoDrawerProps = {
  visible: boolean;
  onClose: () => void;
  currentRoute: InfoDrawerRoute;
  navigation: {
    navigate: <T extends keyof RootStackParamList>(
      ...args: undefined extends RootStackParamList[T]
        ? [screen: T] | [screen: T, params: RootStackParamList[T]]
        : [screen: T, params: RootStackParamList[T]]
    ) => void;
  };
};

const DRAWER_ITEMS: Array<{ route: InfoDrawerRoute; title: string; description: string; icon: string }> = [
  {
    route: 'AboutUs',
    title: 'About PMARTS',
    description: 'Mission, values, trust model, and support links.',
    icon: '🏢',
  },
  {
    route: 'AppGuide',
    title: 'App Guide',
    description: 'How to use deposits, escrow, disputes, and support.',
    icon: '📘',
  },
  {
    route: 'CommunityGuidelines',
    title: 'Community Guide',
    description: 'Rules for safe trading, conduct, and evidence.',
    icon: '🤝',
  },
  {
    route: 'PrivacyPolicy',
    title: 'Privacy Policy',
    description: 'How PMARTS handles privacy and user data.',
    icon: '🔐',
  },
  {
    route: 'TermsOfService',
    title: 'Terms of Service',
    description: 'Platform terms, responsibilities, and usage rules.',
    icon: '📄',
  },
  {
    route: 'HelpSupport',
    title: 'Help & Support',
    description: 'Support contacts, FAQs, tickets, and assistant.',
    icon: '🆘',
  },
];

export default function InfoDrawer({ visible, onClose, currentRoute, navigation }: InfoDrawerProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} onPress={onClose} activeOpacity={1} />
        <View style={styles.drawer}>
          <View style={styles.header}>
            <View>
              <Text style={styles.kicker}>PMARTS Reader</Text>
              <Text style={styles.title}>Guides & Policies</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>×</Text>
            </TouchableOpacity>
          </View>

          {DRAWER_ITEMS.map((item) => {
            const active = item.route === currentRoute;
            return (
              <TouchableOpacity
                key={item.route}
                style={[styles.item, active && styles.itemActive]}
                onPress={() => {
                  onClose();
                  if (!active) navigation.navigate(item.route);
                }}
              >
                <Text style={styles.itemIcon}>{item.icon}</Text>
                <View style={styles.itemContent}>
                  <Text style={[styles.itemTitle, active && styles.itemTitleActive]}>{item.title}</Text>
                  <Text style={styles.itemDescription}>{item.description}</Text>
                </View>
                <Text style={[styles.itemArrow, active && styles.itemArrowActive]}>{active ? '•' : '→'}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.28)',
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  backdrop: {
    flex: 1,
  },
  drawer: {
    width: '84%',
    maxWidth: 360,
    backgroundColor: '#FFFFFF',
    paddingTop: SPACING.xxl + 8,
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.xl,
    shadowColor: '#000000',
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: -4, height: 0 },
    elevation: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  kicker: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  title: {
    fontSize: FONT_SIZES.xl,
    color: COLORS.text,
    fontWeight: '800',
  },
  closeButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface,
  },
  closeButtonText: {
    fontSize: 24,
    lineHeight: 24,
    color: COLORS.text,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  itemActive: {
    backgroundColor: '#FFF7E8',
    borderColor: '#F2C46D',
  },
  itemIcon: {
    fontSize: 22,
    marginRight: SPACING.md,
  },
  itemContent: {
    flex: 1,
  },
  itemTitle: {
    fontSize: FONT_SIZES.md,
    color: COLORS.text,
    fontWeight: '700',
    marginBottom: 4,
  },
  itemTitleActive: {
    color: COLORS.primary,
  },
  itemDescription: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
  itemArrow: {
    fontSize: 18,
    color: COLORS.textMuted,
    marginLeft: SPACING.sm,
  },
  itemArrowActive: {
    color: COLORS.primary,
  },
});