/**
 * PMARTS Code Entry Screen
 *
 * Allows RECIPIENT to enter the 6-digit delivery code or scan QR.
 * On successful verification, payment is released automatically.
 *
 * Features:
 * - 6-digit code input with auto-focus
 * - QR code scanner option
 * - Attempt counter
 * - Error handling
 * - Success animation
 *
 * @module CodeEntryScreen
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Vibration,
  Keyboard,
} from 'react-native';
import { useToast } from './Toast';
import { CameraView, useCameraPermissions } from 'expo-camera';

// ============================================
// TYPES
// ============================================

interface CodeEntryScreenProps {
  escrowId: string;
  senderName?: string;
  productTitle: string;
  amountPi: number;
  maxAttempts?: number;
  attemptsUsed?: number;
  onVerify: (code: string) => Promise<{ success: boolean; message?: string }>;
  onVerifyQR: (payload: string) => Promise<{ success: boolean; message?: string }>;
  onSuccess: () => void;
  onCancel: () => void;
}

type ViewMode = 'code' | 'scanner';

// ============================================
// COMPONENT
// ============================================

export function CodeEntryScreen({
  escrowId,
  senderName,
  productTitle,
  amountPi,
  maxAttempts = 5,
  attemptsUsed = 0,
  onVerify,
  onVerifyQR,
  onSuccess,
  onCancel,
}: CodeEntryScreenProps) {
  const [code, setCode] = useState<string[]>(['', '', '', '', '', '']);
  const [viewMode, setViewMode] = useState<ViewMode>('code');
  const [loading, setLoading] = useState(false);
  const [attempts, setAttempts] = useState(attemptsUsed);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [scanned, setScanned] = useState(false);

  const toast = useToast();

  const inputRefs = useRef<(TextInput | null)[]>([]);
  const [permission, requestPermission] = useCameraPermissions();

  // Focus first input on mount
  useEffect(() => {
    if (viewMode === 'code') {
      setTimeout(() => {
        inputRefs.current[0]?.focus();
      }, 300);
    }
  }, [viewMode]);

  // Handle code input
  const handleCodeChange = (value: string, index: number) => {
    if (!/^\d*$/.test(value)) return; // Only allow digits

    const newCode = [...code];
    newCode[index] = value.slice(-1); // Take only last character
    setCode(newCode);
    setError(null);

    // Auto-focus next input
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all digits entered
    if (newCode.every((d) => d !== '') && value) {
      Keyboard.dismiss();
      handleSubmit(newCode.join(''));
    }
  };

  // Handle backspace
  const handleKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  // Submit code for verification
  const handleSubmit = async (fullCode?: string) => {
    const codeToVerify = fullCode || code.join('');

    if (codeToVerify.length !== 6) {
      setError('Please enter all 6 digits');
      return;
    }

    if (attempts >= maxAttempts) {
      setError('Maximum attempts reached. Contact support.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await onVerify(codeToVerify);

      if (result.success) {
        Vibration.vibrate([0, 100, 50, 100]); // Success vibration
        setSuccess(true);
        setTimeout(onSuccess, 1500);
      } else {
        Vibration.vibrate(300); // Error vibration
        setAttempts((prev) => prev + 1);
        setError(result.message || 'Invalid code. Please try again.');
        setCode(['', '', '', '', '', '']);
        setTimeout(() => inputRefs.current[0]?.focus(), 100);
      }
    } catch (err: any) {
      setError(err.message || 'Verification failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Handle QR code scan
  const handleBarCodeScanned = async ({ data }: { data: string }) => {
    if (scanned || loading) return;
    setScanned(true);
    setLoading(true);

    try {
      const result = await onVerifyQR(data);

      if (result.success) {
        Vibration.vibrate([0, 100, 50, 100]);
        setSuccess(true);
        setTimeout(onSuccess, 1500);
      } else {
        Vibration.vibrate(300);
        setError(result.message || 'Invalid QR code');
        setTimeout(() => setScanned(false), 2000);
      }
    } catch (err: any) {
      setError(err.message || 'QR verification failed');
      setTimeout(() => setScanned(false), 2000);
    } finally {
      setLoading(false);
    }
  };

  // Request camera permission
  const handleScannerMode = async () => {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        try { toast.push({ type: 'error', message: 'Camera access is required to scan QR codes.' }); } catch(e) {}
        return;
      }
    }
    setViewMode('scanner');
  };

  const remainingAttempts = maxAttempts - attempts;
  const isLocked = remainingAttempts <= 0;

  // Success state
  if (success) {
    return (
      <View style={styles.container}>
        <View style={styles.successContainer}>
          <Text style={styles.successIcon}>✅</Text>
          <Text style={styles.successTitle}>Code Verified!</Text>
          <Text style={styles.successText}>
            Payment of {amountPi} π is being released to you.
          </Text>
        </View>
      </View>
    );
  }

  // Locked state
  if (isLocked) {
    return (
      <View style={styles.container}>
        <View style={styles.lockedContainer}>
          <Text style={styles.lockedIcon}>🔒</Text>
          <Text style={styles.lockedTitle}>Too Many Attempts</Text>
          <Text style={styles.lockedText}>
            This escrow has been locked due to too many failed verification
            attempts. Please contact the sender or support.
          </Text>
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={onCancel}
            activeOpacity={0.7}
          >
            <Text style={styles.cancelButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // QR Scanner view
  if (viewMode === 'scanner') {
    return (
      <View style={styles.container}>
        <View style={styles.scannerHeader}>
          <TouchableOpacity
            onPress={() => setViewMode('code')}
            style={styles.backButton}
          >
            <Text style={styles.backButtonText}>← Enter Code</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.scannerContainer}>
          <CameraView
            style={styles.camera}
            barcodeScannerSettings={{
              barcodeTypes: ['qr'],
            }}
            onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
          />
          <View style={styles.scannerOverlay}>
            <View style={styles.scannerFrame} />
          </View>
        </View>

        <View style={styles.scannerFooter}>
          <Text style={styles.scannerText}>
            Point camera at the sender's QR code
          </Text>
          {loading && (
            <ActivityIndicator size="large" color="#E8A838" style={{ marginTop: 16 }} />
          )}
          {error && <Text style={styles.errorText}>{error}</Text>}
        </View>
      </View>
    );
  }

  // Code entry view
  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerIcon}>🔑</Text>
        <Text style={styles.headerTitle}>Enter Delivery Code</Text>
      </View>

      {/* Transaction Info */}
      <View style={styles.infoContainer}>
        <Text style={styles.productTitle}>{productTitle}</Text>
        {senderName && <Text style={styles.senderName}>Sender: {senderName}</Text>}
        <Text style={styles.amount}>{amountPi} π</Text>
      </View>

      {/* Code Input */}
      <View style={styles.codeInputContainer}>
        <Text style={styles.inputLabel}>Enter the 6-digit code from sender:</Text>
        <View style={styles.codeInputRow}>
          {code.map((digit, index) => (
            <TextInput
              key={index}
              ref={(ref) => {
                inputRefs.current[index] = ref;
              }}
              style={[
                styles.codeInput,
                digit && styles.codeInputFilled,
                error && styles.codeInputError,
              ]}
              value={digit}
              onChangeText={(value) => handleCodeChange(value, index)}
              onKeyPress={(e) => handleKeyPress(e, index)}
              keyboardType="number-pad"
              maxLength={1}
              editable={!loading}
              selectTextOnFocus
            />
          ))}
        </View>
      </View>

      {/* Error Message */}
      {error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Attempts Counter */}
      <View style={styles.attemptsContainer}>
        <Text style={styles.attemptsText}>
          {remainingAttempts} attempt{remainingAttempts !== 1 ? 's' : ''} remaining
        </Text>
      </View>

      {/* Submit Button */}
      <TouchableOpacity
        style={[
          styles.submitButton,
          (loading || code.some((d) => !d)) && styles.submitButtonDisabled,
        ]}
        onPress={() => handleSubmit()}
        disabled={loading || code.some((d) => !d)}
        activeOpacity={0.7}
      >
        {loading ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.submitButtonText}>Verify Code</Text>
        )}
      </TouchableOpacity>

      {/* QR Scanner Option */}
      <TouchableOpacity
        style={styles.scanButton}
        onPress={handleScannerMode}
        activeOpacity={0.7}
      >
        <Text style={styles.scanButtonText}>📷 Scan QR Code Instead</Text>
      </TouchableOpacity>

      {/* Cancel */}
      <TouchableOpacity
        style={styles.cancelLink}
        onPress={onCancel}
        activeOpacity={0.7}
      >
        <Text style={styles.cancelLinkText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );
}

// ============================================
// STYLES
// ============================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F8F8',
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 40,
    marginBottom: 24,
  },
  headerIcon: {
    fontSize: 28,
    marginRight: 10,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  infoContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 32,
  },
  productTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333333',
    textAlign: 'center',
  },
  senderName: {
    fontSize: 14,
    color: '#666666',
    marginTop: 4,
  },
  amount: {
    fontSize: 24,
    fontWeight: '700',
    color: '#E8A838',
    marginTop: 8,
  },
  codeInputContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    color: '#666666',
    marginBottom: 16,
  },
  codeInputRow: {
    flexDirection: 'row',
    gap: 8,
  },
  codeInput: {
    width: 48,
    height: 60,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#E5E5E5',
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    color: '#1A1A1A',
  },
  codeInputFilled: {
    borderColor: '#E8A838',
    backgroundColor: '#FFF9F0',
  },
  codeInputError: {
    borderColor: '#FF4444',
    backgroundColor: '#FFF0F0',
  },
  errorContainer: {
    backgroundColor: '#FFF0F0',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  errorText: {
    color: '#FF4444',
    fontSize: 14,
    textAlign: 'center',
  },
  attemptsContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  attemptsText: {
    fontSize: 13,
    color: '#888888',
  },
  submitButton: {
    backgroundColor: '#E8A838',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 16,
  },
  submitButtonDisabled: {
    backgroundColor: '#CCCCCC',
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  scanButton: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E5E5',
    marginBottom: 24,
  },
  scanButtonText: {
    color: '#333333',
    fontSize: 15,
    fontWeight: '600',
  },
  cancelLink: {
    alignItems: 'center',
  },
  cancelLinkText: {
    color: '#666666',
    fontSize: 14,
  },
  // Scanner styles
  scannerHeader: {
    paddingTop: 40,
    paddingBottom: 16,
  },
  backButton: {
    paddingVertical: 8,
  },
  backButtonText: {
    fontSize: 16,
    color: '#E8A838',
    fontWeight: '600',
  },
  scannerContainer: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
  },
  camera: {
    flex: 1,
  },
  scannerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scannerFrame: {
    width: 250,
    height: 250,
    borderWidth: 2,
    borderColor: '#E8A838',
    borderRadius: 16,
  },
  scannerFooter: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  scannerText: {
    fontSize: 15,
    color: '#666666',
  },
  // Success styles
  successContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successIcon: {
    fontSize: 64,
    marginBottom: 24,
  },
  successTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 12,
  },
  successText: {
    fontSize: 16,
    color: '#666666',
    textAlign: 'center',
  },
  // Locked styles
  lockedContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  lockedIcon: {
    fontSize: 64,
    marginBottom: 24,
  },
  lockedTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FF4444',
    marginBottom: 12,
  },
  lockedText: {
    fontSize: 15,
    color: '#666666',
    textAlign: 'center',
    lineHeight: 22,
  },
  cancelButton: {
    marginTop: 32,
    paddingVertical: 14,
    paddingHorizontal: 32,
    backgroundColor: '#F5F5F5',
    borderRadius: 10,
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333333',
  },
});

export default CodeEntryScreen;

