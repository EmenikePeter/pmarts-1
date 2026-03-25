/**
 * PMARTS Delivery Code Display
 *
 * Shows the 6-digit delivery code and QR code to the SENDER.
 * The sender shares this code with the recipient/delivery person
 * ONLY AFTER receiving the item.
 *
 * Features:
 * - Large readable 6-digit code
 * - QR code for scanning
 * - Copy to clipboard
 * - Share functionality
 * - Expiration countdown
 * - Safety warnings
 *
 * @module DeliveryCodeDisplay
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Share,
  Alert,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';

// ============================================
// TYPES
// ============================================

interface DeliveryCodeDisplayProps {
  code: string;
  qrPayload?: string;
  expiresAt: string;
  escrowId: string;
  recipientName?: string;
  productTitle: string;
  onCodeVerified?: () => void;
}

// ============================================
// COMPONENT
// ============================================

export function DeliveryCodeDisplay({
  code,
  qrPayload,
  expiresAt,
  escrowId,
  recipientName,
  productTitle,
  onCodeVerified,
}: DeliveryCodeDisplayProps) {
  const [copied, setCopied] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<string>('');

  // Calculate time remaining
  useEffect(() => {
    const updateTimer = () => {
      const now = new Date();
      const expiry = new Date(expiresAt);
      const diff = expiry.getTime() - now.getTime();

      if (diff <= 0) {
        setTimeRemaining('EXPIRED');
        return;
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

      if (days > 0) {
        setTimeRemaining(`${days}d ${hours}h remaining`);
      } else if (hours > 0) {
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        setTimeRemaining(`${hours}h ${minutes}m remaining`);
      } else {
        const minutes = Math.floor(diff / (1000 * 60));
        setTimeRemaining(`${minutes}m remaining`);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 60000); // Update every minute
    return () => clearInterval(interval);
  }, [expiresAt]);

  // Format code for display (XXX-XXX)
  const formattedCode = useMemo(() => {
    if (!code || code.length !== 6) return code;
    return `${code.slice(0, 3)}-${code.slice(3)}`;
  }, [code]);

  // Copy code to clipboard
  const handleCopy = async () => {
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Share code via system share sheet
  const handleShare = async () => {
    try {
      await Share.share({
        message: `PMARTS Delivery Code: ${formattedCode}\n\nFor: ${productTitle}\n\n⚠️ IMPORTANT: Only share this code AFTER you receive and verify the item.`,
        title: 'PMARTS Delivery Code',
      });
    } catch (error) {
      try { const { debugError } = require('../lib/debugLogger'); debugError('Error sharing code', error); } catch (e) { /* fallback */ }
    }
  };

  // Show warning when tapping share
  const confirmShare = () => {
    Alert.alert(
      '⚠️ Before Sharing',
      'Only share this code AFTER you have:\n\n✅ Received the item\n✅ Verified it matches the description\n✅ Confirmed everything is correct\n\nOnce the recipient enters this code, the payment will be released.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'I Understand', onPress: handleShare },
      ]
    );
  };

  const isExpired = timeRemaining === 'EXPIRED';

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerIcon}>🔐</Text>
        <Text style={styles.headerTitle}>Delivery Code</Text>
      </View>

      {/* Product Info */}
      <View style={styles.productInfo}>
        <Text style={styles.productTitle}>{productTitle}</Text>
        {recipientName && (
          <Text style={styles.recipientName}>Recipient: {recipientName}</Text>
        )}
      </View>

      {/* Code Display */}
      <View style={[styles.codeContainer, isExpired && styles.codeExpired]}>
        {isExpired ? (
          <Text style={styles.expiredText}>CODE EXPIRED</Text>
        ) : (
          <Text style={styles.code}>{formattedCode}</Text>
        )}
      </View>

      {/* Expiration Timer */}
      <View style={[styles.timerContainer, isExpired && styles.timerExpired]}>
        <Text style={styles.timerIcon}>⏱️</Text>
        <Text style={[styles.timerText, isExpired && styles.timerTextExpired]}>
          {timeRemaining}
        </Text>
      </View>

      {/* QR Code */}
      {qrPayload && !isExpired && (
        <View style={styles.qrContainer}>
          <Text style={styles.qrLabel}>Or scan QR code:</Text>
          <View style={styles.qrWrapper}>
            <QRCode
              value={qrPayload}
              size={150}
              backgroundColor="#FFFFFF"
              color="#1A1A1A"
            />
          </View>
        </View>
      )}

      {/* Action Buttons */}
      {!isExpired && (
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.button, styles.copyButton]}
            onPress={handleCopy}
            activeOpacity={0.7}
          >
            <Text style={styles.copyButtonText}>
              {copied ? '✓ Copied!' : '📋 Copy Code'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.shareButton]}
            onPress={confirmShare}
            activeOpacity={0.7}
          >
            <Text style={styles.shareButtonText}>📤 Share</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Safety Warning */}
      <View style={styles.warning}>
        <Text style={styles.warningIcon}>⚠️</Text>
        <View style={styles.warningContent}>
          <Text style={styles.warningTitle}>IMPORTANT</Text>
          <Text style={styles.warningText}>
            Only share this code with the recipient or delivery person AFTER you
            have received and verified the item. Once verified, the payment
            will be released to the recipient.
          </Text>
        </View>
      </View>

      {/* Help Text */}
      <View style={styles.helpSection}>
        <Text style={styles.helpTitle}>How it works:</Text>
        <Text style={styles.helpItem}>1. Wait to receive your item</Text>
        <Text style={styles.helpItem}>2. Verify it matches the description</Text>
        <Text style={styles.helpItem}>3. Share this code with the recipient</Text>
        <Text style={styles.helpItem}>4. Recipient enters code to release payment</Text>
      </View>
    </View>
  );
}

// ============================================
// STYLES
// ============================================

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    margin: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
    boxShadow: '0 2px 8px rgba(0,0,0,0.10)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  headerIcon: {
    fontSize: 24,
    marginRight: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  productInfo: {
    alignItems: 'center',
    marginBottom: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  productTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333333',
    textAlign: 'center',
  },
  recipientName: {
    fontSize: 14,
    color: '#666666',
    marginTop: 4,
  },
  codeContainer: {
    backgroundColor: '#F8F8F8',
    borderRadius: 12,
    paddingVertical: 24,
    paddingHorizontal: 32,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#E8A838',
    borderStyle: 'dashed',
  },
  codeExpired: {
    borderColor: '#FF4444',
    backgroundColor: '#FFF0F0',
  },
  code: {
    fontSize: 42,
    fontWeight: '800',
    color: '#1A1A1A',
    letterSpacing: 8,
    fontFamily: 'monospace',
  },
  expiredText: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FF4444',
  },
  timerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: '#FFF9F0',
    borderRadius: 20,
    alignSelf: 'center',
  },
  timerExpired: {
    backgroundColor: '#FFF0F0',
  },
  timerIcon: {
    fontSize: 14,
    marginRight: 6,
  },
  timerText: {
    fontSize: 13,
    color: '#E8A838',
    fontWeight: '600',
  },
  timerTextExpired: {
    color: '#FF4444',
  },
  qrContainer: {
    alignItems: 'center',
    marginTop: 24,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
  },
  qrLabel: {
    fontSize: 14,
    color: '#666666',
    marginBottom: 12,
  },
  qrWrapper: {
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  actions: {
    flexDirection: 'row',
    marginTop: 20,
    gap: 12,
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  copyButton: {
    backgroundColor: '#F5F5F5',
  },
  copyButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333333',
  },
  shareButton: {
    backgroundColor: '#E8A838',
  },
  shareButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  warning: {
    flexDirection: 'row',
    backgroundColor: '#FFF3CD',
    borderRadius: 12,
    padding: 14,
    marginTop: 20,
  },
  warningIcon: {
    fontSize: 20,
    marginRight: 10,
  },
  warningContent: {
    flex: 1,
  },
  warningTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#856404',
    marginBottom: 4,
  },
  warningText: {
    fontSize: 12,
    color: '#856404',
    lineHeight: 18,
  },
  helpSection: {
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
  },
  helpTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333333',
    marginBottom: 8,
  },
  helpItem: {
    fontSize: 13,
    color: '#666666',
    marginBottom: 4,
    paddingLeft: 8,
  },
});

export default DeliveryCodeDisplay;

