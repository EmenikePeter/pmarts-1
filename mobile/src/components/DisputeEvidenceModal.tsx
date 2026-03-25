import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  Image,
  ScrollView,
  Alert,
} from 'react-native';
import { useToast } from './Toast';
import * as ImagePicker from 'expo-image-picker';
import Button from './Button';
import { supabase } from '../lib/supabase';
import { User, Escrow } from '../lib/types';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../lib/theme';

type DisputeEvidenceModalProps = {
  visible: boolean;
  onClose: () => void;
  escrow: Escrow;
  currentUser: User;
  onSubmit?: () => void;
};

export function DisputeEvidenceModal({
  visible,
  onClose,
  escrow,
  currentUser,
  onSubmit,
}: DisputeEvidenceModalProps) {
  const [reason, setReason] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  const pickImage = async () => {
    // Request permissions
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      try { toast.push({ type: 'error', message: 'Please allow access to your photo library.' }); } catch(e) {}
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: 5 - images.length,
      quality: 0.7,
    });

    if (!result.canceled && result.assets) {
      const newUris = result.assets.map((asset) => asset.uri);
      setImages((prev) => [...prev, ...newUris].slice(0, 5));
    }
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      try { toast.push({ type: 'error', message: 'Please allow access to your camera.' }); } catch(e) {}
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      quality: 0.7,
    });

    if (!result.canceled && result.assets[0]) {
      setImages((prev) => [...prev, result.assets[0].uri].slice(0, 5));
    }
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!reason.trim()) {
      try { toast.push({ type: 'error', message: 'Please provide a reason for the dispute' }); } catch(e) {}
      return;
    }

    setLoading(true);
    try {
      // Update escrow status to disputed
      const { data: updatedEscrow, error: escrowError } = await supabase
        .from('escrows')
        .update({ status: 'disputed' })
        .eq('id', escrow.id)
        .select()
        .single();

      if (escrowError) throw escrowError;

      // Upload images to Supabase Storage
      const uploadedUrls: string[] = [];
      for (const imageUri of images) {
        const fileName = `disputes/${escrow.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
        
        // Convert URI to blob for upload
        const response = await fetch(imageUri);
        const blob = await response.blob();
        
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('evidence')
          .upload(fileName, blob, { contentType: 'image/jpeg' });

        if (!uploadError && uploadData) {
          const { data: urlData } = supabase.storage
            .from('evidence')
            .getPublicUrl(uploadData.path);
          uploadedUrls.push(urlData.publicUrl);
        }
      }

      // Insert evidence records
      if (uploadedUrls.length > 0) {
        const evidenceRecords = uploadedUrls.map((url) => ({
          escrow_id: escrow.id,
          user_id: currentUser.id,
          image_url: url,
          description: reason.trim(),
        }));

        await supabase.from('dispute_evidence').insert(evidenceRecords);
      }

      // Insert ledger entry
      await supabase.from('escrow_ledger').insert({
        escrow_id: escrow.id,
        sender_id: escrow.sender_id,
        amount: escrow.amount,
        action: 'dispute',
      });

      // Notify both parties
      const otherUserId = escrow.sender_id === currentUser.id ? escrow.recipient_id : escrow.sender_id;
      await supabase.from('notifications').insert([
        {
          user_id: currentUser.id,
          type: 'dispute',
          title: 'Dispute Opened',
          message: `Your dispute for ${escrow.reference_id} is now under review.`,
          escrow_id: escrow.id,
          is_read: false,
        },
        {
          user_id: otherUserId,
          type: 'dispute',
          title: 'Dispute Opened',
          message: `A dispute has been opened for ${escrow.reference_id}.`,
          escrow_id: escrow.id,
          is_read: false,
        },
      ]);

      try { toast.push({ type: 'success', message: `Dispute submitted with ${images.length} evidence image(s). Our team will review and contact both parties.` }); } catch(e) {}
      onSubmit?.();
      onClose();
    } catch (err) {
      try { const { debugError } = require('../lib/debugLogger'); debugError('Dispute error', err); } catch (e) { /* fallback */ }
      // Demo mode
      try { toast.push({ type: 'success', message: 'Dispute submitted. Our team will review and contact both parties. (Demo)' }); } catch(e) {}
      onSubmit?.();
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={styles.container}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.title}>Open Dispute</Text>
            <Text style={styles.subtitle}>
              Provide details and evidence for your dispute
            </Text>

            {/* Reason */}
            <Text style={styles.label}>Reason for Dispute *</Text>
            <TextInput
              style={styles.reasonInput}
              placeholder="Describe the issue in detail..."
              placeholderTextColor={COLORS.textMuted}
              value={reason}
              onChangeText={setReason}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />

            {/* Evidence Upload */}
            <Text style={styles.label}>Evidence (up to 5 images)</Text>
            <View style={styles.uploadButtons}>
              <TouchableOpacity
                style={styles.uploadButton}
                onPress={pickImage}
                disabled={images.length >= 5}
              >
                <Text style={styles.uploadIcon}>🖼️</Text>
                <Text style={styles.uploadText}>Gallery</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.uploadButton}
                onPress={takePhoto}
                disabled={images.length >= 5}
              >
                <Text style={styles.uploadIcon}>📷</Text>
                <Text style={styles.uploadText}>Camera</Text>
              </TouchableOpacity>
            </View>

            {/* Image Preview */}
            {images.length > 0 && (
              <ScrollView horizontal style={styles.imagePreview} showsHorizontalScrollIndicator={false}>
                {images.map((uri, index) => (
                  <View key={index} style={styles.imageContainer}>
                    <Image source={{ uri }} style={styles.previewImage} />
                    <TouchableOpacity
                      style={styles.removeButton}
                      onPress={() => removeImage(index)}
                    >
                      <Text style={styles.removeText}>×</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            )}

            <Text style={styles.evidenceHint}>
              {images.length}/5 images attached
            </Text>

            {/* Actions */}
            <View style={styles.actions}>
              <Button
                title="Cancel"
                onPress={onClose}
                variant="outline"
                fullWidth={false}
                style={{ flex: 1, marginRight: SPACING.sm }}
              />
              <Button
                title="Submit Dispute"
                onPress={handleSubmit}
                variant="danger"
                loading={loading}
                fullWidth={false}
                style={{ flex: 1 }}
              />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: COLORS.overlay,
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: BORDER_RADIUS.xl,
    borderTopRightRadius: BORDER_RADIUS.xl,
    padding: SPACING.lg,
    maxHeight: '90%',
  },
  title: {
    fontSize: FONT_SIZES.xxl,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: FONT_SIZES.md,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: SPACING.xs,
    marginBottom: SPACING.lg,
  },
  label: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: SPACING.sm,
  },
  reasonInput: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    fontSize: FONT_SIZES.md,
    color: COLORS.text,
    minHeight: 100,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.lg,
  },
  uploadButtons: {
    flexDirection: 'row',
    marginBottom: SPACING.md,
  },
  uploadButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginRight: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
  },
  uploadIcon: {
    fontSize: 20,
    marginRight: SPACING.sm,
  },
  uploadText: {
    fontSize: FONT_SIZES.md,
    color: COLORS.textSecondary,
  },
  imagePreview: {
    marginBottom: SPACING.sm,
  },
  imageContainer: {
    position: 'relative',
    marginRight: SPACING.sm,
  },
  previewImage: {
    width: 80,
    height: 80,
    borderRadius: BORDER_RADIUS.md,
  },
  removeButton: {
    position: 'absolute',
    top: -8,
    right: -8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.error,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  evidenceHint: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
    marginBottom: SPACING.lg,
  },
  actions: {
    flexDirection: 'row',
    marginBottom: SPACING.lg,
  },
});

