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

type AppGuideScreenProps = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'AppGuide'>;
};

type GuideSubsection = {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
  numbered?: string[];
};

type GuideSection = {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
  numbered?: string[];
  subsections?: GuideSubsection[];
};

const GUIDE_SECTIONS: GuideSection[] = [
  {
    title: 'What PMARTS Does',
    paragraphs: [
      'PMARTS is an escrow system for Pi Network transactions. Instead of sending Pi directly to another user and hoping they deliver, PMARTS places the funds in escrow first. The funds are only released when the agreement is fulfilled or when a dispute is resolved.',
      'PMARTS is useful when:',
    ],
    bullets: [
      'You are buying a product from someone you do not fully know.',
      'You are paying for a service and want proof of completion first.',
      'You want a safer way to handle delivery, pickup, or trade agreements.',
      'You need a record of the transaction, reference ID, and support path.',
    ],
  },
  {
    title: 'Main Screens in the App',
    paragraphs: ['The mobile app includes these main user areas:'],
    bullets: [
      'Login: Connect your Pi account and enter the app.',
      'Home: View balance in escrow, quick actions, recent escrows, notifications, inbox, dispute access, and help contacts.',
      'Deposit: Create a new escrow agreement.',
      'Escrow Detail: Review one transaction and take the next action.',
      'Transaction History: Filter and review your sent, received, active, completed, disputed, refunded, or cancelled escrows.',
      'Notifications: Track escrow updates and important alerts.',
      'Inbox and Chat: Communicate with other users and open escrow from a conversation when needed.',
      'Profile: View your PMARTS ID, trust score, verification state, stats, and settings.',
      'Help & Support: Contact support, open tickets, use the virtual assistant, and read FAQs.',
      'Dispute: Open a dispute and upload evidence.',
    ],
  },
  {
    title: 'Before You Start',
    paragraphs: ['Before using PMARTS, make sure you:'],
    bullets: [
      'Have access to your Pi account.',
      'Know the correct username or recipient identifier of the other party.',
      'Agree on the transaction amount, item or service, delivery method, and timing before creating escrow.',
      'Prepare a clear reference ID and note so the transaction is easy to identify later.',
    ],
  },
  {
    title: 'Step 1: Sign In',
    numbered: ['Open the app.', 'Tap the Pi login button.', 'Approve authentication through Pi.', 'Wait for the app to load your user profile.'],
    paragraphs: ['After sign-in, you are taken to the Home screen.'],
  },
  {
    title: 'Step 2: Understand the Home Screen',
    paragraphs: ['The Home screen is your control center.', 'You can use it to:'],
    bullets: [
      'See your escrow balance.',
      'Start a new deposit.',
      'Open transaction history.',
      'View notifications.',
      'Open disputes.',
      'Open inbox and chat.',
      'Open help and support.',
      'Open your profile.',
      'Review recent escrows.',
    ],
  },
  {
    title: 'Step 3: Create a Deposit',
    paragraphs: [
      'To create a new escrow:',
      'The app then creates the escrow through the backend and, where applicable, starts the Pi payment flow to fund it.',
      'If both parties are together, you can use QR fast-path: scan recipient Payment QR, enter amount + optional reason in the instant modal, then confirm.',
    ],
    numbered: [
      'From Home, tap Deposit.',
      'Enter the recipient ID or the intended counterparty.',
      'Enter the Pi amount.',
      'Enter a reference ID.',
      'Add an optional note explaining the agreement.',
      'Choose the transaction type.',
      'Review the completion method shown by the app.',
      'If needed, add milestones.',
      'Submit the escrow.',
      'Complete the Pi payment flow if prompted.',
    ],
    subsections: [
      {
        title: 'How to Fill the Deposit Form Correctly',
      },
      {
        title: 'Recipient ID',
        paragraphs: ['Use the correct recipient username or identifier. A mistake here can direct the escrow to the wrong user.'],
      },
      {
        title: 'Amount',
        paragraphs: ['Enter the exact Pi amount agreed by both parties.'],
      },
      {
        title: 'Reference ID',
        paragraphs: ['Your reference ID should help both sides identify the deal quickly.', 'Good examples:'],
        bullets: ['PHONE-ORDER-102', 'LOGO-DESIGN-MARCH', 'TABLE-PICKUP-24MAR', 'Avoid vague references like payment, deal, or item.'],
      },
      {
        title: 'Note',
        paragraphs: ['Use the note to summarize what is being exchanged. Keep it short but specific.'],
        bullets: [
          'iPhone 12, black, with charger, courier delivery',
          'Logo design with 3 revisions, final files in PNG and SVG',
          'Dining table pickup at Wuse market, same-day exchange',
        ],
      },
    ],
  },
  {
    title: 'Choosing the Right Transaction Type',
    paragraphs: ['This is one of the most important parts of the app. Choose the type that matches how the agreement will be completed.'],
    subsections: [
      {
        title: 'Physical Product',
        paragraphs: [
          'Use this when a real item must be delivered before funds are released.',
          'Scenario: You buy a laptop from a seller in another city. You pay into escrow today. The seller ships the laptop. You receive it two days later and confirm delivery. After confirmation, the funds are released.',
          'Physical Product can use a delivery code flow so release only happens after verified handoff.',
          'Use Physical Product when:',
        ],
        bullets: ['There is a delivery delay.', 'Shipping is involved.', 'The item will arrive later, not immediately.', 'Confirmation happens after receipt.'],
      },
      {
        title: 'Delivery Code (Physical Product)',
        paragraphs: [
          'The delivery code is a confirmation control for physical-product handoff. The sender gets this code from Escrow Detail and shares it only at confirmed handoff.',
          'Do not share the code before you receive and inspect the product. If the wrong code is shared too early, funds can be released before safe confirmation.',
          'Recipient can verify by scanning the delivery QR in Escrow Detail or by entering the sender-provided code manually.',
        ],
        numbered: [
          'Sender creates escrow with transaction type set to Physical Product.',
          'When delivery is due, sender opens Escrow Detail and gets the delivery code.',
          'Sender gives the code to the delivery person/recipient only after receiving and checking the item.',
          'Recipient (or delivery side) opens Escrow Detail, then scans sender delivery QR or enters sender-provided code to verify delivery.',
          'When code verification succeeds, escrow is automatically released.',
        ],
        bullets: [
          'If the item is wrong, damaged, or incomplete, do not share/confirm the code yet.',
          'Use dispute and evidence upload if delivery terms are not met.',
        ],
      },
      {
        title: 'Instant Transfer',
        paragraphs: [
          'Use this when the exchange happens immediately and both parties complete the handoff at the same time.',
          'Scenario: You meet a seller in person to collect a chair. You inspect it on the spot, the seller hands it over immediately, and the escrow can move to completion right away.',
          'Instant Transfer supports Payment QR fast flow for speed: recipient shows Payment QR, sender scans, enters amount + optional reason, and confirms.',
          'Use Instant Transfer when:',
        ],
        bullets: ['There is no shipping delay.', 'The exchange is happening now.', 'Pickup and delivery happen immediately.', 'The transaction should not stay open for long.'],
      },
      {
        title: 'Payment QR (Instant Transfer)',
        paragraphs: [
          'This is the fastest in-person flow and is designed for scan → modal → done.',
        ],
        numbered: [
          'Recipient opens Profile and shows My Payment QR.',
          'Sender opens Deposit and taps the QR scan icon on Recipient field.',
          'Sender scans recipient Payment QR. Recipient details and transaction type are auto-set to Instant Transfer.',
          'Instant modal opens for sender to enter amount and optional reason (for dispute/reconciliation record).',
          'Sender taps Confirm. App creates escrow, starts Pi payment, and triggers automatic backend release for instant flow.',
        ],
        bullets: [
          'If sender cancels instant modal, scanner reopens immediately for fast retry.',
          'Reason is optional but recommended for better records.',
        ],
      },
      {
        title: 'Physical Product vs Instant Transfer',
        paragraphs: ['These two are not the same.'],
        bullets: [
          'Physical Product: the item is real, but delivery happens later.',
          'Instant Transfer: the item or value is handed over immediately.',
          'Simple rule: if you must wait for delivery, use Physical Product. If the exchange is happening now, use Instant Transfer.',
        ],
      },
      {
        title: 'Digital Product',
        paragraphs: ['Use this for digital goods such as software, domains, design files, game assets, and downloadable content.'],
      },
      {
        title: 'Service',
        paragraphs: ['Use this for work performed by a provider, such as freelance work, tutoring, consulting, editing, and design services.'],
      },
      {
        title: 'Trade Agreement',
        paragraphs: ['Use this when the agreement depends on an external exchange or external evidence. Use it only when both parties clearly understand the off-platform part of the deal.'],
      },
      {
        title: 'Donation, Custom Agreement, and Other',
        paragraphs: [
          'Donation is for voluntary support without a normal buyer-seller dispute structure.',
          'Custom Agreement is for unusual terms and requires a very clear reference and note.',
          'Use Other only if none of the available types fits.',
        ],
      },
    ],
  },
  {
    title: 'Completion Methods',
    paragraphs: ['Each transaction type maps to a completion method. This tells you how the escrow is expected to finish.'],
    bullets: ['Delivery Code', 'Manual Release', 'Service Approval', 'Receipt Evidence', 'Auto Release'],
  },
  {
    title: 'Milestones',
    paragraphs: ['Use milestones when one large escrow should be split into smaller deliverables.'],
    bullets: ['Milestone 1: Draft design - 20 Pi', 'Milestone 2: Final design - 30 Pi', 'The total of all milestones should match the full escrow amount.'],
  },
  {
    title: 'After Creating the Escrow',
    paragraphs: ['Once created, the escrow may move through several stages. Common statuses include:'],
    bullets: [
      'Deposit Pending: the escrow exists, but the funding is still being confirmed.',
      'Funds Held or Deposit Confirmed: the funds are secured in escrow.',
      'Delivery In Progress: the recipient is expected to fulfill the agreement.',
      'Release Requested or Release Pending: one side has asked for completion and is waiting for confirmation.',
      'Completed: funds have been released successfully.',
      'Refunded: the funds went back to the sender.',
      'Disputed: the transaction is under review.',
      'Deposit Failed: funding did not complete.',
      'Cancelled or Expired: the contract is no longer active.',
    ],
  },
  {
    title: 'How to Use Escrow Safely',
    subsections: [
      {
        title: 'If You Are the Sender',
        bullets: [
          'Confirm the recipient identity before creating escrow.',
          'Use the correct transaction type.',
          'Write a clear reference and note.',
          'Do not release funds before the agreement is fulfilled.',
          'For physical goods, confirm delivery before release.',
        ],
      },
      {
        title: 'If You Are the Recipient',
        bullets: [
          'Review the escrow details carefully.',
          'Confirm the amount, reference, and note match the agreement.',
          'Deliver exactly what was promised.',
          'Keep evidence of delivery, service completion, or handoff.',
          'Do not ask the sender to bypass escrow.',
        ],
      },
    ],
  },
  {
    title: 'Using Transaction History',
    paragraphs: ['The Transaction History screen helps you review all your escrows.'],
    bullets: ['All', 'Sent', 'Received', 'Active', 'Completed', 'Disputed', 'Refunded', 'Cancelled'],
  },
  {
    title: 'Notifications, Inbox, and Escrow Detail',
    paragraphs: [
      'Notifications help you stay updated when a deposit is confirmed, an escrow status changes, a release is requested, a dispute is opened, or support messages arrive.',
      'Use chat to confirm the deal before creating escrow and keep transaction context inside PMARTS when possible.',
      'Use Escrow Detail to review transaction type, role, reference ID, note, status guidance, and next action.',
    ],
  },
  {
    title: 'Disputes',
    paragraphs: ['Open a dispute when something goes wrong, such as non-delivery, misrepresentation, incomplete service, or unresponsive counterparties.'],
    numbered: [
      'Go to the Dispute screen or the escrow flow that leads to dispute.',
      'Provide the escrow ID if needed.',
      'Enter a reason.',
      'Write a short summary.',
      'Add a more detailed description if necessary.',
      'Upload evidence.',
      'Submit the dispute.',
    ],
    bullets: [
      'Good evidence includes screenshots, delivery records, chat proof, item-condition photos, incomplete-work files, and receipts or tracking proof.',
      'Avoid opening disputes for minor issues that can be solved directly first.',
    ],
  },
  {
    title: 'Support and Help',
    paragraphs: ['Available support paths include:'],
    bullets: [
      'Email support: support@pmarts.org',
      'General inquiries: info@pmarts.org',
      'Telegram: @pmarts_support',
      'Twitter: @pmarts_support',
      'Support tickets',
      'Virtual assistant',
      'FAQ section',
    ],
  },
  {
    title: 'Trust, Profile, Fees, and Time Expectations',
    paragraphs: [
      'Trust score is influenced by completed transactions, ratings and reputation signals, account age, and dispute history.',
      'Profile may include username, PMARTS ID, trust badge, verification state, escrow statistics, avatar, notification settings, and security settings.',
      'According to the in-app FAQ, PMARTS charges a 1% fee on successful transactions and no stated fee for creating escrows or refunds.',
      'Release timing can vary by transaction type and escrow flow; some transactions complete immediately, while others may require verification or admin/support review.',
    ],
  },
  {
    title: 'Common Mistakes to Avoid',
    bullets: [
      'Choosing the wrong transaction type.',
      'Using a vague reference ID.',
      'Leaving the note blank for a custom agreement.',
      'Releasing funds before verifying fulfillment.',
      'Taking important agreement details outside the app.',
      'Ignoring notifications.',
      'Opening a dispute without evidence.',
      'Sending Pi outside escrow for a transaction that should be protected.',
    ],
  },
  {
    title: 'Best Practices and Quick Examples',
    bullets: [
      'Agree on terms before creating escrow.',
      'Keep your note and reference specific.',
      'Use the correct transaction type.',
      'Save screenshots and delivery proof.',
      'Keep communication respectful and documented.',
      'Act quickly when the other side completes their obligation.',
      'Contact support early if something becomes unclear.',
      'Shipped phone → Physical Product',
      'Same-day pickup → Instant Transfer',
      'Logo design job → Service',
      'Domain transfer → Digital Product',
    ],
    paragraphs: [
      'Final rule: Use PMARTS to protect trust, not to replace clarity. The app works best when both parties clearly describe the agreement, use the right transaction type, and keep records inside the platform.',
    ],
  },
];

function renderSection(section: GuideSection) {
  return (
    <View key={section.title} style={styles.sectionCard}>
      <Text style={styles.sectionTitle}>{section.title}</Text>

      {section.paragraphs?.map((paragraph) => (
        <Text key={paragraph} style={styles.sectionBody}>{paragraph}</Text>
      ))}

      {section.numbered?.map((item, idx) => (
        <View key={`${section.title}-n-${idx}`} style={styles.row}>
          <Text style={styles.marker}>{idx + 1}.</Text>
          <Text style={styles.rowText}>{item}</Text>
        </View>
      ))}

      {section.bullets?.map((item) => (
        <View key={item} style={styles.row}>
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

            {sub.numbered?.map((item, idx) => (
              <View key={`${sub.title}-n-${idx}`} style={styles.row}>
                <Text style={styles.marker}>{idx + 1}.</Text>
                <Text style={styles.rowText}>{item}</Text>
              </View>
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

export default function AppGuideScreen({ navigation }: AppGuideScreenProps) {
  const [drawerVisible, setDrawerVisible] = useState(false);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton}>
          <Text style={styles.headerButtonText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>App Guide</Text>
        <TouchableOpacity onPress={() => setDrawerVisible(true)} style={styles.headerButton}>
          <Text style={styles.headerButtonText}>☰</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.heroCard}>
          <Text style={styles.heroKicker}>PMARTS Reader</Text>
          <Text style={styles.heroTitle}>PMARTS App Guide</Text>
          <Text style={styles.heroText}>
            This guide explains how to use the PMARTS mobile app from sign-in to escrow completion.
          </Text>
        </View>

        {GUIDE_SECTIONS.map(renderSection)}
      </ScrollView>

      <InfoDrawer
        visible={drawerVisible}
        onClose={() => setDrawerVisible(false)}
        currentRoute="AppGuide"
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
    backgroundColor: '#0F172A',
    borderRadius: BORDER_RADIUS.xl,
    padding: SPACING.xl,
    marginBottom: SPACING.lg,
  },
  heroKicker: {
    color: '#FACC15',
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
    color: '#CBD5E1',
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
    backgroundColor: '#F8FAFC',
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    borderColor: '#E2E8F0',
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
    color: COLORS.primary,
    fontWeight: '700',
  },
  rowText: {
    flex: 1,
    fontSize: FONT_SIZES.sm,
    color: COLORS.text,
    lineHeight: 20,
  },
});