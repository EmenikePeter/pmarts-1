/**
 * PaymentQRDisplay
 *
 * Shows the current user's personal payment QR code.
 * The RECIPIENT shows this screen; the SENDER scans it on the Create Escrow screen.
 *
 * QR payload format: { t: 'pmarts', v: '1', rid: '<pi_username_or_pi_id>' }
 */

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { COLORS, SPACING, FONT_SIZES, BORDER_RADIUS } from '../lib/theme';

interface PaymentQRDisplayProps {
  username?: string;
  piId?: string;
  pmartsId?: string;
  onClose: () => void;
}

export default function PaymentQRDisplay({
  username,
  piId,
  pmartsId,
  onClose,
}: PaymentQRDisplayProps) {
  const recipientId = username || piId || '';
  const qrPayload = JSON.stringify({ t: 'pmarts', v: '1', rid: recipientId });

  return (
    <View style={styles.overlay}>
      <View style={styles.card}>
        {/* Title */}
        <Text style={styles.title}>My Payment QR</Text>
        <Text style={styles.subtitle}>
          Show this to the sender — they scan it to pay you instantly
        </Text>

        {/* QR Code */}
        <View style={styles.qrWrapper}>
          {recipientId ? (
            <QRCode
              value={qrPayload}
              size={200}
              color={COLORS.primary}
              backgroundColor="#FFFFFF"
            />
          ) : (
            <View style={styles.noIdBox}>
              <Text style={styles.noIdText}>
                No Pi username set. Update your profile first.
              </Text>
            </View>
          )}
        </View>

        {/* Identity */}
        <View style={styles.identityBlock}>
          <Text style={styles.usernameText}>@{username || piId || '—'}</Text>
          {pmartsId ? (
            <Text style={styles.pmartsIdText}>PMARTS ID: {pmartsId}</Text>
          ) : null}
        </View>

        {/* Instructions */}
        <View style={styles.infoBox}>
          <Text style={styles.infoText}>
            📸 Sender opens "Create Escrow" → taps the scan icon next to the Recipient field → scans this QR.{'\n\n'}
            ⚡ Your username is filled in automatically and the type is set to Instant Transfer.
          </Text>
        </View>

        {/* Close */}
        <TouchableOpacity style={styles.closeButton} onPress={onClose} activeOpacity={0.8}>
          <Text style={styles.closeButtonText}>Close</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.xl,
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
  },
  title: {
    fontSize: FONT_SIZES.xl,
    fontWeight: '700',
    color: COLORS.primary,
    marginBottom: SPACING.xs,
  },
  subtitle: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginBottom: SPACING.lg,
  },
  qrWrapper: {
    padding: SPACING.md,
    backgroundColor: '#FFFFFF',
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 2,
    borderColor: COLORS.primary,
    marginBottom: SPACING.md,
  },
  noIdBox: {
    width: 200,
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: BORDER_RADIUS.sm,
  },
  noIdText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
    textAlign: 'center',
    paddingHorizontal: SPACING.sm,
  },
  identityBlock: {
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  usernameText: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '700',
    color: COLORS.text,
  },
  pmartsIdText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  infoBox: {
    backgroundColor: '#F0F9FF',
    borderRadius: BORDER_RADIUS.sm,
    padding: SPACING.md,
    marginBottom: SPACING.lg,
    width: '100%',
  },
  infoText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text,
    lineHeight: 20,
  },
  closeButton: {
    backgroundColor: COLORS.primary,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.xxl,
    width: '100%',
    alignItems: 'center',
  },
  closeButtonText: {
    color: '#FFFFFF',
    fontSize: FONT_SIZES.md,
    fontWeight: '700',
  },
});
