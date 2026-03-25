/**
 * PMARTS "Continue with Pi" Button
 *
 * A reusable authentication button that:
 * - Shows Pi branding
 * - Handles auth flow automatically
 * - Shows loading/error states
 * - Detects Pi Browser for seamless login
 *
 * @module PiLoginButton
 */

import React, { useState } from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  View,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { usePiAuth } from '../context/PiAuthContext';

// ============================================
// TYPES
// ============================================

interface PiLoginButtonProps {
  onSuccess?: (user: any) => void;
  onError?: (error: string) => void;
  title?: string;
  style?: object;
  disabled?: boolean;
}

// ============================================
// COMPONENT
// ============================================

export function PiLoginButton({
  onSuccess,
  onError,
  title,
  style,
  disabled = false,
}: PiLoginButtonProps) {
  const { login, isLoading, isInPiBrowser, error } = usePiAuth();
  const [localLoading, setLocalLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handlePress = async () => {
    if (localLoading || isLoading || disabled) return;

    try {
      setLocalLoading(true);
      setLocalError(null);

      const result = await login();

      if (result.success && result.user) {
        onSuccess?.(result.user);
      } else {
        const errorMsg = result.error || 'Login failed';
        setLocalError(errorMsg);
        onError?.(errorMsg);
      }
    } catch (err: any) {
      const errorMsg = err.message || 'Login error';
      setLocalError(errorMsg);
      onError?.(errorMsg);
    } finally {
      setLocalLoading(false);
    }
  };

  const buttonText = title || (isInPiBrowser ? 'Continue with Pi' : 'Connect Pi Wallet');
  const showLoading = localLoading || isLoading;
  const displayError = localError || error;

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={[
          styles.button,
          disabled && styles.buttonDisabled,
          style,
        ]}
        onPress={handlePress}
        disabled={disabled || showLoading}
        activeOpacity={0.8}
      >
        {showLoading ? (
          <ActivityIndicator color="#FFFFFF" size="small" />
        ) : (
          <>
            {/* Pi Logo */}
            <View style={styles.logoContainer}>
              <Text style={styles.piSymbol}>π</Text>
            </View>

            <Text style={styles.buttonText}>{buttonText}</Text>
          </>
        )}
      </TouchableOpacity>

      {/* Error message */}
      {displayError && !showLoading && (
        <Text style={styles.errorText}>{displayError}</Text>
      )}

      {/* Pi Browser hint */}
      {!isInPiBrowser && !showLoading && (
        <Text style={styles.hintText}>
          For the best experience, open in Pi Browser
        </Text>
      )}
    </View>
  );
}

// ============================================
// STYLES
// ============================================

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    width: '100%',
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E8A838', // Pi Network gold
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 32,
    width: '100%',
    maxWidth: 320,
    ...Platform.select({
      web: {
        boxShadow: '0 4px 8px rgba(232,168,56,0.20)'
      },
      ios: {
        shadowColor: '#E8A838',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  buttonDisabled: {
    backgroundColor: '#B8892C',
    opacity: 0.7,
  },
  logoContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  piSymbol: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  buttonText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  errorText: {
    marginTop: 12,
    fontSize: 14,
    color: '#E74C3C',
    textAlign: 'center',
  },
  hintText: {
    marginTop: 12,
    fontSize: 12,
    color: '#888888',
    textAlign: 'center',
  },
});

export default PiLoginButton;

