/**
 * PMARTS Evidence Upload Component
 * 
 * Allows users to upload screenshots, receipts, and other evidence
 * for dispute resolution.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Alert,
  TextInput,
  ScrollView,
  Modal,
} from 'react-native';
import { useToast } from './Toast';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../lib/theme';
import {
  pickImage,
  takePhoto,
  uploadEvidence,
  EvidenceRecord,
} from '../lib/storage';

interface EvidenceUploadProps {
  escrowId: string;
  disputeId: string | null;
  userId: string;
  onUploadComplete: (evidence: EvidenceRecord) => void;
  onClose: () => void;
}

type EvidenceType = 'screenshot' | 'receipt' | 'chat_log' | 'delivery_proof';

const EVIDENCE_TYPES: { value: EvidenceType; label: string; icon: string }[] = [
  { value: 'screenshot', label: 'Screenshot', icon: '📸' },
  { value: 'receipt', label: 'Receipt', icon: '🧾' },
  { value: 'chat_log', label: 'Chat Log', icon: '💬' },
  { value: 'delivery_proof', label: 'Delivery Proof', icon: '📦' },
];

export default function EvidenceUpload({
  escrowId,
  disputeId,
  userId,
  onUploadComplete,
  onClose,
}: EvidenceUploadProps) {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [evidenceType, setEvidenceType] = useState<EvidenceType>('screenshot');
  const [uploading, setUploading] = useState(false);
  const [showSourcePicker, setShowSourcePicker] = useState(false);
  const toast = useToast();

  const handlePickImage = async () => {
    const uri = await pickImage();
    if (uri) {
      setSelectedImage(uri);
    }
    setShowSourcePicker(false);
  };

  const handleTakePhoto = async () => {
    const uri = await takePhoto();
    if (uri) {
      setSelectedImage(uri);
    }
    setShowSourcePicker(false);
  };

  const handleUpload = async () => {
    if (!selectedImage) {
      try { toast.push({ type: 'error', message: 'Please select an image to upload.' }); } catch(e) {}
      return;
    }

    if (!description.trim()) {
      try { toast.push({ type: 'error', message: 'Please add a description for this evidence.' }); } catch(e) {}
      return;
    }

    setUploading(true);

    try {
      const result = await uploadEvidence(
        selectedImage,
        escrowId,
        disputeId,
        userId,
        description.trim(),
        evidenceType
      );

      if (result.success && result.evidence) {
        try { toast.push({ type: 'success', message: 'Evidence uploaded successfully!' }); } catch(e) {}
        onUploadComplete(result.evidence);
      } else {
        try { toast.push({ type: 'error', message: result.error || 'Failed to upload evidence.' }); } catch(e) {}
      }
    } catch (error) {
      try { toast.push({ type: 'error', message: 'An unexpected error occurred.' }); } catch(e) {}
    } finally {
      setUploading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Upload Evidence</Text>
        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <Text style={styles.closeText}>✕</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Image Selection */}
        <TouchableOpacity
          style={styles.imageSelector}
          onPress={() => setShowSourcePicker(true)}
          disabled={uploading}
        >
          {selectedImage ? (
            <Image source={{ uri: selectedImage }} style={styles.previewImage} />
          ) : (
            <View style={styles.imagePlaceholder}>
              <Text style={styles.imagePlaceholderIcon}>📷</Text>
              <Text style={styles.imagePlaceholderText}>Tap to select image</Text>
            </View>
          )}
        </TouchableOpacity>

        {/* Evidence Type Selection */}
        <Text style={styles.label}>Evidence Type</Text>
        <View style={styles.typeContainer}>
          {EVIDENCE_TYPES.map((type) => (
            <TouchableOpacity
              key={type.value}
              style={[
                styles.typeButton,
                evidenceType === type.value && styles.typeButtonActive,
              ]}
              onPress={() => setEvidenceType(type.value)}
              disabled={uploading}
            >
              <Text style={styles.typeIcon}>{type.icon}</Text>
              <Text
                style={[
                  styles.typeLabel,
                  evidenceType === type.value && styles.typeLabelActive,
                ]}
              >
                {type.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Description */}
        <Text style={styles.label}>Description</Text>
        <TextInput
          style={styles.descriptionInput}
          placeholder="Describe what this evidence shows..."
          placeholderTextColor={COLORS.textMuted}
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={3}
          editable={!uploading}
        />

        {/* Upload Button */}
        <TouchableOpacity
          style={[styles.uploadButton, (!selectedImage || uploading) && styles.uploadButtonDisabled]}
          onPress={handleUpload}
          disabled={!selectedImage || uploading}
        >
          {uploading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.uploadButtonText}>Upload Evidence</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.hint}>
          Evidence will be reviewed by both parties and may be used in dispute resolution.
        </Text>
      </ScrollView>

      {/* Source Picker Modal */}
      <Modal
        visible={showSourcePicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSourcePicker(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowSourcePicker(false)}
        >
          <View style={styles.sourcePickerContainer}>
            <Text style={styles.sourcePickerTitle}>Select Image Source</Text>
            
            <TouchableOpacity style={styles.sourceOption} onPress={handleTakePhoto}>
              <Text style={styles.sourceIcon}>📷</Text>
              <Text style={styles.sourceLabel}>Take Photo</Text>
            </TouchableOpacity>
            
            <TouchableOpacity style={styles.sourceOption} onPress={handlePickImage}>
              <Text style={styles.sourceIcon}>🖼️</Text>
              <Text style={styles.sourceLabel}>Choose from Gallery</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => setShowSourcePicker(false)}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  title: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '600',
    color: COLORS.text,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeText: {
    fontSize: 18,
    color: COLORS.textSecondary,
  },
  content: {
    flex: 1,
    padding: SPACING.md,
  },
  imageSelector: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: BORDER_RADIUS.lg,
    overflow: 'hidden',
    marginBottom: SPACING.lg,
    backgroundColor: COLORS.surface,
    borderWidth: 2,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
  },
  previewImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  imagePlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  imagePlaceholderIcon: {
    fontSize: 48,
    marginBottom: SPACING.sm,
  },
  imagePlaceholderText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.md,
  },
  label: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: SPACING.sm,
    marginTop: SPACING.sm,
  },
  typeContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  typeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  typeButtonActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  typeIcon: {
    fontSize: 16,
    marginRight: SPACING.xs,
  },
  typeLabel: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textSecondary,
  },
  typeLabelActive: {
    color: '#FFFFFF',
  },
  descriptionInput: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    fontSize: FONT_SIZES.md,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.border,
    minHeight: 100,
    textAlignVertical: 'top',
    marginBottom: SPACING.lg,
  },
  uploadButton: {
    backgroundColor: COLORS.primary,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  uploadButtonDisabled: {
    backgroundColor: COLORS.border,
  },
  uploadButtonText: {
    color: '#FFFFFF',
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
  },
  hint: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginBottom: SPACING.lg,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sourcePickerContainer: {
    width: '80%',
    backgroundColor: COLORS.background,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
  },
  sourcePickerTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '600',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: SPACING.lg,
  },
  sourceOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.surface,
    marginBottom: SPACING.sm,
  },
  sourceIcon: {
    fontSize: 24,
    marginRight: SPACING.md,
  },
  sourceLabel: {
    fontSize: FONT_SIZES.md,
    color: COLORS.text,
  },
  cancelButton: {
    padding: SPACING.md,
    alignItems: 'center',
    marginTop: SPACING.sm,
  },
  cancelText: {
    fontSize: FONT_SIZES.md,
    color: COLORS.error,
  },
});

