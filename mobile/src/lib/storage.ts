/**
 * PMARTS Storage Library
 * 
 * Handles file uploads to Supabase Storage for dispute evidence.
 */

import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { decode } from 'base64-arraybuffer';
import { supabase } from './supabase';
import { API_URL } from './api';
import dlog, { derror } from './dlog';

const EVIDENCE_BUCKET = 'evidence';

export interface UploadResult {
  success: boolean;
  url?: string;
  error?: string;
}

export interface EvidenceRecord {
  id: string;
  escrow_id: string;
  user_id: string;
  image_url: string;
  description: string;
  evidence_type: string;
  created_at: string;
}

/**
 * Request camera permissions
 */
export async function requestCameraPermissions(): Promise<boolean> {
  const { status } = await ImagePicker.requestCameraPermissionsAsync();
  return status === 'granted';
}

/**
 * Request media library permissions
 */
export async function requestMediaLibraryPermissions(): Promise<boolean> {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  return status === 'granted';
}

/**
 * Pick an image from the gallery
 */
export async function pickImage(): Promise<string | null> {
  const hasPermission = await requestMediaLibraryPermissions();
  if (!hasPermission) {
    return null;
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    aspect: [4, 3],
    quality: 0.8,
  });

  if (result.canceled || !result.assets[0]) {
    return null;
  }

  return result.assets[0].uri;
}

/**
 * Take a photo with the camera
 */
export async function takePhoto(): Promise<string | null> {
  const hasPermission = await requestCameraPermissions();
  if (!hasPermission) {
    return null;
  }

  const result = await ImagePicker.launchCameraAsync({
    allowsEditing: true,
    aspect: [4, 3],
    quality: 0.8,
  });

  if (result.canceled || !result.assets[0]) {
    return null;
  }

  return result.assets[0].uri;
}

/**
 * Upload an image to Supabase Storage
 */
export async function uploadToStorage(
  localUri: string,
  escrowId: string,
  userId: string
): Promise<UploadResult> {
  try {
    // Read file as base64
    const base64 = await FileSystem.readAsStringAsync(localUri, {
      encoding: 'base64',
    });

    // Generate unique filename
    const fileExt = localUri.split('.').pop() || 'jpg';
    const fileName = `${escrowId}/${userId}_${Date.now()}.${fileExt}`;

    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from(EVIDENCE_BUCKET)
      .upload(fileName, decode(base64), {
        contentType: `image/${fileExt}`,
        upsert: false,
      });

    if (error) {
      derror('Storage upload error:', error);
      return { success: false, error: error.message };
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from(EVIDENCE_BUCKET)
      .getPublicUrl(fileName);

    return {
      success: true,
      url: urlData.publicUrl,
    };
  } catch (error) {
    derror('Upload error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Upload failed',
    };
  }
}

/**
 * Upload evidence and record in database
 */
export async function uploadEvidence(
  localUri: string,
  escrowId: string,
  disputeId: string | null,
  userId: string,
  description: string,
  evidenceType: 'screenshot' | 'receipt' | 'chat_log' | 'delivery_proof' = 'screenshot'
): Promise<{ success: boolean; evidence?: EvidenceRecord; error?: string }> {
  try {
    // First upload to storage
    const uploadResult = await uploadToStorage(localUri, escrowId, userId);
    
    if (!uploadResult.success || !uploadResult.url) {
      return { success: false, error: uploadResult.error || 'Failed to upload image' };
    }

    // Record evidence in database via API
    const response = await fetch(`${API_URL}/disputes/evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        disputeId,
        escrowId,
        userId,
        imageUrl: uploadResult.url,
        description,
        evidenceType,
      }),
    });

    const result = await response.json();

    if (!result.success) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      evidence: result.evidence,
    };
  } catch (error) {
    derror('Evidence upload error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to upload evidence',
    };
  }
}

/**
 * Get evidence for an escrow
 */
export async function getEvidenceForEscrow(escrowId: string): Promise<EvidenceRecord[]> {
  try {
    const { data, error } = await supabase
      .from('dispute_evidence')
      .select('*')
      .eq('escrow_id', escrowId)
      .order('created_at', { ascending: false });

    if (error) {
      derror('Failed to fetch evidence:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    derror('Get evidence error:', error);
    return [];
  }
}

/**
 * Delete evidence (only owner can delete)
 */
export async function deleteEvidence(evidenceId: string, userId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('dispute_evidence')
      .delete()
      .eq('id', evidenceId)
      .eq('user_id', userId);

    return !error;
  } catch (error) {
    derror('Delete evidence error:', error);
    return false;
  }
}

