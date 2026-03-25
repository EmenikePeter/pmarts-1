/**
 * About Us Screen
 *
 * Professional overview of PMARTS — mission, values, how it works,
 * and the team behind it.
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../lib/types';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES, HEADER_TITLE_TEXT } from '../lib/theme';
import InfoDrawer from '../components/InfoDrawer';

type AboutUsScreenProps = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'AboutUs'>;
};

const CORE_VALUES = [
  {
    icon: '🔒',
    title: 'Security First',
    description:
      "Every transaction is protected by Pi Network's blockchain infrastructure. Your funds never leave escrow until both parties are satisfied.",
  },
  {
    icon: '⚖️',
    title: 'Fair & Transparent',
    description:
      'Our dispute resolution process is impartial. All evidence is reviewed by our team, and outcomes are communicated clearly to both parties.',
  },
  {
    icon: '🤝',
    title: 'Trust-Driven',
    description:
      "A real-time trust score reflects each user's track record — making it easy to identify reliable trading partners before you transact.",
  },
  {
    icon: '⚡',
    title: 'Fast & Reliable',
    description:
      'Instant deposit confirmation, real-time status updates, and automated release checks keep your transactions moving without delays.',
  },
];

const HOW_IT_WORKS = [
  {
    step: '01',
    title: 'Create an Escrow',
    description: "The sender initiates an escrow with the agreed Pi amount and the recipient's details.",
  },
  {
    step: '02',
    title: 'Funds Held Securely',
    description: 'Pi is locked in escrow — neither party can access it until the conditions are met.',
  },
  {
    step: '03',
    title: 'Delivery & Confirmation',
    description: 'The recipient delivers the goods or service, and the sender confirms receipt.',
  },
  {
    step: '04',
    title: 'Payment Released',
    description: 'Once confirmed, funds are released instantly to the recipient. A 1% service fee applies on successful transfers.',
  },
];

export default function AboutUsScreen({ navigation }: AboutUsScreenProps) {
  const [drawerVisible, setDrawerVisible] = React.useState(false);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>About Us</Text>
        <TouchableOpacity onPress={() => setDrawerVisible(true)} style={styles.menuButton}>
          <Text style={styles.menuIcon}>☰</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>

        {/* Hero */}
        <View style={styles.hero}>
          <Text style={styles.heroLogo}>🛡️</Text>
          <Text style={styles.heroTitle}>PMARTS</Text>
          <Text style={styles.heroSubtitle}>Pi Marketplace Trust System</Text>
          <Text style={styles.heroTagline}>
            Secure, transparent, and fair escrow for the Pi Network ecosystem.
          </Text>
        </View>

        {/* Mission */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Our Mission</Text>
          <Text style={styles.bodyText}>
            PMARTS was built to solve one of the biggest challenges in peer-to-peer commerce on the
            Pi Network — <Text style={styles.boldText}>trust</Text>. Without a reliable way to
            secure transactions, buyers risk losing Pi without receiving goods, and sellers risk
            delivering without payment.
          </Text>
          <Text style={[styles.bodyText, { marginTop: SPACING.md }]}>
            We bridge that gap with a robust escrow service that holds funds impartially until both
            parties fulfil their obligations. Our goal is to make every Pi transaction safe,
            predictable, and dispute-free.
          </Text>
        </View>

        {/* What We Do */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>What We Do</Text>
          <Text style={styles.bodyText}>
            PMARTS provides a suite of tools designed for everyday Pi marketplace users:
          </Text>
          <View style={styles.bulletList}>
            {[
              '💰  Escrow deposits — lock funds until delivery is confirmed',
              '🧾  Full transaction history with real-time status updates',
              '🚨  Dispute management with evidence submission & admin review',
              '🔁  Refund requests with structured approval workflows',
              '📊  Trust scoring to rate and verify trading partners',
              '💬  In-app messaging between buyers and sellers',
              '🔔  Push notifications for every transaction milestone',
            ].map((item, i) => (
              <Text key={i} style={styles.bulletItem}>{item}</Text>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Read Before You Trade</Text>

          <TouchableOpacity style={styles.guideCard} onPress={() => navigation.navigate('AppGuide')}>
            <Text style={styles.guideIcon}>📘</Text>
            <View style={styles.guideContent}>
              <Text style={styles.guideTitle}>PMARTS App Guide</Text>
              <Text style={styles.guideDescription}>
                Learn how deposits, escrow, releases, disputes, and support work inside the app.
              </Text>
            </View>
            <Text style={styles.guideArrow}>→</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.guideCard} onPress={() => navigation.navigate('CommunityGuidelines')}>
            <Text style={styles.guideIcon}>🤝</Text>
            <View style={styles.guideContent}>
              <Text style={styles.guideTitle}>Community Guidelines</Text>
              <Text style={styles.guideDescription}>
                Review safe trading rules, communication standards, and evidence expectations.
              </Text>
            </View>
            <Text style={styles.guideArrow}>→</Text>
          </TouchableOpacity>
        </View>

        {/* How It Works */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>How It Works</Text>
          {HOW_IT_WORKS.map((step) => (
            <View key={step.step} style={styles.stepCard}>
              <View style={styles.stepBadge}>
                <Text style={styles.stepNumber}>{step.step}</Text>
              </View>
              <View style={styles.stepContent}>
                <Text style={styles.stepTitle}>{step.title}</Text>
                <Text style={styles.stepDescription}>{step.description}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Core Values */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Our Core Values</Text>
          {CORE_VALUES.map((value) => (
            <View key={value.title} style={styles.valueCard}>
              <Text style={styles.valueIcon}>{value.icon}</Text>
              <View style={styles.valueContent}>
                <Text style={styles.valueTitle}>{value.title}</Text>
                <Text style={styles.valueDescription}>{value.description}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Why Pi Network */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Built for Pi Network</Text>
          <Text style={styles.bodyText}>
            Pi Network is one of the fastest-growing blockchain communities in the world. As the
            ecosystem matures, peer-to-peer trade is accelerating — and so is the need for
            trustworthy infrastructure.
          </Text>
          <Text style={[styles.bodyText, { marginTop: SPACING.md }]}>
            PMARTS is purpose-built for Pi, integrating natively with Pi's payment SDK to provide
            seamless, low-friction escrow that fits naturally into the Pi Network user experience.
          </Text>
        </View>

        {/* Stats / Highlights */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>1%</Text>
            <Text style={styles.statLabel}>Service Fee</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>24h</Text>
            <Text style={styles.statLabel}>Dispute Review</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>Varies</Text>
            <Text style={styles.statLabel}>Release Timing (By Type)</Text>
          </View>
        </View>

        {/* Contact */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Get in Touch</Text>
          <TouchableOpacity
            style={styles.contactRow}
            onPress={() => Linking.openURL('mailto:support@pmarts.org?subject=PMARTS Inquiry')}
          >
            <Text style={styles.contactIcon}>📧</Text>
            <View style={styles.contactTextContainer}>
              <Text style={styles.contactTitle}>Support</Text>
              <Text style={styles.contactValue}>support@pmarts.org</Text>
            </View>
            <Text style={styles.contactArrow}>→</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.contactRow}
            onPress={() => Linking.openURL('mailto:info@pmarts.org?subject=PMARTS Inquiry')}
          >
            <Text style={styles.contactIcon}>✉️</Text>
            <View style={styles.contactTextContainer}>
              <Text style={styles.contactTitle}>General Inquiries</Text>
              <Text style={styles.contactValue}>info@pmarts.org</Text>
            </View>
            <Text style={styles.contactArrow}>→</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.contactRow}
            onPress={() => Linking.openURL('https://t.me/pmarts_support')}
          >
            <Text style={styles.contactIcon}>💬</Text>
            <View style={styles.contactTextContainer}>
              <Text style={styles.contactTitle}>Telegram</Text>
              <Text style={styles.contactValue}>@pmarts_support</Text>
            </View>
            <Text style={styles.contactArrow}>→</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.contactRow}
            onPress={() => Linking.openURL('https://x.com/pmarts_support')}
          >
            <Text style={styles.contactIcon}>🐦</Text>
            <View style={styles.contactTextContainer}>
              <Text style={styles.contactTitle}>Twitter / X</Text>
              <Text style={styles.contactValue}>@pmarts_support</Text>
            </View>
            <Text style={styles.contactArrow}>→</Text>
          </TouchableOpacity>
        </View>

        {/* Legal Links */}
        <View style={styles.legalRow}>
          <TouchableOpacity onPress={() => navigation.navigate('PrivacyPolicy')}>
            <Text style={styles.legalLink}>Privacy Policy</Text>
          </TouchableOpacity>
          <Text style={styles.legalDivider}>·</Text>
          <TouchableOpacity onPress={() => navigation.navigate('TermsOfService')}>
            <Text style={styles.legalLink}>Terms of Service</Text>
          </TouchableOpacity>
          <Text style={styles.legalDivider}>·</Text>
          <TouchableOpacity onPress={() => navigation.navigate('HelpSupport')}>
            <Text style={styles.legalLink}>Help & Support</Text>
          </TouchableOpacity>
        </View>

        {/* Footer */}
        <Text style={styles.footer}>
          © {new Date().getFullYear()} PMARTS. All rights reserved.{'\n'}
          Powering trust in the Pi Network ecosystem.
        </Text>

      </ScrollView>

        <InfoDrawer
          visible={drawerVisible}
          onClose={() => setDrawerVisible(false)}
          currentRoute="AboutUs"
          navigation={navigation}
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
  menuButton: {
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
  menuIcon: {
    fontSize: 20,
    color: COLORS.primary,
    fontWeight: '700',
  },
  headerTitle: {
    ...HEADER_TITLE_TEXT,
    color: '#FFFFFF',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: SPACING.xxl,
  },

  // Hero
  hero: {
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    paddingTop: SPACING.xl,
    paddingBottom: SPACING.xxl,
    paddingHorizontal: SPACING.lg,
  },
  heroLogo: {
    fontSize: 56,
    marginBottom: SPACING.sm,
  },
  heroTitle: {
    fontSize: 36,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 2,
  },
  heroSubtitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '600',
    color: COLORS.secondary,
    marginTop: SPACING.xs,
    marginBottom: SPACING.md,
  },
  heroTagline: {
    fontSize: FONT_SIZES.md,
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'center',
    lineHeight: 22,
  },

  // Section
  section: {
    backgroundColor: COLORS.card,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.lg,
    borderRadius: BORDER_RADIUS.xl,
    padding: SPACING.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '700',
    color: COLORS.primary,
    marginBottom: SPACING.md,
    paddingBottom: SPACING.sm,
    borderBottomWidth: 2,
    borderBottomColor: COLORS.secondary,
  },
  bodyText: {
    fontSize: FONT_SIZES.md,
    color: COLORS.textSecondary,
    lineHeight: 24,
  },
  boldText: {
    fontWeight: '700',
    color: COLORS.text,
  },

  // Bullet list
  bulletList: {
    marginTop: SPACING.md,
    gap: SPACING.sm,
  },
  bulletItem: {
    fontSize: FONT_SIZES.md,
    color: COLORS.textSecondary,
    lineHeight: 22,
  },
  guideCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: BORDER_RADIUS.xl,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
    marginTop: SPACING.md,
  },
  guideIcon: {
    fontSize: 24,
    marginRight: SPACING.md,
  },
  guideContent: {
    flex: 1,
  },
  guideTitle: {
    fontSize: FONT_SIZES.md,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 4,
  },
  guideDescription: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
  guideArrow: {
    fontSize: FONT_SIZES.lg,
    color: COLORS.primary,
    marginLeft: SPACING.sm,
  },

  // How It Works steps
  stepCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: SPACING.md,
  },
  stepBadge: {
    width: 44,
    height: 44,
    borderRadius: BORDER_RADIUS.full,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.md,
    flexShrink: 0,
  },
  stepNumber: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  stepContent: {
    flex: 1,
  },
  stepTitle: {
    fontSize: FONT_SIZES.md,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 4,
  },
  stepDescription: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
    lineHeight: 20,
  },

  // Core Values
  valueCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
  },
  valueIcon: {
    fontSize: 28,
    marginRight: SPACING.md,
    flexShrink: 0,
  },
  valueContent: {
    flex: 1,
  },
  valueTitle: {
    fontSize: FONT_SIZES.md,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 4,
  },
  valueDescription: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
    lineHeight: 20,
  },

  // Stats
  statsRow: {
    flexDirection: 'row',
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.lg,
    gap: SPACING.md,
  },
  statCard: {
    flex: 1,
    backgroundColor: COLORS.primary,
    borderRadius: BORDER_RADIUS.xl,
    paddingVertical: SPACING.lg,
    alignItems: 'center',
  },
  statValue: {
    fontSize: FONT_SIZES.xxl,
    fontWeight: '800',
    color: COLORS.secondary,
  },
  statLabel: {
    fontSize: FONT_SIZES.xs,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.8)',
    marginTop: 4,
    textAlign: 'center',
  },

  // Contact rows
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  contactIcon: {
    fontSize: 26,
    marginRight: SPACING.md,
  },
  contactTextContainer: {
    flex: 1,
  },
  contactTitle: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    color: COLORS.text,
  },
  contactValue: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  contactArrow: {
    fontSize: FONT_SIZES.lg,
    color: COLORS.primary,
    fontWeight: '600',
  },

  // Legal
  legalRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: SPACING.xl,
    flexWrap: 'wrap',
    gap: SPACING.xs,
  },
  legalLink: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary,
    fontWeight: '600',
  },
  legalDivider: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.muted,
    marginHorizontal: 2,
  },

  // Footer
  footer: {
    textAlign: 'center',
    fontSize: FONT_SIZES.xs,
    color: COLORS.muted,
    marginTop: SPACING.lg,
    marginBottom: SPACING.md,
    lineHeight: 18,
    paddingHorizontal: SPACING.lg,
  },
});
