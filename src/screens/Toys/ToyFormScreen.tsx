import React, { useEffect, useState, useRef } from 'react';
import { View, StyleSheet, Image, Platform, ScrollView, Pressable } from 'react-native';
import { TextInput, Button, Text, HelperText, List, Menu, Chip, Portal, Dialog } from 'react-native-paper';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { supabase } from '../../supabaseClient';
import { Toy } from '../../types';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { uploadToyPhotoBestEffort, uploadToyPhotoWebBestEffort, uploadBase64PhotoBestEffort, BUCKET } from '../../utils/storage';
import { setToyStatus } from '../../utils/playSessions';
import { normalizeRfid, formatRfidDisplay } from '../../utils/rfid';
import Constants from 'expo-constants';
import { LinearGradient } from 'expo-linear-gradient'
import { cartoonGradient } from '../../theme/tokens'

type Props = NativeStackScreenProps<any>;

// Ensure image URIs are safe on native (iOS/Android): allow only file:// and https://
const getSafeImageUri = (uri?: string) => {
  if (!uri) return undefined;
  if (Platform.OS === 'web') return uri;
  if (uri.startsWith('file://') || uri.startsWith('https://')) return uri;
  return undefined;
};

export default function ToyFormScreen({ route, navigation }: Props) {
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
  const [historyDates, setHistoryDates] = useState<string[]>([]);
  const [historyOpen, setHistoryOpen] = useState(!!route.params?.showHistory);
  const [historySessions, setHistorySessions] = useState<{ start: string; minutes?: number; end?: string | null; durationMin?: number | null }[]>([]);
  // Keep base64 for native upload when asset URI is not readable (content://, ph://)
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [photoContentType, setPhotoContentType] = useState<string>('image/jpeg');
  const [originalAssetUri, setOriginalAssetUri] = useState<string | null>(null);
  
  // Accordion panels
  const [basicOpen, setBasicOpen] = useState(true);
  const [detailOpen, setDetailOpen] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Category menu and creation
  const BASE_CATEGORIES = ['Fluffy','Blocks','Puzzle','Figure','Instrument','Doll'];
  const [categories, setCategories] = useState<string[]>(BASE_CATEGORIES);
  const [catMenuOpen, setCatMenuOpen] = useState(false);
  const [addCatOpen, setAddCatOpen] = useState(false);
  const [newCategory, setNewCategory] = useState('');

  // Suggestions for location and owner
  const [locSuggestions, setLocSuggestions] = useState<string[]>([]);
  const [locMenuOpen, setLocMenuOpen] = useState(false);
  const [ownerSuggestions, setOwnerSuggestions] = useState<string[]>([]);
  const [ownerMenuOpen, setOwnerMenuOpen] = useState(false);
  // Default locations and inline add states
  const DEFAULT_LOCATIONS = ['Living room','Bedroom','Toy house','others'];
  const [addLocOpen, setAddLocOpen] = useState(false);
  const [newLocation, setNewLocation] = useState('');
  const [addOwnerOpen, setAddOwnerOpen] = useState(false);
  const [newOwner, setNewOwner] = useState('');
  
  // local lock refs are defined below to decouple selection and focus
  
  // Input refs for dropdowns
  const catInputRef = useRef<any>(null);
  const locInputRef = useRef<any>(null);
  const ownerInputRef = useRef<any>(null);
  const catLockRef = useRef(false);
  const locLockRef = useRef(false);
  const ownerLockRef = useRef(false);

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
    // Fetch recent toys to build suggestions for location and owner
  const { data } = await supabase.from('toys').select('location,owner').limit(100);
    const locs = Array.from(new Set((data || []).map(t => t.location).filter(Boolean))) as string[];
    const owners = Array.from(new Set((data || []).map(t => t.owner).filter(Boolean))) as string[];
    setLocSuggestions(locs);
    setOwnerSuggestions(owners);
  };

  useEffect(() => { loadSuggestions(); }, []);

  const save = async () => {
    setLoading(true);
    setError(null);
    if (!name.trim()) {
      setLoading(false);
      setError('Please enter a toy name');
      return;
    }
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

  useEffect(() => {
    (async () => {
      try {
        if (!toy?.id) return;
        const { data, error } = await supabase
          .from('toy_events')
          .select('event_time,event_type')
          .eq('toy_id', toy.id)
          .eq('event_type', 'played')
          .order('event_time', { ascending: false });
        if (error) return;
        setHistoryDates((data || []).map((ev: any) => new Date(ev.event_time).toLocaleString()));
      } catch {}
    })();
  }, [toy?.id]);

  useEffect(() => {
    if (!toy?.id) return;
    const channel = supabase
      .channel(`toy-${toy.id}-sessions-insert`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'play_sessions', filter: `toy_id=eq.${toy.id}` }, async (payload) => {
        const row = (payload as any).new || {};
        const st = row.scan_time as string | undefined;
        // Read current status and toggle
        const { data } = await supabase.from('toys').select('status').eq('id', toy.id).maybeSingle();
        const prev = (data as any)?.status as 'in' | 'out' | null;
        const next = prev === 'out' ? 'in' : 'out';
        await supabase.from('toys').update({ status: next }).eq('id', toy.id);
        // Local UI sync
        setStatus(next);
        if (next === 'out' && st) {
          setHistorySessions((prev) => [{ start: st, end: null, durationMin: null }, ...prev]);
        } else {
          // End the most recent session: assign the last end value
          setHistorySessions((prev) => {
            const idx = prev.findIndex((s) => s.end === null);
            if (idx >= 0) {
              const now = new Date().toISOString();
              const start = prev[idx].start;
              const dur = Math.max(0, Math.round((new Date(now).getTime() - new Date(start).getTime()) / 60000));
              const updated = { ...prev[idx], end: now, durationMin: dur };
              return [...prev.slice(0, idx), updated, ...prev.slice(idx + 1)];
            }
            return prev;
          });
        }
      })
      .subscribe();

    return () => { try { supabase.removeChannel(channel); } catch {} };
  }, [toy?.id]);

  useEffect(() => {
    if (!toy?.id) return;
    (async () => {
      try {
        const { data } = await supabase
          .from('play_sessions')
          .select('scan_time')
          .eq('toy_id', toy.id)
          .order('scan_time', { ascending: true });
        const scans = (data || []).map((r: any) => new Date(r.scan_time));
        const items: { start: string; minutes: number }[] = [];
        for (let i = 0; i < scans.length; i += 2) {
          const outTime = scans[i];
          const inTime = scans[i + 1];
          if (!outTime) continue;
          const minutes = Math.round(((inTime ? inTime.getTime() : Date.now()) - outTime.getTime()) / 60000);
          items.push({ start: outTime.toISOString(), minutes });
        }
        setHistorySessions(items.reverse());
      } catch {}
    })();
  }, [toy?.id, status]);

  return (
    <LinearGradient colors={cartoonGradient} style={{ flex: 1 }}>
      <ScrollView style={[styles.container, { backgroundColor: 'transparent' }]} contentContainerStyle={{ paddingBottom: 16 }}>
       {/* Title removed per request */}
      <List.Section>
        <List.Accordion title="Basic Info" expanded={basicOpen} onPress={() => setBasicOpen(!basicOpen)}>
          {readOnly ? (
            <>
              <List.Item title="Toy Name" description={name || '-'} />
              <List.Item title="Tag ID" description={formatRfidDisplay(rfid)} />
              <List.Item title="Category" description={category || '-'} />
              {(() => { const safeUri = getSafeImageUri(photoUrl || undefined); return safeUri ? (<Image source={{ uri: safeUri }} style={{ width: '100%', height: 200, marginVertical: 8, borderRadius: 12 }} />) : null; })()}
            </>
          ) : (
            <>
              <TextInput label="Toy Name" value={name} onChangeText={setName} style={styles.input} disabled={readOnly} />
              {/* Combine Tag ID and Category into one row */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1, marginRight: 4 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <TextInput
                      label="Tag ID"
                      value={rfid}
                      onChangeText={setRfid}
                      style={[styles.input, { flex: 1 }]}
                      contentStyle={{ fontSize: 12, lineHeight: 16, paddingVertical: 0 }}
                      dense
                      disabled={readOnly}
                    />
                    <Button style={{ marginLeft: 8 }} labelStyle={{ fontSize: 12 }} onPress={scanRfid} disabled={readOnly}>Scan</Button>
                  </View>
                </View>
                <View style={{ flex: 1, marginLeft: 4 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Menu
                      visible={catMenuOpen}
                      onDismiss={() => setCatMenuOpen(false)}
                      anchor={
                        <Pressable onPress={() => { if (!readOnly && !catLockRef.current) { catInputRef.current?.focus?.(); } }}>
                          <TextInput
                            label="Category"
                            value={category}
                            onChangeText={setCategory}
                            onFocus={() => { if (!catLockRef.current) setCatMenuOpen(true); }}
                            ref={catInputRef}
                            style={[styles.input, { flex: 1 }]}
                            contentStyle={{ fontSize: 12, lineHeight: 16, paddingVertical: 0 }}
                            dense
                            disabled={readOnly}
                          />
                        </Pressable>
                      }>
                        {categories.map((c) => (
                          <Menu.Item key={c} onPress={() => {
                            setCategory(c);
                            setCatMenuOpen(false);
                            catInputRef.current?.blur?.();
                            catLockRef.current = true;
                            requestAnimationFrame(() => { setTimeout(() => { catLockRef.current = false; }, 150); });
                          }} title={c} />
                        ))}
                      </Menu>
                      <Button onPress={() => setAddCatOpen(true)} style={{ marginLeft: 8 }} labelStyle={{ fontSize: 12 }} disabled={readOnly}>Add</Button>
                  </View>
                </View>
              </View>
                <View
                 // @ts-ignore - web-only drag events
                 onDragOver={(e) => { if (Platform.OS === 'web') { e.preventDefault(); setDragOver(true); } }}
                 // @ts-ignore
                 onDragLeave={(e) => { if (Platform.OS === 'web') { e.preventDefault(); setDragOver(false); } }}
                 // @ts-ignore
                 onDrop={handleDrop}
                 style={[styles.dropZone, dragOver && styles.dropZoneActive]}>
                 <Text style={{ color: '#666' }}>{Platform.OS === 'web' ? 'Drag a photo here or click to choose' : 'Tap the button below to choose a photo'}</Text>
                 <Button onPress={pickImage} style={{ marginTop: 8 }} disabled={readOnly}>Choose Photo</Button>
               </View>
               {(() => { const safeUri = getSafeImageUri(photoUrl || undefined); return safeUri ? (<Image source={{ uri: safeUri }} style={{ width: '100%', height: 200, marginVertical: 8, borderRadius: 12 }} />) : null; })()}
            </>
          )}
        </List.Accordion>

        <List.Accordion title="Details" expanded={detailOpen} onPress={() => setDetailOpen(!detailOpen)}>
          {readOnly ? (
            <>
              <List.Item title="Location" description={location || '-'} />
              <List.Item title="Owner" description={owner || '-'} />
              <List.Item title="Source" description={source || '-'} />
              {!!notes && <List.Item title="Notes" description={notes} />}
            </>
          ) : (
            <>
              {/* Combine Location and Owner into one row */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1, marginRight: 4 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Menu
                      visible={locMenuOpen}
                      onDismiss={() => setLocMenuOpen(false)}
                      anchor={
                        <Pressable onPress={() => { if (!readOnly && !locLockRef.current) { locInputRef.current?.focus?.(); } }}>
                          <TextInput
                            label="Location"
                            value={location}
                            onChangeText={setLocation}
                            onFocus={() => { if (!locLockRef.current) setLocMenuOpen(true); }}
                            ref={locInputRef}
                            style={[styles.input, { flex: 1 }]}
                            contentStyle={{ fontSize: 12, lineHeight: 16, paddingVertical: 0 }}
                            dense
                            disabled={readOnly}
                          />
                        </Pressable>
                      }
                    >
                      {DEFAULT_LOCATIONS.map((loc) => (
                        <Menu.Item key={`default-${loc}`} onPress={() => {
                          setLocation(loc);
                          setLocMenuOpen(false);
                          locInputRef.current?.blur?.();
                          locLockRef.current = true;
                          requestAnimationFrame(() => { setTimeout(() => { locLockRef.current = false; }, 150); });
                        }} title={loc} />
                      ))}
                      {locSuggestions.filter((s) => !DEFAULT_LOCATIONS.includes(s)).map((loc) => (
                        <Menu.Item key={loc} onPress={() => {
                          setLocation(loc);
                          setLocMenuOpen(false);
                          locInputRef.current?.blur?.();
                          locLockRef.current = true;
                          requestAnimationFrame(() => { setTimeout(() => { locLockRef.current = false; }, 150); });
                        }} title={loc} />
                      ))}
                    </Menu>
                    <Button onPress={() => setAddLocOpen(true)} style={{ marginLeft: 8 }} labelStyle={{ fontSize: 12 }} disabled={readOnly}>Add</Button>
                  </View>
                </View>
                <View style={{ flex: 1, marginLeft: 4 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Menu
                      visible={ownerMenuOpen}
                      onDismiss={() => setOwnerMenuOpen(false)}
                      anchor={
                        <Pressable onPress={() => { if (!readOnly && !ownerLockRef.current) { ownerInputRef.current?.focus?.(); } }}>
                          <TextInput
                            label="Owner"
                            value={owner}
                            onChangeText={setOwner}
                            onFocus={() => { if (!ownerLockRef.current) setOwnerMenuOpen(true); }}
                            ref={ownerInputRef}
                            style={[styles.input, { flex: 1 }]}
                            contentStyle={{ fontSize: 12, lineHeight: 16, paddingVertical: 0 }}
                            dense
                            disabled={readOnly}
                          />
                        </Pressable>
                      }>
                      {ownerSuggestions.map((o) => (
                        <Menu.Item key={o} onPress={() => {
                          setOwner(o);
                          setOwnerMenuOpen(false);
                          ownerInputRef.current?.blur?.();
                          ownerLockRef.current = true;
                          requestAnimationFrame(() => { setTimeout(() => { ownerLockRef.current = false; }, 150); });
                        }} title={o} />
                      ))}
                    </Menu>
                    <Button onPress={() => setAddOwnerOpen(true)} style={{ marginLeft: 8 }} labelStyle={{ fontSize: 12 }} disabled={readOnly}>Add</Button>
                  </View>
                </View>
              </View>

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginVertical: 8 }}>
                <Button mode="contained" onPress={async () => { setStatus('in'); if (toy?.id) await setToyStatus(toy.id, 'in'); }}>Set In Place</Button>
                <Button mode="contained" onPress={async () => { setStatus('out'); if (toy?.id) await setToyStatus(toy.id, 'out'); }} style={{ marginLeft: 8 }}>Set Playing</Button>
              </View>

              <TextInput label="Source (purchase info)" value={source} onChangeText={setSource} style={styles.input} disabled={readOnly} />
              <TextInput label="Notes" value={notes} onChangeText={setNotes} style={styles.input} multiline disabled={readOnly} />
            </>
          )}
        </List.Accordion>

        <List.Accordion title="Advanced Settings" expanded={advancedOpen} onPress={() => setAdvancedOpen(!advancedOpen)}>
          <Text style={{ color: '#666' }}>Advanced settings are reserved; not stored currently; for future hardware/automation integrations.</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
            <Chip style={styles.chip}>Playtime Reminder</Chip>
            <Chip style={styles.chip}>Auto State Detection</Chip>
            <Chip style={styles.chip}>Custom Fields</Chip>
          </View>
        </List.Accordion>

        <List.Accordion title="History" expanded={historyOpen} onPress={() => setHistoryOpen(!historyOpen)}>
           <Text style={{ marginBottom: 4 }}>{`Added on ${toy?.created_at ? new Date(toy.created_at).toLocaleString() : '-'}`}</Text>
           {historySessions.length ? historySessions.map((h, idx) => (
             <Text key={idx} style={{ marginBottom: 4 }}>{`Start: ${new Date(h.start).toLocaleString()}  •  Played ${h.minutes} min`}</Text>
           )) : (
             <Text style={{ color: '#666' }}>No play history</Text>
           )}
        </List.Accordion>
      </List.Section>
      {error && <Text style={{ color: 'red' }}>{error}</Text>}
      {!readOnly && <Button mode="contained" onPress={save} loading={loading} style={styles.button}>Save</Button>}

      <Portal>
        <Dialog visible={addCatOpen} onDismiss={() => setAddCatOpen(false)}>
          <Dialog.Title>Add Category</Dialog.Title>
          <Dialog.Content>
            <TextInput label="Category Name" value={newCategory} onChangeText={setNewCategory} />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setAddCatOpen(false)}>Cancel</Button>
            <Button onPress={() => {
              const v = newCategory.trim();
              if (v) {
                setCategories(prev => Array.from(new Set([...prev, v])));
                setCategory(v);
              }
              setNewCategory('');
              setAddCatOpen(false);
            }}>Add</Button>
          </Dialog.Actions>
        </Dialog>
        
        {/* Add Location Dialog */}
        <Dialog visible={addLocOpen} onDismiss={() => setAddLocOpen(false)}>
          <Dialog.Title>Add Location</Dialog.Title>
          <Dialog.Content>
            <TextInput label="Location Name" value={newLocation} onChangeText={setNewLocation} />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setAddLocOpen(false)}>Cancel</Button>
            <Button onPress={() => {
              const v = newLocation.trim();
              if (v) {
                setLocSuggestions(prev => Array.from(new Set([...prev, v])));
                setLocation(v);
              }
              setNewLocation('');
              setAddLocOpen(false);
            }}>Add</Button>
          </Dialog.Actions>
        </Dialog>

        {/* Add Owner Dialog */}
        <Dialog visible={addOwnerOpen} onDismiss={() => setAddOwnerOpen(false)}>
          <Dialog.Title>Add Owner</Dialog.Title>
          <Dialog.Content>
            <TextInput label="Owner Name" value={newOwner} onChangeText={setNewOwner} />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setAddOwnerOpen(false)}>Cancel</Button>
            <Button onPress={() => {
              const v = newOwner.trim();
              if (v) {
                setOwnerSuggestions(prev => Array.from(new Set([...prev, v])));
                setOwner(v);
              }
              setNewOwner('');
              setAddOwnerOpen(false);
            }}>Add</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
      </ScrollView>
    </LinearGradient>
    );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  input: { marginVertical: 8 },
  button: { marginTop: 8, borderRadius: 14 },
  chip: { marginRight: 8, marginVertical: 4 },
  chipIn: { backgroundColor: '#CFF6E8' },
  chipOut: { backgroundColor: '#FFE5EC' },
  dropZone: { borderWidth: 1, borderStyle: 'dashed', borderColor: '#CCC', borderRadius: 12, padding: 12, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  dropZoneActive: { borderColor: '#6C63FF', backgroundColor: '#F4F2FF' },
});