import React, { Fragment, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../lib/types';
import { BORDER_RADIUS, COLORS, FONT_SIZES, HEADER_TITLE_TEXT, SPACING } from '../lib/theme';
import InfoDrawer from '../components/InfoDrawer';

type CommunityGuidelinesScreenProps = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'CommunityGuidelines'>;
};

type GuideSubsection = {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
};

type GuideSection = {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
  subsections?: GuideSubsection[];
};

const COMMUNITY_SECTIONS: GuideSection[] = [
  {
    title: 'Purpose',
    paragraphs: [
      'The goal of the PMARTS community is to create a safe, fair, and transparent environment for Pi transactions.',
      'These guidelines exist to:',
    ],
    bullets: [
      'Protect users from fraud and abuse.',
      'Encourage respectful communication.',
      'Improve transaction success rates.',
      'Reduce disputes caused by unclear agreements.',
      'Support a healthy reputation system.',
    ],
  },
  {
    title: 'Core Principles',
    bullets: [
      'Be honest about what you are offering or requesting.',
      'Keep agreements clear and specific.',
      'Respect the time, funds, and safety of other users.',
      'Use escrow properly instead of trying to bypass it.',
      'Provide evidence when a dispute or claim is made.',
      'Communicate with maturity and respect.',
    ],
  },
  {
    title: 'Expected User Behavior',
    subsections: [
      {
        title: 'Be Accurate',
        paragraphs: ['Always describe the transaction truthfully.'],
        bullets: [
          'If you are selling a product, describe it correctly.',
          'If you are offering a service, explain the deliverable and timeline clearly.',
          'If the item is used, damaged, delayed, or limited, say so before escrow is created.',
        ],
      },
      {
        title: 'Be Clear',
        paragraphs: ['Before starting a transaction, both parties should agree on:'],
        bullets: [
          'What is being exchanged',
          'The exact Pi amount',
          'Delivery or completion timeline',
          'Any conditions for release',
          'What counts as successful completion',
        ],
      },
      {
        title: 'Be Responsive',
        paragraphs: ['Users should respond within a reasonable time on active transactions. Silence during an active escrow can create risk and unnecessary disputes.'],
      },
      {
        title: 'Be Respectful',
        paragraphs: ['Treat other users, moderators, and support staff professionally.'],
        bullets: [
          'Allowed behavior: asking questions politely, requesting clarification, disagreeing without insults, and reporting issues with evidence.',
          'Unacceptable behavior: harassment, threats, bullying, hate speech, abusive language, and repeated intimidation or pressure tactics.',
        ],
      },
    ],
  },
  {
    title: 'Safe Trading Rules',
    bullets: [
      'Never pressure another user to release funds early.',
      'Never ask another user to send Pi outside escrow for a protected transaction.',
      'Never misrepresent shipping, delivery status, or item condition.',
      'Never pretend a service is complete when it is not.',
      'Never create fake urgency to manipulate the other party.',
    ],
  },
  {
    title: 'Rules for Escrow Use',
    paragraphs: ['PMARTS escrow must be used in good faith.'],
    bullets: [
      'Users must not create fake escrows, mislead another user, use intentionally false details, or select misleading transaction types.',
      'Users should choose the correct transaction type, use a meaningful reference ID, add clear notes, and keep proof of completion.',
    ],
  },
  {
    title: 'Physical Product vs Instant Transfer Rule',
    paragraphs: [
      'Use Physical Product when the item is real but delivery happens later with shipping or delayed handoff.',
      'Use Instant Transfer when handoff is immediate and both parties complete exchange at the same time with no shipping delay.',
      'Choosing the wrong type can create confusion and disputes. Users are expected to select the type that reflects the real transaction.',
    ],
  },
  {
    title: 'Communication Rules',
    bullets: [
      'Keep messages relevant to the transaction.',
      'Do not spam another user.',
      'Do not send deceptive instructions.',
      'Do not share false evidence.',
      'Do not impersonate support staff, moderators, or another user.',
    ],
  },
  {
    title: 'Fraud and Deception Prohibited',
    bullets: [
      'Scam attempts, fake listings, false delivery claims, and chargeback-style abuse are prohibited.',
      'Manipulated screenshots, fabricated evidence, impersonation, identity misrepresentation, and multi-account abuse are prohibited.',
      'Coordinated fraud with other accounts is prohibited.',
    ],
    paragraphs: ['Any user found engaging in fraudulent behavior may lose access to platform features and may be subject to account review, transaction holds, dispute action, or removal.'],
  },
  {
    title: 'Dispute Conduct',
    paragraphs: ['Disputes are for genuine conflicts, not for retaliation.'],
    bullets: [
      'When opening a dispute: tell the truth, be specific, upload relevant evidence, avoid abusive language, and focus on facts, timeline, and proof.',
      'Do not open fake disputes, threaten others with disputes, flood support with duplicate claims, or submit misleading proof.',
    ],
  },
  {
    title: 'Evidence Standards',
    subsections: [
      {
        title: 'Strong evidence includes',
        bullets: [
          'Screenshots of the agreement',
          'Delivery records',
          'Photos of the received item',
          'Video or image proof when relevant',
          'Files showing missing or incomplete work',
          'Receipts, tracking, or handoff proof',
        ],
      },
      {
        title: 'Poor evidence includes',
        bullets: [
          'Cropped screenshots with no context',
          'Unrelated chat messages',
          'Screenshots with missing timestamps when timing matters',
          'Evidence that cannot be connected to the escrow',
        ],
      },
    ],
  },
  {
    title: 'Trust and Reputation',
    bullets: [
      'Complete transactions fairly.',
      'Use accurate descriptions.',
      'Meet deadlines.',
      'Communicate clearly.',
      'Resolve small misunderstandings before escalating.',
    ],
    paragraphs: ['Users who repeatedly create avoidable conflicts, abuse support, or ignore agreed terms may damage their trust standing.'],
  },
  {
    title: 'Support and Moderator Respect',
    paragraphs: ['Support exists to help resolve issues, not to act as a weapon against other users.'],
    bullets: [
      'When contacting support: explain the issue clearly, include escrow ID when relevant, summarize events in order, attach useful evidence, and be patient.',
      'Do not abuse support agents, spam repeated messages, impersonate authority, or demand special treatment without basis.',
    ],
  },
  {
    title: 'Content and Safety Standards',
    bullets: [
      'Users must not use PMARTS to facilitate fraudulent activity, stolen goods, illegal services, financial deception, harassment campaigns, or exploitation/coercion.',
      'If a transaction appears unsafe, deceptive, or illegal, users should avoid proceeding and report it.',
    ],
  },
  {
    title: 'Privacy and Account Responsibility',
    bullets: [
      'Protect your login access.',
      'Avoid sharing account credentials.',
      'Review profile information for accuracy.',
      'Report suspicious access or impersonation quickly.',
    ],
  },
  {
    title: 'Enforcement',
    paragraphs: ['PMARTS may take action when these guidelines are violated.'],
    bullets: [
      'Warning the user',
      'Restricting certain features',
      'Increased review of transactions',
      'Escalating to support or moderation review',
      'Suspending or removing access where necessary',
    ],
  },
  {
    title: 'Report Problems Early',
    bullets: [
      'Report deceptive behavior, changed deal terms after escrow creation, false delivery evidence, pressure to bypass escrow, and abusive or threatening behavior.',
    ],
  },
  {
    title: 'Community Standard Summary',
    bullets: [
      'Say exactly what you mean.',
      'Trade honestly.',
      'Use the correct escrow type.',
      'Keep proof.',
      'Respect other users.',
      'Do not manipulate the system.',
      'Let facts guide disputes.',
    ],
    paragraphs: ['PMARTS works best when trust is supported by clear agreements, documented action, and responsible behavior from both sides.'],
  },
];

function renderSection(section: GuideSection) {
  return (
    <View key={section.title} style={styles.sectionCard}>
      <Text style={styles.sectionTitle}>{section.title}</Text>

      {section.paragraphs?.map((paragraph) => (
        <Text key={`${section.title}-${paragraph}`} style={styles.sectionBody}>{paragraph}</Text>
      ))}

      {section.bullets?.map((item) => (
        <View key={`${section.title}-${item}`} style={styles.row}>
          <Text style={styles.marker}>•</Text>
          <Text style={styles.rowText}>{item}</Text>
        </View>
      ))}

      {section.subsections?.map((sub) => (
        <Fragment key={`${section.title}-${sub.title}`}>
          <View style={styles.subsectionCard}>
            <Text style={styles.subsectionTitle}>{sub.title}</Text>

            {sub.paragraphs?.map((paragraph) => (
              <Text key={`${sub.title}-${paragraph}`} style={styles.subsectionBody}>{paragraph}</Text>
            ))}

            {sub.bullets?.map((item) => (
              <View key={`${sub.title}-${item}`} style={styles.row}>
                <Text style={styles.marker}>•</Text>
                <Text style={styles.rowText}>{item}</Text>
              </View>
            ))}
          </View>
        </Fragment>
      ))}
    </View>
  );
}

export default function CommunityGuidelinesScreen({ navigation }: CommunityGuidelinesScreenProps) {
  const [drawerVisible, setDrawerVisible] = useState(false);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton}>
          <Text style={styles.headerButtonText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Community Guide</Text>
        <TouchableOpacity onPress={() => setDrawerVisible(true)} style={styles.headerButton}>
          <Text style={styles.headerButtonText}>☰</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.heroCard}>
          <Text style={styles.heroKicker}>PMARTS Reader</Text>
          <Text style={styles.heroTitle}>PMARTS Community Guidelines</Text>
          <Text style={styles.heroText}>
            These guidelines explain how PMARTS users are expected to behave while using the app and interacting with other members.
          </Text>
        </View>

        {COMMUNITY_SECTIONS.map(renderSection)}
      </ScrollView>

      <InfoDrawer
        visible={drawerVisible}
        onClose={() => setDrawerVisible(false)}
        currentRoute="CommunityGuidelines"
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
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerButtonText: {
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
    padding: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
  heroCard: {
    backgroundColor: '#134E4A',
    borderRadius: BORDER_RADIUS.xl,
    padding: SPACING.xl,
    marginBottom: SPACING.lg,
  },
  heroKicker: {
    color: '#A7F3D0',
    fontSize: FONT_SIZES.sm,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  heroTitle: {
    color: '#FFFFFF',
    fontSize: FONT_SIZES.xxxl,
    fontWeight: '800',
    lineHeight: 36,
    marginBottom: SPACING.sm,
  },
  heroText: {
    color: '#D1FAE5',
    fontSize: FONT_SIZES.md,
    lineHeight: 22,
  },
  sectionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: BORDER_RADIUS.xl,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  sectionTitle: {
    fontSize: FONT_SIZES.xl,
    fontWeight: '800',
    color: COLORS.text,
    marginBottom: SPACING.sm,
  },
  sectionBody: {
    fontSize: FONT_SIZES.md,
    color: COLORS.textSecondary,
    lineHeight: 22,
    marginBottom: SPACING.sm,
  },
  subsectionCard: {
    marginTop: SPACING.sm,
    backgroundColor: '#F0FDFA',
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    borderColor: '#99F6E4',
    padding: SPACING.md,
  },
  subsectionTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 6,
  },
  subsectionBody: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textSecondary,
    lineHeight: 20,
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 6,
  },
  marker: {
    width: 20,
    fontSize: FONT_SIZES.sm,
    color: '#0F766E',
    fontWeight: '700',
  },
  rowText: {
    flex: 1,
    fontSize: FONT_SIZES.sm,
    color: COLORS.text,
    lineHeight: 20,
  },
});