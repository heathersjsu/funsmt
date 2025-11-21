import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Image, Platform } from 'react-native';
import { TextInput, Button, Card, Text, useTheme } from 'react-native-paper';
import { supabase } from '../../supabaseClient';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { uploadToyPhotoBestEffort, uploadToyPhotoWebBestEffort, uploadBase64PhotoBestEffort } from '../../utils/storage';

type Props = NativeStackScreenProps<any>;

// Ensure image URIs are safe on native (iOS/Android): allow only file:// and https://
const getSafeImageUri = (uri?: string) => {
  if (!uri) return undefined;
  if (Platform.OS === 'web') return uri;
  if (uri.startsWith('file://') || uri.startsWith('https://')) return uri;
  return undefined;
};

// removed duplicate styles; using the unified styles defined at the bottom of the file

export default function EditProfileScreen({ navigation }: Props) {
  const theme = useTheme();
  const [name, setName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draggedFile, setDraggedFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [avatarBase64, setAvatarBase64] = useState<string | null>(null);
  const [avatarContentType, setAvatarContentType] = useState<string | null>(null);
  const [originalAssetUri, setOriginalAssetUri] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const user = data.user;
      setName((user?.user_metadata?.full_name as string) || '');
      setAvatarUrl((user?.user_metadata?.avatar_url as string) || '');
    });
  }, []);

  const pickImage = async () => {
    const { granted } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!granted) {
      setError('Photo access not granted. Please enable Photos/Media Library permission in system settings and try again.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      base64: Platform.OS !== 'web',
      quality: 0.9,
    });
    if (!result.canceled) {
      const asset = result.assets[0];
      setDraggedFile(null);
      if (Platform.OS !== 'web') {
        const ct = (asset as any)?.mimeType || (asset.uri.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg');
        const isHeic = ct?.includes('heic') || ct?.includes('heif') || asset.uri.toLowerCase().endsWith('.heic') || asset.uri.toLowerCase().endsWith('.heif');
        try {
          // 对所有原生平台图片进行压缩和转码，头像尺寸更小更快
          const manipulated = await ImageManipulator.manipulateAsync(
            asset.uri,
            [{ resize: { width: 1024 } }],
            { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true }
          );
          setOriginalAssetUri(asset.uri);
          setAvatarUrl(manipulated.uri);
          setAvatarBase64(manipulated.base64 || null);
          setAvatarContentType('image/jpeg');
        } catch (e) {
          // 如果处理失败，则回退到原始资源（并尽量保持类型信息）
          setOriginalAssetUri(asset.uri);
          setAvatarUrl(asset.uri);
          setAvatarBase64((asset as any)?.base64 || null);
          setAvatarContentType(isHeic ? 'image/jpeg' : (ct || 'image/jpeg'));
        }
      } else {
        // Web: keep object URL/data URL behavior
        setAvatarUrl(asset.uri);
      }
    }
  };

  const handleDrop: any = (e: any) => {
    if (Platform.OS !== 'web') return;
    e.preventDefault();
    setDragOver(false);
    const file = e?.dataTransfer?.files?.[0];
    if (file) {
      setDraggedFile(file);
      const objectUrl = URL.createObjectURL(file);
      setAvatarUrl(objectUrl);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      let finalAvatarUrl = avatarUrl || '';
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes?.user?.id;
      if (!uid) {
        throw new Error('Not logged in or session expired');
      }
      if (Platform.OS !== 'web' && avatarBase64) {
        // 并发“对冲”上传（先直传，稍后启动函数上传）
        const tryUpload = async (b64: string, ct: string) => uploadBase64PhotoBestEffort(b64, uid, ct);
        const ct = avatarContentType || 'image/jpeg';
        try {
          finalAvatarUrl = await tryUpload(avatarBase64, ct);
        } catch (e1: any) {
          const msg1 = String(e1?.message || e1).toLowerCase();
          // 如果超时，自动降级尺寸与质量后重试（两次降级：720px/0.6，480px/0.5）
          if (msg1.includes('timed out')) {
            const baseUri = originalAssetUri || avatarUrl;
            if (baseUri) {
              try {
                const m1 = await ImageManipulator.manipulateAsync(
                  baseUri,
                  [{ resize: { width: 720 } }],
                  { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG, base64: true }
                );
                setAvatarUrl(m1.uri);
                setAvatarBase64(m1.base64 || null);
                finalAvatarUrl = await tryUpload(m1.base64 || avatarBase64, ct);
              } catch (e2: any) {
                const msg2 = String(e2?.message || e2).toLowerCase();
                if (msg2.includes('timed out')) {
                  const m2 = await ImageManipulator.manipulateAsync(
                    baseUri,
                    [{ resize: { width: 480 } }],
                    { compress: 0.5, format: ImageManipulator.SaveFormat.JPEG, base64: true }
                  );
                  setAvatarUrl(m2.uri);
                  setAvatarBase64(m2.base64 || null);
                  finalAvatarUrl = await tryUpload(m2.base64 || avatarBase64, ct);
                } else {
                  throw e2;
                }
              }
            } else {
              // 无法获取文件 URI，则直接重试一次原始 base64
              finalAvatarUrl = await tryUpload(avatarBase64, ct);
            }
          } else {
            throw e1;
          }
        }
      } else if (finalAvatarUrl && finalAvatarUrl.startsWith('file:')) {
        // 原生本地文件：并发上传
        finalAvatarUrl = await uploadToyPhotoBestEffort(finalAvatarUrl, uid);
      } else if (Platform.OS === 'web' && draggedFile) {
        // Web 拖拽文件：并发上传
        const publicUrl = await uploadToyPhotoWebBestEffort(draggedFile as Blob, uid);
        finalAvatarUrl = publicUrl;
      } else if (Platform.OS === 'web' && finalAvatarUrl && (finalAvatarUrl.startsWith('blob:') || finalAvatarUrl.startsWith('data:'))) {
        // Web 选择的 blob/data URL：先转 Blob，再并发上传
        const resp = await fetch(finalAvatarUrl);
        const blob = await resp.blob();
        const publicUrl = await uploadToyPhotoWebBestEffort(blob, uid);
        finalAvatarUrl = publicUrl;
      }
      const { error } = await supabase.auth.updateUser({
        data: { full_name: name || null, avatar_url: finalAvatarUrl || null },
      });
      setSaving(false);
      if (error) setError(error.message); else navigation.goBack();
    } catch (e: any) {
      setSaving(false);
      const status = (e && (e.status || e.code)) ? ` [status: ${e.status || e.code}]` : '';
      console.error('Save profile failed:', e);
      setError((e?.message || 'Update failed') + status);
    }
  };

  return (
    <View style={[editProfileStyles.container, { backgroundColor: theme.colors.background }]}>
      <Card style={[editProfileStyles.card, { backgroundColor: theme.colors.surface }]}>
        <Card.Title title="Edit Profile" />
        <Card.Content>
          <TextInput 
            label="Display Name" 
            value={name} 
            onChangeText={setName} 
            style={editProfileStyles.input}
            mode="outlined"
            outlineColor={theme.colors.outline}
            activeOutlineColor={theme.colors.primary}
          />
          <View
            // @ts-ignore - web-only drag events
            onDragOver={(e) => { if (Platform.OS === 'web') { e.preventDefault(); setDragOver(true); } }}
            // @ts-ignore
            onDragLeave={(e) => { if (Platform.OS === 'web') { e.preventDefault(); setDragOver(false); } }}
            // @ts-ignore
            onDrop={handleDrop}
            style={[
              editProfileStyles.dropZone, 
              { borderColor: theme.colors.outline },
              dragOver && { borderColor: theme.colors.primary, backgroundColor: theme.colors.primaryContainer }
            ]}
          >
            <Text style={{ color: theme.colors.onSurfaceVariant }}>{Platform.OS === 'web' ? 'Drag an avatar here or click to choose' : 'Tap the button below to choose an avatar'}</Text>
            <Button onPress={pickImage} style={{ marginTop: 8 }}>Choose Avatar</Button>
          </View>
          {(() => { const safeUri = getSafeImageUri(avatarUrl || undefined); return safeUri ? (<Image source={{ uri: safeUri }} style={{ width: '100%', height: 180, marginTop: 8, borderRadius: 12 }} />) : null; })()}
          {error && <Text style={{ color: theme.colors.error, marginTop: 8 }}>{error}</Text>}
          <Button mode="contained" onPress={save} loading={saving} style={{ marginTop: 12 }}>Save</Button>
        </Card.Content>
      </Card>
    </View>
  );
}

const editProfileStyles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  card: { borderRadius: 16 },
  input: { marginVertical: 8 },
  dropZone: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 12, padding: 12, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
});