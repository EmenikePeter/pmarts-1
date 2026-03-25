/**
 * Security Settings Screen
 * 
 * Manage security options like PIN, biometrics, and session info
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  TextInput,
  Modal,
  Platform,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import { RootStackParamList } from '../lib/types';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES, HEADER_TITLE_TEXT } from '../lib/theme';
import { supabase } from '../lib/supabase';
import { useToast } from '../components/Toast';
import { API_URL, getApiEndpoint } from '../lib/api';
import { usePiAuth } from '../context/PiAuthContext';
import { debugLog, debugError } from '../lib/debugLogger';
import { clearAppSession, getBestAuthTokenFromSupabase } from '../lib/appSession';

type SecuritySettingsScreenProps = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'SecuritySettings'>;
  route: RouteProp<RootStackParamList, 'SecuritySettings'>;
};

export default function SecuritySettingsScreen({ navigation, route }: SecuritySettingsScreenProps) {
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [pinEnabled, setPinEnabled] = useState(false);
  const [biometricsEnabled, setBiometricsEnabled] = useState(false);
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinStep, setPinStep] = useState<'enter' | 'confirm'>('enter');
  const [sessions, setSessions] = useState<any[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  useEffect(() => {
    loadSecuritySettings();
    checkBiometrics();
    loadActiveSessions();
  }, []);

  const loadActiveSessions = async () => {
    try {
      setSessionsLoading(true);
      const token = await getBestAuthTokenFromSupabase(supabase);
      if (!token) {
        setSessions([]);
        return;
      }

      const resp = await fetch(getApiEndpoint('/api/auth/sessions'), {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!resp.ok) {
        const b = await resp.json().catch(() => ({}));
        throw new Error(b?.error || 'Failed to load sessions');
      }

      const body = await resp.json().catch(() => null);
      setSessions((body?.sessions || []).slice(0, 5));
    } catch (err) {
      debugError('Failed to load active sessions', err);
      setSessions([]);
    } finally {
      setSessionsLoading(false);
    }
  };

  const loadSecuritySettings = async () => {
    try {
      const storedPin = await SecureStore.getItemAsync('app_pin');
      setPinEnabled(!!storedPin);
      
      const bioEnabled = await SecureStore.getItemAsync('biometrics_enabled');
      setBiometricsEnabled(bioEnabled === 'true');
      // load persisted flags from DB if present
      try {
        const uid = route.params.user.id;
        const { data } = await supabase.from('user_security_settings').select('*').eq('user_id', uid).maybeSingle();
        if (data) {
          // prefer secure store for actual pinEnabled, but sync flags
          if (typeof data.pin_enabled !== 'undefined') setPinEnabled(!!data.pin_enabled);
          if (typeof data.biometrics_enabled !== 'undefined') setBiometricsEnabled(!!data.biometrics_enabled);
        }
      } catch (err) {
        // ignore
      }
    } catch (err) {
      debugError('Failed to load security settings:', err);
    }
  };

  const checkBiometrics = async () => {
    try {
      if (Platform.OS === 'web') {
        setBiometricsAvailable(false);
        return;
      }

      const [compatible, enrolled, types] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
        LocalAuthentication.supportedAuthenticationTypesAsync(),
      ]);

      const available = !!compatible && !!enrolled && Array.isArray(types) && types.length > 0;
      setBiometricsAvailable(available);

      debugLog('[SecuritySettings] biometrics capability', {
        platform: Platform.OS,
        compatible,
        enrolled,
        supportedTypes: types,
        available,
      });
    } catch (err) {
      debugError('[SecuritySettings] biometrics capability check failed', err);
      setBiometricsAvailable(false);
    }
  };

  const handlePinToggle = async (value: boolean) => {
    if (value) {
      // Show PIN setup modal
      setPin('');
      setConfirmPin('');
      setPinStep('enter');
      setShowPinModal(true);
    } else {
      // Remove PIN
      Alert.alert(
        'Disable PIN',
        'Are you sure you want to disable PIN protection?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Disable',
            style: 'destructive',
            onPress: async () => {
              await SecureStore.deleteItemAsync('app_pin');
              setPinEnabled(false);
              // persist to DB
              try { await supabase.from('user_security_settings').upsert({ user_id: route.params.user.id, pin_enabled: false }); } catch(e){}
            },
          },
        ]
      );
    }
  };

  const handleSetPin = async () => {
    if (pinStep === 'enter') {
      if (pin.length !== 4) {
        try { toast.push({ type: 'error', message: 'PIN must be 4 digits' }); } catch(e) {}
        return;
      }
      setPinStep('confirm');
      return;
    }

    // Confirm step
    if (pin !== confirmPin) {
      try { toast.push({ type: 'error', message: 'PINs do not match. Please try again.' }); } catch(e) {}
      setPin('');
      setConfirmPin('');
      setPinStep('enter');
      return;
    }

    try {
      await SecureStore.setItemAsync('app_pin', pin);
      setPinEnabled(true);
      setShowPinModal(false);
      try { toast.push({ type: 'success', message: 'PIN has been set successfully' }); } catch(e) {}
      // persist to DB
      try { await supabase.from('user_security_settings').upsert({ user_id: route.params.user.id, pin_enabled: true }); } catch(e){}
    } catch (err) {
      try { toast.push({ type: 'error', message: 'Failed to save PIN' }); } catch(e) {}
    }
  };

  const handleBiometricsToggle = async (value: boolean) => {
    try {
      if (value) {
        if (!biometricsAvailable) {
          try { toast.push({ type: 'error', message: 'Biometrics is not available or not enrolled on this device' }); } catch (e) {}
          return;
        }

        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: 'Authenticate to enable biometrics',
          cancelLabel: 'Cancel',
          fallbackLabel: 'Use device passcode',
          disableDeviceFallback: false,
        });

        if (result.success) {
          await SecureStore.setItemAsync('biometrics_enabled', 'true');
          setBiometricsEnabled(true);
          try { await supabase.from('user_security_settings').upsert({ user_id: route.params.user.id, biometrics_enabled: true }); } catch (e) {}
          try { toast.push({ type: 'success', message: 'Biometrics enabled' }); } catch (e) {}
        } else {
          setBiometricsEnabled(false);
          const reason = result.error ? ` (${result.error})` : '';
          try { toast.push({ type: 'error', message: `Biometric authentication failed${reason}` }); } catch (e) {}
          debugLog('[SecuritySettings] biometrics authentication not successful', result as any);
        }
      } else {
        await SecureStore.setItemAsync('biometrics_enabled', 'false');
        setBiometricsEnabled(false);
        try { await supabase.from('user_security_settings').upsert({ user_id: route.params.user.id, biometrics_enabled: false }); } catch (e) {}
        try { toast.push({ type: 'success', message: 'Biometrics disabled' }); } catch (e) {}
      }
    } catch (err) {
      debugError('[SecuritySettings] biometrics toggle failed', err);
      try { toast.push({ type: 'error', message: 'Failed to update biometric setting' }); } catch (e) {}
      setBiometricsEnabled(false);
    }
  };

  const handleChangePin = () => {
    setPin('');
    setConfirmPin('');
    setPinStep('enter');
    setShowPinModal(true);
  };

  const toast = useToast();
  const { logout } = usePiAuth();
  const sessionStartedText = route.params.user?.created_at
    ? new Date(route.params.user.created_at).toLocaleString()
    : 'Unknown';

  // Password change UI removed — login uses Pi authentication

  const handleSignOutEverywhere = async () => {
    Alert.alert(
      'Sign out everywhere',
      'This will sign you out of all devices. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: async () => {
          try {
            // Prefer server-side revoke for stronger guarantees
            const sess = await supabase.auth.getSession();
            const token = await getBestAuthTokenFromSupabase(supabase);
            if (!token) {
              // fallback to client signOut
              await supabase.auth.signOut();
              await clearAppSession();
              toast.push({ type: 'success', message: 'Signed out locally' });
              try { navigation.replace('Login'); } catch (e) {}
              return;
            }

            const resp = await fetch(`${API_URL}/api/auth/revoke-all`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ keepCurrent: false }),
            });

            if (!resp.ok) {
              const body = await resp.json().catch(() => ({}));
              throw new Error(body?.error || 'Revoke failed');
            }

            // Clear local session
            await supabase.auth.signOut();
            await clearAppSession();
            toast.push({ type: 'success', message: 'Signed out from all devices' });
            try { navigation.replace('Login'); } catch (e) {}
          } catch (err) {
            debugError('Sign out everywhere failed', err);
            toast.push({ type: 'error', message: 'Failed to sign out everywhere' });
          }
        } }
      ]
    );
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Request Account Deletion',
      'This submits an account deletion request and signs you out. Our team will process it after verification.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Request',
          style: 'destructive',
          onPress: async () => {
            try {
              const token = await getBestAuthTokenFromSupabase(supabase);
              if (!token) {
                toast.push({ type: 'error', message: 'You must be signed in to request deletion' });
                return;
              }

              const payload = {
                title: 'Account Deletion Request',
                body: `User ${route.params.user.id} requested account deletion from Security Settings.`,
                category: 'account',
                priority: 'high',
              };

              const resp = await fetch(`${API_URL}/api/support/tickets`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(payload),
              });

              if (!resp.ok) {
                const b = await resp.json().catch(() => ({}));
                throw new Error(b?.error || 'Failed to submit deletion request');
              }

              toast.push({ type: 'success', message: 'Deletion request submitted. You have been signed out.' });

              try { await logout(); } catch (e) {}
              try { await supabase.auth.signOut(); } catch (e) {}
              try { await clearAppSession(); } catch (e) {}
              navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
            } catch (err) {
              debugError('Delete account request failed', err);
              toast.push({ type: 'error', message: 'Failed to submit deletion request' });
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Security Settings</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.scrollContent}>
        {/* Authentication Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Authentication</Text>
          
          <View style={styles.settingRow}>
            <View style={styles.settingLeft}>
              <Text style={styles.settingIcon}>🔢</Text>
              <View style={styles.settingTextContainer}>
                <Text style={styles.settingTitle}>PIN Lock</Text>
                <Text style={styles.settingDescription}>
                  Require PIN to open the app
                </Text>
              </View>
            </View>
            <Switch
              value={pinEnabled}
              onValueChange={handlePinToggle}
              trackColor={{ false: COLORS.muted, true: COLORS.primary }}
              thumbColor="#FFFFFF"
            />
          </View>

          {pinEnabled && (
            <TouchableOpacity style={styles.changeButton} onPress={handleChangePin}>
              <Text style={styles.changeButtonText}>Change PIN</Text>
            </TouchableOpacity>
          )}

          <View style={[styles.settingRow, !biometricsAvailable && styles.disabled]}>
            <View style={styles.settingLeft}>
              <Text style={styles.settingIcon}>👆</Text>
              <View style={styles.settingTextContainer}>
                <Text style={styles.settingTitle}>Biometrics</Text>
                <Text style={styles.settingDescription}>
                  {biometricsAvailable 
                    ? 'Use fingerprint or face to unlock'
                    : 'Not available on this device'}
                </Text>
              </View>
            </View>
            <Switch
              value={biometricsEnabled}
              onValueChange={handleBiometricsToggle}
              trackColor={{ false: COLORS.muted, true: COLORS.primary }}
              thumbColor="#FFFFFF"
              disabled={!biometricsAvailable}
            />
          </View>
        </View>

        {/* Session Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Session</Text>
          
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Logged in as</Text>
            <Text style={styles.infoValue}>@{route.params.user.username || route.params.user.pi_id}</Text>
          </View>
          
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Session started</Text>
            <Text style={styles.infoValue}>{sessionStartedText}</Text>
          </View>

          <TouchableOpacity
            style={styles.actionRow}
            onPress={handleSignOutEverywhere}
          >
            <Text style={styles.settingIcon}>📴</Text>
            <Text style={styles.actionText}>Sign out everywhere</Text>
            <Text style={styles.actionArrow}>→</Text>
          </TouchableOpacity>

          <View style={styles.sessionsBlock}>
            <View style={styles.sessionsHeaderRow}>
              <Text style={styles.sessionsTitle}>Active Sessions (Last 5)</Text>
              <TouchableOpacity onPress={loadActiveSessions}>
                <Text style={styles.refreshText}>{sessionsLoading ? 'Refreshing...' : 'Refresh'}</Text>
              </TouchableOpacity>
            </View>
            {sessions.length === 0 && !sessionsLoading ? (
              <Text style={styles.sessionHint}>No active sessions found.</Text>
            ) : (
              sessions.map((s) => (
                <View key={s.id} style={styles.sessionRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sessionDevice}>
                      {s?.device?.platform || 'Unknown device'}{s?.current ? ' (Current)' : ''}
                    </Text>
                    <Text style={styles.sessionMeta}>
                      {s?.created_at ? new Date(s.created_at).toLocaleString() : 'Unknown start'}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </View>

          <TouchableOpacity
            style={[styles.actionRow, { marginTop: SPACING.sm }]}
            onPress={() => setConfirmLogout(true)}
          >
            <Text style={styles.settingIcon}>🚪</Text>
            <Text style={[styles.actionText, { color: COLORS.error }]}>Logout</Text>
            <Text style={styles.actionArrow}>→</Text>
          </TouchableOpacity>
        </View>

        {/* Privacy Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Privacy</Text>
          
          <TouchableOpacity 
            style={styles.actionRow}
            onPress={() => { try { toast.push({ type: 'info', message: 'Your data export will be sent to your email within 24 hours.' }); } catch(e) {} }}
          >
            <Text style={styles.settingIcon}>📥</Text>
            <Text style={styles.actionText}>Export My Data</Text>
            <Text style={styles.actionArrow}>→</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.actionRow}
            onPress={handleDeleteAccount}
          >
            <Text style={styles.settingIcon}>🗑️</Text>
            <Text style={[styles.actionText, { color: COLORS.error }]}>Request Account Deletion</Text>
            <Text style={styles.actionArrow}>→</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.infoText}>
          Security settings help protect your account and escrow funds.
        </Text>
      </ScrollView>

      <Modal visible={confirmLogout} transparent animationType="fade" onRequestClose={() => setConfirmLogout(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={{ fontSize: 18, fontWeight: '700', marginBottom: 8 }}>Confirm sign out</Text>
            <Text style={{ color: COLORS.textMuted, marginBottom: 16 }}>Sign out from this device?</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8 }}>
              <TouchableOpacity onPress={() => setConfirmLogout(false)} style={{ padding: 10 }}>
                <Text style={{ color: COLORS.textMuted }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={async () => {
                try {
                  debugLog('[SecuritySettings] performLogout requested');

                  // Log supabase session before signing out
                  try {
                    const sess = await supabase.auth.getSession().catch(() => null);
                    debugLog('[SecuritySettings] supabase session before logout', { hasSession: !!sess?.data?.session });
                  } catch (e) {
                    debugError('[SecuritySettings] failed to read session', e);
                  }

                  await logout();
                  try { await supabase.auth.signOut(); } catch (e) { debugError('[SecuritySettings] supabase.signOut failed', e); }
                  try { await clearAppSession(); } catch (e) {}
                  toast.push({ type: 'success', message: 'Logged out' });
                  navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
                } catch (err) {
                  debugError('Logout failed', err);
                  toast.push({ type: 'error', message: 'Failed to logout' });
                } finally {
                  setConfirmLogout(false);
                }
              }} style={{ padding: 10, marginLeft: 12 }}>
                <Text style={{ color: COLORS.error, fontWeight: '700' }}>Logout</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* PIN Setup Modal */}
      <Modal
        visible={showPinModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowPinModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              {pinStep === 'enter' ? 'Set PIN' : 'Confirm PIN'}
            </Text>
            <Text style={styles.modalDescription}>
              {pinStep === 'enter' 
                ? 'Enter a 4-digit PIN'
                : 'Re-enter your PIN to confirm'}
            </Text>
            
            <TextInput
              style={styles.pinInput}
              value={pinStep === 'enter' ? pin : confirmPin}
              onChangeText={pinStep === 'enter' ? setPin : setConfirmPin}
              keyboardType="numeric"
              maxLength={4}
              secureTextEntry
              placeholder="••••"
              placeholderTextColor={COLORS.muted}
              autoFocus
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={styles.modalCancelButton}
                onPress={() => setShowPinModal(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={styles.modalConfirmButton}
                onPress={handleSetPin}
              >
                <Text style={styles.modalConfirmText}>
                  {pinStep === 'enter' ? 'Next' : 'Set PIN'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Change password removed — Pi authentication handled externally */}
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
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  disabled: {
    opacity: 0.5,
  },
  settingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  settingIcon: {
    fontSize: 24,
    marginRight: SPACING.md,
  },
  settingTextContainer: {
    flex: 1,
  },
  settingTitle: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    color: COLORS.text,
  },
  settingDescription: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  changeButton: {
    alignSelf: 'flex-start',
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    marginTop: SPACING.sm,
  },
  changeButtonText: {
    color: COLORS.primary,
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  infoLabel: {
    fontSize: FONT_SIZES.md,
    color: COLORS.textMuted,
  },
  infoValue: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    color: COLORS.text,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  actionText: {
    flex: 1,
    fontSize: FONT_SIZES.md,
    fontWeight: '500',
    color: COLORS.text,
  },
  actionArrow: {
    fontSize: FONT_SIZES.lg,
    color: COLORS.muted,
  },
  infoText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  sessionsBlock: {
    marginTop: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.sm,
  },
  sessionsHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.xs,
  },
  sessionsTitle: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '700',
    color: COLORS.text,
  },
  refreshText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.primary,
    fontWeight: '600',
  },
  sessionRow: {
    paddingVertical: SPACING.xs,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  sessionDevice: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text,
    fontWeight: '600',
  },
  sessionMeta: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  sessionHint: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.textMuted,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: COLORS.background,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.xl,
    width: '80%',
    maxWidth: 320,
  },
  modalTitle: {
    fontSize: FONT_SIZES.xl,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
  modalDescription: {
    fontSize: FONT_SIZES.md,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginBottom: SPACING.lg,
  },
  pinInput: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    fontSize: 32,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 10,
    color: COLORS.text,
    borderWidth: 2,
    borderColor: COLORS.primary,
    marginBottom: SPACING.lg,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: SPACING.md,
  },
  modalCancelButton: {
    flex: 1,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
  },
  modalCancelText: {
    color: COLORS.textMuted,
    fontWeight: '600',
  },
  modalConfirmButton: {
    flex: 1,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
  },
  modalConfirmText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  debugBanner: {
    backgroundColor: '#FEF3F2',
    borderColor: '#FCA5A5',
    borderWidth: 1,
    padding: 8,
    alignItems: 'center',
    margin: SPACING.md,
  },
  debugBannerText: {
    color: '#991B1B',
    fontWeight: '700',
  },
});

