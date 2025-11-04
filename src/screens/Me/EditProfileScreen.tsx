import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Image, Platform } from 'react-native';
import { TextInput, Button, Card, Text, useTheme } from 'react-native-paper';
import { supabase } from '../../supabaseClient';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { uploadToyPhoto, uploadToyPhotoWeb, uploadBase64Photo } from '../../utils/storage';

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
        if (isHeic) {
          // Convert HEIC/HEIF to JPEG to ensure edge function and storage compatibility
          const manipulated = await ImageManipulator.manipulateAsync(
            asset.uri,
            [],
            { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG, base64: true }
          );
          setAvatarUrl(manipulated.uri);
          setAvatarBase64(manipulated.base64 || null);
          setAvatarContentType('image/jpeg');
        } else {
          setAvatarUrl(asset.uri);
          setAvatarBase64((asset as any)?.base64 || null);
          setAvatarContentType(ct || 'image/jpeg');
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
        // Native: upload base64 directly to edge function (avoids FileSystem copyAsync)
        finalAvatarUrl = await uploadBase64Photo(avatarBase64, uid, avatarContentType || 'image/jpeg');
      } else if (finalAvatarUrl && finalAvatarUrl.startsWith('file:')) {
        // Native file path fallback: upload via helper
        finalAvatarUrl = await uploadToyPhoto(finalAvatarUrl, uid);
      } else if (Platform.OS === 'web' && draggedFile) {
        // Web drag-and-drop file: upload via edge function to avoid RLS
        const publicUrl = await uploadToyPhotoWeb(draggedFile as Blob, uid);
        finalAvatarUrl = publicUrl;
      } else if (Platform.OS === 'web' && finalAvatarUrl && (finalAvatarUrl.startsWith('blob:') || finalAvatarUrl.startsWith('data:'))) {
        // Web picker produces blob/data URLs: fetch to Blob then upload
        const resp = await fetch(finalAvatarUrl);
        const blob = await resp.blob();
        const publicUrl = await uploadToyPhotoWeb(blob, uid);
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