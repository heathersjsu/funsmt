import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Platform, ScrollView, Pressable, RefreshControl } from 'react-native';
import { Text, TextInput, Button, useTheme, Avatar, List, Snackbar } from 'react-native-paper';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../supabaseClient';
import { LinearGradient } from 'expo-linear-gradient';
import { cartoonGradient } from '../../theme/tokens';
import * as SecureStore from 'expo-secure-store';
import { useNavigation } from '@react-navigation/native';
import { uploadToyPhotoWebBestEffort, uploadBase64PhotoBestEffort, uploadToyPhotoBestEffort } from '../../utils/storage';

type Owner = { id?: string; name: string; bio?: string | null; age?: number | null; birthday?: string | null; avatar_url?: string | null };

const LS_KEY = 'pinme_owners';

export default function OwnerManagementScreen() {
  const theme = useTheme();
  const headerFont = Platform.select({ ios: 'Arial Rounded MT Bold', android: 'sans-serif-medium', default: 'System' });
  const navigation = useNavigation<any>();
  const [owners, setOwners] = useState<Owner[]>([]);
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [age, setAge] = useState('');
  const [birthday, setBirthday] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarBase64, setAvatarBase64] = useState<string | null>(null);
  const [snack, setSnack] = useState<string>('');
  const [snackVisible, setSnackVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const showSnack = (msg: string) => { setSnack(msg); setSnackVisible(true); };

  const loadLocalOwners = async (): Promise<Owner[]> => {
    try {
      if (Platform.OS === 'web') {
        const raw = (globalThis as any)?.localStorage?.getItem(LS_KEY);
        return raw ? JSON.parse(raw) : [];
      }
      const raw = await SecureStore.getItemAsync(LS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  };

  const saveLocalOwners = async (list: Owner[]) => {
    try {
      const raw = JSON.stringify(list);
      if (Platform.OS === 'web') {
        (globalThis as any)?.localStorage?.setItem(LS_KEY, raw);
      } else {
        await SecureStore.setItemAsync(LS_KEY, raw);
      }
    } catch {}
  };

  const fetchOwners = async () => {
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u?.user?.id;
      if (!uid) { setOwners([]); return; }
      const { data, error } = await supabase.from('owners').select('*').eq('user_id', uid).order('name', { ascending: true });
      if (error) {
        const local = await loadLocalOwners();
        const fromEntities = await deriveOwnersFromEntities(uid);
        const combined = [...fromEntities, ...local.filter((o: any) => o.user_id === uid)];
        setOwners(uniqueOwners(combined));
      } else {
        if ((data || []).length) {
          setOwners((data || []) as Owner[]);
        } else {
          const local = await loadLocalOwners();
          const fromEntities = await deriveOwnersFromEntities(uid);
          const combined = [...fromEntities, ...local.filter((o: any) => o.user_id === uid)];
          setOwners(uniqueOwners(combined));
        }
      }
    } catch {
      const local = await loadLocalOwners();
      const { data: u2 } = await supabase.auth.getUser();
      const uid2 = u2?.user?.id;
      const fromEntities = uid2 ? await deriveOwnersFromEntities(uid2) : [];
      const combined = [...fromEntities, ...(uid2 ? local.filter((o: any) => o.user_id === uid2) : [])];
      setOwners(uniqueOwners(combined));
    }
  };
  
  const uniqueOwners = (list: Owner[]): Owner[] => {
    const map = new Map<string, Owner>();
    list.forEach((o) => { const key = (o.name || '').toLowerCase(); if (key) map.set(key, o); });
    return Array.from(map.values());
  };
  
  const deriveOwnersFromEntities = async (uid: string): Promise<Owner[]> => {
    try {
      const ownersSet = new Set<string>();
      const resToys = await supabase.from('toys').select('owner,user_id,photo_url').eq('user_id', uid);
      (resToys.data || []).forEach((t: any) => { if (t.owner) ownersSet.add(String(t.owner)); });
      const resDevices = await supabase.from('devices').select('owner,user_id').eq('user_id', uid);
      (resDevices.data || []).forEach((d: any) => { if (d.owner) ownersSet.add(String(d.owner)); });
      return Array.from(ownersSet).map((name) => ({ name }));
    } catch {
      return [];
    }
  };

  useEffect(() => { fetchOwners(); }, []);
  const onRefresh = async () => {
    setRefreshing(true);
    await fetchOwners();
    setRefreshing(false);
  };

  const pickAvatar = async () => {
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
  };

  const saveOwner = async () => {
    const trimmed = name.trim();
    if (!trimmed) { showSnack('Please enter owner name'); return; }
    setLoading(true);
    let finalAvatar: string | null = avatarUrl;
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes?.user?.id || 'anon';
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
    const { data: u } = await supabase.auth.getUser();
    const uid = u?.user?.id || null;
    const payload: any = {
      name: trimmed,
      bio: bio ? bio : null,
      age: age ? Number(age) : null,
      birthday: birthday || null,
      avatar_url: finalAvatar || null,
      user_id: uid
    };
    try {
      const { error } = await supabase.from('owners').upsert(payload);
      if (error) {
        const local = await loadLocalOwners();
        const next = [{ ...payload, id: `${Date.now()}` }, ...local];
        await saveLocalOwners(next);
        setOwners(uid ? next.filter((o: any) => o.user_id === uid) : next);
      } else {
        await fetchOwners();
      }
      setName(''); setBio(''); setAge(''); setBirthday(''); setAvatarUrl(null); setAvatarBase64(null);
      showSnack('Saved');
    } catch {
      const local = await loadLocalOwners();
      const next = [{ ...payload, id: `${Date.now()}` }, ...local];
      await saveLocalOwners(next);
      setOwners(uid ? next.filter((o: any) => o.user_id === uid) : next);
      setName(''); setBio(''); setAge(''); setBirthday(''); setAvatarUrl(null); setAvatarBase64(null);
      showSnack('Saved locally');
    } finally {
      setLoading(false);
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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <List.Subheader style={{ fontFamily: headerFont, color: theme.colors.primary }}>Existing Owner</List.Subheader>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 16 }}>
          {owners.length ? owners.map((o) => (
            <Pressable key={(o.id || o.name) as string} onPress={() => navigation.navigate('OwnerDetail', { owner: o })} style={{ alignItems: 'center', width: '25%', marginBottom: 16 }}>
              {o.avatar_url
                ? <Avatar.Image size={64} source={{ uri: o.avatar_url }} style={{ backgroundColor: theme.colors.secondaryContainer }} />
                : <Avatar.Icon size={64} icon="account" style={{ backgroundColor: theme.colors.secondaryContainer }} />}
              <Text style={{ fontSize: 12, marginTop: 6, textAlign: 'center', color: theme.colors.onSurface, fontFamily: headerFont }} numberOfLines={1}>{o.name}</Text>
            </Pressable>
          )) : <Text style={{ color: theme.colors.onSurfaceVariant, fontFamily: headerFont, marginLeft: 16 }}>No owners yet</Text>}
        </View>

        <List.Subheader style={{ fontFamily: headerFont, color: theme.colors.primary }}>Add New</List.Subheader>
        <View style={{ alignItems: 'center', marginBottom: 12 }}>
          <Pressable onPress={pickAvatar} style={{ alignItems: 'center' }}>
            {avatarUrl
              ? <Avatar.Image size={64} source={{ uri: avatarUrl }} style={{ backgroundColor: theme.colors.secondaryContainer }} />
              : <Avatar.Icon size={64} icon="account" style={{ backgroundColor: theme.colors.secondaryContainer }} />}
            <Text style={{ fontSize: 12, marginTop: 6, color: '#888', fontFamily: headerFont }}>Tap to add owner photo</Text>
          </Pressable>
        </View>
        <TextInput label="Name" value={name} onChangeText={setName} style={styles.input} mode="outlined" theme={{ roundness: 20 }} />
        <TextInput label="Age" value={age} onChangeText={setAge} keyboardType="number-pad" style={styles.input} mode="outlined" theme={{ roundness: 20 }} />
        <TextInput label="Birthday (YYYY-MM-DD)" value={birthday} onChangeText={setBirthday} style={styles.input} mode="outlined" theme={{ roundness: 20 }} />
        <TextInput label="Bio" value={bio} onChangeText={setBio} multiline style={styles.input} mode="outlined" theme={{ roundness: 20 }} />
        <Button mode="contained" onPress={saveOwner} loading={loading} style={{ alignSelf: 'center', borderRadius: 20 }} contentStyle={{ height: 44 }} labelStyle={{ fontFamily: headerFont }}>Save</Button>
        <Snackbar visible={snackVisible} onDismiss={() => setSnackVisible(false)} duration={2000} style={{ backgroundColor: theme.colors.secondaryContainer, alignSelf: 'center' }} wrapperStyle={{ position: 'absolute', top: '45%', left: 0, right: 0 }}>
          <Text style={{ color: theme.colors.onSecondaryContainer, textAlign: 'center' }}>{snack}</Text>
        </Snackbar>
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  input: { marginBottom: 12 },
});
