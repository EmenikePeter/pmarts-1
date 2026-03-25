import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  TextInput, 
  StyleSheet, 
  KeyboardAvoidingView, 
  Platform, 
  ActivityIndicator,
  TouchableOpacity,
  Animated,
  Linking,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button } from '../components';
import { supabase } from '../lib/supabase';
import { API_URL } from '../lib/api';
import piSDKService, { PiUser } from '../services/PiSDKService';
import { debugLog, debugError } from '../lib/debugLogger';
import { RootStackParamList, User } from '../lib/types';
import { LEGAL_URLS } from '../lib/legal';
import { getAppSessionToken, saveAppSession } from '../lib/appSession';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../lib/theme';

type LoginScreenProps = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Login'>;
};

export default function LoginScreen({navigation}: LoginScreenProps) {
  // State
  const [piId, setPiId] = useState('');
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState('');
  const [isPiBrowser, setIsPiBrowser] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const [isDebugMode, setIsDebugMode] = useState(false);

  // Animation
  const fadeAnim = useState(new Animated.Value(0))[0];
  const slideAnim = useState(new Animated.Value(30))[0];

  // Initialize on mount
  useEffect(() => {
    initializeApp();
  }, []);

  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.location?.search?.includes('debug=1')) setIsDebugMode(true);
    } catch (e) {}
  }, []);

  // Animate content in
  useEffect(() => {
    if (!initializing) {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 400,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [initializing]);


  /**
   * Initialize app and detect Pi Browser
   */
  const initializeApp = async () => {
    try {
      let inPiBrowser = false;

      if (Platform.OS === 'web') {
        const initialized = await piSDKService.initialize();
        setSdkReady(initialized);
        inPiBrowser = piSDKService.isRunningInPiBrowser();
      } else {
        inPiBrowser = piSDKService.isRunningInPiBrowser();
      }

      setIsPiBrowser(inPiBrowser);

      // Attempt session restore so browser refresh keeps user logged in
      try {
        const storedToken = await getAppSessionToken();
        if (storedToken) {
          const verifyResp = await fetch(`${API_URL}/api/auth/verify-token`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${storedToken}`,
            },
            body: JSON.stringify({ token: storedToken }),
          });

          const verifyPayload = await verifyResp.json().catch(() => null);
          if (verifyResp.ok && verifyPayload?.success && verifyPayload?.user) {
            try {
              await supabase.auth.setSession({ access_token: storedToken, refresh_token: '' });
            } catch (e) {
              // non-fatal for custom app session
            }

            const u = verifyPayload.user || {};
            const restoredUser: User = {
              id: u.id,
              pi_id: u.pi_id || u.pi_uid || '',
              username: u.username,
              pmarts_id: u.pmarts_id || null,
              balance: Number(u.balance ?? 0),
              trust_score: Number(u.trust_score ?? u.trustScore ?? 0),
              total_escrows: Number(u.total_escrows ?? 0),
              completed_escrows: Number(u.completed_escrows ?? 0),
              disputes: Number(u.disputes ?? 0),
              created_at: u.created_at || new Date().toISOString(),
            };

            navigation.replace('Home', { user: restoredUser });
            return;
          }
        }
      } catch (restoreErr) {
        debugError('Session restore failed', restoreErr);
      }
    } catch (err) {
      debugError('Initialization error:', err);
    } finally {
      setInitializing(false);
    }
  };

  /**
   * Handle "Continue with Pi" button press
   * Shows Pi Network's official login popup
   */
  const handlePiLogin = async () => {
    setLoading(true);
    setError('');

    try {
      if (!sdkReady && Platform.OS === 'web') {
        const initialized = await piSDKService.initialize();
        setSdkReady(initialized);
        setIsPiBrowser(piSDKService.isRunningInPiBrowser());
      }

      if (!piSDKService.isRunningInPiBrowser()) {
        setError('Pi Browser required for real authentication');
        setLoading(false);
        return;
      }

      const authResult = await piSDKService.authenticate();

      if (!authResult?.success || !authResult.user) {
        setError(authResult?.error || 'Authentication cancelled');
        setLoading(false);
        return;
      }

      // Login to app with Pi user
      await loginWithPiUser(authResult.user);
    } catch (err: any) {
      debugError('Pi login error:', err);
      setError(err.message || 'Authentication failed');
      setLoading(false);
    }
  };

  /**
   * Login with Pi user data
   * Creates or updates user in database
   */
  const applyServerSession = async (payload: any) => {
    try {
      if (!payload?.supabaseToken) return;
      await saveAppSession(payload.supabaseToken, payload.user || null);
      await supabase.auth.setSession({
        access_token: payload.supabaseToken,
        refresh_token: payload.refreshToken || '',
      });
    } catch (e) {
      debugError('Failed to apply Supabase session from server payload', e);
    }
  };

  const loginWithPiUser = async (piUser: PiUser) => {
    try {
      // Delegate user creation/verification to server-side API to avoid RLS issues
      const resp = await fetch(`${API_URL}/api/auth/verify`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          piUid: piUser.uid,
          username: piUser.username,
          accessToken: piUser.accessToken,
          walletAddress: piUser.walletAddress || null,
          deviceInfo: {platform: 'web', isInPiBrowser: false},
        }),
      });

      if (!resp.ok) {
        debugError('Server verify failed', await resp.text());
        if (__DEV__ || isDebugMode) {
          const mockUser = createMockUser(piUser.uid, piUser.username);
          navigation.replace('Home', {user: mockUser});
          return;
        }
        setError('Unable to verify account. Please try again.');
        return;
      }

      const payload = await resp.json();
  await applyServerSession(payload);
      const user = payload.user;
      navigation.replace('Home', {user: user as User});
    } catch (err) {
      debugError('Login error:', err);
      if (__DEV__ || isDebugMode) {
        const mockUser = createMockUser(piUser.uid, piUser.username);
        navigation.replace('Home', { user: mockUser });
      } else {
        setError('Authentication failed. Please try again.');
      }
    }
  };

  /**
   * Dev mode login (when not in Pi Browser)
   */
  const handleDevLogin = async () => {
    const trimmedId = piId.trim();
    
    if (!trimmedId) {
      setError('Please enter your Pi ID');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Check for existing user
      let { data: user } = await supabase
        .from('users')
        .select('*')
        .or(`pi_id.eq.${trimmedId},username.eq.${trimmedId}`)
        .maybeSingle();

      if (!user) {
        // Ask server to create a dev user (server will accept MOCK_VALID/dev-token in dev)
        try {
          const resp = await fetch(`${API_URL}/api/auth/verify`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
              piUid: `dev_${trimmedId}`,
              username: trimmedId,
              accessToken: 'MOCK_VALID',
            }),
          });
          if (resp.ok) {
            const payload = await resp.json();
            await applyServerSession(payload);
            user = payload.user;
          } else if (__DEV__ || isDebugMode) {
            user = createMockUser(trimmedId, trimmedId);
          } else {
            throw new Error('Unable to create or verify account');
          }
        } catch (e) {
          if (__DEV__ || isDebugMode) {
            user = createMockUser(trimmedId, trimmedId);
          } else {
            throw e;
          }
        }
      }

      navigation.replace('Home', {user: user as User});
    } catch (err) {
      if (__DEV__ || isDebugMode) {
        const mockUser = createMockUser(trimmedId, trimmedId);
        navigation.replace('Home', {user: mockUser});
      } else {
        setError('Login failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  /**
   * Create mock user for dev/fallback
   */
  const createMockUser = (piUid: string, username: string): User => ({
    id: uuidv4(),
    pi_id: piUid,
    username: username,
    balance: 100, // Test balance
    trust_score: 20,
    total_escrows: 0,
    completed_escrows: 0,
    disputes: 0,
    created_at: new Date().toISOString(),
  });

  // Simple RFC4122 v4 UUID generator (no external deps)
  function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // ============================================
  // RENDER
  // ============================================

  // Show loading during initialization
  if (initializing) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color="#FFD700" />
        <Text style={styles.initText}>Starting PMARTS...</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <Animated.View 
        style={[
          styles.content,
          {opacity: fadeAnim, transform: [{ translateY: slideAnim }]}
        ]}
      >
        {/* Logo & Branding */}
        <View style={styles.logoSection}>
          <View style={styles.logoCircle}>
            <Text style={styles.logoEmoji}>🛡️</Text>
          </View>
          <Text style={styles.appName}>PMARTS</Text>
          <Text style={styles.tagline}>Secure Pi Escrow</Text>
        </View>

        {/* Login Card */}
        <View style={styles.card}>
          {/* ============================================
           * PI AUTH (always visible)
           * ============================================ */}
          <Text style={styles.cardTitle}>Welcome to PMARTS</Text>
          <Text style={styles.cardSubtitle}>
            Tap below to sign in with your Pi account
          </Text>

          {error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>⚠️ {error}</Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.piButton, loading && styles.piButtonDisabled]}
            onPress={handlePiLogin}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color="#7B3FE4" size="small" />
            ) : (
              <>
                <Text style={styles.piButtonIcon}>π</Text>
                <Text style={styles.piButtonText}>Continue with Pi</Text>
              </>
            )}
          </TouchableOpacity>

          <Text style={styles.securityNote}>
            🔒 Secure authentication via Pi Network
          </Text>

          {/* Debug-only demo login */}
          {isDebugMode && (
            <TouchableOpacity
              style={[styles.devDemoButton]}
              onPress={async () => {
                setLoading(true);
                try {
                  const demo: PiUser = {
                    uid: `dev_${Date.now()}`,
                    username: 'dev_user',
                    accessToken: 'dev-token',
                  };
                  await piSDKService.createDevSession(demo);
                  await loginWithPiUser(demo);
                } catch (e) {
                  debugError('Demo login failed', e);
                } finally {
                  setLoading(false);
                }
              }}
            >
              <Text style={{color: '#fff', fontWeight: '700'}}>Sign in as Demo User</Text>
            </TouchableOpacity>
          )}

          {/* ============================================
           * DEV MODE LOGIN (fallback)
           * ============================================ */}
          {!isPiBrowser && (
            <>
              <Text style={[styles.cardTitle, styles.devTitle]}>Development Mode</Text>
              <Text style={styles.cardSubtitle}>
                Enter your Pi ID to continue testing
              </Text>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Pi Network ID</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="e.g. @username"
                  placeholderTextColor={COLORS.textMuted}
                  value={piId}
                  onChangeText={(text) => {
                    setPiId(text);
                    setError('');
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="go"
                  onSubmitEditing={handleDevLogin}
                />
              </View>

              <Button
                title={loading ? 'Signing in...' : 'Continue'}
                onPress={handleDevLogin}
                loading={loading}
                variant="primary"
              />

              <View style={styles.devBadge}>
                <Text style={styles.devBadgeText}>
                  🔧 Open in Pi Browser for real authentication
                </Text>
              </View>
            </>
          )}
        </View>

        {/* Features */}
        <View style={styles.features}>
          <View style={styles.feature}>
            <Text style={styles.featureIcon}>🔒</Text>
            <Text style={styles.featureText}>Secure Escrow</Text>
          </View>
          <View style={styles.feature}>
            <Text style={styles.featureIcon}>⭐</Text>
            <Text style={styles.featureText}>Trust Ratings</Text>
          </View>
          <View style={styles.feature}>
            <Text style={styles.featureIcon}>🛡️</Text>
            <Text style={styles.featureText}>Dispute Protection</Text>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            By continuing, you agree to our{' '}
            <Text style={styles.footerLink} onPress={() => Linking.openURL(LEGAL_URLS.termsOfService)}>
              Terms of Service
            </Text>
            {' '}and{' '}
            <Text style={styles.footerLink} onPress={() => Linking.openURL(LEGAL_URLS.privacyPolicy)}>
              Privacy Policy
            </Text>
          </Text>
        </View>
      </Animated.View>
    </KeyboardAvoidingView>
  );
}

// ============================================
// STYLES
// ============================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.primary,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  initText: {
    color: '#FFFFFF',
    fontSize: FONT_SIZES.md,
    marginTop: SPACING.md,
    opacity: 0.8,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    padding: SPACING.lg,
  },
  // Logo Section
  logoSection: {
    alignItems: 'center',
    marginBottom: SPACING.xl,
  },
  logoCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  logoEmoji: {
    fontSize: 48,
  },
  appName: {
    fontSize: 36,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 2,
  },
  tagline: {
    fontSize: FONT_SIZES.md,
    color: 'rgba(255,255,255,0.8)',
    marginTop: SPACING.xs,
  },
  // Card
  card: {
    backgroundColor: COLORS.background,
    borderRadius: BORDER_RADIUS.xl,
    padding: SPACING.xl,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
    boxShadow: '0 8px 16px rgba(0,0,0,0.20)',
  },
  cardTitle: {
    fontSize: FONT_SIZES.xl,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: SPACING.xs,
  },
  cardSubtitle: {
    fontSize: FONT_SIZES.md,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: SPACING.lg,
  },
  devTitle: {
    marginTop: SPACING.lg,
  },
  // Pi Button (main CTA for Pi Browser)
  piButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFD700',
    borderRadius: BORDER_RADIUS.lg,
    paddingVertical: SPACING.md + 4,
    paddingHorizontal: SPACING.xl,
    marginTop: SPACING.md,
    shadowColor: '#FFD700',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
    boxShadow: '0 4px 8px rgba(232,168,56,0.20)',
  },
  piButtonDisabled: {
    opacity: 0.7,
  },
  piButtonIcon: {
    fontSize: 28,
    fontWeight: '700',
    color: '#7B3FE4',
    marginRight: SPACING.sm,
  },
  piButtonText: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '700',
    color: '#7B3FE4',
  },
  securityNote: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: SPACING.lg,
  },
  // Error
  errorBox: {
    backgroundColor: 'rgba(255,59,48,0.1)',
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.sm,
    marginBottom: SPACING.md,
  },
  errorText: {
    color: COLORS.error,
    fontSize: FONT_SIZES.sm,
    textAlign: 'center',
  },
  // Input Group (Dev Mode)
  inputGroup: {
    marginBottom: SPACING.md,
  },
  inputLabel: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: SPACING.xs,
  },
  textInput: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    fontSize: FONT_SIZES.md,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  // Dev Badge
  devBadge: {
    backgroundColor: 'rgba(255,193,7,0.1)',
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.sm,
    marginTop: SPACING.lg,
  },
  devBadgeText: {
    fontSize: FONT_SIZES.xs,
    color: '#B8860B',
    textAlign: 'center',
  },
  // Features
  features: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: SPACING.xl,
    gap: SPACING.lg,
  },
  feature: {
    alignItems: 'center',
  },
  featureIcon: {
    fontSize: 24,
    marginBottom: SPACING.xs,
  },
  featureText: {
    fontSize: FONT_SIZES.xs,
    color: 'rgba(255,255,255,0.8)',
  },
  // Footer
  footer: {
    marginTop: SPACING.xl,
  },
  footerText: {
    fontSize: FONT_SIZES.xs,
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
  },
  footerLink: {
    color: '#FFFFFF',
    textDecorationLine: 'underline',
    fontWeight: '600',
  },
  devDemoButton: {
    marginTop: SPACING.md,
    backgroundColor: '#7B3FE4',
    paddingVertical: 12,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
  },
});

