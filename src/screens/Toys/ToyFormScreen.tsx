import React, { useEffect, useState, useRef } from 'react';
import { View, StyleSheet, Image, Platform, ScrollView, Pressable, KeyboardAvoidingView } from 'react-native';
import { TextInput, Button, Text, HelperText, List, Menu, Chip, Portal, Dialog, useTheme, Avatar } from 'react-native-paper';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { supabase } from '../../supabaseClient';
import { Toy } from '../../types';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { uploadToyPhotoBestEffort, uploadToyPhotoWebBestEffort, uploadBase64PhotoBestEffort, BUCKET } from '../../utils/storage';
import { setToyStatus } from '../../utils/playSessions';
import { normalizeRfid, formatRfidDisplay } from '../../utils/rfid';
import Constants from 'expo-constants';
import { LinearGradient } from 'expo-linear-gradient'
import { cartoonGradient } from '../../theme/tokens'
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';

type Props = NativeStackScreenProps<any>;

// Ensure image URIs are safe on native (iOS/Android): allow only file:// and https://
const getSafeImageUri = (uri?: string) => {
  if (!uri) return undefined;
  if (Platform.OS === 'web') return uri;
  if (uri.startsWith('file://') || uri.startsWith('https://')) return uri;
  return undefined;
};

export default function ToyFormScreen({ route, navigation }: Props) {
  const theme = useTheme();
  const headerFont = Platform.select({ ios: 'Arial Rounded MT Bold', android: 'sans-serif-medium', default: 'System' });
  const toy: Toy | undefined = route.params?.toy;
  const readOnly = !!route.params?.readOnly;
  const prefillName: string | undefined = route.params?.name;
  const [name, setName] = useState(toy?.name ?? prefillName ?? '');
  const [rfid, setRfid] = useState(toy?.rfid || '');
  const [photoUrl, setPhotoUrl] = useState<string | null>(toy?.photo_url || null);
  const [draggedFile, setDraggedFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [category, setCategory] = useState(toy?.category || '');
  const [source, setSource] = useState(toy?.source || '');
  const [location, setLocation] = useState(toy?.location || '');
  const [owner, setOwner] = useState(toy?.owner || '');
  const [status, setStatus] = useState<Toy['status']>(toy?.status || 'in');
  const [notes, setNotes] = useState(toy?.notes || '');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Keep base64 for native upload when asset URI is not readable (content://, ph://)
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [photoContentType, setPhotoContentType] = useState<string>('image/jpeg');
  const [originalAssetUri, setOriginalAssetUri] = useState<string | null>(null);
  
  // Category menu and creation
  const BASE_CATEGORIES = ['Fluffy','Blocks','Puzzle','Figure','Instrument','Doll'];
  const [categories, setCategories] = useState<string[]>(BASE_CATEGORIES);
  const [addCatOpen, setAddCatOpen] = useState(false);
  const [newCategory, setNewCategory] = useState('');

  // Suggestions for location and owner
  const [locSuggestions, setLocSuggestions] = useState<string[]>([]);
  const [ownerSuggestions, setOwnerSuggestions] = useState<string[]>([]);
  const [ownerProfiles, setOwnerProfiles] = useState<Array<{ name: string; avatar_url?: string | null }>>([]);
  const LS_OWNER_KEY = 'pinme_owners';

  // Default locations and inline add states
  const DEFAULT_LOCATIONS = ['Living room','Bedroom','Toy house','others'];
  const [addLocOpen, setAddLocOpen] = useState(false);
  const [newLocation, setNewLocation] = useState('');
  const [addOwnerOpen, setAddOwnerOpen] = useState(false);
  const [newOwner, setNewOwner] = useState('');
  const catIcon = (c: string) => {
    const k = c.toLowerCase();
    if (k.includes('fluffy') || k.includes('soft')) return 'teddy-bear';
    if (k.includes('blocks') || k.includes('puzzle')) return 'cube-outline';
    if (k.includes('figure') || k.includes('doll')) return 'account-child';
    if (k.includes('instrument')) return 'music';
    if (k.includes('vehicle')) return 'car';
    if (k.includes('electronic')) return 'controller-classic';
    return 'shape';
  };
  
  const pickImage = async () => {
    const { granted } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!granted) return;
    // 动态兼容 expo-image-picker 新旧 API
    const hasNew = !!(ImagePicker as any).MediaType && typeof (ImagePicker as any).MediaType.image !== 'undefined';
    const mediaTypesParam: any = hasNew ? (ImagePicker as any).MediaType.image : (ImagePicker as any).MediaTypeOptions.Images;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: mediaTypesParam,
      base64: true,
      quality: 0.8,
    });
    if (!result.canceled) {
      const asset = result.assets[0];
      let finalUri = asset.uri;
      let finalBase64 = asset.base64 || null;
      let finalContentType = 'image/jpeg';
      // On native, proactively compress to reduce upload size and avoid timeouts
      if (Platform.OS !== 'web') {
        try {
          const manipulated = await ImageManipulator.manipulateAsync(
            asset.uri,
            [{ resize: { width: 1024 } }], // 更小的上限，减少体积
            { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }
          );
          setOriginalAssetUri(asset.uri);
          finalUri = manipulated.uri || asset.uri;
          finalBase64 = manipulated.base64 || asset.base64 || null;
          finalContentType = 'image/jpeg';
        } catch (e) {
          // If manipulation fails, fallback to original asset
          finalBase64 = asset.base64 || null;
          const isPng = (asset.uri || '').toLowerCase().endsWith('.png');
          finalContentType = isPng ? 'image/png' : 'image/jpeg';
        }
      } else {
        // Web: keep original asset
        const isPng = (asset.uri || '').toLowerCase().endsWith('.png');
        finalContentType = isPng ? 'image/png' : 'image/jpeg';
      }
      setPhotoUrl(finalUri);
      setPhotoBase64(finalBase64);
      setPhotoContentType(finalContentType);
      setDraggedFile(null);
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
      setPhotoUrl(objectUrl);
    }
  };

  const scanRfid = async () => {
    try {
      if (Platform.OS === 'web') {
        if ((navigator as any)?.clipboard?.readText) {
          const text = await (navigator as any).clipboard.readText();
          if (text) setRfid(text.trim());
          else setError('Clipboard is empty; paste or input manually');
        } else {
          setError('Browser does not support clipboard read; please input manually');
        }
        return;
      }
      // Native platforms: use NFC when available (Dev Client / production build)
      const supportsNativeNfc = (Platform.OS as any) !== 'web' && (Constants.appOwnership !== 'expo');
      if (!supportsNativeNfc) {
        setError('Running in Expo Go; NFC scanning is unavailable. Please use Expo Dev Client or a production build.');
        return;
      }
      try {
        const mod: any = await import('react-native-nfc-manager');
        const NfcManager = mod?.default || mod;
        const NfcTech = mod?.NfcTech || (mod?.Ndef ? mod.Ndef : null);
        await NfcManager.start();
        await NfcManager.requestTechnology(NfcTech?.Ndef || NfcTech, { alertMessage: 'Hold your phone near the toy tag to scan' });
        const tag = await NfcManager.getTag();
        let id: string | undefined = (tag?.id as any) || (tag?.serialNumber as any);
        if (Array.isArray(tag?.id)) {
          try { id = (tag.id as any).map((b: number) => ('0' + b.toString(16)).slice(-2)).join(''); } catch {}
        }
        const normalized = normalizeRfid((id || '').toString());
        if (normalized) setRfid(normalized);
        try { await NfcManager.cancelTechnologyRequest(); } catch {}
      } catch (err: any) {
        try {
          const { default: NfcManager } = await import('react-native-nfc-manager');
          await NfcManager.cancelTechnologyRequest();
        } catch {}
        setError(err?.message || 'NFC scan failed or device not supported');
      }
    } catch (e) {
      setError('Failed to read scan content; please input or paste manually');
    }
  };

  const loadSuggestions = async () => {
    // Fetch recent toys to build suggestions for location
    const { data } = await supabase.from('toys').select('location,owner').limit(100);
    const locs = Array.from(new Set((data || []).map(t => t.location).filter(Boolean))) as string[];
    setLocSuggestions(locs);
  };

  const loadOwnerProfiles = async () => {
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u?.user?.id;
      if (!uid) return;
      let ownersRows: Array<{ name: string; avatar_url?: string | null }> = [];
      // Prefer owners table tied to current user
      try {
        const { data: ownersData } = await supabase
          .from('owners')
          .select('name,avatar_url,user_id')
          .eq('user_id', uid)
          .order('name', { ascending: true });
        ownersRows = (ownersData || []) as any;
      } catch {}
      // Fallback: derive from user's toys/devices
      if (!ownersRows || ownersRows.length === 0) {
        const ownersSet = new Set<string>();
        try {
          const { data: toysData } = await supabase.from('toys').select('owner,user_id').eq('user_id', uid);
          (toysData || []).forEach((t: any) => { if (t.owner) ownersSet.add(String(t.owner)); });
        } catch {}
        try {
          const { data: devData } = await supabase.from('devices').select('owner,user_id').eq('user_id', uid);
          (devData || []).forEach((d: any) => { if (d.owner) ownersSet.add(String(d.owner)); });
        } catch {}
        ownersRows = Array.from(ownersSet).map((name) => ({ name }));
      }
      // Fallback to local cache keyed by user_id
      if (!ownersRows || ownersRows.length === 0) {
        try {
          let raw: string | null = null;
          if (Platform.OS === 'web') raw = (globalThis as any)?.localStorage?.getItem(LS_OWNER_KEY) || null;
          else raw = await SecureStore.getItemAsync(LS_OWNER_KEY);
          const localList = raw ? JSON.parse(raw) : [];
          ownersRows = (uid ? (localList || []).filter((o: any) => o.user_id === uid) : localList)
            .map((o: any) => ({ name: o.name, avatar_url: o.avatar_url || null }));
        } catch {}
      }
      const rows = (ownersRows || []).filter((o) => !!o && typeof o.name === 'string' && o.name.trim().length > 0);
      setOwnerProfiles(rows);
      setOwnerSuggestions(Array.from(new Set(rows.map((o) => o.name).filter(Boolean))));
    } catch {
      // Minimal fallback: keep existing suggestions
    }
  };

  useEffect(() => { loadSuggestions(); loadOwnerProfiles(); }, []);
  useFocusEffect(React.useCallback(() => {
    loadOwnerProfiles();
    return () => {};
  }, []));
  useEffect(() => {
    let ch: any;
    (async () => {
      try {
        const { data: u } = await supabase.auth.getUser();
        const uid = u?.user?.id;
        ch = supabase
          .channel('owners_ui')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'owners', filter: uid ? `user_id=eq.${uid}` : undefined }, () => {
            loadOwnerProfiles();
          })
          .subscribe();
      } catch {}
    })();
    return () => {
      try { ch && supabase.removeChannel(ch); } catch {}
    };
  }, []);

  const save = async () => {
    setLoading(true);
    setError(null);
    if (!name.trim()) {
      setLoading(false);
      setError('Please enter a toy name');
      return;
    }
    // Only require RFID if it's strictly needed, but let's assume it is based on existing logic
    if (!rfid.trim()) {
      setLoading(false);
      setError('Please enter or scan RFID Tag ID');
      return;
    }
    const payload = {
      name,
      rfid: normalizeRfid(rfid) || null,
      photo_url: photoUrl || null,
      category: category || null,
      source: source || null,
      location: location || null,
      owner: owner || null,
      status,
      notes: notes || null,
    };
    if (toy) {
      try {
        if (photoBase64) {
          const { data: userRes } = await supabase.auth.getUser();
          const uid = userRes?.user?.id;
          if (!uid) throw new Error('Not logged in');
          // Best-effort: try direct signed upload first, hedge to Edge Function if slow
          const tryUpload = async (b64: string, ct: string) => uploadBase64PhotoBestEffort(b64, uid, ct);
          const ct = photoContentType || 'image/jpeg';
          try {
            const publicUrl = await tryUpload(photoBase64, ct);
            payload.photo_url = publicUrl;
          } catch (e1: any) {
            const msg1 = String(e1?.message || e1).toLowerCase();
            if (msg1.includes('timed out')) {
              const baseUri = originalAssetUri || photoUrl || '';
              if (baseUri) {
                try {
                  const m1 = await ImageManipulator.manipulateAsync(
                    baseUri,
                    [{ resize: { width: 720 } }],
                    { compress: 0.5, format: ImageManipulator.SaveFormat.JPEG, base64: true }
                  );
                  setPhotoUrl(m1.uri);
                  setPhotoBase64(m1.base64 || null);
                  const publicUrl = await tryUpload(m1.base64 || photoBase64, ct);
                  payload.photo_url = publicUrl;
                } catch (e2: any) {
                  const msg2 = String(e2?.message || e2).toLowerCase();
                  if (msg2.includes('timed out')) {
                    const m2 = await ImageManipulator.manipulateAsync(
                      baseUri,
                      [{ resize: { width: 480 } }],
                      { compress: 0.4, format: ImageManipulator.SaveFormat.JPEG, base64: true }
                    );
                    setPhotoUrl(m2.uri);
                    setPhotoBase64(m2.base64 || null);
                    const publicUrl = await tryUpload(m2.base64 || photoBase64, ct);
                    payload.photo_url = publicUrl;
                  } else {
                    throw e2;
                  }
                }
              } else {
                // 无法获取文件 URI，则直接重试一次原始 base64
                const publicUrl = await tryUpload(photoBase64, ct);
                payload.photo_url = publicUrl;
              }
            } else {
              throw e1;
            }
          }
        } else if (photoUrl && photoUrl.startsWith('file:')) {
          const { data: userRes } = await supabase.auth.getUser();
          const uid = userRes?.user?.id;
          if (!uid) throw new Error('Not logged in');
          // 对本地文件进行压缩后再上传（避免大图导致超时）
          let localUri = photoUrl;
          try {
            const m0 = await ImageManipulator.manipulateAsync(
              photoUrl,
              [{ resize: { width: 1024 } }],
              { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
            );
            localUri = m0.uri || photoUrl;
          } catch {}
          try {
            const publicUrl = await uploadToyPhotoBestEffort(localUri, uid);
            payload.photo_url = publicUrl;
          } catch (e1: any) {
            const msg1 = String(e1?.message || e1).toLowerCase();
            if (msg1.includes('timed out')) {
              try {
                const m1 = await ImageManipulator.manipulateAsync(
                  localUri,
                  [{ resize: { width: 720 } }],
                  { compress: 0.5, format: ImageManipulator.SaveFormat.JPEG }
                );
                const publicUrl = await uploadToyPhotoBestEffort(m1.uri || localUri, uid);
                payload.photo_url = publicUrl;
              } catch (e2: any) {
                const msg2 = String(e2?.message || e2).toLowerCase();
                if (msg2.includes('timed out')) {
                  const m2 = await ImageManipulator.manipulateAsync(
                    localUri,
                    [{ resize: { width: 480 } }],
                    { compress: 0.4, format: ImageManipulator.SaveFormat.JPEG }
                  );
                  const publicUrl = await uploadToyPhotoBestEffort(m2.uri || localUri, uid);
                  payload.photo_url = publicUrl;
                } else {
                  throw e2;
                }
              }
            } else {
              throw e1;
            }
          }
        } else if (Platform.OS === 'web' && draggedFile) {
          const { data: userRes } = await supabase.auth.getUser();
          const uid = userRes?.user?.id;
          if (!uid) throw new Error('Not logged in');
          // Best-effort web Blob upload
          const publicUrl = await uploadToyPhotoWebBestEffort(draggedFile as any as Blob, uid);
          payload.photo_url = publicUrl;
        } else if (Platform.OS === 'web' && photoUrl && (photoUrl.startsWith('blob:') || photoUrl.startsWith('data:'))) {
          const { data: userRes } = await supabase.auth.getUser();
          const uid = userRes?.user?.id;
          if (!uid) throw new Error('Not logged in');
          const resp = await fetch(photoUrl);
          const blob = await resp.blob();
          // Best-effort web data/blob URL upload
          const publicUrl = await uploadToyPhotoWebBestEffort(blob, uid);
          payload.photo_url = publicUrl;
        }
        const { error } = await supabase.from('toys').update(payload).eq('id', toy.id);
        setLoading(false);
        if (error) setError(error.message); else navigation.goBack();
      } catch (e: any) {
        setLoading(false);
        setError(e?.message || 'Upload failed');
      }
    } else {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes?.user?.id;
      if (!uid) {
        setLoading(false);
        setError('Not logged in or session expired, please sign in');
        return;
      }
      try {
        if (photoBase64) {
          // Best-effort base64 upload (native)
          const publicUrl = await uploadBase64PhotoBestEffort(photoBase64, uid, photoContentType);
          payload.photo_url = publicUrl;
        } else if (photoUrl && photoUrl.startsWith('file:')) {
          // Best-effort native file upload
          const publicUrl = await uploadToyPhotoBestEffort(photoUrl, uid);
          payload.photo_url = publicUrl;
        } else if (Platform.OS === 'web' && draggedFile) {
          // Best-effort web Blob upload
          const publicUrl = await uploadToyPhotoWebBestEffort(draggedFile as any as Blob, uid);
          payload.photo_url = publicUrl;
        } else if (Platform.OS === 'web' && photoUrl && (photoUrl.startsWith('blob:') || photoUrl.startsWith('data:'))) {
          const resp = await fetch(photoUrl);
          const blob = await resp.blob();
          // Best-effort web data/blob URL upload
          const publicUrl = await uploadToyPhotoWebBestEffort(blob, uid);
          payload.photo_url = publicUrl;
        }
        const { error } = await supabase.from('toys').insert({ ...payload, user_id: uid });
        setLoading(false);
        if (error) setError(error.message); else navigation.goBack();
      } catch (e: any) {
        setLoading(false);
        setError(e?.message || 'Upload failed');
      }
    }
  };

  // removed inline history rendering; use dedicated history screen instead

  const isWeb = Platform.OS === 'web';

  return (
    <LinearGradient colors={cartoonGradient} style={{ flex: 1 }}>
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
      style={{ flex: 1 }}
    >
      <ScrollView 
        style={{ flex: 1 }} 
        contentContainerStyle={[
          { paddingBottom: 80, paddingHorizontal: 16 },
          isWeb && { width: '100%', maxWidth: 1000, alignSelf: 'center', paddingHorizontal: 16 }
        ]}
      >
        <View style={{ marginTop: 16 }}>
          {/* Photo Upload */}
          <View style={{ alignItems: 'center', marginBottom: 24 }}>
            <Pressable onPress={pickImage} style={styles.photoContainer}>
              {photoUrl ? (
                <Image source={{ uri: photoUrl }} style={styles.photo} contentFit="cover" cachePolicy="disk" />
              ) : (
                <View style={[styles.photoPlaceholder, { borderColor: '#FFC37A' }]}>
                  <MaterialCommunityIcons name="camera" size={32} color="#9E9E9E" />
                </View>
              )}
              <View style={[styles.editIconBadge, { backgroundColor: theme.colors.primary }]}>
                <MaterialCommunityIcons name="pencil" size={14} color="#FFF" />
              </View>
            </Pressable>
            <Text style={{ marginTop: 8, color: '#888', fontFamily: headerFont }}>Tap to add photo</Text>
          </View>

          {/* Name */}
          <TextInput
            label="Toy Name"
            value={name}
            onChangeText={setName}
            mode="outlined"
            style={[styles.input, { backgroundColor: '#FFF' }]}
            placeholder="e.g. Buzz Lightyear"
            contentStyle={{ fontFamily: headerFont }}
            right={<TextInput.Icon icon="pencil" color="#FF8C42" />}
            theme={{ roundness: 24 }}
            outlineColor="#E0E0E0"
            activeOutlineColor="#FF8C42"
          />

          {/* Tag ID */}
          <TextInput
            label="Tag ID (RFID)"
            value={rfid}
            onChangeText={(t) => setRfid(normalizeRfid(t))}
            mode="outlined"
            style={[styles.input, { backgroundColor: '#FFF' }]}
            contentStyle={{ fontFamily: headerFont }}
            right={<TextInput.Icon icon="barcode-scan" onPress={scanRfid} color="#FF8C42" />}
            theme={{ roundness: 24 }}
            outlineColor="#E0E0E0"
            activeOutlineColor="#FF8C42"
          />

          {/* Category */}
          <Text style={[styles.sectionLabel, { fontFamily: headerFont }]}>Category</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {categories.map(c => (
              <Chip 
                key={c} 
                selected={category === c} 
                onPress={() => setCategory(c)}
                icon={catIcon(c)}
                style={[
                  styles.chip,
                  { backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 22 },
                  category === c && { backgroundColor: '#FF8C42', borderColor: '#FF8C42' }
                ]}
                textStyle={[
                  { fontFamily: headerFont, color: '#333' },
                  category === c && { color: '#FFF', fontWeight: 'bold' }
                ]}
              >
                {c}
              </Chip>
            ))}
            <Chip icon="plus" onPress={() => setAddCatOpen(true)} style={[styles.chip, { borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 22 }]} textStyle={{ fontFamily: headerFont }}>Add</Chip>
          </ScrollView>

          {/* Location */}
          <Text style={[styles.sectionLabel, { fontFamily: headerFont }]}>Location</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
             {DEFAULT_LOCATIONS.map(l => (
               <Chip key={`def-${l}`} selected={location === l} onPress={() => setLocation(l)} style={[styles.chip, { backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 22 }, location === l && { backgroundColor: '#FF8C42', borderColor: '#FF8C42' }]} textStyle={[{ fontFamily: headerFont, color: '#333' }, location === l && { color: '#FFF', fontWeight: 'bold' }]}>{l}</Chip>
             ))}
             {locSuggestions.filter(s => !DEFAULT_LOCATIONS.includes(s)).map(l => (
               <Chip key={l} selected={location === l} onPress={() => setLocation(l)} style={[styles.chip, { backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 22 }, location === l && { backgroundColor: '#FF8C42', borderColor: '#FF8C42' }]} textStyle={[{ fontFamily: headerFont, color: '#333' }, location === l && { color: '#FFF', fontWeight: 'bold' }]}>{l}</Chip>
             ))}
             <Chip icon="plus" onPress={() => setAddLocOpen(true)} style={[styles.chip, { borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 22 }]} textStyle={{ fontFamily: headerFont }}>Add</Chip>
          </ScrollView>

          {/* Owner */}
          <Text style={[styles.sectionLabel, { fontFamily: headerFont }]}>Owner</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 16 }}>
            {ownerProfiles.map((op) => (
              <Pressable key={op.name} onPress={() => setOwner(op.name)} style={{ alignItems: 'center', width: '20%', marginBottom: 12 }}>
                {op.avatar_url
                  ? <Avatar.Image size={48} source={{ uri: op.avatar_url }} style={{ backgroundColor: theme.colors.secondaryContainer, borderWidth: owner === op.name ? 2 : 0, borderColor: owner === op.name ? '#FF8C42' : 'transparent' }} />
                  : <Avatar.Icon size={48} icon="account" style={{ backgroundColor: theme.colors.secondaryContainer, borderWidth: owner === op.name ? 2 : 0, borderColor: owner === op.name ? '#FF8C42' : 'transparent' }} />}
                <Text style={{ fontSize: 12, marginTop: 4, textAlign: 'center', color: theme.colors.onSurface, fontFamily: headerFont }} numberOfLines={1}>{op.name}</Text>
              </Pressable>
            ))}
            <Pressable onPress={() => {
              try {
                const parent = (navigation as any)?.getParent?.();
                if (parent) parent.navigate('Me', { screen: 'OwnerManagement' });
                else (navigation as any)?.navigate?.('Me', { screen: 'OwnerManagement' });
              } catch {
                (navigation as any)?.navigate?.('Me', { screen: 'OwnerManagement' });
              }
            }} style={{ alignItems: 'center', width: '20%', marginBottom: 12 }}>
              <Avatar.Icon size={48} icon="hammer-wrench" style={{ backgroundColor: theme.colors.secondaryContainer }} />
              <Text style={{ fontSize: 12, marginTop: 4, textAlign: 'center', color:'#FF8C42', fontFamily: headerFont }} numberOfLines={1}>Manage</Text>
            </Pressable>
          </View>

          {/* Source & Notes */}
          <TextInput label="Source" value={source} onChangeText={setSource} mode="outlined" style={[styles.input, { backgroundColor: '#FFF' }]} theme={{ roundness: 24 }} contentStyle={{ fontFamily: headerFont }} outlineColor="#E0E0E0" activeOutlineColor="#FF8C42" />
          <TextInput label="Notes" value={notes} onChangeText={setNotes} mode="outlined" multiline numberOfLines={3} style={[styles.input, { backgroundColor: '#FFF' }]} contentStyle={{ fontFamily: headerFont }} theme={{ roundness: 24 }} outlineColor="#E0E0E0" activeOutlineColor="#FF8C42" />

          {error && <Text style={{ color: theme.colors.error, marginTop: 8, fontFamily: headerFont }}>{error}</Text>}

          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, justifyContent: 'center' }}>
            <Button
              mode={status === 'in' ? 'contained' : 'outlined'}
              onPress={async () => {
                setStatus('in');
                if (toy?.id) {
                  try {
                    setLoading(true);
                    const { error } = await supabase.from('toys').update({ status: 'in' }).eq('id', toy.id);
                    if (!error) {
                      try {
                        await supabase.from('play_sessions').insert({ toy_id: toy.id, scan_time: new Date().toISOString() });
                      } catch {}
                    }
                    setLoading(false);
                    if (error) setError(error.message);
                  } catch (e: any) {
                    setLoading(false);
                    setError(e?.message || 'Failed to update status');
                  }
                }
              }}
              style={{ borderRadius: 20, minWidth: 140 }}
              labelStyle={{ fontFamily: headerFont }}
            >
              Set In Place
            </Button>
            <Button
              mode={status === 'out' ? 'contained' : 'outlined'}
              onPress={async () => {
                setStatus('out');
                if (toy?.id) {
                  try {
                    setLoading(true);
                    const { error } = await supabase.from('toys').update({ status: 'out' }).eq('id', toy.id);
                    if (!error) {
                      try {
                        await supabase.from('play_sessions').insert({ toy_id: toy.id, scan_time: new Date().toISOString() });
                      } catch {}
                    }
                    setLoading(false);
                    if (error) setError(error.message);
                  } catch (e: any) {
                    setLoading(false);
                    setError(e?.message || 'Failed to update status');
                  }
                }
              }}
              style={{ borderRadius: 20, minWidth: 140 }}
              labelStyle={{ fontFamily: headerFont }}
            >
              Set as Playing
            </Button>
          </View>

          <View style={{ height: 12 }} />
          <Button mode="contained" onPress={save} loading={loading} style={[styles.saveBtn, { alignSelf: 'center' }]} contentStyle={{ height: 44, minWidth: 120 }} labelStyle={{ fontSize: 16, fontWeight: 'bold', fontFamily: headerFont }}>
            Save
          </Button>

          
          
          <View style={{ height: 60 }} />
        </View>
      </ScrollView>
      </KeyboardAvoidingView>
      
      <Portal>
        <Dialog visible={addCatOpen} onDismiss={() => setAddCatOpen(false)} style={{ borderRadius: 24 }}>
          <Dialog.Content>
            <View style={{ alignItems: 'center', marginTop: -28, marginBottom: 8 }}>
              <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: '#FFE8CC', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFD8A0' }}>
                <MaterialCommunityIcons name="shape" size={24} color="#FF8C42" />
              </View>
            </View>
            <Text style={{ fontSize: 20, fontWeight: '700', textAlign: 'center', fontFamily: headerFont }}>New Category</Text>
            <Text style={{ marginTop: 6, textAlign: 'center', color: '#888', fontFamily: headerFont }}>What kind of toys are these?</Text>
            <View style={{ marginTop: 16 }}>
              <Text style={{ fontSize: 12, color: '#999', marginBottom: 6, fontFamily: headerFont }}>NAME</Text>
              <TextInput
                value={newCategory}
                onChangeText={setNewCategory}
                autoFocus
                placeholder="e.g. Race Cars"
                mode="outlined"
                outlineStyle={{ borderWidth: 2 }}
                outlineColor="#FF8C42"
                activeOutlineColor="#FF8C42"
                right={<TextInput.Icon icon="pencil" />}
                theme={{ roundness: 24 }}
                contentStyle={{ fontFamily: headerFont }}
              />
            </View>
          </Dialog.Content>
          <Dialog.Actions style={{ justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12 }}>
            <Button mode="contained-tonal" onPress={() => setAddCatOpen(false)} style={{ flex: 1, marginRight: 8, borderRadius: 24 }} labelStyle={{ fontFamily: headerFont }}>Cancel</Button>
            <Button
              mode="contained"
              onPress={() => {
                const v = newCategory.trim();
                if (v) {
                  setCategories(prev => Array.from(new Set([...prev, v])));
                  setCategory(v);
                }
                setNewCategory('');
                setAddCatOpen(false);
              }}
              style={{ flex: 1, marginLeft: 8, borderRadius: 24 }}
              buttonColor="#FF8C42"
              labelStyle={{ fontFamily: headerFont, color: '#FFF' }}
            >
              Add Category
            </Button>
          </Dialog.Actions>
        </Dialog>
        
        <Dialog visible={addLocOpen} onDismiss={() => setAddLocOpen(false)} style={{ borderRadius: 24 }}>
          <Dialog.Content>
            <View style={{ alignItems: 'center', marginTop: -28, marginBottom: 8 }}>
              <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: '#FFE8CC', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFD8A0' }}>
                <MaterialCommunityIcons name="map-marker" size={24} color="#FF8C42" />
              </View>
            </View>
            <Text style={{ fontSize: 20, fontWeight: '700', textAlign: 'center', fontFamily: headerFont }}>New Location</Text>
            <Text style={{ marginTop: 6, textAlign: 'center', color: '#888', fontFamily: headerFont }}>Where does this live?</Text>
            <View style={{ marginTop: 16 }}>
              <Text style={{ fontSize: 12, color: '#999', marginBottom: 6, fontFamily: headerFont }}>NAME</Text>
              <TextInput
                value={newLocation}
                onChangeText={setNewLocation}
                autoFocus
                placeholder="e.g. Playroom"
                mode="outlined"
                outlineStyle={{ borderWidth: 2 }}
                outlineColor="#FF8C42"
                activeOutlineColor="#FF8C42"
                right={<TextInput.Icon icon="pencil" />}
                theme={{ roundness: 24 }}
                contentStyle={{ fontFamily: headerFont }}
              />
            </View>
          </Dialog.Content>
          <Dialog.Actions style={{ justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12 }}>
            <Button mode="contained-tonal" onPress={() => setAddLocOpen(false)} style={{ flex: 1, marginRight: 8, borderRadius: 24 }} labelStyle={{ fontFamily: headerFont }}>Cancel</Button>
            <Button
              mode="contained"
              onPress={() => {
                const v = newLocation.trim();
                if (v) {
                  setLocSuggestions(prev => Array.from(new Set([...prev, v])));
                  setLocation(v);
                }
                setNewLocation('');
                setAddLocOpen(false);
              }}
              style={{ flex: 1, marginLeft: 8, borderRadius: 24 }}
              buttonColor="#FF8C42"
              labelStyle={{ fontFamily: headerFont, color: '#FFF' }}
            >
              Add Location
            </Button>
          </Dialog.Actions>
        </Dialog>

        <Dialog visible={addOwnerOpen} onDismiss={() => setAddOwnerOpen(false)}>
          <Dialog.Title style={{ fontFamily: headerFont }}>Add Owner</Dialog.Title>
          <Dialog.Content>
            <TextInput label="Owner Name" value={newOwner} onChangeText={setNewOwner} autoFocus contentStyle={{ fontFamily: headerFont }} />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setAddOwnerOpen(false)} labelStyle={{ fontFamily: headerFont }}>Cancel</Button>
            <Button onPress={() => {
              const v = newOwner.trim();
              if (v) {
                setOwnerSuggestions(prev => Array.from(new Set([...prev, v])));
                setOwner(v);
              }
              setNewOwner('');
              setAddOwnerOpen(false);
            }} labelStyle={{ fontFamily: headerFont }}>Add</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'transparent',
    borderRadius: 0,
    padding: 16
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#000',
  },
  content: {
    paddingHorizontal: 24,
    paddingBottom: 32,
  },
  photoContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  photo: {
    width: 120,
    height: 120,
    borderRadius: 60,
  },
  photoPlaceholder: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    borderStyle: 'dashed',
    backgroundColor: '#FFF',
    alignItems: 'center',
    justifyContent: 'center'
  },
  editIconBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFF',
  },
  input: {
    marginBottom: 16,
    backgroundColor: '#FFF',
  },
  sectionLabel: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
    marginTop: 8,
    color: '#333',
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    paddingRight: 16,
  },
  chip: {
    marginRight: 8,
    borderRadius: 16,
  },
  saveBtn: {
    borderRadius: 25,
    marginTop: 8,
  },
});
