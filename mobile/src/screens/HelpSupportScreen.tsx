/**
 * Help & Support Screen
 * 
 * FAQ and support contact options
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
  TextInput,
} from 'react-native';
import { Modal } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../lib/types';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES, HEADER_TITLE_TEXT } from '../lib/theme';
import { API_URL } from '../lib/api';
import { supabase } from '../lib/supabase';
import { debugWarn } from '../lib/debugLogger';
import { useToast } from '../components/Toast';
import InfoDrawer from '../components/InfoDrawer';

type HelpSupportScreenProps = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'HelpSupport'>;
};

interface FAQItem {
  question: string;
  answer: string;
}

const FAQ_ITEMS: FAQItem[] = [
  {
    question: 'What is PMARTS?',
    answer: 'PMARTS (Pi Marketplace Trust System) is a secure escrow service for Pi Network transactions. It protects both senders and recipients by holding Pi in escrow until the transaction is completed successfully.',
  },
  {
    question: 'How does escrow work?',
    answer: '1. Sender creates an escrow with the agreed Pi amount\n2. Pi is held securely in escrow\n3. Recipient delivers the goods/services\n4. Sender confirms receipt and releases the payment\n5. Recipient receives the Pi',
  },
  {
    question: 'What are the fees?',
    answer: 'PMARTS charges a 1% fee on successful transactions. This fee is deducted from the final amount when the escrow is released. There are no fees for creating escrows or refunds.',
  },
  {
    question: 'How do I dispute a transaction?',
    answer: 'If there\'s an issue with your transaction, tap on the escrow and select "Open Dispute." Provide evidence and describe the problem. Our team will review the case within 24-48 hours.',
  },
  {
    question: 'How is my trust score calculated?',
    answer: 'Your trust score is based on:\n• Completed transactions\n• Ratings from other users\n• Account age\n• Dispute history\n\nMaintaining a high trust score helps build credibility.',
  },
  {
    question: 'Is my Pi safe?',
    answer: 'Yes! All Pi held in escrow is secured by Pi Network\'s blockchain. Funds can only be released when the sender confirms or through our dispute resolution process.',
  },
  {
    question: 'How long do I have to release payment?',
    answer: 'Release timing depends on the transaction type and escrow flow. Some escrows can be released immediately, while others require additional verification or admin/support review before completion.',
  },
];

export default function HelpSupportScreen({ navigation }: HelpSupportScreenProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [tickets, setTickets] = useState<any[]>([]);
  const toast = useToast();

  useEffect(() => {
    loadTickets();
  }, []);

  const loadTickets = async () => {
    try {
      const sess = await supabase.auth.getSession();
      const token = sess?.data?.session?.access_token;
      if (!token) return;
      const resp = await fetch(`${API_URL}/api/support/tickets`, { headers: { Authorization: `Bearer ${token}` } });
      if (!resp.ok) return;
      const body = await resp.json();
      setTickets(body.tickets || body.tickets || []);
    } catch (e) {
      debugWarn('Failed to load tickets', e);
    }
  };

  const createTicket = async () => {
    if (!title || !message) return toast.push({ type: 'warn', message: 'Please enter title and message' });
    try {
      const sess = await supabase.auth.getSession();
      const token = sess?.data?.session?.access_token;
      if (!token) return toast.push({ type: 'error', message: 'Not signed in' });

      const resp = await fetch(`${API_URL}/api/support/tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title, body: message }),
      });
      if (!resp.ok) {
        const b = await resp.json().catch(() => ({}));
        throw new Error(b?.error || 'Failed');
      }
      const res = await resp.json();
      toast.push({ type: 'success', message: 'Ticket created' });
      setShowCreateModal(false);
      setTitle('');
      setMessage('');
      // navigate to the chat for the created ticket if returned
      const newTicket = res?.ticket || res?.data || null;
      if (newTicket && newTicket.id) {
        navigation.navigate('SupportChat', { ticketId: newTicket.id, title: newTicket.title || 'Support' });
        return;
      }
      loadTickets();
    } catch (e) {
      debugWarn('Create ticket failed', e);
      toast.push({ type: 'error', message: 'Failed to create ticket' });
    }
  };

  // Create Ticket Modal UI handled via showCreateModal, title, message

  const handleContactEmail = () => {
    Linking.openURL('mailto:support@pmarts.org?subject=PMARTS Support Request');
  };

  const handleTelegram = () => {
    Linking.openURL('https://t.me/pmarts_support');
  };

  const handleTwitter = () => {
    Linking.openURL('https://x.com/pmarts_support');
  };

  const handleVirtualAssistant = () => {
    navigation.navigate('VirtualAssistant');
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Help & Support</Text>
        <TouchableOpacity onPress={() => setDrawerVisible(true)} style={styles.menuButton}>
          <Text style={styles.menuIcon}>☰</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.scrollContent}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Guides & Policies</Text>

          <TouchableOpacity style={styles.guideRow} onPress={() => navigation.navigate('AppGuide')}>
            <Text style={styles.contactIcon}>📘</Text>
            <View style={styles.contactTextContainer}>
              <Text style={styles.contactTitle}>Read the PMARTS App Guide</Text>
              <Text style={styles.contactDescription}>How deposits, escrow, release flow, disputes, and support work</Text>
            </View>
            <Text style={styles.contactArrow}>→</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.guideRow} onPress={() => navigation.navigate('CommunityGuidelines')}>
            <Text style={styles.contactIcon}>🤝</Text>
            <View style={styles.contactTextContainer}>
              <Text style={styles.contactTitle}>Read the Community Guidelines</Text>
              <Text style={styles.contactDescription}>Safe trading rules, communication standards, and evidence expectations</Text>
            </View>
            <Text style={styles.contactArrow}>→</Text>
          </TouchableOpacity>
        </View>

        {/* Contact Options */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Contact Us</Text>
          
          <TouchableOpacity style={styles.contactRow} onPress={handleContactEmail}>
            <Text style={styles.contactIcon}>📧</Text>
            <View style={styles.contactTextContainer}>
              <Text style={styles.contactTitle}>Email Support</Text>
              <Text style={styles.contactDescription}>support@pmarts.org</Text>
            </View>
            <Text style={styles.contactArrow}>→</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.contactRow} onPress={() => Linking.openURL('mailto:info@pmarts.org?subject=PMARTS Inquiry')}>
            <Text style={styles.contactIcon}>✉️</Text>
            <View style={styles.contactTextContainer}>
              <Text style={styles.contactTitle}>General Inquiries</Text>
              <Text style={styles.contactDescription}>info@pmarts.org</Text>
            </View>
            <Text style={styles.contactArrow}>→</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.contactRow} onPress={handleTelegram}>
            <Text style={styles.contactIcon}>💬</Text>
            <View style={styles.contactTextContainer}>
              <Text style={styles.contactTitle}>Telegram</Text>
              <Text style={styles.contactDescription}>@pmarts_support</Text>
            </View>
            <Text style={styles.contactArrow}>→</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.contactRow} onPress={() => setShowCreateModal(true)}>
            <Text style={styles.contactIcon}>🎫</Text>
            <View style={styles.contactTextContainer}>
              <Text style={styles.contactTitle}>Create Support Ticket</Text>
              <Text style={styles.contactDescription}>Open a ticket with our support team</Text>
            </View>
            <Text style={styles.contactArrow}>→</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.contactRow} onPress={handleVirtualAssistant}>
            <Text style={styles.contactIcon}>🤖</Text>
            <View style={styles.contactTextContainer}>
              <Text style={styles.contactTitle}>Virtual Assistant</Text>
              <Text style={styles.contactDescription}>Quick help from our assistant</Text>
            </View>
            <Text style={styles.contactArrow}>→</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.contactRow} onPress={handleTwitter}>
            <Text style={styles.contactIcon}>🐦</Text>
            <View style={styles.contactTextContainer}>
              <Text style={styles.contactTitle}>Twitter</Text>
              <Text style={styles.contactDescription}>@pmarts_support</Text>
            </View>
            <Text style={styles.contactArrow}>→</Text>
          </TouchableOpacity>
        </View>

        {/* FAQ Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Frequently Asked Questions</Text>
          
          {FAQ_ITEMS.map((item, index) => (
            <TouchableOpacity
              key={index}
              style={styles.faqItem}
              onPress={() => setExpandedIndex(expandedIndex === index ? null : index)}
              activeOpacity={0.7}
            >
              <View style={styles.faqHeader}>
                <Text style={styles.faqQuestion}>{item.question}</Text>
                <Text style={styles.faqToggle}>
                  {expandedIndex === index ? '−' : '+'}
                </Text>
              </View>
              {expandedIndex === index && (
                <Text style={styles.faqAnswer}>{item.answer}</Text>
              )}
            </TouchableOpacity>
          ))}
        </View>

        {/* Tickets Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>My Tickets</Text>
          {tickets.length === 0 ? (
            <Text style={{ color: COLORS.textMuted, textAlign: 'center' }}>No tickets yet — create one and our team will respond.</Text>
          ) : (
            tickets.map((t) => (
              <TouchableOpacity key={t.id} style={styles.ticketRow} onPress={() => navigation.navigate('SupportChat', { ticketId: t.id, title: t.title })}>
                <Text style={styles.ticketTitle}>{t.title}</Text>
                <Text style={styles.ticketMeta}>{t.status} · {new Date(t.created_at).toLocaleString()}</Text>
              </TouchableOpacity>
            ))
          )}
        </View>

        {/* Create Ticket Modal */}
        <Modal visible={showCreateModal} animationType="slide" transparent onRequestClose={() => setShowCreateModal(false)}>
          <View style={modalStyles.overlay}>
            <View style={modalStyles.modal}>
              <Text style={modalStyles.modalTitle}>Create Support Ticket</Text>
              <TextInput
                placeholder="Title"
                value={title}
                onChangeText={setTitle}
                style={modalStyles.input}
                placeholderTextColor={COLORS.muted}
              />
              <TextInput
                placeholder="Message"
                value={message}
                onChangeText={setMessage}
                style={[modalStyles.input, { height: 120 }]}
                multiline
                placeholderTextColor={COLORS.muted}
              />
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8 }}>
                <TouchableOpacity onPress={() => setShowCreateModal(false)} style={{ marginRight: 12 }}>
                  <Text style={{ color: COLORS.muted }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={createTicket}>
                  <Text style={{ color: COLORS.primary, fontWeight: '600' }}>Create</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Response Time */}
        <View style={styles.infoCard}>
          <Text style={styles.infoIcon}>⏱️</Text>
          <Text style={styles.infoTitle}>Response Time</Text>
          <Text style={styles.infoText}>
            We typically respond within 24 hours. For urgent issues, please use Telegram.
          </Text>
        </View>
      </ScrollView>

      <InfoDrawer
        visible={drawerVisible}
        onClose={() => setDrawerVisible(false)}
        currentRoute="HelpSupport"
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
  content: {
    flex: 1,
  },
  scrollContent: {
    padding: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
  section: {
    backgroundColor: COLORS.background,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.lg,
  },
  sectionTitle: {
    fontSize: FONT_SIZES.md,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: SPACING.md,
    paddingBottom: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  guideRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: '#F3D58A',
  },
  contactIcon: {
    fontSize: 28,
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
  contactDescription: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  contactArrow: {
    fontSize: FONT_SIZES.lg,
    color: COLORS.muted,
  },
  faqItem: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingVertical: SPACING.md,
  },
  faqHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  faqQuestion: {
    flex: 1,
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    color: COLORS.text,
    paddingRight: SPACING.md,
  },
  faqToggle: {
    fontSize: 24,
    fontWeight: '600',
    color: COLORS.primary,
    width: 30,
    textAlign: 'center',
  },
  faqAnswer: {
    marginTop: SPACING.sm,
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
    lineHeight: 22,
  },
  infoCard: {
    backgroundColor: COLORS.primary + '10',
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    alignItems: 'center',
  },
  infoIcon: {
    fontSize: 40,
    marginBottom: SPACING.sm,
  },
  infoTitle: {
    fontSize: FONT_SIZES.md,
    fontWeight: '700',
    color: COLORS.primary,
    marginBottom: SPACING.xs,
  },
  infoText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  ticketRow: {
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  ticketTitle: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    color: COLORS.text,
  },
  ticketMeta: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
    marginTop: 4,
  },
});

const modalStyles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  modal: {
    width: '100%',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 16,
  },
  modalTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '700',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    padding: 10,
    marginTop: 8,
    backgroundColor: '#fff',
  },
});

