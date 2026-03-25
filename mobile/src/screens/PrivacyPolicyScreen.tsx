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

type PrivacyPolicyScreenProps = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'PrivacyPolicy'>;
};

export default function PrivacyPolicyScreen({ navigation }: PrivacyPolicyScreenProps) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Privacy Policy</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.lastUpdated}>Last Updated: March 2026</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your Privacy at PMARTS</Text>
          <Text style={styles.paragraph}>
            PMARTS collects and processes limited account, escrow, dispute, and message data needed to operate
            secure peer-to-peer escrow services and protect users from fraud and abuse.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>What We Use Data For</Text>
          <Text style={styles.bulletPoint}>• Account authentication and session security</Text>
          <Text style={styles.bulletPoint}>• Escrow transaction processing and status updates</Text>
          <Text style={styles.bulletPoint}>• Dispute resolution and evidence review</Text>
          <Text style={styles.bulletPoint}>• Notifications, support, and platform safety controls</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Full Legal Policy</Text>
          <Text style={styles.paragraph}>
            Read the complete hosted Privacy Policy at the link below.
          </Text>
          <TouchableOpacity style={styles.linkButton} onPress={() => Linking.openURL(LEGAL_URLS.privacyPolicy)}>
            <Text style={styles.linkButtonText}>Open Full Privacy Policy</Text>
          </TouchableOpacity>
          <Text style={styles.urlText}>{LEGAL_URLS.privacyPolicy}</Text>
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
});
