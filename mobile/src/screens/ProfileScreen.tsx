import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Modal,
  Linking,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { Button } from '../components';
import { supabase } from '../lib/supabase';
import { getUserById } from '../lib/userResolver';
import Clipboard from '@react-native-clipboard/clipboard';
import { useToast } from '../components/Toast';
import { RootStackParamList, formatPi, getTrustBadge } from '../lib/types';
import { LEGAL_URLS } from '../lib/legal';
import { getApiEndpoint } from '../lib/api';
import { clearAppSession, getBestAuthTokenFromSupabase } from '../lib/appSession';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES, HEADER_TITLE_TEXT } from '../lib/theme';
import { usePiAuth } from '../context/PiAuthContext';
import DebugLogPanel from '../components/DebugLogPanel';
import { debugError, debugLog, isDebugEnabled } from '../lib/debugLogger';
import PaymentQRDisplay from '../components/PaymentQRDisplay';

type ProfileScreenProps = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Profile'>;
  route: RouteProp<RootStackParamList, 'Profile'>;
};

export default function ProfileScreen({ navigation, route }: ProfileScreenProps) {
  const { user: initialUser } = route.params;
  const [user, setUser] = useState(initialUser as any || {});
  const [showPaymentQR, setShowPaymentQR] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>((initialUser as any)?.avatar_url || null);
  const [profileStats, setProfileStats] = useState<any | null>(null);
  const [verificationBadges, setVerificationBadges] = useState<string[]>([]);
  const [milestoneBadges, setMilestoneBadges] = useState<string[]>([]);
  const [reputationHighlights, setReputationHighlights] = useState<string[]>([]);
  const [deletionTicket, setDeletionTicket] = useState<any | null>(null);
  const { logout } = usePiAuth();
  const showDebug = isDebugEnabled();
  const trustScore = Number(user?.trust_score ?? 0);
  const trustBadge = getTrustBadge(trustScore);
  const trustStars = Math.max(0, Math.min(5, Math.round(trustScore / 20)));
  const totalEscrows = Number(user?.total_escrows ?? 0);
  const completedEscrows = Number(user?.completed_escrows ?? 0);
  const disputesCount = Number(user?.disputes ?? 0);
  const successRate = totalEscrows > 0 ? Math.round((completedEscrows / totalEscrows) * 100) : 100;
  const accountAgeDays = Math.max(
    0,
    Math.floor((Date.now() - new Date(user?.created_at || Date.now()).getTime()) / (1000 * 60 * 60 * 24))
  );

  const completionPoints = Math.min(40, completedEscrows * 2);
  const agePoints = Math.min(20, Math.floor(accountAgeDays / 30));
  const disputePenalty = Math.min(40, disputesCount * 10);

  const isKycVerified = Boolean((user as any)?.is_verified);
  const verificationChecklist = [
    { label: 'Pi account linked', done: !!user?.pi_id },
    { label: 'Username set', done: !!user?.username },
    { label: 'PMARTS ID assigned', done: !!user?.pmarts_id },
    { label: 'KYC verified', done: isKycVerified },
  ];

  const handleLogout = () => {
    // Open confirm modal instead of platform Alert which can block in WebView/Pi Browser
    setConfirmLogout(true);
  };

  const [confirmLogout, setConfirmLogout] = useState(false);

  const performLogout = async () => {
    try {
      debugLog('[Logout] Requested sync', { userId: user?.id });
      toast.push({ type: 'info', message: 'Signing out...' });

      // Log current supabase session (masked)
      try {
        const sess = await supabase.auth.getSession();
        debugLog('[Logout] Supabase session before logout', {
          hasSession: !!sess?.data?.session,
          access_token: sess?.data?.session?.access_token ? '***' : null,
        });
      } catch (e) {
        debugError('[Logout] Failed to read supabase session before logout', e);
      }

      // Attempt logout with timeout guard
      try {
        await Promise.race([
          logout(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Logout timeout')), 8000)),
        ]);
      } catch (err) {
        debugError('[Logout] piSDK.logout error or timeout', err);
      }

      debugLog('[Logout] Completed (piSDK logout attempted)');
      toast.push({ type: 'success', message: 'Signed out' });

      // Ensure supabase session is cleared and log result
      try { await supabase.auth.signOut(); } catch (e) { debugError('[Logout] supabase.auth.signOut failed', e); }
      try { await clearAppSession(); } catch (e) {}
      try {
        const sessAfter = await supabase.auth.getSession().catch(() => null);
        debugLog('[Logout] Supabase session after logout', { hasSession: !!sessAfter?.data?.session });
      } catch (navErr) {
        debugError('[Logout] Error ensuring supabase session cleared', navErr);
      }

      // Try clearing server session cookie
      try {
        const resp = await fetch('/api/auth/clear-session', { method: 'POST' });
        debugLog('[Logout] /api/auth/clear-session response', { ok: resp.ok, status: resp.status });
      } catch (e) {
        debugError('[Logout] Failed to call /api/auth/clear-session', e);
      }

      try { navigation.reset({ index: 0, routes: [{ name: 'Login' }] }); } catch (e) { try { navigation.replace('Login'); } catch (e) {} }
    } catch (error) {
      debugError('[Logout] Failed', error);
      toast.push({ type: 'error', message: 'Logout failed' });
    } finally {
      setConfirmLogout(false);
    }
  };

  const handleEditProfile = () => {
    navigation.navigate('EditProfile', { user, onUpdate: (u: any) => setUser(u) });
  };

  const handleNotificationSettings = () => {
    navigation.navigate('NotificationSettings', { user });
  };

  const handleSecuritySettings = () => {
    navigation.navigate('SecuritySettings', { user });
  };

  const handleHelpSupport = () => {
    navigation.navigate('HelpSupport');
  };

  const handleAboutUs = () => {
    navigation.navigate('AboutUs');
  };

  const handleTermsOfService = async () => {
    try {
      const supported = await Linking.canOpenURL(LEGAL_URLS.termsOfService);
      if (!supported) {
        toast.push({ type: 'error', message: 'Unable to open Terms link on this device' });
        return;
      }
      await Linking.openURL(LEGAL_URLS.termsOfService);
    } catch (e) {
      toast.push({ type: 'error', message: 'Failed to open Terms of Service' });
      debugError('[Profile] open terms link failed', e);
    }
  };

  const handlePrivacyPolicy = async () => {
    try {
      const supported = await Linking.canOpenURL(LEGAL_URLS.privacyPolicy);
      if (!supported) {
        toast.push({ type: 'error', message: 'Unable to open Privacy link on this device' });
        return;
      }
      await Linking.openURL(LEGAL_URLS.privacyPolicy);
    } catch (e) {
      toast.push({ type: 'error', message: 'Failed to open Privacy Policy' });
      debugError('[Profile] open privacy link failed', e);
    }
  };

  const handlePrivacyPolicyInApp = () => {
    navigation.navigate('PrivacyPolicy');
  };

  // Subscribe to realtime updates for this user so profile updates appear live
  useEffect(() => {
    let sub: any = null;
    try {
      sub = supabase
        .channel('public:users')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'users', filter: `id=eq.${user.id}` }, (payload: any) => {
          try {
            if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') {
              setUser((prev: any) => ({ ...prev, ...payload.new }));
            }
          } catch (e) {}
        })
        .subscribe();
    } catch (e) {
      // older supabase client fallback
      try {
        const channel = supabase.channel(`users:${user.id}`);
        channel.on('postgres_changes', { event: '*', schema: 'public', table: 'users', filter: `id=eq.${user.id}` }, (payload: any) => {
          if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') setUser((prev: any) => ({ ...prev, ...payload.new }));
        });
        channel.subscribe();
        sub = channel;
      } catch (err) {}
    }

    return () => {
      try { sub?.unsubscribe?.(); } catch (e) {}
    };
  }, [user.id]);

  // Fetch fresh user data on mount
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const token = await getBestAuthTokenFromSupabase(supabase);
        if (token) {
          const [avatarResp, statsResp] = await Promise.all([
            fetch(getApiEndpoint('/api/user/profile/avatar-url'), {
              headers: { Authorization: `Bearer ${token}` },
            }).catch(() => null),
            fetch(getApiEndpoint('/api/user/profile/stats'), {
              headers: { Authorization: `Bearer ${token}` },
            }).catch(() => null),
          ]);

          if (avatarResp?.ok) {
            const avatarBody = await avatarResp.json().catch(() => null);
            if (mounted && avatarBody?.avatar_url) setAvatarUrl(avatarBody.avatar_url);
          }

          if (statsResp?.ok) {
            const statsBody = await statsResp.json().catch(() => null);
            if (mounted && statsBody?.success) {
              setProfileStats(statsBody.stats || null);
              setVerificationBadges(Array.isArray(statsBody?.badges?.verification) ? statsBody.badges.verification : []);
              setMilestoneBadges(Array.isArray(statsBody?.badges?.milestones) ? statsBody.badges.milestones : []);
              setReputationHighlights(Array.isArray(statsBody?.reputation_highlights) ? statsBody.reputation_highlights : []);
            }
          }
        }

        const { data, error } = await getUserById(
          initialUser.id,
          'id,pi_id,username,pmarts_id,balance,trust_score,completed_escrows,disputes,created_at,updated_at,avatar_path,avatar_visibility,photo_review_status,bio,location,preferred_language,theme_preset,notification_preset,is_verified',
          { maybeSingle: true }
        );

        if (!error && data && mounted) {
          const { count } = await supabase
            .from('escrows')
            .select('id', { count: 'exact', head: true })
            .or(`sender_id.eq.${initialUser.id},recipient_id.eq.${initialUser.id}`);

          const merged = {
            ...(data as any),
            total_escrows: Number(count || 0),
          };

          debugLog('[Profile] refreshed user', { id: data.id, pmarts_id: data.pmarts_id });
          setUser(merged as any);
        } else if (error) {
          debugError('[Profile] refresh error', error);
        }
      } catch (e) {
        debugError('Failed to refresh user', e);
      }
    })();
    return () => { mounted = false; };
  }, [initialUser.id]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const token = await getBestAuthTokenFromSupabase(supabase);
        if (!token) return;

        const resp = await fetch(getApiEndpoint('/api/support/tickets'), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!resp.ok) return;

        const body = await resp.json().catch(() => null);
        const tickets = body?.tickets || [];
        const deletion = tickets.find((t: any) =>
          typeof t?.title === 'string' && t.title.toLowerCase().includes('account deletion request')
        );

        if (mounted) setDeletionTicket(deletion || null);
      } catch (e) {
        debugError('[Profile] Failed to load deletion status', e);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const toast = useToast();

  const copyToClipboard = async (label: string, value?: string) => {
    if (!value) return toast.push({ type: 'info', message: `${label}: No value available` });
    try {
      Clipboard.setString(value);
      toast.push({ type: 'success', message: `${label} copied to clipboard` });
    } catch (e) {
      try { toast.push({ type: 'info', message: `${label}: ${value}` }); } catch(e) {}
    }
  };

  // Developer test artifacts removed: test button handled elsewhere

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Profile</Text>
        <TouchableOpacity onPress={handleEditProfile} style={styles.editButton}>
          <Text style={styles.editText}>Edit</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.scrollContent}>
        {/* Avatar & Username */}
        {/* Confirm logout modal */}
        <Modal visible={confirmLogout} transparent animationType="fade" onRequestClose={() => setConfirmLogout(false)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' }}>
            <View style={{ backgroundColor: COLORS.background, padding: 20, borderRadius: 12, width: '90%', maxWidth: 360 }}>
              <Text style={{ fontSize: 18, fontWeight: '700', marginBottom: 8 }}>Confirm sign out</Text>
              <Text style={{ color: COLORS.textMuted, marginBottom: 16 }}>Are you sure you want to sign out from this device?</Text>
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
                <TouchableOpacity onPress={() => setConfirmLogout(false)} style={{ padding: 10 }}>
                  <Text style={{ color: COLORS.muted }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={performLogout} style={{ padding: 10 }}>
                  <Text style={{ color: COLORS.error, fontWeight: '700' }}>Logout</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
        <View style={styles.profileHeader}>
          <View style={styles.avatarContainer}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatar} />
            ) : (
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {((user.username || user.pi_id || 'U') + '').charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
            <View style={[styles.trustIndicator, { backgroundColor: trustBadge.color }]} />
          </View>
          
          <Text style={styles.username}>@{user.username || user.pi_id || 'user'}</Text>
          <Text style={styles.piId}>Pi ID: {user.pi_id || '—'}</Text>

          {/* Identifiers: show ID, Pi ID, Username, PMA ID */}

          {/* My Payment QR button */}
          <TouchableOpacity
            style={styles.paymentQRButton}
            onPress={() => setShowPaymentQR(true)}
            activeOpacity={0.8}
          >
            <Text style={styles.paymentQRButtonText}>⚡ My Payment QR</Text>
          </TouchableOpacity>

          {/* Payment QR Modal */}
          <Modal
            visible={showPaymentQR}
            transparent
            animationType="fade"
            onRequestClose={() => setShowPaymentQR(false)}
          >
            <PaymentQRDisplay
              username={user.username}
              piId={user.pi_id}
              pmartsId={user.pmarts_id}
              onClose={() => setShowPaymentQR(false)}
            />
          </Modal>

          <View style={styles.identifiersContainer}>
            <TouchableOpacity style={styles.identifierRow} onPress={() => copyToClipboard('PMARTS ID', user.pmarts_id)}>
              <Text style={styles.identifierLabel}>PMARTS ID</Text>
              <Text style={styles.identifierValue}>{user.pmarts_id ? user.pmarts_id : 'Not assigned'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.identifierRow} onPress={() => copyToClipboard('Pi ID', user.pi_id)}>
              <Text style={styles.identifierLabel}>Pi ID</Text>
              <Text style={styles.identifierValue}>{user.pi_id || '—'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.identifierRow} onPress={() => copyToClipboard('Name', user.username)}>
              <Text style={styles.identifierLabel}>Name</Text>
              <Text style={styles.identifierValue}>{user.username || '—'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.identifierRow} onPress={() => copyToClipboard('DB ID', user.id)}>
              <Text style={styles.identifierLabel}>DB ID</Text>
              <Text style={styles.identifierValue}>{user.id || '—'}</Text>
            </TouchableOpacity>
          </View>
          
          <View style={[styles.trustBadgeLarge, { backgroundColor: trustBadge.color }]}>
            <Text style={styles.trustBadgeText}>{trustBadge.label}</Text>
          </View>

          {(user as any)?.photo_review_status === 'pending' && (
            <View style={[styles.trustBadgeLarge, { backgroundColor: COLORS.secondary, marginTop: SPACING.xs }]}>
              <Text style={styles.trustBadgeText}>Photo Pending Approval</Text>
            </View>
          )}
        </View>

        {/* Personal Profile */}
        <View style={styles.breakdownCard}>
          <Text style={styles.sectionTitle}>Personal Profile</Text>
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>Bio</Text>
            <Text style={styles.breakdownValue}>{(user as any).bio || '—'}</Text>
          </View>
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>Location</Text>
            <Text style={styles.breakdownValue}>{(user as any).location || '—'}</Text>
          </View>
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>Language</Text>
            <Text style={styles.breakdownValue}>{(user as any).preferred_language || '—'}</Text>
          </View>
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>Avatar privacy</Text>
            <Text style={styles.breakdownValue}>{(user as any).avatar_visibility === 'counterparties_only' ? 'Counterparties only' : 'Public'}</Text>
          </View>
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>Theme preset</Text>
            <Text style={styles.breakdownValue}>{(user as any).theme_preset || 'default'}</Text>
          </View>
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>Notification preset</Text>
            <Text style={styles.breakdownValue}>{(user as any).notification_preset || 'balanced'}</Text>
          </View>
        </View>

        {/* Balance Card */}
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Available Balance</Text>
          <Text style={styles.balanceValue}>{formatPi(Number(user.balance ?? 0))}</Text>
        </View>

        {/* Seller/Buyer Performance */}
        <View style={styles.breakdownCard}>
          <Text style={styles.sectionTitle}>About this seller/buyer</Text>
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>Completed escrows</Text>
            <Text style={styles.breakdownValue}>{profileStats?.completed_escrows ?? completedEscrows}</Text>
          </View>
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>On-time rate</Text>
            <Text style={styles.breakdownValue}>{profileStats?.on_time_rate ?? 100}%</Text>
          </View>
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>Dispute rate</Text>
            <Text style={styles.breakdownValue}>{profileStats?.dispute_rate ?? 0}%</Text>
          </View>
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>Profile completeness</Text>
            <Text style={styles.breakdownValue}>{profileStats?.profile_completeness ?? 0}%</Text>
          </View>
        </View>

        {/* Trust Score Card */}
        <View style={styles.trustCard}>
          <Text style={styles.sectionTitle}>Trust Score</Text>
          
          <View style={styles.trustScoreContainer}>
            <Text style={styles.trustScore}>{Math.round(trustScore)}</Text>
            <View style={styles.starsContainer}>
              {[1, 2, 3, 4, 5].map((star) => (
                <Text
                  key={star}
                  style={[
                    styles.star,
                    { color: star <= trustStars ? COLORS.secondary : COLORS.muted },
                  ]}
                >
                  ★
                </Text>
              ))}
            </View>
          </View>

          <View style={styles.trustDetails}>
            <View style={styles.trustDetailItem}>
              <Text style={styles.trustDetailValue}>{totalEscrows}</Text>
              <Text style={styles.trustDetailLabel}>Total Escrows</Text>
            </View>
            <View style={styles.trustDetailDivider} />
            <View style={styles.trustDetailItem}>
              <Text style={styles.trustDetailValue}>{completedEscrows}</Text>
              <Text style={styles.trustDetailLabel}>Completed</Text>
            </View>
            <View style={styles.trustDetailDivider} />
            <View style={styles.trustDetailItem}>
              <Text style={[styles.trustDetailValue, { color: COLORS.success }]}>{successRate}%</Text>
              <Text style={styles.trustDetailLabel}>Success Rate</Text>
            </View>
          </View>
        </View>

        {/* Trust Breakdown Card */}
        <View style={styles.breakdownCard}>
          <Text style={styles.sectionTitle}>Trust Breakdown</Text>
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>Completions boost</Text>
            <Text style={[styles.breakdownValue, { color: COLORS.success }]}>+{completionPoints}</Text>
          </View>
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>Account age boost</Text>
            <Text style={[styles.breakdownValue, { color: COLORS.success }]}>+{agePoints}</Text>
          </View>
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>Disputes impact</Text>
            <Text style={[styles.breakdownValue, { color: disputesCount > 0 ? COLORS.error : COLORS.success }]}>
              {disputesCount > 0 ? `-${disputePenalty}` : '0'}
            </Text>
          </View>
          <Text style={styles.breakdownHint}>Informational factors behind current trust score.</Text>
        </View>

        {/* Verification Layer */}
        <View style={styles.verificationCard}>
          <Text style={styles.sectionTitle}>Verification</Text>
          <View style={styles.badgesRow}>
            <View style={[styles.statusBadge, { backgroundColor: isKycVerified ? COLORS.success : COLORS.muted }]}> 
              <Text style={styles.statusBadgeText}>{isKycVerified ? 'KYC Verified' : 'KYC Pending'}</Text>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: trustBadge.color }]}> 
              <Text style={styles.statusBadgeText}>{trustBadge.label}</Text>
            </View>
            {verificationBadges.map((badge) => (
              <View key={badge} style={[styles.statusBadge, { backgroundColor: COLORS.primary }]}> 
                <Text style={styles.statusBadgeText}>{badge}</Text>
              </View>
            ))}
          </View>
          {verificationChecklist.map((item) => (
            <View key={item.label} style={styles.checklistRow}>
              <Text style={styles.checkIcon}>{item.done ? '✅' : '⬜'}</Text>
              <Text style={styles.checkText}>{item.label}</Text>
            </View>
          ))}
        </View>

        {/* Milestones and reputation highlights */}
        <View style={styles.verificationCard}>
          <Text style={styles.sectionTitle}>Milestones & Reputation</Text>
          <View style={styles.badgesRow}>
            {milestoneBadges.length === 0 ? (
              <View style={[styles.statusBadge, { backgroundColor: COLORS.muted }]}> 
                <Text style={styles.statusBadgeText}>No milestones yet</Text>
              </View>
            ) : milestoneBadges.map((badge) => (
              <View key={badge} style={[styles.statusBadge, { backgroundColor: COLORS.secondary }]}> 
                <Text style={styles.statusBadgeText}>{badge}</Text>
              </View>
            ))}
          </View>
          {reputationHighlights.map((highlight) => (
            <View key={highlight} style={styles.checklistRow}>
              <Text style={styles.checkIcon}>👍</Text>
              <Text style={styles.checkText}>{highlight}</Text>
            </View>
          ))}
        </View>

        {/* Account Deletion Status */}
        <View style={styles.deletionCard}>
          <Text style={styles.sectionTitle}>Account Deletion Status</Text>
          {deletionTicket ? (
            <>
              <View style={styles.deletionRow}>
                <Text style={styles.deletionLabel}>Ticket status</Text>
                <Text style={styles.deletionValue}>{String(deletionTicket.status || 'open')}</Text>
              </View>
              <View style={styles.deletionRow}>
                <Text style={styles.deletionLabel}>Submitted</Text>
                <Text style={styles.deletionValue}>
                  {deletionTicket.created_at ? new Date(deletionTicket.created_at).toLocaleString() : 'Unknown'}
                </Text>
              </View>
              <Text style={styles.deletionHint}>Expected SLA: 24–72 hours after verification.</Text>
            </>
          ) : (
            <Text style={styles.deletionHint}>No deletion request submitted.</Text>
          )}
        </View>

        {/* Disputes */}
        <View style={styles.disputeCard}>
          <View style={styles.disputeRow}>
            <Text style={styles.disputeLabel}>Disputes</Text>
            <Text style={[
              styles.disputeValue,
              { color: disputesCount === 0 ? COLORS.success : COLORS.error }
            ]}>
              {disputesCount}
            </Text>
          </View>
          {disputesCount === 0 && (
            <Text style={styles.disputeNote}>✓ Clean record - no disputes</Text>
          )}
        </View>

        {/* Settings */}
        <View style={styles.settingsCard}>
          <Text style={styles.sectionTitle}>Settings</Text>
          
          <TouchableOpacity style={styles.settingsItem} onPress={handleNotificationSettings}>
            <Text style={styles.settingsIcon}>🔔</Text>
            <Text style={styles.settingsText}>Notification Preferences</Text>
            <Text style={styles.settingsArrow}>→</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.settingsItem} onPress={handleSecuritySettings}>
            <Text style={styles.settingsIcon}>🔐</Text>
            <Text style={styles.settingsText}>Security Settings</Text>
            <Text style={styles.settingsArrow}>→</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.settingsItem} onPress={handleHelpSupport}>
            <Text style={styles.settingsIcon}>❓</Text>
            <Text style={styles.settingsText}>Help & Support</Text>
            <Text style={styles.settingsArrow}>→</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.settingsItem} onPress={handleAboutUs}>
            <Text style={styles.settingsIcon}>🏢</Text>
            <Text style={styles.settingsText}>About Us</Text>
            <Text style={styles.settingsArrow}>→</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.settingsItem} onPress={handleTermsOfService}>
            <Text style={styles.settingsIcon}>📄</Text>
            <Text style={styles.settingsText}>Terms of Service</Text>
            <Text style={styles.settingsArrow}>→</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.settingsItem} onPress={handlePrivacyPolicy}>
            <Text style={styles.settingsIcon}>🔏</Text>
            <Text style={styles.settingsText}>Privacy Policy</Text>
            <Text style={styles.settingsArrow}>→</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.settingsItem} onPress={handlePrivacyPolicyInApp}>
            <Text style={styles.settingsIcon}>📘</Text>
            <Text style={styles.settingsText}>Privacy Policy (In-App)</Text>
            <Text style={styles.settingsArrow}>→</Text>
          </TouchableOpacity>
        </View>

        {/* Logout */}
        <Button
          title="Logout"
          onPress={handleLogout}
          variant="outline"
          style={{ marginTop: SPACING.lg }}
        />

        {/* dev test button removed; keep DebugLogPanel for diagnostics */}

        {showDebug && <DebugLogPanel title="Profile Debug" />}

        {/* App Info */}
        <View style={styles.appInfo}>
          <Text style={styles.appLogo}>🛡️</Text>
          <Text style={styles.appName}>PMARTS</Text>
          <Text style={styles.appTagline}>Secure Pi Escrow</Text>
          <Text style={styles.appVersion}>Version 1.0.0</Text>
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
  editButton: {
    paddingHorizontal: SPACING.sm,
  },
  editText: {
    color: COLORS.secondary,
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    padding: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
  profileHeader: {
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: SPACING.md,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 42,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  trustIndicator: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 3,
    borderColor: COLORS.surface,
  },
  username: {
    fontSize: FONT_SIZES.xxl,
    fontWeight: '700',
    color: COLORS.text,
  },
  piId: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textSecondary,
    marginTop: SPACING.xs,
  },
  identifiersContainer: {
    marginTop: SPACING.md,
    width: '100%',
    paddingHorizontal: SPACING.md,
  },
  paymentQRButton: {
    marginTop: SPACING.md,
    backgroundColor: COLORS.primary,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.xl,
    alignSelf: 'center',
  },
  paymentQRButtonText: {
    color: '#FFFFFF',
    fontSize: FONT_SIZES.md,
    fontWeight: '700',
  },
  identifierRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  identifierLabel: {
    fontSize: 12,
    color: '#000000',
    fontWeight: '700',
  },
  identifierValue: {
    fontSize: 13,
    color: '#000000',
    fontWeight: '700',
  },
  trustBadgeLarge: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: BORDER_RADIUS.full,
    marginTop: SPACING.md,
  },
  trustBadgeText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  balanceCard: {
    backgroundColor: COLORS.card,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    alignItems: 'center',
    marginBottom: SPACING.md,
    borderWidth: 2,
    borderColor: COLORS.primary,
  },
  balanceLabel: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textSecondary,
  },
  balanceValue: {
    fontSize: 36,
    fontWeight: '700',
    color: COLORS.primary,
    marginTop: SPACING.xs,
  },
  trustCard: {
    backgroundColor: COLORS.card,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
  },
  sectionTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: SPACING.md,
  },
  trustScoreContainer: {
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  trustScore: {
    fontSize: 48,
    fontWeight: '700',
    color: COLORS.text,
  },
  starsContainer: {
    flexDirection: 'row',
    marginTop: SPACING.xs,
  },
  star: {
    fontSize: 24,
    marginHorizontal: 2,
  },
  trustDetails: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  trustDetailItem: {
    alignItems: 'center',
    flex: 1,
  },
  trustDetailValue: {
    fontSize: FONT_SIZES.xxl,
    fontWeight: '700',
    color: COLORS.text,
  },
  trustDetailLabel: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.textSecondary,
    marginTop: SPACING.xs,
  },
  trustDetailDivider: {
    width: 1,
    backgroundColor: COLORS.border,
  },
  breakdownCard: {
    backgroundColor: COLORS.card,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
  },
  breakdownLabel: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textSecondary,
  },
  breakdownValue: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '700',
    color: COLORS.text,
  },
  breakdownHint: {
    marginTop: SPACING.sm,
    fontSize: FONT_SIZES.xs,
    color: COLORS.textMuted,
  },
  verificationCard: {
    backgroundColor: COLORS.card,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
  },
  badgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.xs,
    marginBottom: SPACING.sm,
  },
  statusBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 6,
    borderRadius: BORDER_RADIUS.full,
  },
  statusBadgeText: {
    color: '#FFFFFF',
    fontSize: FONT_SIZES.xs,
    fontWeight: '700',
  },
  checklistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: SPACING.xs,
  },
  checkIcon: {
    marginRight: SPACING.xs,
    fontSize: FONT_SIZES.sm,
  },
  checkText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text,
  },
  deletionCard: {
    backgroundColor: COLORS.card,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
  },
  deletionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
  },
  deletionLabel: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textSecondary,
  },
  deletionValue: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text,
    fontWeight: '600',
  },
  deletionHint: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.textMuted,
  },
  disputeCard: {
    backgroundColor: COLORS.card,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
  },
  disputeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  disputeLabel: {
    fontSize: FONT_SIZES.lg,
    color: COLORS.text,
  },
  disputeValue: {
    fontSize: FONT_SIZES.xxl,
    fontWeight: '700',
  },
  disputeNote: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.success,
    marginTop: SPACING.sm,
  },
  settingsCard: {
    backgroundColor: COLORS.card,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
  },
  settingsItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  settingsIcon: {
    fontSize: 20,
    marginRight: SPACING.md,
  },
  settingsText: {
    flex: 1,
    fontSize: FONT_SIZES.md,
    color: COLORS.text,
  },
  settingsArrow: {
    fontSize: FONT_SIZES.lg,
    color: COLORS.textMuted,
  },
  appInfo: {
    alignItems: 'center',
    marginTop: SPACING.xl,
    paddingTop: SPACING.lg,
  },
  appLogo: {
    fontSize: 32,
  },
  appName: {
    fontSize: FONT_SIZES.xl,
    fontWeight: '700',
    color: COLORS.primary,
    marginTop: SPACING.xs,
  },
  appTagline: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textSecondary,
  },
  appVersion: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.textMuted,
    marginTop: SPACING.xs,
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

