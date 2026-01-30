import React, { useEffect, useState, useRef } from 'react';
import { View, StyleSheet, Image, Platform, ScrollView, Pressable, KeyboardAvoidingView, Alert } from 'react-native';
import { TextInput, Button, Text, HelperText, List, Menu, Chip, Portal, Dialog, useTheme, Avatar, ActivityIndicator, Modal } from 'react-native-paper';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { supabase } from '../../supabaseClient';
import { Toy } from '../../types';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { uploadToyPhotoBestEffort, uploadToyPhotoWebBestEffort, uploadBase64PhotoBestEffort, BUCKET } from '../../utils/storage';
// import { setToyStatus, recordScan } from '../../utils/playSessions';
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
  const [rfidDisplay, setRfidDisplay] = useState(toy?.rfid ? formatRfidDisplay(String(toy.rfid), 6) : '');
  const [rfidFull, setRfidFull] = useState<string | null>(toy?.rfid || null);
  const [scannedDeviceId, setScannedDeviceId] = useState<string | null>(null);
  const [scanRunning, setScanRunning] = useState(false);
  const scanRunningRef = useRef<boolean>(false);
  const scanRowIdRef = useRef<number | null>(null);
  const lastParsedRef = useRef<string>('');
  const [debugText, setDebugText] = useState('');
  const [scanResults, setScanResults] = useState<Array<{ epc: string; rssi?: number; time: string }>>([]);
  const [photoUrl, setPhotoUrl] = useState<string | null>(toy?.photo_url || null);
  const [draggedFile, setDraggedFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [category, setCategory] = useState(toy?.category || '');
  const [source, setSource] = useState(toy?.source || '');
  const [location, setLocation] = useState(toy?.location || '');
  const [owner, setOwner] = useState(toy?.owner || '');
  // const [status, setStatus] = useState<Toy['status']>(toy?.status || 'in');
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

  const [scanDialogOpen, setScanDialogOpen] = useState(false);
  
  const stopScan = () => {
    setScanRunning(false);
    scanRunningRef.current = false;
    scanRowIdRef.current = null;
    setScanDialogOpen(false);
  };

  const parseLines = (text: string) => {
    const lines = text.split(/\r?\n/);
    const results: Array<{ epc: string; rssi?: number }> = [];
    lines.forEach(line => {
      // Match "Tag: EPC=300833B2DDD9014000000000 RSSI=-51dBm"
      const epcMatch = line.match(/EPC\s*[:=]?\s*([0-9A-Fa-f]{4,})/i);
      if (epcMatch) {
        const epc = epcMatch[1];
        let rssi: number | undefined;
        const rssiMatch = line.match(/RSSI\s*[:=]?\s*(-?\d+)/i);
        if (rssiMatch) {
          rssi = parseInt(rssiMatch[1], 10);
        }
        results.push({ epc, rssi });
      } else {
        // Fallback: match raw hex strings that look like EPCs (20+ chars)
        const hexOnly = line.trim();
        if (/^[0-9A-Fa-f]{20,}$/.test(hexOnly)) {
          results.push({ epc: hexOnly });
        }
      }
    });
    return results;
  };

  const scanRfid = async () => {
    try {
      if (scanRunning) {
        stopScan();
        return;
      }
      // Initialize state immediately for UI feedback
      setScanDialogOpen(true);
      setScanRunning(true);
      scanRunningRef.current = true;
      setError(null);
      setScanResults([]); // Clear previous results immediately
      setDebugText(''); // Clear previous debug text
      
      try {
        const { data: u } = await supabase.auth.getUser();
        if (!scanRunningRef.current) return; // Abort if cancelled

        const uid = u?.user?.id;
        if (uid) {
          let targetId: string | null = null;
          try {
            const { data: dev } = await supabase
              .from('devices')
              .select('device_id')
              .order('last_seen', { ascending: false })
              .limit(1);
            if (dev && dev.length > 0) targetId = dev[0].device_id as string;
          } catch {}
          
          if (!scanRunningRef.current) return; // Abort if cancelled

          // Fallback: use latest device_id seen in testuart table (more reliable for active device)
          try {
            const { data: lastCmdRows } = await supabase
              .from('testuart')
              .select('device_id')
              .order('id', { ascending: false })
              .limit(1);
            if (lastCmdRows && lastCmdRows.length > 0 && lastCmdRows[0].device_id) {
              targetId = String(lastCmdRows[0].device_id);
            }
          } catch {}
          
          if (!scanRunningRef.current) return; // Abort if cancelled

          if (targetId) {
            setScannedDeviceId(targetId);
            // Clear any previous pending commands to avoid queue backlog
            await supabase
              .from('testuart')
              .update({ uart_result: 'SKIPPED_BY_APP', uart_debug: 'Skipped by new scan request' })
              .eq('device_id', targetId)
              .eq('uart_result', 'PENDING');

            const { data: inserted } = await supabase
              .from('testuart')
              .insert({ device_id: targetId, uart_debug: 'RFID_POLL_MULTI 20', uart_result: 'PENDING' })
              .select();
            const rowId = inserted && inserted[0]?.id ? inserted[0].id as number : null;
            const start = Date.now();
            scanRowIdRef.current = rowId;
            // setScanRunning(true) is already called at start
            // scanRunningRef.current is already true
            lastParsedRef.current = '';
            setDebugText(`Initializing scan on device ${targetId}...`);
            setScanResults([]);
            // Live loop: fetch updates for up to 10s or until stopped
            const LOOP_TIMEOUT = 10000;
            while (scanRunningRef.current && Date.now() - start < LOOP_TIMEOUT) {
              await new Promise(r => setTimeout(r, 500)); // Slightly slower poll to reduce load
              let r = '';
              let d = '';
              let currentDeviceId = targetId;
              
              if (rowId) {
                // 1. Check specific row
                const { data: rows } = await supabase
                  .from('testuart')
                  .select('id, uart_result, uart_debug, device_id')
                  .eq('id', rowId)
                  .limit(1);
                const row = rows && rows[0] ? rows[0] : null;
                r = row?.uart_result ? String(row.uart_result) : '';
                d = row?.uart_debug ? String(row.uart_debug) : '';
                if (row && row.device_id) currentDeviceId = row.device_id;

                // 2. Check latest row (in case ESP32 updated a previous/next row)
                const { data: latestRows } = await supabase
                  .from('testuart')
                  .select('id, uart_result, uart_debug')
                  .eq('device_id', targetId)
                  .order('id', { ascending: false })
                  .limit(1);
                
                if (latestRows && latestRows.length > 0) {
                  const latest = latestRows[0];
                  // If latest row has data and is recent (or is the one we are looking for), combine it
                  // We append it to 'd' (debug) so parseLines can find it
                  if (latest.id !== rowId && (latest.uart_result !== 'PENDING' || latest.uart_debug)) {
                     const latestStr = ` [LatestDB:${latest.id} Res:${latest.uart_result} Dbg:${latest.uart_debug}]`;
                     d += latestStr;
                     // Also append to r if r is pending
                     if (r === 'PENDING' && latest.uart_result !== 'PENDING') {
                       r += ` (See Latest: ${latest.uart_result})`;
                     }
                  }
                }
              } else {
                // Fallback (should rarely happen given rowId logic)
                const { data: rows } = await supabase
                  .from('testuart')
                  .select('id, uart_result, uart_debug')
                  .eq('device_id', targetId)
                  .order('id', { ascending: false })
                  .limit(1);
                const row = rows && rows[0] ? rows[0] : null;
                r = row?.uart_result ? String(row.uart_result) : '';
                d = row?.uart_debug ? String(row.uart_debug) : '';
              }

              // Update Debug Text with detailed info
              const statusLine = `Dev:${currentDeviceId.slice(-4)} | Row:${rowId} | St:${r.slice(0, 10)}`;
              const fullDebug = `${statusLine}\nRES: ${r}\nDBG: ${d}`;
              
              if (fullDebug !== lastParsedRef.current) {
                lastParsedRef.current = fullDebug;
                setDebugText(fullDebug);
                console.log('--- RFID DEBUG ---\n' + fullDebug);
                
                const combined = r + '\n' + d;
                const combinedFlat = combined.replace(/\s+/g, ' ');
                if (/you.*only.*issue.*one.*request.*at.*a.*time/i.test(combinedFlat)) {
                  setError('you can only issue one request at a time');
                  stopScan();
                  break;
                }
                const parsed = parseLines(combined);
              
                if (parsed.length > 0) {
                    const now = new Date().toLocaleTimeString();
                    setScanResults(prev => {
                      // Merge new results
                      const map = new Map<string, { epc: string; rssi?: number; time: string }>();
                      prev.forEach(p => map.set(p.epc, p));
                      parsed.forEach(p => {
                        // Update if new or better RSSI (or just overwrite)
                        map.set(p.epc, { epc: p.epc, rssi: p.rssi, time: now });
                      });
                      const merged = Array.from(map.values());
                      // Sort by RSSI desc
                      merged.sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999));
                      // Keep top 5
                      return merged.slice(0, 5);
                    });

                    // User Request: Mark executed/read commands as Skipped to prevent repetition
                    // We try to mark both the primary row and any fallback row we might have read
                    const idsToSkip: number[] = [];
                    if (rowId && r !== 'Skipped') idsToSkip.push(rowId);
                    if (latestRows && latestRows.length > 0) {
                        const l = latestRows[0];
                        if (l.uart_result !== 'Skipped' && l.uart_result !== 'PENDING') {
                            idsToSkip.push(l.id);
                        }
                    }
                    
                    if (idsToSkip.length > 0) {
                        // Fire and forget update
                        supabase
                            .from('testuart')
                            .update({ uart_result: 'Skipped' })
                            .in('id', idsToSkip)
                            .then(({ error }) => {
                                if (!error) console.log('Marked IDs as Skipped:', idsToSkip);
                            });
                    }
                }
              }
            }
            setScanRunning(false);
            scanRunningRef.current = false;
            return;
          }
        }
      } catch (e: any) {
        setDebugText(prev => prev + '\nError: ' + e.message);
        setScanRunning(false); // Cleanup on error
        // If it was an ESP32 error, we might still want to try NFC?
        // But for now, let's treat it as a stop.
      }
      
      // Fallback to Web/NFC if ESP32 didn't handle it
      // Note: If we reached here, ESP32 loop didn't run (or threw error).
      
      if (Platform.OS === 'web') {
        if ((navigator as any)?.clipboard?.readText) {
          const text = await (navigator as any).clipboard.readText();
          if (text) {
            const norm = normalizeRfid(text.trim());
            if (norm && norm.length >= 8) {
              setRfidFull(norm);
              setRfidDisplay(formatRfidDisplay(norm, 6));
            } else {
              setRfidFull(null);
              setRfidDisplay(norm);
            }
          }
          else setError('Clipboard is empty; paste or input manually');
        } else {
          setError('Browser does not support clipboard read; please input manually');
        }
        setScanRunning(false); // Cleanup
        return;
      }
      // Native platforms: use NFC when available (Dev Client / production build)
      const supportsNativeNfc = (Platform.OS as any) !== 'web' && (Constants.appOwnership !== 'expo');
      if (!supportsNativeNfc) {
        setError('Running in Expo Go; NFC scanning is unavailable. Please use Expo Dev Client or a production build.');
        setScanRunning(false); // Cleanup
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
        if (normalized) {
          setRfidFull(normalized);
          setRfidDisplay(formatRfidDisplay(normalized, 6));
        }
        try { await NfcManager.cancelTechnologyRequest(); } catch {}
      } catch (err: any) {
        try {
          const { default: NfcManager } = await import('react-native-nfc-manager');
          await NfcManager.cancelTechnologyRequest();
        } catch {}
        setError(err?.message || 'NFC scan failed or device not supported');
      } finally {
        setScanRunning(false); // Cleanup NFC
      }
    } catch (e) {
      setError('Failed to read scan content; please input or paste manually');
      setScanRunning(false); // Cleanup outer catch
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
    const hasFull = !!(rfidFull && rfidFull.trim());
    const hasDisplay = !!(rfidDisplay && rfidDisplay.trim());
    if (!hasFull && !hasDisplay) {
      setLoading(false);
      setError('Please enter or scan RFID Tag ID');
      return;
    }
    const payload = {
      name,
      rfid: normalizeRfid(hasFull ? rfidFull! : rfidDisplay) || null,
      photo_url: photoUrl || null,
      category: category || null,
      source: source || null,
      location: location || null,
      owner: owner || null,
      device_id: scannedDeviceId || toy?.device_id || null,
      // status,
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
        if (error) {
          setError(error.message);
        } else {
          // If status changed, record a scan event to ensure play history continuity
          // if (toy.status !== status) {
          //   try { await recordScan(toy.id, new Date().toISOString()); } catch {}
          // }
          navigation.goBack();
        }
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
        const { error } = await supabase.from('toys').insert({ ...payload, user_id: uid, status: 'in' });
        setLoading(false);
        if (error) setError(error.message); else navigation.goBack();
      } catch (e: any) {
        setLoading(false);
        setError(e?.message || 'Upload failed');
      }
    }
  };

  // removed inline history rendering; use dedicated history screen instead

  const deleteToy = async () => {
    if (!toy) return;
    if (Platform.OS === 'web') {
      if (confirm('Are you sure you want to delete this toy?')) {
        setLoading(true);
        const { error } = await supabase.from('toys').delete().eq('id', toy.id);
        setLoading(false);
        if (error) {
          setError(error.message);
        } else {
          navigation.goBack();
        }
      }
    } else {
      Alert.alert(
        'Delete Toy',
        'Are you sure you want to delete this toy?',
        [
          { text: 'Cancel', style: 'cancel' },
          { 
            text: 'Delete', 
            style: 'destructive',
            onPress: async () => {
               setLoading(true);
               const { error } = await supabase.from('toys').delete().eq('id', toy.id);
               setLoading(false);
               if (error) {
                 setError(error.message);
               } else {
                 navigation.goBack();
               }
            }
          }
        ]
      );
    }
  };

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
            value={rfidDisplay}
            onChangeText={(t) => setRfidDisplay(normalizeRfid(t))}
            mode="outlined"
            style={[styles.input, { backgroundColor: '#FFF' }]}
            contentStyle={{ fontFamily: headerFont }}
            right={<TextInput.Icon icon={scanRunning ? 'loading' : 'barcode-scan'} onPress={scanRfid} color={scanRunning ? theme.colors.primary : '#FF8C42'} />}
            theme={{ roundness: 24 }}
            outlineColor="#E0E0E0"
            activeOutlineColor="#FF8C42"
          />
          {(scannedDeviceId || toy?.device_id) && (
            <HelperText type="info" visible={true} style={{ fontFamily: headerFont }}>
              Bound Device: {scannedDeviceId || toy?.device_id}
            </HelperText>
          )}

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



          <View style={{ height: 12 }} />
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 16 }}>
            {toy && (
              <Button 
                mode="outlined" 
                onPress={deleteToy} 
                loading={loading}
                style={[styles.saveBtn, { borderColor: theme.colors.error, flex: 1, maxWidth: 160 }]} 
                contentStyle={{ height: 44 }} 
                textColor={theme.colors.error}
                labelStyle={{ fontSize: 16, fontWeight: 'bold', fontFamily: headerFont }}
              >
                Delete
              </Button>
            )}
            <Button 
              mode="contained" 
              onPress={save} 
              loading={loading} 
              style={[styles.saveBtn, { flex: 1, maxWidth: 160 }]} 
              contentStyle={{ height: 44 }} 
              labelStyle={{ fontSize: 16, fontWeight: 'bold', fontFamily: headerFont }}
            >
              Save
            </Button>
          </View>

          
          
          <View style={{ height: 60 }} />
        </View>
      </ScrollView>
      </KeyboardAvoidingView>
      
      <Portal>
        <Modal
            visible={scanDialogOpen}
            onDismiss={stopScan}
            contentContainerStyle={{
              backgroundColor: 'white',
              borderRadius: 16,
              width: '85%',
              alignSelf: 'center',
              paddingVertical: 20,
              paddingHorizontal: 0,
              overflow: 'hidden'
            }}
        >
          {scanResults.length === 0 ? (
              <View style={{ padding: 16, alignItems: 'center' }}>
                 {scanRunning ? (
                   <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                     <ActivityIndicator size={20} color={theme.colors.primary} style={{ marginRight: 12 }} />
                     <Text style={{ fontFamily: headerFont, fontSize: 16, color: '#666' }}>Scanning nearby tags...</Text>
                   </View>
                 ) : (
                   <Text style={{ fontFamily: headerFont, color: '#666', fontSize: 16, textAlign: 'center' }}>No tags found. Please bring toy closer.</Text>
                 )}
              </View>
           ) : (
            <ScrollView style={{ maxHeight: 400, width: '100%' }} contentContainerStyle={{ paddingHorizontal: 0 }}>
              {scanResults.map((r, idx) => (
                  <Pressable
                    key={r.epc}
                    style={({ pressed }) => ({
                        width: '100%',
                        paddingVertical: 14,
                        paddingHorizontal: 32,
                        backgroundColor: pressed ? 'rgba(0,0,0,0.05)' : 'transparent',
                        borderBottomWidth: StyleSheet.hairlineWidth,
                        borderBottomColor: '#eee',
                        flexDirection: 'column',
                        alignItems: 'stretch'
                    })}
                    onPress={() => {
                      setRfidFull(r.epc);
                      setRfidDisplay(formatRfidDisplay(r.epc, 6));
                      stopScan();
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Text style={{ fontSize: 16, fontFamily: headerFont, color: theme.colors.onSurface }}>
                            {formatRfidDisplay(r.epc, 6)}
                        </Text>
                        <Text style={{ fontSize: 12, color: r.rssi && r.rssi > -70 ? '#4CAF50' : (r.rssi && r.rssi > -85 ? '#FF9800' : '#F44336'), fontFamily: headerFont }}>
                             {r.rssi !== undefined ? `${r.rssi} dBm` : ''}
                        </Text>
                    </View>
                  </Pressable>
                ))
              }
            </ScrollView>
          )}
          <View style={{ paddingHorizontal: 24, paddingTop: 12 }}>
            <Button mode="text" onPress={stopScan} labelStyle={{ fontFamily: headerFont }}>Close</Button>
          </View>
        </Modal>

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
