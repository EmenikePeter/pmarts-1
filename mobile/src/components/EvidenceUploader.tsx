import React, { useState } from 'react';
import { View, Button, Image, ActivityIndicator, Text, TouchableOpacity } from 'react-native';

type Props = {
  escrowId: string;
  disputeId?: string | null;
  userId: string;
  onUploaded?: (result: any) => void;
  maxFiles?: number;
};

const API_URL = (process.env.EXPO_PUBLIC_API_URL || '').replace(/\/+$/, '');

export default function EvidenceUploader({ escrowId, disputeId = null, userId, onUploaded, maxFiles = 5 }: Props) {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<Array<any>>([]);
  const [progress, setProgress] = useState<number | null>(null);

  async function pickAndUpload() {
    setError(null);
    try {
      // dynamic import to avoid hard dependency if not installed
      const ImagePicker = await import('expo-image-picker');
      const res = await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.8 });
      // modern expo-image-picker returns { canceled: boolean, assets: [...] }
      if ((res as any).canceled) return;
      const asset = (res as any).assets && (res as any).assets[0];
      if (!asset || !asset.uri) return;
      setPreview(asset.uri || null);
      setBusy(true);

      const filename = (asset.fileName && asset.fileName) || (asset.uri && asset.uri.split('/').pop()) || `evidence_${Date.now()}.jpg`;
      const contentType = asset.type ? `image/${asset.type}` : 'image/jpeg';

      // Prefer signed upload flow: request uploadUrl from server
      try {
        const suRes = await fetch(`${API_URL}/api/disputes/signed-upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ disputeId, escrowId, userId, filename, contentType }),
        });
        const suJson = await suRes.json();
        if (suJson && suJson.success && suJson.uploadUrl) {
            // Fetch file as blob and PUT to uploadUrl with progress using XHR
            try {
              const fileResp = await fetch(asset.uri);
              const blob = await fileResp.blob();
              await new Promise<void>((resolve, reject) => {
                try {
                  const xhr = new XMLHttpRequest();
                  xhr.open('PUT', suJson.uploadUrl);
                  xhr.setRequestHeader('Content-Type', contentType);
                  xhr.upload.onprogress = (ev) => {
                    if (ev.lengthComputable) {
                      setProgress(Math.round((ev.loaded / ev.total) * 100));
                    }
                  };
                  xhr.onload = async () => {
                    setProgress(null);
                    if (xhr.status >= 200 && xhr.status < 300) {
                      // Optionally record evidence row via server if needed
                      try {
                        const recordResp = await fetch(`${API_URL}/api/disputes/evidence`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ disputeId, escrowId, userId, imageUrl: suJson.publicUrl || null, description: '' }),
                        });
                        const recordJson = await recordResp.json();
                        setBusy(false);
                        if (!recordJson || !recordJson.success) {
                          setError(recordJson?.error || 'Upload recorded but evidence record failed');
                          reject(new Error('record failed'));
                          return;
                        }
                        const result = { publicUrl: suJson.publicUrl || null, evidence: recordJson.evidence || null };
                        setUploaded((s) => [result, ...s]);
                        onUploaded && onUploaded(result);
                        resolve();
                        return;
                      } catch (e) {
                        setBusy(false);
                        console.warn('Signed upload record failed', e);
                        reject(e);
                        return;
                      }
                    } else {
                      reject(new Error('Upload PUT failed'));
                    }
                  };
                  xhr.onerror = (e) => {
                    setProgress(null);
                    reject(new Error('XHR upload failed'));
                  };
                  xhr.send(blob as any);
                } catch (e) {
                  setProgress(null);
                  reject(e);
                }
              });
              return;
            } catch (e) {
              // fallthrough to base64 fallback
              console.warn('Signed upload failed, falling back to base64', e);
            }
        }
      } catch (e) {
        console.warn('Signed-upload request failed, falling back to base64', e);
      }

      // Fallback: send base64 to /upload
      const base64Data = asset.base64 || (res as any).base64 || null;
      if (!base64Data) {
        setBusy(false);
        setError('Image picker did not return base64 data');
        return;
      }

      const body = {
        disputeId,
        escrowId,
        userId,
        filename,
        contentType,
        base64: base64Data,
      };

      const r = await fetch(`${API_URL}/api/disputes/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await r.json();
      setBusy(false);
      if (!json || !json.success) {
        setError(json?.error || 'Upload failed');
        return;
      }
      setUploaded((s) => [json, ...s]);
      onUploaded && onUploaded(json);
    } catch (e: any) {
      setBusy(false);
      setError(e?.message || String(e));
    }
  }

  return (
    <View>
      {uploaded && uploaded.length > 0 ? (
        <View style={{ flexDirection: 'row', marginBottom: 8 }}>
          {uploaded.slice(0, 5).map((u, idx) => (
            <View key={idx} style={{ marginRight: 8 }}>
              <Image source={{ uri: u.publicUrl || u.thumbnailPublicUrl || u.imageUrl || u.publicUrl }} style={{ width: 80, height: 60, borderRadius: 6 }} />
              <TouchableOpacity
                onPress={async () => {
                  // Attempt delete via API
                  try {
                    const evidenceId = u?.evidence?.id || u?.evidence?.evidence_id || u?.evidence?.id || u?.evidence_id || u?.evidenceId || null;
                    if (!evidenceId) {
                      setError('Cannot delete: missing evidence id');
                      return;
                    }
                    const del = await fetch(`${API_URL}/api/disputes/evidence/${encodeURIComponent(evidenceId)}`, {
                      method: 'DELETE',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ userId }),
                    });
                    const delJson = await del.json().catch(() => ({}));
                    if (!delJson || !delJson.success) {
                      setError(delJson?.error || 'Delete failed');
                      return;
                    }
                    setUploaded((prev) => prev.filter((it) => it !== u));
                  } catch (e: any) {
                    setError(e?.message || String(e));
                  }
                }}
                style={{ position: 'absolute', top: -6, right: -6, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 12, padding: 4 }}
              >
                <Text style={{ color: '#fff', fontSize: 12 }}>×</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ) : null}
      {preview ? <Image source={{ uri: preview }} style={{ width: 240, height: 160, marginBottom: 8 }} /> : null}
      {busy ? (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <ActivityIndicator />
          <Text style={{ marginLeft: 8 }}>{progress ? `Uploading… ${progress}%` : 'Uploading…'}</Text>
        </View>
      ) : (
        <Button title={`Pick & Upload Evidence (${uploaded.length}/${maxFiles})`} onPress={pickAndUpload} disabled={uploaded.length >= (maxFiles || 1)} />
      )}
      {error ? <Text style={{ color: 'red' }}>{error}</Text> : null}
    </View>
  );
}
