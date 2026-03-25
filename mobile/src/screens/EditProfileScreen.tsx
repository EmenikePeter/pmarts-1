/**
 * Edit Profile Screen
 * 
 * Allows users to update their profile information
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Image,
  ActivityIndicator,
} from 'react-native';
import { useToast } from '../components/Toast';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { Button } from '../components';
import { RootStackParamList, User } from '../lib/types';
import { debugError } from '../lib/debugLogger';
import { getApiEndpoint } from '../lib/api';
import { getBestAuthTokenFromSupabase } from '../lib/appSession';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES, HEADER_TITLE_TEXT } from '../lib/theme';

type EditProfileScreenProps = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'EditProfile'>;
  route: RouteProp<RootStackParamList, 'EditProfile'>;
};

export default function EditProfileScreen({ navigation, route }: EditProfileScreenProps) {
  const { user, onUpdate } = route.params;
  const [username, setUsername] = useState(user.username || '');
  const [bio, setBio] = useState((user as any).bio || '');
  const [location, setLocation] = useState((user as any).location || '');
  const [preferredLanguage, setPreferredLanguage] = useState((user as any).preferred_language || 'English');
  const [avatarVisibility, setAvatarVisibility] = useState<'public' | 'counterparties_only'>((user as any).avatar_visibility || 'public');
  const [themePreset, setThemePreset] = useState<'default' | 'business' | 'quiet'>((user as any).theme_preset || 'default');
  const [notificationPreset, setNotificationPreset] = useState<'balanced' | 'business' | 'minimal'>((user as any).notification_preset || 'balanced');
  const [avatarUrl, setAvatarUrl] = useState<string | null>((user as any).avatar_url || null);
  const [loading, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const toast = useToast();

  const loadSignedAvatarUrl = async () => {
    try {
      const token = await getBestAuthTokenFromSupabase(supabase);
      if (!token) return;
      const resp = await fetch(getApiEndpoint('/api/user/profile/avatar-url'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await resp.json().catch(() => null);
      if (resp.ok && body?.avatar_url) {
        setAvatarUrl(body.avatar_url);
      }
    } catch (e) {
      // best effort
    }
  };

  useEffect(() => {
    loadSignedAvatarUrl();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const uploadAvatar = async (fromCamera: boolean) => {
    try {
      setUploadingAvatar(true);
      const ImagePicker = await import('expo-image-picker');
      const permission = fromCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (permission.status !== 'granted') {
        toast.push({ type: 'error', message: fromCamera ? 'Camera permission denied' : 'Media permission denied' });
        return;
      }

      const result = fromCamera
        ? await ImagePicker.launchCameraAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.7,
            base64: true,
          })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.7,
            base64: true,
          });

      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];

      if (asset.fileSize && asset.fileSize > 4 * 1024 * 1024) {
        toast.push({ type: 'error', message: 'Avatar too large (max 4MB)' });
        return;
      }

      const base64 = asset.base64 || null;
      if (!base64) {
        toast.push({ type: 'error', message: 'Image processing failed (no base64)' });
        return;
      }

      const contentType = asset.mimeType || 'image/jpeg';
      const token = await getBestAuthTokenFromSupabase(supabase);
      if (!token) {
        toast.push({ type: 'error', message: 'Please login again before uploading avatar' });
        return;
      }

      const resp = await fetch(getApiEndpoint('/api/user/profile/avatar-upload'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ base64, contentType }),
      });

      const body = await resp.json().catch(() => null);
      if (!resp.ok || !body?.success) {
        throw new Error(body?.error || 'Failed to upload avatar');
      }

      setAvatarUrl(body.avatar_url || null);
      toast.push({ type: 'success', message: 'Avatar uploaded (pending moderation review)' });
    } catch (err: any) {
      debugError('[EditProfile] avatar upload failed', err);
      toast.push({ type: 'error', message: err?.message || 'Failed to upload avatar' });
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleSave = async () => {
    if (!username.trim()) {
      try { toast.push({ type: 'error', message: 'Username cannot be empty' }); } catch(e) {}
      return;
    }

    if (username.length < 3) {
      try { toast.push({ type: 'error', message: 'Username must be at least 3 characters' }); } catch(e) {}
      return;
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      try { toast.push({ type: 'error', message: 'Username can only contain letters, numbers, and underscores' }); } catch(e) {}
      return;
    }

    setSaving(true);
    try {
      const token = await getBestAuthTokenFromSupabase(supabase);
      if (!token) {
        try { toast.push({ type: 'error', message: 'Session expired. Please login again.' }); } catch(e) {}
        return;
      }

      const resp = await fetch(getApiEndpoint('/api/user/profile/update'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          username: username.trim(),
          bio: bio.trim() || null,
          location: location.trim() || null,
          preferred_language: preferredLanguage.trim() || null,
          avatar_visibility: avatarVisibility,
          theme_preset: themePreset,
          notification_preset: notificationPreset,
        }),
      });

      const body = await resp.json().catch(() => null);
      if (!resp.ok || !body?.success) {
        if (resp.status === 409) {
          try { toast.push({ type: 'error', message: 'This username is already taken' }); } catch(e) {}
          return;
        }
        throw new Error(body?.error || 'Failed to update profile');
      }

      // Update the user object
      const updatedUser: User = {
        ...(user as any),
        ...(body.user || {}),
        username: username.trim(),
        bio: bio.trim() || null,
        location: location.trim() || null,
        preferred_language: preferredLanguage.trim() || null,
        avatar_visibility: avatarVisibility,
        theme_preset: themePreset,
        notification_preset: notificationPreset,
      } as User;
      (updatedUser as any).avatar_url = avatarUrl || null;
      
      // Call callback if provided
      if (onUpdate) {
        onUpdate(updatedUser);
      }

      try { toast.push({ type: 'success', message: 'Profile updated successfully' }); } catch(e) {}
      navigation.goBack();
    } catch (err: any) {
      debugError('Failed to update profile:', err);
      try { toast.push({ type: 'error', message: 'Failed to update profile. Please try again.' }); } catch(e) {}
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit Profile</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.scrollContent}>
        {/* Avatar Preview */}
        <View style={styles.avatarSection}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.avatar} />
          ) : (
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {username.charAt(0).toUpperCase() || user.pi_id.charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
          <Text style={styles.avatarHint}>Profile photo (camera/gallery, cropped + compressed)</Text>
          <View style={styles.avatarActionsRow}>
            <TouchableOpacity style={styles.smallActionBtn} onPress={() => uploadAvatar(false)} disabled={uploadingAvatar}>
              <Text style={styles.smallActionText}>Choose</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.smallActionBtn} onPress={() => uploadAvatar(true)} disabled={uploadingAvatar}>
              <Text style={styles.smallActionText}>Camera</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.smallActionBtn} onPress={loadSignedAvatarUrl}>
              <Text style={styles.smallActionText}>Refresh</Text>
            </TouchableOpacity>
          </View>
          {uploadingAvatar && <ActivityIndicator size="small" color={COLORS.primary} style={{ marginTop: SPACING.xs }} />}
        </View>

        {/* Form */}
        <View style={styles.formSection}>
          <Text style={styles.label}>Username</Text>
          <TextInput
            style={styles.input}
            value={username}
            onChangeText={setUsername}
            placeholder="Enter username"
            placeholderTextColor={COLORS.muted}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={20}
          />
          <Text style={styles.hint}>
            3-20 characters. Letters, numbers, and underscores only.
          </Text>

          <Text style={styles.label}>Pi ID</Text>
          <View style={styles.readOnlyField}>
            <Text style={styles.readOnlyText}>{user.pi_id}</Text>
          </View>
          <Text style={styles.hint}>
            Your Pi ID cannot be changed
          </Text>

          <Text style={styles.label}>Bio</Text>
          <TextInput
            style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]}
            value={bio}
            onChangeText={setBio}
            placeholder="Tell people about yourself"
            placeholderTextColor={COLORS.muted}
            multiline
            maxLength={280}
          />
          <Text style={styles.hint}>Optional. Max 280 characters.</Text>

          <Text style={styles.label}>Location</Text>
          <TextInput
            style={styles.input}
            value={location}
            onChangeText={setLocation}
            placeholder="City, Country"
            placeholderTextColor={COLORS.muted}
            maxLength={120}
          />
          <Text style={styles.hint}>Optional.</Text>

          <Text style={styles.label}>Preferred language</Text>
          <TextInput
            style={styles.input}
            value={preferredLanguage}
            onChangeText={setPreferredLanguage}
            placeholder="English"
            placeholderTextColor={COLORS.muted}
            maxLength={30}
          />
          <Text style={styles.hint}>Used for personalization.</Text>

          <Text style={styles.label}>Avatar privacy</Text>
          <View style={styles.pillRow}>
            <TouchableOpacity
              style={[styles.pill, avatarVisibility === 'public' && styles.pillActive]}
              onPress={() => setAvatarVisibility('public')}
            >
              <Text style={[styles.pillText, avatarVisibility === 'public' && styles.pillTextActive]}>Public</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.pill, avatarVisibility === 'counterparties_only' && styles.pillActive]}
              onPress={() => setAvatarVisibility('counterparties_only')}
            >
              <Text style={[styles.pillText, avatarVisibility === 'counterparties_only' && styles.pillTextActive]}>Counterparties only</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>Theme preset</Text>
          <View style={styles.pillRow}>
            {(['default', 'business', 'quiet'] as const).map((preset) => (
              <TouchableOpacity
                key={preset}
                style={[styles.pill, themePreset === preset && styles.pillActive]}
                onPress={() => setThemePreset(preset)}
              >
                <Text style={[styles.pillText, themePreset === preset && styles.pillTextActive]}>{preset}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Notification preset</Text>
          <View style={styles.pillRow}>
            {(['balanced', 'business', 'minimal'] as const).map((preset) => (
              <TouchableOpacity
                key={preset}
                style={[styles.pill, notificationPreset === preset && styles.pillActive]}
                onPress={() => setNotificationPreset(preset)}
              >
                <Text style={[styles.pillText, notificationPreset === preset && styles.pillTextActive]}>{preset}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Save Button */}
        <Button
          title={loading ? "Saving..." : "Save Changes"}
          onPress={handleSave}
          disabled={loading}
          style={{ marginTop: SPACING.lg }}
        />

        {loading && (
          <ActivityIndicator 
            size="small" 
            color={COLORS.primary} 
            style={{ marginTop: SPACING.md }} 
          />
        )}
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
  content: {
    flex: 1,
  },
  scrollContent: {
    padding: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
  avatarSection: {
    alignItems: 'center',
    marginBottom: SPACING.xl,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.sm,
  },
  avatarText: {
    fontSize: 40,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  avatarHint: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
  },
  avatarActionsRow: {
    flexDirection: 'row',
    marginTop: SPACING.sm,
    gap: SPACING.xs,
  },
  smallActionBtn: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
  },
  smallActionText: {
    color: COLORS.text,
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
  },
  formSection: {
    backgroundColor: COLORS.background,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
  },
  label: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: SPACING.xs,
  },
  input: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    fontSize: FONT_SIZES.md,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  hint: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.textMuted,
    marginTop: SPACING.xs,
    marginBottom: SPACING.lg,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.xs,
    marginBottom: SPACING.lg,
  },
  pill: {
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.full,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
  },
  pillActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  pillText: {
    color: COLORS.text,
    fontSize: FONT_SIZES.xs,
    textTransform: 'capitalize',
  },
  pillTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  readOnlyField: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    opacity: 0.6,
  },
  readOnlyText: {
    fontSize: FONT_SIZES.md,
    color: COLORS.textMuted,
  },
});

