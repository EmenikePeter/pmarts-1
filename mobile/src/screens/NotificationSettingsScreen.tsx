/**
 * Notification Preferences Screen
 * 
 * Allows users to configure notification settings
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  ActivityIndicator,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import * as SecureStore from 'expo-secure-store';
import { supabase, SUPABASE_CONFIG_VALID } from '../lib/supabase';
import { getApiEndpoint } from '../lib/api';
import { getBestAuthTokenFromSupabase } from '../lib/appSession';
import { debugError, debugLog, debugWarn } from '../lib/debugLogger';
import { useToast } from '../components/Toast';
import { RootStackParamList } from '../lib/types';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES, HEADER_TITLE_TEXT } from '../lib/theme';

type NotificationSettingsScreenProps = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'NotificationSettings'>;
  route: RouteProp<RootStackParamList, 'NotificationSettings'>;
};

interface NotificationPrefs {
  escrowCreated: boolean;
  escrowReceived: boolean;
  paymentReleased: boolean;
  paymentRefunded: boolean;
  disputeUpdates: boolean;
  ratingReceived: boolean;
  marketingUpdates: boolean;
}

const DEFAULT_PREFS: NotificationPrefs = {
  escrowCreated: true,
  escrowReceived: true,
  paymentReleased: true,
  paymentRefunded: true,
  disputeUpdates: true,
  ratingReceived: true,
  marketingUpdates: false,
};

const mapDbToPrefs = (row: any): NotificationPrefs => {
  const refunded =
    typeof row?.push_refund_completed === 'boolean'
      ? !!row.push_refund_completed
      : !!row?.push_release_completed;

  return {
    escrowCreated: !!row?.push_escrow_created,
    escrowReceived: !!row?.push_deposit_received,
    paymentReleased: !!row?.push_release_completed,
    paymentRefunded: refunded,
    disputeUpdates: !!row?.push_dispute_update,
    ratingReceived: !!row?.push_rating_received,
    marketingUpdates: !!row?.email_daily_summary,
  };
};

export default function NotificationSettingsScreen({ navigation, route }: NotificationSettingsScreenProps) {
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const retryCountRef = useRef(0);
  const MAX_RETRIES = 2;

  useEffect(() => {
    let channel: any;
    (async () => {
      await loadPreferences();
      try {
        channel = supabase
          .channel(`notification_prefs:${route.params.user.id}`)
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notification_preferences', filter: `user_id=eq.${route.params.user.id}` }, (payload: any) => {
            if (payload?.new) {
              setPrefs((prev) => ({
                ...prev,
                ...mapDbToPrefs(payload.new),
              }));
            }
          })
          .subscribe();
      } catch (e) {
        // ignore
      }
    })();

    return () => {
      try { channel?.unsubscribe(); } catch (e) {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toast = useToast();

  const loadPreferences = async () => {
    try {
      if (!SUPABASE_CONFIG_VALID) {
        const msg = 'Supabase anon key missing in build (EXPO_PUBLIC_SUPABASE_ANON_KEY).';
        setLoadError(msg);
        toast.push({ type: 'error', message: `Failed to load preferences: ${msg}` });
        setLoading(false);
        return;
      }
      setLoadError(null);
      const uid = route.params.user.id;
      const { data, error } = await supabase
        .from('notification_preferences')
        .select('*')
        .eq('user_id', uid)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        // map DB fields to client prefs shape if needed
        setPrefs(mapDbToPrefs(data));
      } else {
        // create default row for user
        const toInsert = {
          push_escrow_created: DEFAULT_PREFS.escrowCreated,
          push_deposit_received: DEFAULT_PREFS.escrowReceived,
          push_release_completed: DEFAULT_PREFS.paymentReleased,
          push_dispute_update: DEFAULT_PREFS.disputeUpdates,
          push_rating_received: DEFAULT_PREFS.ratingReceived,
          email_daily_summary: DEFAULT_PREFS.marketingUpdates,
        };

        // Upsert via server endpoint to avoid RLS issues
        try {
          const headers: any = { 'Content-Type': 'application/json' };
          // Wait briefly for session if token not present (avoid race)
          let useToken = await getBestAuthTokenFromSupabase(supabase) || '';
          if (!useToken) {
            useToken = await waitForSession(2000);
          }
          if (!useToken) {
            throw new Error('Not authenticated');
          }
          // Debug: log masked token presence
          try { debugLog('[NotificationSettings] insert default prefs token present:', { hasToken: !!useToken, mask: useToken ? (String(useToken).slice(0,8) + '...') : null }); } catch (e) {}
          if (useToken) headers.Authorization = `Bearer ${useToken}`;
          const resp = await fetch(getApiEndpoint('/api/notification-preferences/preferences'), {
            method: 'POST',
            headers,
            body: JSON.stringify({ user_id: uid, preferences: toInsert }),
          });
          if (!resp.ok) {
            const errBody = await resp.json().catch(() => ({}));
            debugWarn('Failed to insert default notification prefs', errBody);
          }
        } catch (e) {
          debugWarn('Failed to insert default notification prefs', e);
        }

        setPrefs(DEFAULT_PREFS);
      }

      // realtime subscription is created in the outer effect; no-op here
      debugLog('[NotificationSettings] loadPreferences completed');
    } catch (err: any) {
      // log full payload to debug panel
      debugError('Failed to load notification preferences', err);
      // also record a dedicated payload entry for easier inspection
      debugLog('[NotificationSettings] Supabase error payload', err);

      const message = (err && (err.message || err.error || err.msg)) ? (err.message || err.error || err.msg) : 'Unknown error';
      setLoadError(message);
      // show short toast with error summary
      toast.push({ type: 'error', message: `Failed to load preferences: ${message}` });

      // automatic retry with backoff
      if (retryCountRef.current < MAX_RETRIES) {
        retryCountRef.current += 1;
        const delay = 2000 * retryCountRef.current;
        debugLog('[NotificationSettings] retrying load', { attempt: retryCountRef.current, delay });
        setTimeout(() => {
          loadPreferences();
        }, delay);
      }
    } finally {
      setLoading(false);
    }
  };

  // Helper: reliably obtain a Supabase access token
  const getUserAccessToken = async (): Promise<string> => {
    try {
      const token = await getBestAuthTokenFromSupabase(supabase);
      if (token) return token;
    } catch (e) {
      // ignore
    }

    // Fallback for web: inspect localStorage keys where supabase may persist the session
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const candidates = [
          'supabase.auth.token',
          'sb:token',
          'supabase.auth.session',
        ];
        for (const key of candidates) {
          const raw = window.localStorage.getItem(key);
          if (!raw) continue;
          try {
            const parsed = JSON.parse(raw);
            // search recursively for access_token
            const findToken = (obj: any): string | null => {
              if (!obj || typeof obj !== 'object') return null;
              if (typeof obj.access_token === 'string') return obj.access_token;
              for (const k of Object.keys(obj)) {
                const t = findToken(obj[k]);
                if (t) return t;
              }
              return null;
            };
            const t = findToken(parsed);
            if (t) return t;
          } catch (e) {
            continue;
          }
        }
      }
    } catch (e) {
      // ignore
    }
    return '';
  };

  // Wait for session to appear (polls for up to timeoutMs)
  const waitForSession = async (timeoutMs = 2000): Promise<string> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const token = await getUserAccessToken();
      if (token) return token;
      await new Promise((r) => setTimeout(r, 150));
    }
    return '';
  };

  const updatePref = async (key: keyof NotificationPrefs, value: boolean) => {
    const newPrefs = { ...prefs, [key]: value };
    setPrefs(newPrefs);
    setSaving(true);
    try {
      const uid = route.params.user.id;
      const payload: any = { user_id: uid };
      // map client key to DB column
      switch (key) {
        case 'escrowCreated': payload.push_escrow_created = value; break;
        case 'escrowReceived': payload.push_deposit_received = value; break;
        case 'paymentReleased': payload.push_release_completed = value; break;
        case 'paymentRefunded': payload.push_refund_completed = value; break;
        case 'disputeUpdates': payload.push_dispute_update = value; break;
        case 'ratingReceived': payload.push_rating_received = value; break;
        case 'marketingUpdates': payload.email_daily_summary = value; break;
      }

      // Post update to server endpoint which upserts under service-role
      try {
        // remove user_id from prefs object when sending as 'preferences'
        const { user_id: uidPayload, ...prefsOnly } = payload as any;
        const headers: any = { 'Content-Type': 'application/json' };
        // Wait briefly for session if token not present (avoid race)
        let useToken = await getBestAuthTokenFromSupabase(supabase) || '';
        if (!useToken) {
          useToken = await waitForSession(2000);
        }
        if (!useToken) {
          throw new Error('Not authenticated');
        }
        // Debug: log masked token presence
        try { debugLog('[NotificationSettings] saving prefs token present:', { hasToken: !!useToken, mask: useToken ? (String(useToken).slice(0,8) + '...') : null }); } catch (e) {}
        if (useToken) headers.Authorization = `Bearer ${useToken}`;
        let resp = await fetch(getApiEndpoint('/api/notification-preferences/preferences'), {
          method: 'POST',
          headers,
          body: JSON.stringify({ user_id: uid, preferences: prefsOnly }),
        });

        let body = await resp.json().catch(() => null);

        // Backward compatibility: if DB hasn't been migrated yet, fallback to push_release_completed
        if (!resp.ok && key === 'paymentRefunded') {
          const msg = String(body?.error || body?.message || '');
          if (msg.toLowerCase().includes('push_refund_completed')) {
            const fallbackPrefs = { ...prefsOnly, push_release_completed: value } as any;
            delete fallbackPrefs.push_refund_completed;
            resp = await fetch(getApiEndpoint('/api/notification-preferences/preferences'), {
              method: 'POST',
              headers,
              body: JSON.stringify({ user_id: uid, preferences: fallbackPrefs }),
            });
            body = await resp.json().catch(() => null);
            if (resp.ok) {
              debugWarn('[NotificationSettings] push_refund_completed missing; fell back to push_release_completed');
            }
          }
        }

        if (!resp.ok) {
          throw new Error(body?.error || 'Failed to save preferences');
        }
      } catch (e) {
        throw e;
      }
      toast.push({ type: 'success', message: 'Preferences saved' });
    } catch (err: any) {
      debugError('Failed to save notification preferences', err);
      debugLog('[NotificationSettings] save error payload', err);
      const summary = (err && (err.message || err.error)) ? (err.message || err.error) : 'Save failed';
      toast.push({ type: 'error', message: `Failed to save preferences: ${summary}` });
    } finally {
      setSaving(false);
    }
  };

  const NotificationToggle = ({ 
    icon, 
    title, 
    description, 
    prefKey 
  }: { 
    icon: string; 
    title: string; 
    description: string; 
    prefKey: keyof NotificationPrefs;
  }) => (
    <View style={styles.toggleRow}>
      <View style={styles.toggleLeft}>
        <Text style={styles.toggleIcon}>{icon}</Text>
        <View style={styles.toggleTextContainer}>
          <Text style={styles.toggleTitle}>{title}</Text>
          <Text style={styles.toggleDescription}>{description}</Text>
        </View>
      </View>
      <Switch
        value={prefs[prefKey]}
        onValueChange={(value) => updatePref(prefKey, value)}
        trackColor={{ false: COLORS.muted, true: COLORS.primary }}
        thumbColor="#FFFFFF"
      />
    </View>
  );

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (loadError && !loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={{ marginBottom: 12, color: COLORS.error }}>Failed to load preferences.</Text>
        <TouchableOpacity
          onPress={() => {
            retryCountRef.current = 0;
            setLoading(true);
            loadPreferences();
          }}
          style={{ backgroundColor: COLORS.primary, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8 }}
        >
          <Text style={{ color: '#fff', fontWeight: '700' }}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notification Preferences</Text>
        {saving ? (
          <ActivityIndicator size="small" color={COLORS.secondary} />
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.scrollContent}>
        {/* Escrow Notifications */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Escrow Notifications</Text>
          
          <NotificationToggle
            icon="📤"
            title="Escrow Created"
            description="When you create a new escrow"
            prefKey="escrowCreated"
          />
          
          <NotificationToggle
            icon="📥"
            title="Escrow Received"
            description="When someone creates an escrow for you"
            prefKey="escrowReceived"
          />
        </View>

        {/* Payment Notifications */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Payment Notifications</Text>
          
          <NotificationToggle
            icon="✅"
            title="Payment Released"
            description="When funds are released from escrow"
            prefKey="paymentReleased"
          />
          
          <NotificationToggle
            icon="↩️"
            title="Payment Refunded"
            description="When an escrow is refunded"
            prefKey="paymentRefunded"
          />
        </View>

        {/* Other Notifications */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Other Notifications</Text>
          
          <NotificationToggle
            icon="⚠️"
            title="Dispute Updates"
            description="Updates on dispute cases"
            prefKey="disputeUpdates"
          />
          
          <NotificationToggle
            icon="⭐"
            title="Ratings Received"
            description="When you receive a new rating"
            prefKey="ratingReceived"
          />
          
          <NotificationToggle
            icon="📢"
            title="Marketing Updates"
            description="News and promotional offers"
            prefKey="marketingUpdates"
          />
        </View>

        <Text style={styles.infoText}>
          These settings control in-app notifications. Push notifications require system permissions.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.surface,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
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
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  toggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  toggleIcon: {
    fontSize: 24,
    marginRight: SPACING.md,
  },
  toggleTextContainer: {
    flex: 1,
  },
  toggleTitle: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    color: COLORS.text,
  },
  toggleDescription: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  infoText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
});
