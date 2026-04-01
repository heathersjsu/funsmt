import React, { useState } from 'react';
import { View, Platform, ScrollView, Pressable } from 'react-native';
import { Text, useTheme, Avatar, List, Button, TextInput, Snackbar } from 'react-native-paper';
import { LinearGradient } from 'expo-linear-gradient';
import { cartoonGradient } from '../../theme/tokens';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { supabase } from '../../supabaseClient';
import * as ImagePicker from 'expo-image-picker';
import { uploadToyPhotoWebBestEffort, uploadBase64PhotoBestEffort, uploadToyPhotoBestEffort } from '../../utils/storage';

type Props = NativeStackScreenProps<any>;

export default function OwnerDetailScreen({ route }: Props) {
  const theme = useTheme();
  const headerFont = Platform.select({ ios: 'Arial Rounded MT Bold', android: 'sans-serif-medium', default: 'System' });
  const owner = route.params?.owner || {};
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState<string>(owner.name || '');
  const [age, setAge] = useState<string>(owner.age ? String(owner.age) : '');
  const [birthday, setBirthday] = useState<string>(owner.birthday || '');
  const [bio, setBio] = useState<string>(owner.bio || '');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(owner.avatar_url || null);
  const [avatarBase64, setAvatarBase64] = useState<string | null>(null);
  const [snack, setSnack] = useState<string>('');
  const [snackVisible, setSnackVisible] = useState(false);

  const pickAvatar = async () => {
    try {
      const { granted } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!granted) return;
      const hasNew = !!(ImagePicker as any).MediaType && typeof (ImagePicker as any).MediaType.image !== 'undefined';
      const mediaTypesParam: any = hasNew ? (ImagePicker as any).MediaType.image : (ImagePicker as any).MediaTypeOptions.Images;
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: mediaTypesParam,
        base64: true,
        quality: 0.9,
      });
      if (!result.canceled) {
        const asset = result.assets[0];
        setAvatarUrl(asset.uri);
        setAvatarBase64(asset.base64 || null);
      }
    } catch {}
  };

  const save = async () => {
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u?.user?.id;
      if (!uid) { setSnack('Not signed in'); setSnackVisible(true); return; }
      let finalAvatar: string | null = avatarUrl || owner.avatar_url || null;
      try {
        if (avatarBase64) {
          finalAvatar = await uploadBase64PhotoBestEffort(avatarBase64, uid, 'image/jpeg');
        } else if (avatarUrl && avatarUrl.startsWith('file:')) {
          finalAvatar = await uploadToyPhotoBestEffort(avatarUrl, uid);
        } else if (Platform.OS === 'web' && avatarUrl && (avatarUrl.startsWith('blob:') || avatarUrl.startsWith('data:'))) {
          const resp = await fetch(avatarUrl);
          const blob = await resp.blob();
          finalAvatar = await uploadToyPhotoWebBestEffort(blob, uid);
        }
      } catch {}
      const payload: any = {
        name: name.trim(),
        bio: bio ? bio : null,
        age: age ? Number(age) : null,
        birthday: birthday || null,
        user_id: uid,
        avatar_url: finalAvatar || null,
        id: owner.id || undefined,
      };
      if (owner.id) {
        const { error } = await supabase.from('owners').update(payload).eq('id', owner.id);
        if (error) { setSnack(error.message); setSnackVisible(true); return; }
      } else {
        const { error } = await supabase.from('owners').upsert(payload);
        if (error) { setSnack(error.message); setSnackVisible(true); return; }
      }
      owner.name = payload.name;
      owner.age = payload.age;
      owner.birthday = payload.birthday;
      owner.bio = payload.bio;
      owner.avatar_url = payload.avatar_url;
      setSnack('Saved');
      setSnackVisible(true);
      setEditing(false);
    } catch (e: any) {
      setSnack(e?.message || 'Save failed');
      setSnackVisible(true);
    }
  };
  return (
    <LinearGradient colors={cartoonGradient} style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          { padding: 16, paddingBottom: 40 },
          Platform.OS === 'web' && { width: '100%', maxWidth: 1000, alignSelf: 'center', paddingHorizontal: 16 }
        ]}
      >
        <View style={{ alignItems: 'center', marginBottom: 16 }}>
          <Pressable onPress={() => { if (editing) pickAvatar(); }} style={{ alignItems: 'center' }}>
            {avatarUrl
              ? <Avatar.Image size={96} source={{ uri: avatarUrl }} style={{ backgroundColor: theme.colors.secondaryContainer }} />
              : <Avatar.Icon size={96} icon="account" style={{ backgroundColor: theme.colors.secondaryContainer }} />}
            {editing && <Text style={{ fontSize: 12, marginTop: 6, color: '#888', fontFamily: headerFont }}>Tap to add owner photo</Text>}
          </Pressable>
          <Text style={{ marginTop: 8, fontSize: 18, fontWeight: '700', color: theme.colors.primary, fontFamily: headerFont }}>{name || owner.name}</Text>
        </View>
        {editing ? (
          <View>
            <TextInput label="Name" value={name} onChangeText={setName} style={{ marginBottom: 12, backgroundColor: theme.colors.surface }} mode="outlined" />
            <TextInput label="Age" value={age} onChangeText={setAge} keyboardType="number-pad" style={{ marginBottom: 12, backgroundColor: theme.colors.surface }} mode="outlined" />
            <TextInput label="Birthday (YYYY-MM-DD)" value={birthday} onChangeText={setBirthday} style={{ marginBottom: 12, backgroundColor: theme.colors.surface }} mode="outlined" />
            <TextInput label="Bio" value={bio} onChangeText={setBio} multiline style={{ marginBottom: 12, backgroundColor: theme.colors.surface }} mode="outlined" />
            <Button mode="contained" onPress={save} style={{ alignSelf: 'center', borderRadius: 20 }} contentStyle={{ height: 44 }} labelStyle={{ fontFamily: headerFont }}>
              Save
            </Button>
          </View>
        ) : (
          <List.Section>
            {age ? <List.Item title={`Age`} description={`${age}`} titleStyle={{ fontFamily: headerFont }} /> : (owner.age ? <List.Item title={`Age`} description={`${owner.age}`} titleStyle={{ fontFamily: headerFont }} /> : null)}
            {birthday ? <List.Item title={`Birthday`} description={`${birthday}`} titleStyle={{ fontFamily: headerFont }} /> : (owner.birthday ? <List.Item title={`Birthday`} description={`${owner.birthday}`} titleStyle={{ fontFamily: headerFont }} /> : null)}
            {bio ? <List.Item title={`Bio`} description={`${bio}`} titleStyle={{ fontFamily: headerFont }} /> : (owner.bio ? <List.Item title={`Bio`} description={`${owner.bio}`} titleStyle={{ fontFamily: headerFont }} /> : null)}
          </List.Section>
        )}
        {!editing && (
          <View style={{ alignItems: 'center', marginTop: 8 }}>
            <Button mode="outlined" onPress={() => setEditing(true)} style={{ borderRadius: 20 }} labelStyle={{ fontFamily: headerFont }}>
              Edit
            </Button>
          </View>
        )}
        <Snackbar visible={snackVisible} onDismiss={() => setSnackVisible(false)} duration={2000} style={{ backgroundColor: theme.colors.secondaryContainer, alignSelf: 'center' }} wrapperStyle={{ position: 'absolute', top: '45%', left: 0, right: 0 }}>
          <Text style={{ color: theme.colors.onSecondaryContainer, textAlign: 'center' }}>{snack}</Text>
        </Snackbar>
      </ScrollView>
    </LinearGradient>
  );
}
