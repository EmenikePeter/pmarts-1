/**
 * Terms of Service Screen
 * 
 * Legal terms and conditions for using PMARTS
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
import { LEGAL_URLS } from '../lib/legal';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES, HEADER_TITLE_TEXT } from '../lib/theme';

type TermsOfServiceScreenProps = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'TermsOfService'>;
};

export default function TermsOfServiceScreen({ navigation }: TermsOfServiceScreenProps) {
  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Terms of Service</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.lastUpdated}>Last Updated: March 2026</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>1. Acceptance of Terms</Text>
          <Text style={styles.paragraph}>
            By accessing or using PMARTS (Pi Marketplace Trust System), you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use our service.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>2. Service Description</Text>
          <Text style={styles.paragraph}>
            PMARTS provides an escrow service for Pi Network transactions. We facilitate secure peer-to-peer transactions by holding Pi tokens in escrow until both parties confirm the transaction is complete.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>3. User Responsibilities</Text>
          <Text style={styles.paragraph}>
            Users are responsible for:
          </Text>
          <Text style={styles.bulletPoint}>• Providing accurate information</Text>
          <Text style={styles.bulletPoint}>• Securing their account credentials</Text>
          <Text style={styles.bulletPoint}>• Completing transactions in good faith</Text>
          <Text style={styles.bulletPoint}>• Complying with all applicable laws</Text>
          <Text style={styles.bulletPoint}>• Not using the service for illegal activities</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>4. Escrow Process</Text>
          <Text style={styles.paragraph}>
            When you create an escrow, the Pi is held by our system until:
          </Text>
          <Text style={styles.bulletPoint}>• The sender releases the payment</Text>
          <Text style={styles.bulletPoint}>• The escrow is refunded</Text>
          <Text style={styles.bulletPoint}>• A dispute is resolved</Text>
          <Text style={[styles.paragraph, { marginTop: SPACING.sm }]}>
            PMARTS is not responsible for the quality of goods or services exchanged between parties.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>5. Fees</Text>
          <Text style={styles.paragraph}>
            PMARTS charges a 1% fee on successful transactions. This fee is deducted from the payment amount when escrow is released. Fees are non-refundable.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>6. Dispute Resolution</Text>
          <Text style={styles.paragraph}>
            In case of disputes:
          </Text>
          <Text style={styles.bulletPoint}>• Either party may open a dispute</Text>
          <Text style={styles.bulletPoint}>• Both parties should provide evidence</Text>
          <Text style={styles.bulletPoint}>• PMARTS will review and make a decision</Text>
          <Text style={styles.bulletPoint}>• Decisions are final and binding</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>7. Prohibited Activities</Text>
          <Text style={styles.paragraph}>
            The following are strictly prohibited:
          </Text>
          <Text style={styles.bulletPoint}>• Money laundering or fraud</Text>
          <Text style={styles.bulletPoint}>• Trading illegal items</Text>
          <Text style={styles.bulletPoint}>• Harassment or threats</Text>
          <Text style={styles.bulletPoint}>• Creating fake accounts</Text>
          <Text style={styles.bulletPoint}>• Manipulating ratings</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>8. Account Termination</Text>
          <Text style={styles.paragraph}>
            We reserve the right to suspend or terminate accounts that violate these terms. Users may also request account deletion at any time.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>9. Limitation of Liability</Text>
          <Text style={styles.paragraph}>
            PMARTS is provided "as is" without warranties. We are not liable for:
          </Text>
          <Text style={styles.bulletPoint}>• Lost profits or data</Text>
          <Text style={styles.bulletPoint}>• Service interruptions</Text>
          <Text style={styles.bulletPoint}>• Third-party actions</Text>
          <Text style={styles.bulletPoint}>• Pi Network issues</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>10. Privacy</Text>
          <Text style={styles.paragraph}>
            Your privacy is important to us. We collect and use data in accordance with our Privacy Policy. By using PMARTS, you consent to our data practices.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>11. Changes to Terms</Text>
          <Text style={styles.paragraph}>
            We may update these terms at any time. Continued use of the service after changes constitutes acceptance of the new terms.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>12. Contact</Text>
          <Text style={styles.paragraph}>
            For questions about these terms, contact us at:
          </Text>
          <Text style={styles.contactInfo}>support@pmarts.org</Text>
          <TouchableOpacity style={styles.linkButton} onPress={() => Linking.openURL(LEGAL_URLS.termsOfService)}>
            <Text style={styles.linkButtonText}>Open Hosted Terms</Text>
          </TouchableOpacity>
          <Text style={styles.urlText}>{LEGAL_URLS.termsOfService}</Text>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            By using PMARTS, you acknowledge that you have read and understood these Terms of Service.
          </Text>
        </View>
      </ScrollView>
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
  content: {
    flex: 1,
  },
  scrollContent: {
    padding: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
  lastUpdated: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginBottom: SPACING.lg,
  },
  section: {
    marginBottom: SPACING.lg,
  },
  sectionTitle: {
    fontSize: FONT_SIZES.md,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: SPACING.sm,
  },
  paragraph: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
    lineHeight: 22,
  },
  bulletPoint: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
    lineHeight: 24,
    paddingLeft: SPACING.md,
  },
  contactInfo: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary,
    fontWeight: '600',
    marginTop: SPACING.xs,
  },
  linkButton: {
    marginTop: SPACING.md,
    backgroundColor: COLORS.primary,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    alignSelf: 'flex-start',
  },
  linkButtonText: {
    color: '#FFFFFF',
    fontSize: FONT_SIZES.sm,
    fontWeight: '700',
  },
  urlText: {
    marginTop: SPACING.sm,
    fontSize: FONT_SIZES.xs,
    color: COLORS.textMuted,
  },
  footer: {
    backgroundColor: COLORS.background,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginTop: SPACING.lg,
  },
  footerText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    fontStyle: 'italic',
  },
});

