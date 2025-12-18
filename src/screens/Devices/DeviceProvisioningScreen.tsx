import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, Platform, Linking, ScrollView, Pressable } from 'react-native';
import { Text, Button, Card, List, TextInput, Banner, useTheme, Portal, Dialog, Snackbar, Chip, Divider, Menu, Provider as PaperProvider } from 'react-native-paper';
import { LinearGradient } from 'expo-linear-gradient';
import { cartoonGradient, orangeCapsuleGradient, softPurpleFill } from '../../theme/tokens';
import Constants from 'expo-constants';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { discoverDevices } from '../../utils/zeroconf';
import { supabase } from '../../supabaseClient';
import { ensureBleDeps } from '../../shims/bleDeps';
import { PERMISSIONS, RESULTS, check, request } from '../../shims/permissions';
// Lazily import expo-camera to avoid initial load issues on web
type BleDevice = { id: string; name: string };
function randomId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let s = '';
  for (let i=0;i<6;i++) s += chars[Math.floor(Math.random()*chars.length)];
  return s;
}
// Normalize device ID format as ESP32_XXXXXX (last 6 characters uppercased)
function toDeviceId(id: string) {
  try {
    const s = String(id || '').trim();
    const stripped = s.replace(/^ESP32_/i, '');
    const m = /([A-Za-z0-9]{6})$/.exec(stripped);
    const suffix = (m && m[1]) ? m[1].toUpperCase() : stripped.toUpperCase();
    return `ESP32_${suffix.slice(-6)}`;
  } catch {
    return `ESP32_${randomId()}`;
  }
}
// UI display helper: show UPPERCASE 6-char suffix
function toDisplaySuffixFromDeviceId(id: string) {
  try {
    const norm = toDeviceId(id);
    return norm.replace(/^ESP32_/i, '').slice(-6).toUpperCase();
  } catch { return randomId().toUpperCase(); }
}
// Try to parse a display suffix from a BLE name.
// Rules:
// 1) Direct 6-char suffix in name: PINME-XXXXXX / PINMEXXXXXX / PINME-ESP32_XXXXXX
// 2) MAC in parentheses: take the LAST 3 bytes (e.g., FC:01:2C:CF:CE:85 -> CFCE85)
function parseDisplaySuffixFromName(name: string): string | null {
  try {
    // Match: PINME-XXXXXX or PINMEXXXXXX or PINME-ESP32_XXXXXX
    const m = /pinme(?:-|)?(?:ESP32_)?([A-Za-z0-9]{6})/i.exec(name || '');
    if (m && m[1]) return String(m[1]).toUpperCase();
    // Match MAC in parentheses at end: (FC:01:2C:CF:CE:85)
    const macMatch = /\(([0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5})\)$/i.exec(name || '');
    if (macMatch && macMatch[1]) {
      const bytes = macMatch[1].split(':');
      if (bytes.length === 6) {
        // Use the last 3 bytes (CF:CE:85) concatenated
        return `${bytes[3]}${bytes[4]}${bytes[5]}`.toUpperCase();
      }
    }
  } catch {}
  return null;
}
class ScreenErrorBoundary extends React.Component<any, { hasError: boolean; error: any }> {
  constructor(props: any) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error: any) { return { hasError: true, error }; }
  componentDidCatch(error: any, info: any) { /* noop: could log */ }
  render() {
    if (this.state.hasError) {
      return (
        <View style={{ flex: 1, padding: 16 }}>
          <Card style={{ borderRadius: 18 }}>
            <Card.Title 
              title="Failed to open page" 
              subtitle="Screen error" 
              titleStyle={{ fontFamily: Platform.OS === 'ios' ? 'Arial Rounded MT Bold' : Platform.OS === 'android' ? 'sans-serif-medium' : 'System' }}
              left={(p) => <List.Icon {...p} icon="alert" />} 
            />
            <Card.Content>
              <Text style={{ marginBottom: 8, fontFamily: Platform.OS === 'ios' ? 'Arial Rounded MT Bold' : Platform.OS === 'android' ? 'sans-serif-medium' : 'System' }}>An unexpected error occurred while opening the page.</Text>
              <Text style={{ color: '#b00020', marginBottom: 12, fontFamily: Platform.OS === 'ios' ? 'Arial Rounded MT Bold' : Platform.OS === 'android' ? 'sans-serif-medium' : 'System' }}>{String(this.state.error?.message || this.state.error || '')}</Text>
              <Button mode="contained" onPress={() => (window?.history?.length ? window.history.back() : null)}>Back</Button>
            </Card.Content>
          </Card>
        </View>
      );
    }
    return this.props.children;
  }
}
export default function DeviceProvisioningScreen() {
  const theme = useTheme();
  const headerFont = Platform.select({ ios: 'Arial Rounded MT Bold', android: 'sans-serif-medium', default: 'System' });
  const navigation = useNavigation<any>();
  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState<BleDevice[]>([]);
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<BleDevice | null>(null);
  const [deviceName, setDeviceName] = useState<string>('');
  const [location, setLocation] = useState<string>('');
  const [deviceId, setDeviceId] = useState<string>(toDeviceId(randomId()));
  const [ssid, setSsid] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [sending, setSending] = useState(false);
  const [success, setSuccess] = useState(false);
  const [showBanner, setShowBanner] = useState(true);
  const [hasCamPermission, setHasCamPermission] = useState<boolean | null>(null);
  const [scanningQR, setScanningQR] = useState(false);
  const camModuleRef = useRef<any>(null);
  const bleRef = useRef<any>(null);
  const bleStateSubRef = useRef<any>(null);
  const [blePoweredOn, setBlePoweredOn] = useState<boolean | null>(null);
  const [snackbarVisible, setSnackbarVisible] = useState(false);
  const [snackbarMsg, setSnackbarMsg] = useState('');
  const [debugEnabled] = useState(true);
  // Wi‑Fi provisioning status (set to true only after Connect succeeds)
  const [wifiProvisionOk, setWifiProvisionOk] = useState(false);
  // BLE 心跳（持续向设备发送 PING）
  const heartbeatTimerRef = useRef<any>(null);
  // 在设备首次报告 WIFI_OK / WIFI_STA_CONNECTED 后，自动触发一次 HEARTBEAT_NOW（避免频繁重复）
  const hbNowSentRef = useRef<boolean>(false);
  // Currently connected device ID (stay connected after Connect, disconnect after Save)
  const connectedTargetIdRef = useRef<string | null>(null);
  // pinme device selection list
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pinmeList, setPinmeList] = useState<Array<{ id: string; name: string; rssi: number | null }>>([]);
  // Wi‑Fi scan picker
  const [wifiPickerVisible, setWifiPickerVisible] = useState(false);
  const [wifiList, setWifiList] = useState<Array<{ ssid: string; strength?: number }>>([]);
  // Scan list returned via ESP32 BLE (WIFI_LIST)
  const [wifiItemsBle, setWifiItemsBle] = useState<Array<{ ssid: string; rssi: number; enc: string }>>([]);
  const [wifiBlePickerVisible, setWifiBlePickerVisible] = useState(false);
  const [selectedWifiEnc, setSelectedWifiEnc] = useState<string | null>(null);
  const [lastWifiStatus, setLastWifiStatus] = useState<string | null>(null);
  const [showPasswordInput, setShowPasswordInput] = useState(false);
  // Align with ToyFormScreen: location dropdown suggestions
  const DEFAULT_LOCATIONS = ['Living room','Bedroom','Toy house','others'];
  const [locSuggestions, setLocSuggestions] = useState<string[]>([]);
  const [locMenuOpen, setLocMenuOpen] = useState(false);
  const locLockRef = useRef(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const siteUrl = process.env.EXPO_PUBLIC_SITE_URL || '';
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
  // Ensure Metro bundles native BLE-related modules in Dev Client
  ensureBleDeps();
  const payload = useMemo(() => ({
    device_id: toDeviceId(deviceId),
    name: deviceName || 'Toy Reader - Living Room',
    location: location || 'Living Room',
    wifi: { ssid, password },
    api: { supabase_url: supabaseUrl, anon_key: anonKey, site_url: siteUrl },
  }), [deviceId, deviceName, location, ssid, password, supabaseUrl, anonKey, siteUrl]);
  useEffect(() => {
    const loadLocs = async () => {
      try {
        const { data } = await supabase.from('toys').select('location').limit(100);
        const locs = Array.from(new Set((data || []).map((t: any) => t.location).filter(Boolean)));
        setLocSuggestions(locs);
      } catch {}
    };
    loadLocs();
  }, []);
  // On native platforms (Android/iOS), we can try native modules; in Expo Go, dynamic loading will fail and fall back.
  const supportsNativeModules = Platform.OS !== 'web';
  useEffect(() => {
    // Auto-start guided flow
    // Attempt to autofill current SSID (if native module available)
    autoFillSsid();
    // Camera permission will be requested when user taps "Scan QR" to avoid early prompts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Debug 日志：新日志在上面显示（prepend），满足“新的在上面”的需求
  const appendStatus = (msg: string) => setStatus((prev) => msg + (prev ? '\n' + prev : ''));
  // —— 安全的 Base64 编解码（避免在 Web/原生环境缺少 Buffer/btoa/atob 时崩溃）——
  const _b64Table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  const simpleBtoa = (str: string): string => {
    // 兼容非 ASCII 文本：先转为 UTF‑8 字节序列（通过 encodeURIComponent/unescape）
    const bytes = unescape(encodeURIComponent(str));
    let output = '';
    let i = 0;
    while (i < bytes.length) {
      const chr1 = bytes.charCodeAt(i++);
      const chr2 = bytes.charCodeAt(i++);
      const chr3 = bytes.charCodeAt(i++);
      const enc1 = chr1 >> 2;
      const enc2 = ((chr1 & 3) << 4) | (chr2 >> 4);
      let enc3 = ((chr2 & 15) << 2) | (chr3 >> 6);
      let enc4 = chr3 & 63;
      if (isNaN(chr2)) { enc3 = enc4 = 64; }
      else if (isNaN(chr3)) { enc4 = 64; }
      output += _b64Table.charAt(enc1) + _b64Table.charAt(enc2) + _b64Table.charAt(enc3) + _b64Table.charAt(enc4);
    }
    return output;
  };
  const simpleAtob = (b64: string): string => {
    let input = String(b64 || '').replace(/[^A-Za-z0-9+/=]/g, '');
    let output = '';
    let i = 0;
    while (i < input.length) {
      const enc1 = _b64Table.indexOf(input.charAt(i++));
      const enc2 = _b64Table.indexOf(input.charAt(i++));
      const enc3 = _b64Table.indexOf(input.charAt(i++));
      const enc4 = _b64Table.indexOf(input.charAt(i++));
      const chr1 = (enc1 << 2) | (enc2 >> 4);
      const chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
      const chr3 = ((enc3 & 3) << 6) | enc4;
      output += String.fromCharCode(chr1);
      if (enc3 !== 64) output += String.fromCharCode(chr2);
      if (enc4 !== 64) output += String.fromCharCode(chr3);
    }
    // 将 Latin‑1 字节串还原为 UTF‑8 字符串
    try { return decodeURIComponent(escape(output)); } catch { return output; }
  };
  const b64Encode = (s: string): string => {
    try { if ((global as any).btoa) return (global as any).btoa(s); } catch {}
    try { if (typeof Buffer !== 'undefined') return Buffer.from(s, 'utf8').toString('base64'); } catch {}
    try { const mod = require('buffer'); const Buf = (mod && mod.Buffer) ? mod.Buffer : (Buffer as any); if (Buf) return Buf.from(s, 'utf8').toString('base64'); } catch {}
    return simpleBtoa(s);
  };
  const b64Decode = (b64: string): string => {
    try { if ((global as any).atob) return (global as any).atob(b64); } catch {}
    try { if (typeof Buffer !== 'undefined') return Buffer.from(b64, 'base64').toString('utf8'); } catch {}
    try { const mod = require('buffer'); const Buf = (mod && mod.Buffer) ? mod.Buffer : (Buffer as any); if (Buf) return Buf.from(b64, 'base64').toString('utf8'); } catch {}
    return simpleAtob(b64);
  };
  // === JWT 签发（带超时与兜底） ===
  const getJwtTokenWithTimeout = async (
    deviceId: string,
    timeoutMs: number = 9000,
  ): Promise<{ token: string | null; usedDebug: boolean; timedOut: boolean; errorCtx?: { status?: number; reqId?: string; region?: string } }> => {
    let token: string | null = null;
    let usedDebug = false;
    let timedOut = false;
    let errorCtx: { status?: number; reqId?: string; region?: string } | undefined;
    try {
      const fnUrl = `${process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/$/, '')}/functions/v1/issue-device-jwt`;
      debug(`Step[Provision] Diagnose: functionUrl=${fnUrl}; supabaseUrl=${process.env.EXPO_PUBLIC_SUPABASE_URL}`);
    } catch {}
    try {
      const invokePromise = supabase.functions.invoke('issue-device-jwt', {
        body: { device_id: deviceId, quick: true },
      });
      const raced = await Promise.race<any>([
        invokePromise,
        new Promise(resolve => setTimeout(() => resolve('**TIMEOUT**'), timeoutMs)),
      ]);
      if (raced === '**TIMEOUT**') {
        timedOut = true;
        debug(`Step[Provision] issue-device-jwt timed out (${timeoutMs}ms), trying debug fallback`);
      } else {
        const { data: jwtRes, error: jwtErr } = raced || {};
        if (jwtErr) {
          try {
            const ctx: any = (jwtErr as any)?.context;
            const status = ctx?.status;
            const headersMap = ctx?.headers?.map || {};
            const reqId = headersMap['sb-request-id'] || headersMap['x-sb-request-id'] || headersMap['x-deno-execution-id'] || '-';
            const region = headersMap['x-sb-edge-region'] || '-';
            errorCtx = { status, reqId, region };
            debug(`Step[Provision] issue-device-jwt detail: status=${status}; reqId=${reqId}; region=${region}`);
          } catch {}
        } else {
          token = (jwtRes as any)?.token || null;
          if (token) debug(`Step[Provision] Issued device JWT (len=${token.length})`);
          else debug('Step[Provision] issue-device-jwt returned no token');
          try {
            const rawLen = JSON.stringify(jwtRes || {}).length;
            debug(`Step[Provision] issue-device-jwt body length=${rawLen}`);
          } catch {}
        }
      }
    } catch (e: any) {
      debug(`Step[Provision] issue-device-jwt call failed: ${e?.message || e}`);
    }
    if (!token && (timedOut || (errorCtx && errorCtx.status === 504))) {
      try {
        const { data: debugRes, error: debugErr } = await supabase.functions.invoke('issue-device-jwt-debug', {
          body: { device_id: deviceId, quick: true },
        });
        usedDebug = true;
        if (debugErr) {
          debug(`Step[Provision] issue-device-jwt-debug error: ${(debugErr as any)?.message || debugErr}`);
        } else {
          token = (debugRes as any)?.token || null;
          if (token) debug(`Step[Provision] Debug route returned token (len=${token.length})`);
          else debug('Step[Provision] issue-device-jwt-debug returned no token');
          try {
            const rawLen = JSON.stringify(debugRes || {}).length;
            debug(`Step[Provision] issue-device-jwt-debug body length=${rawLen}`);
          } catch {}
        }
      } catch (e: any) {
        debug(`Step[Provision] issue-device-jwt-debug call failed: ${e?.message || e}`);
      }
    }
    return { token, usedDebug, timedOut, errorCtx };
  };
  // === BLE 心跳：每隔 30s 发送一次 PING 到 FFF1，便于设备在 BLE 侧维持与上报 ===
  const startBleHeartbeat = (dev: any, serviceUUID: string, writeCharUUID: string, intervalMs = 30000) => {
    try { if (heartbeatTimerRef.current) { clearInterval(heartbeatTimerRef.current); heartbeatTimerRef.current = null; } } catch {}
    heartbeatTimerRef.current = setInterval(async () => {
      try {
        const ping = b64Encode('PING');
        await dev.writeCharacteristicWithResponseForService(serviceUUID, writeCharUUID, ping);
        debug('Step[Heartbeat] PING sent');
      } catch (e: any) {
        debug(`Step[Heartbeat] PING failed: ${e?.message || e}`);
      }
    }, intervalMs);
    debug(`Step[Heartbeat] Started BLE heartbeat @${intervalMs}ms`);
  };
  useEffect(() => {
    return () => { try { if (heartbeatTimerRef.current) { clearInterval(heartbeatTimerRef.current); heartbeatTimerRef.current = null; } } catch {} };
  }, []);
  const updateWifiStatusFromMsg = (msg: string) => {
    const knownPrefixes = [
      'WIFI_IDLE','WIFI_CONNECTING','WIFI_STA_CONNECTED','WIFI_OK','WIFI_FAIL','WIFI_AP_NOT_FOUND','WIFI_AUTH_FAIL','WIFI_DISCONNECTED_REASON_','ACK_PING','ACK_RX_LEN','ACK LEN','DATA_RECEIVED'
    ];
    if (knownPrefixes.some(k => msg.startsWith(k))) {
      setLastWifiStatus(msg);
    }
    if (msg.startsWith('WIFI_OK') || msg.startsWith('WIFI_STA_CONNECTED')) {
      setWifiProvisionOk(true);
    }
  };
  const handleWifiListMessage = (msg: string) => {
    if (msg === 'WIFI_LIST_BEGIN') { setWifiItemsBle([]); return; }
    if (msg.startsWith('WIFI_ITEM ')) {
      const payload = msg.substring('WIFI_ITEM '.length);
      const parts = payload.split('|');
      const ssid = parts[0] ?? '';
      const rssi = parseInt(parts[1] ?? '0', 10);
      const enc = parts[2] ?? '';
      setWifiItemsBle(prev => {
        const filtered = prev.filter(i => i.ssid !== ssid);
        return [...filtered, { ssid, rssi, enc }];
      });
      return;
    }
  };
  // Output debug info to console and on-screen Debug Log, and attempt to send it to the ESP32 (if firmware supports text display)
  const postDebugToEsp32 = async (msg: string) => {
    try {
      const enc = encodeURIComponent(msg);
      const candidates = [
        `http://esp32.local/debug?message=${enc}`,
        `http://esp32.local/lcd?text=${enc}`,
        `http://esp32.local/notify?text=${enc}`,
      ];
      for (const u of candidates) {
        try {
          const controller = new AbortController();
          const t = setTimeout(() => controller.abort(), 600);
          const res = await fetch(u, { signal: controller.signal });
          clearTimeout(t);
          if (res.ok) break; // Any endpoint succeeding is sufficient
        } catch {}
      }
    } catch {}
  };
  const debug = (msg: string) => {
    try { console.log('[BLE][Provisioning]', msg); } catch {}
    appendStatus(msg);
    // Try to display debug text on the device screen asynchronously (if firmware supports any endpoint)
    try { setTimeout(() => { postDebugToEsp32(msg); }, 0); } catch {}
  };
  const autoFillSsid = async () => {
    try {
      if (Platform.OS === 'web') return; // Web does not support reading SSID
      debug('Step[SSID] Request location permission to read current Wi‑Fi');
      // iOS/Android require location permission in order to read SSID
      try {
        const loc = await import('expo-location');
        const { status } = await loc.Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') { debug('Step[SSID] Location permission not granted; cannot read SSID'); return; }
      } catch {}
      if (!supportsNativeModules) { debug('Step[SSID] Native modules not supported (use Dev Client/release build)'); return; }
      // In Dev Client/release builds, require react-native-network-info directly
      let NetworkInfo: any;
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require('react-native-network-info');
        NetworkInfo = mod?.NetworkInfo || mod?.default || mod;
      } catch {
        debug('Step[SSID] react-native-network-info not available');
        return;
      }
      const currentSsid = await NetworkInfo.getSSID();
      if (currentSsid && typeof currentSsid === 'string' && currentSsid !== 'unknown ssid') {
        setSsid(currentSsid);
        debug(`Step[SSID] Detected current Wi‑Fi: ${currentSsid}`);
      } else {
        debug('Step[SSID] SSID unavailable (ensure Wi‑Fi connected and Location enabled)');
      }
    } catch (e:any) {
      debug(`Step[SSID] Auto-detect SSID failed: ${e?.message || e}`);
    }
  };
  // Ensure required BLE permissions at runtime (Android 12+)
  const ensureBlePermissions = async (): Promise<boolean> => {
    try {
      debug('Step[Perm] Check/request BLE scan/connect permissions');
      if (Platform.OS === 'android') {
        const isApi31Plus = (typeof Platform?.Version === 'number' ? Platform.Version >= 31 : true);
        if (isApi31Plus) {
          // Some devices on Android 12+ still require location permission to return BLE advertisements
          const locFineStatus = await check(PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION);
          if (locFineStatus !== RESULTS.GRANTED) {
            const r = await request(PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION);
            if (r !== RESULTS.GRANTED) return false;
          }
          const scanStatus = await check(PERMISSIONS.ANDROID.BLUETOOTH_SCAN);
          if (scanStatus !== RESULTS.GRANTED) {
            const r = await request(PERMISSIONS.ANDROID.BLUETOOTH_SCAN);
            if (r !== RESULTS.GRANTED) return false;
          }
          const connStatus = await check(PERMISSIONS.ANDROID.BLUETOOTH_CONNECT);
          if (connStatus !== RESULTS.GRANTED) {
            const r = await request(PERMISSIONS.ANDROID.BLUETOOTH_CONNECT);
            if (r !== RESULTS.GRANTED) return false;
          }
        } else {
          // Android < 12 use Location for BLE scan
          try {
            const loc = await import('expo-location');
            const { status } = await loc.Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') return false;
          } catch { return false; }
        }
      }
      debug('Step[Perm] Permissions satisfied');
      return true;
    } catch { return false; }
  };
  // Scan briefly and pick the nearest ESP32-like device then read Device ID characteristic
  const scanAndReadNearestDeviceId = async (): Promise<string | null> => {
    setError(null);
    // On native platforms, try dynamically loading the BLE module; if it fails, inform that Dev Client/production build is required
    const ok = await ensureBlePermissions();
    if (!ok) { setError('Bluetooth/Location permissions not granted'); return null; }
    try {
      debug('Step[Scan] Load BLE module and start scanning');
      // Use platform shim to avoid resolving native module on web
      const { BleManager } = await import('../../shims/ble');
      const manager = bleRef.current || new BleManager();
      bleRef.current = manager;
      debug('Step[Scan] Scan nearby devices; prioritize ESP32/Pinme/Toy; fallback to strongest signal');
      return await new Promise<string | null>((resolve) => {
        let resolved = false;
        let bestCandidate: { id: string; name: string; rssi: number | null } | null = null;
        const stop = () => { try { manager.stopDeviceScan(); } catch {} };
        manager.startDeviceScan(null, { allowDuplicates: true }, async (err: any, device: any) => {
          if (err || resolved) { return; }
          const name: string = device?.name || device?.localName || '';
          const id: string = device?.id || device?.uuid || '';
          const rssi: number | null = typeof device?.rssi === 'number' ? device.rssi : null;
          if (!id) return;
          debug(`Step[Scan] Found device: ${name || 'Unknown'} (${id})${rssi != null ? `, RSSI=${rssi}` : ''}`);
          // If device name is pinmeXXXXXX (from ESP32 ID last 6 chars), parse device ID directly from the name
      const nameMatch = /pinme([A-Za-z0-9]{6})/i.exec(name || '');
      if (nameMatch && nameMatch[1]) {
        resolved = true; stop();
        const suffix = String(nameMatch[1]).toUpperCase();
        const derivedId = suffix;
        setSelected({ id, name: `PINME-${suffix}` });
        setSnackbarMsg(`Connected to PINME-${suffix}`);
        setSnackbarVisible(true);
        debug(`Step[ReadID] Derive display suffix from name: ${derivedId}`);
        resolve(derivedId);
        return;
      }
          const looksLikeEsp32 = /esp32|pinme|toy/i.test(name || '');
          // Track strongest signal device as fallback candidate
          if (!bestCandidate || ((rssi ?? -999) > (bestCandidate.rssi ?? -999))) {
            bestCandidate = { id, name: name || 'Unknown', rssi };
          }
          if (!looksLikeEsp32) return;
          // Found matching device; stop scan and try reading
          resolved = true; stop();
          try {
            debug(`Step[ReadID] Connect to ${name || 'ESP32 Device'} and read device ID...`);
            const dev = await manager.connectToDevice(id, { autoConnect: false });
            const d = await dev.discoverAllServicesAndCharacteristics();
            const serviceUUID = '0000fff0-0000-1000-8000-00805f9b34fb';
            const idCharUUID3 = '0000fff3-0000-1000-8000-00805f9b34fb';
            const idCharUUID2 = '0000fff2-0000-1000-8000-00805f9b34fb';
            let ch: any;
            try { ch = await d.readCharacteristicForService(serviceUUID, idCharUUID3); }
            catch { ch = await d.readCharacteristicForService(serviceUUID, idCharUUID2); }
            const b64 = ch?.value || '';
            let idStr = '';
            try { const decoded = b64Decode(b64); idStr = String(decoded || '').trim(); }
            catch (e:any) { debug(`Step[ReadID] FFF3/FFF2 decode error: ${e?.message || e}; raw=${b64}`); idStr = ''; }
            const disp = toDisplaySuffixFromDeviceId(idStr || '');
            setSelected({ id, name: `PINME-${disp}` });
            setSnackbarMsg(`Connected to PINME-${disp}`);
            setSnackbarVisible(true);
            debug(`Step[ReadID] Read device ID: ${idStr || 'empty'}, disconnecting`);
            try { await manager.cancelDeviceConnection(id); } catch {}
            resolve(idStr || null);
          } catch (e: any) {
            setError(`Failed to read device ID: ${e?.message || String(e)}`);
            debug(`Step[ReadID] Failed to read device ID: ${e?.message || e}`);
            resolve(null);
          }
        });
        // After 8 seconds with no match, fall back to the strongest-signal device
        setTimeout(async () => {
          if (resolved) return;
          stop();
          if (!bestCandidate) { debug('Step[Scan] Timeout: no devices found'); resolve(null); return; }
          const { id, name } = bestCandidate;
          debug(`Step[Scan] No matching name; connecting strongest-signal device: ${name} (${id})`);
          try {
            const dev = await manager.connectToDevice(id, { autoConnect: false });
            const d = await dev.discoverAllServicesAndCharacteristics();
            const serviceUUID = '0000fff0-0000-1000-8000-00805f9b34fb';
            const idCharUUID3 = '0000fff3-0000-1000-8000-00805f9b34fb';
            const idCharUUID2 = '0000fff2-0000-1000-8000-00805f9b34fb';
            let ch: any;
            try { ch = await d.readCharacteristicForService(serviceUUID, idCharUUID3); }
            catch { ch = await d.readCharacteristicForService(serviceUUID, idCharUUID2); }
            const b64 = ch?.value || '';
            let idStr = '';
            try { const decoded = b64Decode(b64); idStr = String(decoded || '').trim(); }
            catch (e:any) { debug(`Step[ReadID] FFF3/FFF2 decode error (fallback): ${e?.message || e}; raw=${b64}`); idStr = ''; }
            const disp = toDisplaySuffixFromDeviceId(idStr || '');
            setSelected({ id, name: `PINME-${disp}` });
            setSnackbarMsg(`Connected to PINME-${disp}`);
            setSnackbarVisible(true);
            debug(`Step[ReadID] Read device ID (fallback): ${idStr || 'empty'}, disconnecting`);
            try { await manager.cancelDeviceConnection(id); } catch {}
            resolve(idStr || null);
          } catch (e: any) {
            setError(`Failed to read device ID (fallback): ${e?.message || String(e)}`);
            debug(`Step[ReadID] Fallback connection failed to read device ID: ${e?.message || e}`);
            resolve(null);
          }
        }, 8000);
      });
    } catch (e: any) {
      setError(`Scan failed: ${e?.message || String(e)}`);
      debug(`Step[Scan] Scan failed: ${e?.message || e}`);
      return null;
    }
  };
  const checkMdnsReachable = async (timeoutMs = 12000): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 1500);
        const res = await fetch('http://esp32.local/info', { signal: controller.signal });
        clearTimeout(t);
        if (res.ok) return true;
      } catch {}
      await new Promise(r => setTimeout(r, 800));
    }
    return false;
  };
  const startScan = async () => {
    setError(null);
    setSuccess(false);
    setSending(false);
    setScanning(true);
    setDevices([]);
    setStatus('');
    debug('Step[ScanList] Start scanning and list nearby devices');
    // Demo fallback for Web/Expo Go
    if (!supportsNativeModules) {
      setTimeout(() => {
        const demo: BleDevice = { id: 'DEMO_2C01FC', name: 'Toy Reader - Living Room' };
        setDevices([demo]);
        setScanning(false);
        appendStatus('Found Toy Reader - Living Room');
        setSelected(demo);
        setDeviceId('2C01FC');
      }, 900);
      return;
    }
    try {
      // Runtime permissions
      if (Platform.OS === 'android') {
        const isApi31Plus = (typeof Platform?.Version === 'number' ? Platform.Version >= 31 : true);
        if (isApi31Plus) {
          // Android 12+: additionally request location permission to avoid missing advertisements on some devices
          const locFineStatus = await check(PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION);
          if (locFineStatus !== RESULTS.GRANTED) {
            const r = await request(PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION);
            if (r !== RESULTS.GRANTED) { setError('Location permission denied'); setScanning(false); return; }
          }
          const scanStatus = await check(PERMISSIONS.ANDROID.BLUETOOTH_SCAN);
          if (scanStatus !== RESULTS.GRANTED) {
            const r = await request(PERMISSIONS.ANDROID.BLUETOOTH_SCAN);
            if (r !== RESULTS.GRANTED) { setError('Bluetooth scan permission denied'); setScanning(false); return; }
          }
          const connStatus = await check(PERMISSIONS.ANDROID.BLUETOOTH_CONNECT);
          if (connStatus !== RESULTS.GRANTED) {
            const r = await request(PERMISSIONS.ANDROID.BLUETOOTH_CONNECT);
            if (r !== RESULTS.GRANTED) { setError('Bluetooth connect permission denied'); setScanning(false); return; }
          }
        } else {
          // Android < 12 use Location for BLE scan
          try {
            const loc = await import('expo-location');
            const { status } = await loc.Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') { setError('Location permission denied'); setScanning(false); return; }
          } catch {}
        }
      }
      // Lazy-load BLE manager via platform shim
      if (!bleRef.current) {
        const { BleManager } = await import('../../shims/ble');
        bleRef.current = new BleManager();
        debug('Step[ScanList] BleManager created');
      }
      // Observe Bluetooth state to remind user to enable it on first use
      try {
        if (!bleStateSubRef.current && bleRef.current?.onStateChange) {
          bleStateSubRef.current = bleRef.current.onStateChange((state: string) => {
            const on = String(state).toLowerCase() === 'poweredon';
            setBlePoweredOn(on);
          }, true);
        }
      } catch {}
      // Start scan
      debug('Step[ScanList] Scanning nearby BLE devices...');
      const seen = new Map<string, BleDevice>();
      bleRef.current.startDeviceScan(null, { allowDuplicates: true }, (err: any, device: any) => {
        if (err) {
          setError(String(err?.message || err));
          setScanning(false);
          try { bleRef.current?.stopDeviceScan(); } catch {}
          debug(`Step[ScanList] Scan error: ${err?.message || err}`);
          return;
        }
        const name: string = device?.name || device?.localName || '';
        const id: string = device?.id || device?.uuid || '';
        if (!id) return;
        debug(`Step[ScanList] Found device: ${name || 'Unknown'} (${id})`);
        // Keep only likely ESP32 devices (could further filter by service UUIDs)
        const looksLikeEsp32 = name?.toLowerCase()?.includes('esp32') || name?.toLowerCase()?.includes('pinme') || name?.toLowerCase()?.includes('toy');
        // Display name normalization: show PINME-<UPPERCASE 6-char suffix> if parseable
        const displaySuffix = parseDisplaySuffixFromName(name || '');
        const item: BleDevice = { id, name: displaySuffix ? `PINME-${displaySuffix}` : ((name || 'ESP32 DEVICE').toUpperCase()) };
        if (!looksLikeEsp32 && devices.length < 1) {
          // When initial list is empty, still show other devices to aid debugging
          seen.set(id, item);
        } else if (looksLikeEsp32) {
          seen.set(id, item);
        }
        setDevices(Array.from(seen.values()));
      });
      // Auto stop after 10s
      setTimeout(() => {
        try { bleRef.current?.stopDeviceScan(); } catch {}
        setScanning(false);
        debug('Step[ScanList] Scan finished');
      }, 10000);
    } catch (e: any) {
      setError('BLE scan unavailable (Dev Client required)');
    debug(`Step[ScanListErr] BLE scan unavailable (requires Dev Client/release build): ${e?.message || e}`);
      setScanning(false);
    }
  };
  // Scan and show a picker containing only pinmeXXXXXX devices
const scanAndShowPinmeList = async () => {
  setError(null);
  setSuccess(false);
  setSending(false);
  setStatus('');
  setScanLoading(true);
  if (!supportsNativeModules) {
    setScanLoading(false);
    setError('BLE scanning is not supported on Web. Please use the mobile app (Android/iOS Dev Client or release build) to provision the device.');
    return;
  }
  // If there is an old scan, stop it first to avoid lag or unresponsive touch due to concurrent scans
  try { bleRef.current?.stopDeviceScan(); } catch {}
  const ok = await ensureBlePermissions();
  if (!ok) { setError('Bluetooth/Location permissions not granted'); return; }
    try {
      const { BleManager } = await import('../../shims/ble');
      const manager = bleRef.current || new BleManager();
      bleRef.current = manager;
      setPinmeList([]);
      setPickerVisible(true);
      debug('Step[Scan] Start scanning, collect only PINME-XXXXXX devices for selection');
      const map = new Map<string, { id: string; name: string; rssi: number | null }>();
      manager.startDeviceScan(null, { allowDuplicates: true }, (err: any, device: any) => {
        if (err) { debug(`Step[Scan] Scan error: ${err?.message || err}`); return; }
        const name: string = device?.name || device?.localName || '';
        const id: string = device?.id || device?.uuid || '';
        const rssi: number | null = typeof device?.rssi === 'number' ? device.rssi : null;
        if (!id) return;
        // Compatible with both "PINME-ESP32" and "PINMEXXXXXX" naming; collect any device whose name contains "pinme"
        if (/pinme/i.test(name || '')) {
          const prev = map.get(id);
          // Normalize display name to PINME-XXXXXX (last six). If not parseable, show original device name.
          const suffixFromName = parseDisplaySuffixFromName(name || '') || '';
          const shownName = suffixFromName
            ? `PINME-${suffixFromName}`
            : ((name || 'ESP32 DEVICE').toUpperCase());
          const item = { id, name: shownName, rssi };
          if (!prev || ((rssi ?? -999) > (prev.rssi ?? -999))) map.set(id, item);
          const list = Array.from(map.values()).sort((a,b) => ((b.rssi ?? -999) - (a.rssi ?? -999)));
          // 仅保留最近的 3 个设备（按 RSSI 降序）
          setPinmeList(list.slice(0, 3));
          debug(`Step[Scan] Received PINME device: ${name} (${id})${rssi != null ? `, RSSI=${rssi}` : ''}`);
        }
      });
      // Auto-stop scan after 12s (if user hasn't selected yet)
      setTimeout(() => { try { manager.stopDeviceScan(); } catch {} setScanLoading(false); }, 12000);
    } catch (e:any) {
    setError(`Scan failed: ${e?.message || String(e)}`);
      setScanLoading(false);
      debug(`Step[Scan] Scan failed: ${e?.message || e}`);
    }
  };
  const closePicker = () => {
    try { bleRef.current?.stopDeviceScan(); } catch {}
    setPickerVisible(false);
    setScanLoading(false);
  };
  // Wi‑Fi scan permissions
  const ensureWifiPermissions = async (): Promise<boolean> => {
    try {
      if (Platform.OS !== 'android') return true; // iOS: Wi‑Fi list scanning not implemented
      const isApi33Plus = (typeof Platform?.Version === 'number' ? Platform.Version >= 33 : true);
      const locFineStatus = await check(PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION);
      if (locFineStatus !== RESULTS.GRANTED) {
        const r = await request(PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION);
        if (r !== RESULTS.GRANTED) return false;
      }
      if (isApi33Plus && PERMISSIONS.ANDROID.NEARBY_WIFI_DEVICES) {
        const nearStatus = await check(PERMISSIONS.ANDROID.NEARBY_WIFI_DEVICES);
        if (nearStatus !== RESULTS.GRANTED) {
          const r = await request(PERMISSIONS.ANDROID.NEARBY_WIFI_DEVICES);
          if (r !== RESULTS.GRANTED) return false;
        }
      }
      // Extra: Check if system location services are enabled (Android 10+ may return empty Wi‑Fi results if disabled)
      try {
        const loc = await import('expo-location');
        const enabled = await loc.Location.hasServicesEnabledAsync();
        if (!enabled) { setError('Please enable system Location (GPS); otherwise Wi‑Fi scan results may be empty'); return false; }
      } catch {}
      return true;
    } catch { return false; }
  };
  // 进入“实际添加界面”时，预先向用户请求 BLE / Wi‑Fi / 位置权限，并尝试自动填充当前 SSID
  useFocusEffect(
    React.useCallback(() => {
      (async () => {
        if (Platform.OS === 'web') return;
        try { await ensureBlePermissions(); } catch {}
        try { await ensureWifiPermissions(); } catch {}
        try { await autoFillSsid(); } catch {}
      })();
      return () => {};
    }, [])
  );
  // Scan nearby Wi‑Fi and show picker (Android/Dev Client; fallback to current SSID if module missing)
  const scanWifiNetworks = async () => {
    try {
      const ok = await ensureWifiPermissions();
      if (!ok) { setError('Location/Nearby devices permissions not granted; cannot scan Wi‑Fi'); return; }
      setWifiList([]);
      setWifiPickerVisible(true);
      // Prefer react-native-wifi-reborn
      let wifiModule: any = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        wifiModule = require('react-native-wifi-reborn');
      } catch {}
      if (wifiModule && (wifiModule?.loadWifiList || wifiModule?.reScanAndLoadWifiList)) {
        try {
          // Trigger an active scan first, then read the list (some devices return fewer results on reScan, so read again)
          let raw = (wifiModule.reScanAndLoadWifiList ? await wifiModule.reScanAndLoadWifiList() : await wifiModule.loadWifiList()) as any;
          // If too few results, wait briefly then read again
          let arr = Array.isArray(raw) ? raw : JSON.parse(String(raw || '[]'));
          if (!Array.isArray(arr) || arr.length < 2) {
            await new Promise(r => setTimeout(r, 600));
            raw = await wifiModule.loadWifiList();
            arr = Array.isArray(raw) ? raw : JSON.parse(String(raw || '[]'));
          }
          // raw may be a JSON string or an object array
          // Deduplicate and sort by signal strength, keep top 5
          const dedup = new Map<string, { ssid: string; strength?: number }>();
          arr.forEach((it: any) => {
            const ss = String(it?.SSID || it?.ssid || '').trim();
            const lv = typeof it?.level === 'number' ? it.level : undefined;
            if (!ss || ss === '<unknown ssid>') return;
            const prev = dedup.get(ss);
            if (!prev || ((lv ?? -999) > (prev.strength ?? -999))) dedup.set(ss, { ssid: ss, strength: lv });
          });
          const list = Array.from(dedup.values()).sort((a,b) => ((b.strength ?? -999) - (a.strength ?? -999))).slice(0, 5);
          setWifiList(list);
          debug(`Step[WiFiScan] scanned ${list.length} Wi‑Fi networks`);
          return;
        } catch (e:any) {
          debug(`Step[WiFiScan] wifi-reborn scan failed: ${e?.message || e}`);
        }
      }
      // Fallback: only get current connected SSID (react-native-network-info)
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require('react-native-network-info');
        const NetworkInfo = mod?.NetworkInfo || mod?.default || mod;
        const ssid = await NetworkInfo.getSSID();
        if (ssid && ssid !== 'unknown ssid') {
          setWifiList([{ ssid }]);
          debug(`Step[WiFiScan] current SSID: ${ssid}`);
        } else {
          debug('Step[WiFiScan] no current SSID');
        }
      } catch {
        debug('Step[WiFiScan] Wi‑Fi scan module not integrated');
      }
    } catch (e:any) {
    setError(`Scan Wi‑Fi failed: ${e?.message || e}`);
    }
  };
  const onPickWifi = (ssidSel: string) => {
    setSsid(ssidSel);
    setWifiPickerVisible(false);
    debug(`Step[SSID] Selected Wi‑Fi: ${ssidSel}`);
  };
  const onPickPinmeDevice = async (item: { id: string; name: string; rssi: number | null }) => {
    try {
      // Prefer parsing the 6-character display suffix from the name; if that fails, connect to read FFF3/FFF2
// Supported names: "PINME-XXXXXX", "PINMEXXXXXX", "PINME-ESP32_XXXXXX", or "PINME-ESP32 (FC:01:2C:CF:CE:85)"
      const displaySuffix = parseDisplaySuffixFromName(item?.name || '') || '';
      if (displaySuffix) {
        const norm = toDeviceId(displaySuffix.toUpperCase());
        setDeviceId(norm);
        setSelected({ id: item.id, name: displaySuffix ? `PINME-${displaySuffix}` : (item.name || 'ESP32 DEVICE').toUpperCase() });
      } else {
        setSelected({ id: item.id, name: item.name });
      }
      debug(`Step[ReadID] User selected device: ${item.name} (${item.id}), parsed display suffix: ${displaySuffix || 'n/a'}`);
      // Stop scanning before closing the dialog to avoid UI stuck from scan callbacks
      try { bleRef.current?.stopDeviceScan(); } catch {}
      setPickerVisible(false);
      // Try to establish connection in the background
      try {
      const { BleManager } = await import('../../shims/ble');
      const manager = bleRef.current || new BleManager();
        bleRef.current = manager;
        const dev = await manager.connectToDevice(item.id, { autoConnect: false });
        await dev.discoverAllServicesAndCharacteristics();
        setSnackbarMsg(`Connected to ${item.name}`);
        setSnackbarVisible(true);
        setScanLoading(false);
        debug('Step[Conn] Auto-connected device (keep connection for subsequent Connect write)');
        connectedTargetIdRef.current = item.id;
        // If name parsing didn't yield a device ID, read from FFF3/FFF2
        if (!displaySuffix) {
          try {
            const serviceUUID = '0000fff0-0000-1000-8000-00805f9b34fb';
            const idCharUUID3 = '0000fff3-0000-1000-8000-00805f9b34fb';
            const idCharUUID2 = '0000fff2-0000-1000-8000-00805f9b34fb';
            let ch: any;
            try { ch = await dev.readCharacteristicForService(serviceUUID, idCharUUID3); }
            catch { ch = await dev.readCharacteristicForService(serviceUUID, idCharUUID2); }
            const b64 = ch?.value || '';
            let decoded = '';
            try { decoded = String(b64Decode(b64) || '').trim(); }
            catch (e:any) { debug(`Step[Conn] FFF3/FFF2 decode error: ${e?.message || e}; raw=${b64}`); decoded = ''; }
            if (decoded) {
              const norm = toDeviceId(decoded);
              setDeviceId(norm);
              const disp = toDisplaySuffixFromDeviceId(norm);
              // Update displayed name with the resolved UPPERCASE suffix
              setSelected({ id: item.id, name: `PINME-${disp}` });
              debug(`Step[ReadID] Read device ID via FFF3/FFF2: ${decoded} -> ${norm} (display=${disp})`);
            } else {
              debug('Step[ReadID] Read device ID via characteristic is empty');
            }
          } catch (e:any) {
            debug(`Step[ReadID] Failed to read device ID: ${e?.message || e}`);
          }
        }
        // After connecting, immediately subscribe to FFF2 notifications to parse subsequent WIFI_LIST/status
        try {
          const serviceUUID = '0000fff0-0000-1000-8000-00805f9b34fb';
          const echoCharUUID = '0000fff2-0000-1000-8000-00805f9b34fb';
          const sub = dev.monitorCharacteristicForService(serviceUUID, echoCharUUID, (error: any, characteristic: any) => {
            if (error) { debug(`Step[Conn] FFF2 subscription callback error: ${error?.message || error}`); return; }
            const b64 = characteristic?.value || '';
            let msg = '';
            try { msg = String(b64Decode(b64) || '').trim(); }
            catch (e:any) { debug(`Step[Conn] FFF2 decode error: ${e?.message || e}; raw=${b64}`); msg = ''; }
            updateWifiStatusFromMsg(msg);
            handleWifiListMessage(msg);
            debug(`Step[Conn] FFF2 notification: ${msg}`);
          });
          (bleRef as any).currentSubRef = { current: sub };
          debug('Step[Conn] Subscribed FFF2');
        } catch (e:any) {
          debug(`Step[Conn] Subscribe FFF2 failed: ${e?.message || e}`);
        }
      } catch (e:any) {
        debug(`Step[Conn] Auto connect failed: ${e?.message || e}`);
        setScanLoading(false);
      }
    } catch (e:any) {
    setError(`Failed to select device: ${e?.message || e}`);
    }
  };
  const readDeviceIdFromBle = async () => {
    setError(null);
    // Auto scan for nearest device if none selected
    debug('Step[ReadID] Scan button triggered; start reading device ID');
    const idStr = await scanAndReadNearestDeviceId();
    if (idStr) {
      const normalized = toDeviceId(idStr);
      setDeviceId(normalized);
      debug(`Step[ReadID] Successfully read device ID: ${normalized}`);
    } else {
  setError('No nearby device found or read failed');
      debug('Step[ReadID] No device found or read failed');
    }
  };
  const [connecting, setConnecting] = useState(false);
  // Scan button loading state: show spinner during scanning/connecting; hide after connection success or scan end
  const [scanLoading, setScanLoading] = useState(false);
  const startProvisioning = async () => {
    setError(null);
    setSuccess(false);
    setConnecting(true);
    setStatus('');
    debug('Step[Provision] Send Wi‑Fi info to ESP32 (no device scan)');
    // 基本校验：需要先连接到一个设备；Wi‑Fi 名称可选（若设备已联网，仅发送 JWT 即可）
  if (!selected && !connectedTargetIdRef.current) { setError('Please connect a device first (Scan and select a pinme device)'); setConnecting(false); return; }
    // Allow open networks to have empty passwords; consistent with SimpleBleTest: continue sending even if password is empty
    // Simulate BLE write + device Wi-Fi connect
    const simulate = async () => {
      // Fallback for Web/Expo Go: cannot do BLE; also cannot verify mDNS reliably
      await new Promise((r) => setTimeout(r, 2000));
  setError('Current environment does not support BLE provisioning; please use a Dev Client or release build');
      setConnecting(false);
    };
    if (!supportsNativeModules) { await simulate(); return; }
    try {
      const ok = await ensureBlePermissions();
  if (!ok) { setError('Bluetooth/Location permissions not granted'); setConnecting(false); return; }
      const { BleManager } = await import('../../shims/ble');
      const manager = bleRef.current || new BleManager();
      bleRef.current = manager;
      // Skip re-scan; use the user-selected device ID directly
      const targetId = connectedTargetIdRef.current || selected?.id;
  if (!targetId) { setError('Target device not found'); setConnecting(false); return; }
      debug('Step[Provision] Connect selected device and write provisioning info');
      // Optional: reuse the connection object
      let dev: any;
      try {
        const already = await manager.isDeviceConnected(targetId);
        if (already) {
          debug('Step[Provision] Detected existing connection; reuse device');
          const connectedList = await manager.connectedDevices(['0000fff0-0000-1000-8000-00805f9b34fb']).catch(() => []);
          dev = connectedList?.find((d: any) => d?.id === targetId) || await manager.connectToDevice(targetId, { autoConnect: false });
        } else {
          dev = await manager.connectToDevice(targetId, { autoConnect: false });
        }
      } catch {
        dev = await manager.connectToDevice(targetId, { autoConnect: false });
      }
      // Android: request a larger MTU to avoid long JSON being truncated
      try {
        if (Platform.OS === 'android' && dev?.requestMTU) {
          const mtu = await dev.requestMTU(185);
          debug(`Step[Provision] Requested MTU=${typeof mtu === 'object' ? JSON.stringify(mtu) : String(mtu)}`);
        }
      } catch (e:any) {
        debug(`Step[Provision] Request MTU failed: ${e?.message || e}`);
      }
      const d = await dev.discoverAllServicesAndCharacteristics();
      const serviceUUID = '0000fff0-0000-1000-8000-00805f9b34fb';
      const writeCharUUID = '0000fff1-0000-1000-8000-00805f9b34fb';
      const echoCharUUID = '0000fff2-0000-1000-8000-00805f9b34fb';
      connectedTargetIdRef.current = targetId;
      // Attempt to read device_id via FFF3 and issue a device JWT via Edge Function
      let deviceIdForJwt: string | null = null;
      try {
        const idCharUUID3 = '0000fff3-0000-1000-8000-00805f9b34fb';
        const ch3 = await d.readCharacteristicForService(serviceUUID, idCharUUID3).catch(() => null);
        const v = ch3?.value || '';
        let idUtf8 = '';
        try { idUtf8 = v ? String(b64Decode(v) || '').trim() : ''; }
        catch (e:any) { debug(`Step[Provision] FFF3 decode error: ${e?.message || e}; raw=${v}`); idUtf8 = ''; }
        if (idUtf8) deviceIdForJwt = toDeviceId(idUtf8);
        if (deviceIdForJwt) debug(`Step[Provision] FFF3 read device_id=${deviceIdForJwt}`);
      } catch {}
      // Fallback: use currently selected/parsed deviceId from UI if FFF3 read fails
      if (!deviceIdForJwt && deviceId) {
        deviceIdForJwt = toDeviceId(deviceId);
        debug(`Step[Provision] Resolved device_id for upsert/provisioning: ${deviceIdForJwt}`);
      }
      // Automatically issue device JWT for heartbeat (no manual click)
      let deviceJwt: string | null = null;
      if (deviceIdForJwt) {
        try {
          // Ensure the device row exists and is owned by the current user before provisioning
          const { data: userRes, error: userErr } = await supabase.auth.getUser();
          const uid = userRes?.user?.id;
          if (userErr || !uid) {
            debug(`Step[Provision] JWT issuance skipped: not signed in (${userErr?.message || 'no user'})`);
          } else {
            try {
              const up: any = {
                device_id: deviceIdForJwt,
                name: (deviceName && deviceName.trim()) ? deviceName.trim() : 'Toy Reader',
                location: (location && location.trim()) ? location.trim() : 'Unknown',
                status: 'offline',
                user_id: uid,
                updated_at: new Date().toISOString(),
              };
              const { error: upErr } = await supabase.from('devices').upsert(up, { onConflict: 'device_id' });
              if (upErr) {
                debug(`Step[Provision] Pre-upsert device failed: ${upErr.message}`);
              } else {
                debug(`Step[Provision] Pre-upsert device succeeded for ${deviceIdForJwt}`);
              }
            } catch (e:any) {
              debug(`Step[Provision] Pre-upsert device error: ${e?.message || e}`);
            }
            // Invoke Edge Function to issue JWT（带超时与 504 兜底到 debug 路由）
            try {
              const { token, usedDebug, timedOut, errorCtx } = await getJwtTokenWithTimeout(deviceIdForJwt, 9000);
              deviceJwt = token;
              if (timedOut) debug('Step[Provision] issue-device-jwt timed out, attempted debug route');
              if (errorCtx && typeof errorCtx.status !== 'undefined') debug(`Step[Provision] JWT route context: status=${errorCtx.status}; reqId=${errorCtx.reqId}; region=${errorCtx.region}`);
              debug(`Step[Provision] JWT flow meta: usedDebug=${usedDebug}; timedOut=${timedOut}; tokenLen=${deviceJwt ? deviceJwt.length : 0}`);
            } catch (e:any) {
              debug(`Step[Provision] issue-device-jwt invoke failed: ${e?.message || e}`);
            }
            // 重要：此处不再用用户 access_token 覆盖 deviceJwt，改为优先使用设备 JWT（Edge Function）
            // 说明：设备固件解析 JSON 的内存上限较小，用户 access_token 往往较长，可能导致 JSON_INVALID；
            // 设备 JWT（issue-device-jwt 或 debug 兜底）体积更小，更易被固件正确解析并存储。
            debug('Step[Provision] Use device JWT for storage and heartbeat auth (do not override with access_token)');
          }
        } catch (e: any) {
          debug(`Step[Provision] JWT flow error: ${e?.message || e}`);
        }
      }
      // Simplified path: skip pre-reading/validating device ID, directly subscribe and write
      // Subscribe first to avoid missing immediate ACK after write
      let notified = false;
      // Keep subscription reference to avoid GC stopping notifications on some platforms
      const monRef = (bleRef as any).currentSubRef || { current: null };
      (bleRef as any).currentSubRef = monRef;
      debug('Step[Provision] Subscribing FFF2 notifications (status/ACK), waiting for tick/ACK/WIFI_* ...');
      const txId = `wifi-provision-${Date.now()}`;
      let postSentRef = false;
      const sub = d.monitorCharacteristicForService(serviceUUID, echoCharUUID, async (error: any, characteristic: any) => {
        if (error) { debug(`Step[Provision] FFF2 subscription callback error: ${error?.message || error}`); return; }
        if (notified) return;
        const b64 = characteristic?.value || '';
        let msg = '';
        try { const decoded = b64Decode(b64); msg = String(decoded || '').trim(); }
        catch (e:any) { debug(`Step[Provision] FFF2 decode error: ${e?.message || e}; raw=${b64}`); msg = ''; }
        updateWifiStatusFromMsg(msg);
        debug(`Step[Provision] FFF2 notify utf8=${msg}`);
        if (/ACK_RX_LEN/i.test(msg)) debug('Step[Provision] Detected ACK_RX_LEN');
        if (/ACK LEN/i.test(msg)) debug('Step[Provision] Detected ACK LEN');
        if (/WIFI_CONNECTING/i.test(msg)) debug('Step[Provision] Detected WIFI_CONNECTING');
        if (/DATA_RECEIVED/i.test(msg)) debug('Step[Provision] Detected DATA_RECEIVED');
        if (/JWT_SAVED/i.test(msg)) debug('Step[Provision] Detected JWT_SAVED');
        if (/ACK_JWT/i.test(msg)) debug('Step[Provision] Detected ACK_JWT');
        if (/WIFI_OK/i.test(msg)) {
          notified = true;
          setWifiProvisionOk(true);
          setConnecting(false);
          setSuccess(true);
          // Final success message in English
          // 要求：连接成功提示为“connect wifi success”
          setSnackbarMsg('connect wifi success');
          setSnackbarVisible(true);
          appendStatus('connect wifi success');
          if (!postSentRef) {
            postSentRef = true;
            try {
              const { encodeChunkCommands } = await import('../../utils/chunk');
              const writeChunked = async (
                device: any,
                serviceUUID: string,
                writeCharUUID: string,
                tag: 'SUPA_CFG' | 'JWT_SET' | 'CA_SET',
                text: string,
                chunkSize = 16
              ) => {
                const cmds = encodeChunkCommands(tag as any, text, chunkSize);
                for (const c of cmds) {
                  await device.writeCharacteristicWithResponseForService(serviceUUID, writeCharUUID, b64Encode(c));
                }
              };
              const sbUrlTrim = String(supabaseUrl || '').trim().replace(/^['"\s]+|['"\s]+$/g, '');
              const anonTrim = String(anonKey || '').trim().replace(/^['"\s]+|['"\s]+$/g, '');
              const cfg: any = {};
              if (anonTrim.length > 0) cfg.anon = anonTrim;
              if (sbUrlTrim.length > 0) cfg.supabase_url = sbUrlTrim;
              if (Object.keys(cfg).length > 0) {
                const configJson = JSON.stringify(cfg);
                debug(`Step[Provision] (post-success) CONFIG jsonLen=${configJson.length}`);
                await writeChunked(d, serviceUUID, writeCharUUID, 'SUPA_CFG', configJson);
                debug('Step[Provision] (post-success) CONFIG sent (chunked)');
              } else {
                debug('Step[Provision] (post-success) Skip CONFIG (anon/supabase_url unavailable)');
              }
              if (deviceJwt) {
                const jwtJson = JSON.stringify({ jwt: deviceJwt });
                debug(`Step[Provision] (post-success) JWT jsonLen=${jwtJson.length}`);
                await writeChunked(d, serviceUUID, writeCharUUID, 'JWT_SET', jwtJson);
                debug('Step[Provision] (post-success) JWT_SET sent (chunked)');
              } else {
                debug('Step[Provision] (post-success) Skip JWT write: issuance failed or token empty');
              }
              try {
                const caBundle = (process.env.EXPO_PUBLIC_SUPABASE_CA_BUNDLE || '').trim();
                if (caBundle && caBundle.length > 0) {
                  await writeChunked(d, serviceUUID, writeCharUUID, 'CA_SET', caBundle);
                  debug('Step[Provision] (post-success) CA_SET sent (chunked)');
                } else {
                  debug('Step[Provision] (post-success) Skip CA_SET: bundle env missing');
                }
                const insecureFlag = String(process.env.EXPO_PUBLIC_TLS_INSECURE_ON || '').trim();
                if (insecureFlag === '1' || insecureFlag.toLowerCase() === 'true') {
                  await d.writeCharacteristicWithResponseForService(serviceUUID, writeCharUUID, b64Encode('DEV_INSECURE_ON'));
                  debug('Step[Provision] (post-success) DEV_INSECURE_ON sent');
                }
              } catch (e:any) {
                debug(`Step[Provision] (post-success) CA_SET failed: ${e?.message || e}`);
              }
            } catch (e:any) {
              debug(`Step[Provision] (post-success) send config/jwt failed: ${e?.message || e}`);
            }
          }
          // Auto-save removed per requirements; user must tap Save manually
          // 自动触发一次 HEARTBEAT_NOW（仅一次）
          if (!hbNowSentRef.current) {
            hbNowSentRef.current = true;
            d.writeCharacteristicWithResponseForService(serviceUUID, writeCharUUID, b64Encode('HEARTBEAT_NOW'))
              .then(() => debug('Step[Provision] HEARTBEAT_NOW triggered automatically'))
              .catch((e: any) => debug(`Step[Provision] HEARTBEAT_NOW send failed: ${e?.message || e}`));
          }
          // 在 WIFI_OK 后尝试轮询数据库，确认在线（last_seen 更新或 wifi_signal 有值），提升用户体验
          try {
            const did = deviceIdForJwt || deviceId;
            let attempts = 0;
            const maxAttempts = 10; // 10 次 * 2s ≈ 20s
            const timer = setInterval(async () => {
              attempts += 1;
              try {
                const { data } = await supabase
                  .from('devices')
                  .select('last_seen,status,wifi_signal,wifi_ssid,updated_at')
                  .eq('device_id', did)
                  .maybeSingle();
                if (data) {
                  // 与 Supabase devices.status 保持一致，不再基于 5 分钟 last_seen 阈值
                  const onlineFlag = String(data?.status || '').toLowerCase() === 'online';
                  const hasSignal = typeof data?.wifi_signal === 'number' && !Number.isNaN(data.wifi_signal);
                  if (onlineFlag || hasSignal) {
                    clearInterval(timer);
                    appendStatus('Online confirmed via heartbeat (HTTP 204).');
          setSnackbarMsg('Device online');
          setSnackbarVisible(true);
                  }
                }
              } catch (e: any) {
                debug(`Step[Provision] Online poll error: ${e?.message || String(e)}`);
              }
              if (attempts >= maxAttempts) {
                clearInterval(timer);
                appendStatus('Timeout waiting for online confirmation. You can retry HEARTBEAT_NOW or check Wi‑Fi stability.');
              }
            }, 2000);
          } catch (e: any) {
            debug(`Step[Provision] Failed to start online confirmation polling: ${e?.message || String(e)}`);
          }
        } else if (/WIFI_STA_CONNECTED/i.test(msg)) {
          notified = true;
          setWifiProvisionOk(true);
          setConnecting(false);
          setSuccess(true);
          // 要求：连接成功提示为“connect wifi success”
          setSnackbarMsg('connect wifi success');
          setSnackbarVisible(true);
          appendStatus('connect wifi success');
          if (!postSentRef) {
            postSentRef = true;
            try {
              const { encodeChunkCommands } = await import('../../utils/chunk');
              const writeChunked = async (
                device: any,
                serviceUUID: string,
                writeCharUUID: string,
                tag: 'SUPA_CFG' | 'JWT_SET' | 'CA_SET',
                text: string,
                chunkSize = 16
              ) => {
                const cmds = encodeChunkCommands(tag as any, text, chunkSize);
                for (const c of cmds) {
                  await device.writeCharacteristicWithResponseForService(serviceUUID, writeCharUUID, b64Encode(c));
                }
              };
              const sbUrlTrim = String(supabaseUrl || '').trim().replace(/^['"\s]+|['"\s]+$/g, '');
              const anonTrim = String(anonKey || '').trim().replace(/^['"\s]+|['"\s]+$/g, '');
              const cfg: any = {};
              if (anonTrim.length > 0) cfg.anon = anonTrim;
              if (sbUrlTrim.length > 0) cfg.supabase_url = sbUrlTrim;
              if (Object.keys(cfg).length > 0) {
                const configJson = JSON.stringify(cfg);
                debug(`Step[Provision] (post-success) CONFIG jsonLen=${configJson.length}`);
                await writeChunked(d, serviceUUID, writeCharUUID, 'SUPA_CFG', configJson);
                debug('Step[Provision] (post-success) CONFIG sent (chunked)');
              } else {
                debug('Step[Provision] (post-success) Skip CONFIG (anon/supabase_url unavailable)');
              }
              if (deviceJwt) {
                const jwtJson = JSON.stringify({ jwt: deviceJwt });
                debug(`Step[Provision] (post-success) JWT jsonLen=${jwtJson.length}`);
                await writeChunked(d, serviceUUID, writeCharUUID, 'JWT_SET', jwtJson);
                debug('Step[Provision] (post-success) JWT_SET sent (chunked)');
              } else {
                debug('Step[Provision] (post-success) Skip JWT write: issuance failed or token empty');
              }
            } catch (e:any) {
              debug(`Step[Provision] (post-success) send config/jwt failed: ${e?.message || e}`);
            }
          }
          // Auto-save removed per requirements; user must tap Save manually
          // 自动触发一次 HEARTBEAT_NOW（仅一次）
          if (!hbNowSentRef.current) {
            hbNowSentRef.current = true;
            d.writeCharacteristicWithResponseForService(serviceUUID, writeCharUUID, b64Encode('HEARTBEAT_NOW'))
              .then(() => debug('Step[Provision] HEARTBEAT_NOW triggered automatically'))
            .catch((e: any) => debug(`Step[Provision] HEARTBEAT_NOW send failed: ${e?.message || e}`));
          }
          // 与 WIFI_OK 分支同步：尝试轮询在线状态
          try {
            const did = deviceIdForJwt || deviceId;
            let attempts = 0;
            const maxAttempts = 10;
            const timer = setInterval(async () => {
              attempts += 1;
              try {
                const { data } = await supabase
                  .from('devices')
                  .select('last_seen,status,wifi_signal,wifi_ssid,updated_at')
                  .eq('device_id', did)
                  .maybeSingle();
                if (data) {
                  // 与 Supabase devices.status 保持一致，不再基于 5 分钟 last_seen 阈值
                  const onlineFlag = String(data?.status || '').toLowerCase() === 'online';
                  const hasSignal = typeof data?.wifi_signal === 'number' && !Number.isNaN(data.wifi_signal);
                  if (onlineFlag || hasSignal) {
                    clearInterval(timer);
                    appendStatus('Online confirmed (WIFI_STA_CONNECTED).');
                    setSnackbarMsg('Device online');
                    setSnackbarVisible(true);
                  }
                }
              } catch (e: any) {
                debug(`Step[Provision] Online poll error: ${e?.message || String(e)}`);
              }
              if (attempts >= maxAttempts) {
                clearInterval(timer);
                appendStatus('Timeout waiting for online confirmation. You can retry HEARTBEAT_NOW or check Wi‑Fi stability.');
              }
            }, 2000);
          } catch (e: any) {
            debug(`Step[Provision] Failed to start online confirmation polling: ${e?.message || String(e)}`);
          }
        } else if (/WIFI_FAIL/i.test(msg)) {
          notified = true;
          setWifiProvisionOk(false);
  setError('Device failed to connect to Wi‑Fi');
          setConnecting(false);
        } else if (/WIFI_AP_NOT_FOUND/i.test(msg)) {
          // 不再在 UI 中提示“Wi‑Fi not found”（设备可能继续扫描并成功连接），仅记录到调试日志
          // 保持连接状态，等待后续 WIFI_STA_CONNECTED / WIFI_OK 通知
          debug('Step[Provision] WIFI_AP_NOT_FOUND（设备可能继续重试，暂不提示错误）');
          // 不设置 notified，不设置 error；交由后续 OK/CONNECTED 或超时处理
        } else if (/WIFI_AUTH_FAIL/i.test(msg)) {
          notified = true;
          setWifiProvisionOk(false);
          setError('Wi‑Fi authentication failed (wrong password?)');
          setConnecting(false);
        } else if (/tick/i.test(msg)) {
          debug('Step[Provision] Detected tick heartbeat');
        }
      }, txId);
      monRef.current = sub;
      // Simplified path: after subscribing, write config/JWT/Wi‑Fi in顺序（不改动现有 UI），以确保设备具备心跳所需的 anon 与 URL
      const writeChunked = async (
        device: any,
        serviceUUID: string,
        writeCharUUID: string,
        tag: 'SUPA_CFG' | 'JWT_SET' | 'CA_SET',
        text: string,
        chunkSize = 16
      ) => {
        const total = text.length;
        debug(`Step[Chunk] BEGIN tag=${tag} total=${total} size=${chunkSize}`);
        await device.writeCharacteristicWithResponseForService(serviceUUID, writeCharUUID, b64Encode(`${tag}_BEGIN ${total}`));
        let seq = 0;
        for (let i = 0; i < total; i += chunkSize) {
          const part = text.substring(i, i + chunkSize);
          debug(`Step[Chunk] DATA tag=${tag} seq=${seq} len=${part.length}`);
          await device.writeCharacteristicWithResponseForService(serviceUUID, writeCharUUID, b64Encode(`${tag}_DATA ${seq} ${part}`));
          seq++;
        }
        debug(`Step[Chunk] END tag=${tag} chunks=${Math.ceil(total / chunkSize)}`);
        await device.writeCharacteristicWithResponseForService(serviceUUID, writeCharUUID, b64Encode(`${tag}_END`));
      };
      // 1) 下发 Supabase anon/supabase_url（若环境变量可用）
      try {
        // 严格清洗 env 值：去除首尾空白与反引号/引号，避免设备端出现 apikey/URL 包含多余字符导致 401
        const sbUrlTrim = String(supabaseUrl || '')
          .trim()
          .replace(/^['"\s]+|['"\s]+$/g, '');
        const anonTrim = String(anonKey || '')
          .trim()
          .replace(/^['"\s]+|['"\s]+$/g, '');
        const configObj: any = {};
        if (anonTrim.length > 0) configObj.anon = anonTrim;
        if (sbUrlTrim.length > 0) configObj.supabase_url = sbUrlTrim;
        if (Object.keys(configObj).length > 0) {
          const configJson = JSON.stringify(configObj);
          debug(`Step[Provision] CONFIG jsonLen=${configJson.length}`);
          await writeChunked(d, serviceUUID, writeCharUUID, 'SUPA_CFG', configJson);
          debug('Step[Provision] CONFIG sent (chunked)');
        } else {
          debug('Step[Provision] Skip CONFIG (anon/supabase_url unavailable)');
        }
      } catch (e:any) {
        debug(`Step[Provision] Failed to send CONFIG: ${e?.message || e}`);
      }
      // 发送配网 JSON（仅当提供了 SSID 时才发送 {ssid,password}）；否则跳过 Wi‑Fi，仅发送 JWT
      //const ssidTrim = String(ssid || '').trim();
      //const passwordTrim = String(password || '').trim();
      //if (ssidTrim.length > 0) {
        //const wifiJson = JSON.stringify({ ssid: ssidTrim, password: passwordTrim });
        //const wifiB64 = b64Encode(wifiJson);
        //debug(Step[Provision] WiFi JSON len=${wifiJson.length}; b64=${wifiB64.length});
        //await d.writeCharacteristicWithResponseForService(serviceUUID, writeCharUUID, wifiB64);
        //debug('Step[Provision] Wrote Wi‑Fi credentials (Base64 {ssid,password}); waiting for device status via FFF2...');
      //} else {
        //debug('Step[Provision] Skip Wi‑Fi JSON (no SSID provided); will send JWT only');
      //}
// ===== 关键修改：不管有没有 SSID，先把 JWT 发过去！=====
      if (deviceJwt) {
        const jwtJson = JSON.stringify({ jwt: deviceJwt });
        debug(`Step[Provision] JWT jsonLen=${jwtJson.length}`);
        await writeChunked(d, serviceUUID, writeCharUUID, 'JWT_SET', jwtJson);
        debug('Step[Provision] JWT_SET sent (chunked), waiting for JWT_SAVED');
      }
      else {
        debug('Step[Provision] Skip JWT write: issuance failed or token empty');
      }
      // 3) 再发送 Wi‑Fi 配置（有 SSID 才发；按需附带 jwt）
      const ssidTrim = String(ssid || '').trim();
      const passwordTrim = String(password || '').trim();
      if (ssidTrim.length > 0) {
        // 仅发送 {ssid,password}，避免 JSON 过大导致固件解析失败（WIFI_SET_INVALID）
        const wifiObj: any = { ssid: ssidTrim, password: passwordTrim };
        const wifiJson = JSON.stringify(wifiObj);
        const wifiCmd = `WIFI_SET ${wifiJson}`;
        const wifiB64 = b64Encode(wifiCmd);
        debug(`Step[Provision] Sent WIFI_SET + {ssid,password}: jsonLen=${wifiJson.length}; b64Len=${wifiB64.length}`);
        await d.writeCharacteristicWithResponseForService(serviceUUID, writeCharUUID, wifiB64);
        debug('Step[Provision] Wi‑Fi config sent (without jwt)');
      }
      try {
        await d.writeCharacteristicWithResponseForService(serviceUUID, writeCharUUID, b64Encode('DEV_INSECURE_ON'));
        debug('Step[Provision] DEV_INSECURE_ON sent');
      } catch {}
      // 启动 BLE 心跳（仅在成功连接且写入后启动）
      try { startBleHeartbeat(d, serviceUUID, writeCharUUID, 30000); debug(`Step[Heartbeat] Initialized for target=${connectedTargetIdRef.current}`); } catch {}
      // Wait up to 30s, then end waiting (without forcing disconnect); cleanup subscription (routers may be slow, allow enough time)
      setTimeout(() => {
        if (!notified) { debug('Step[Provision] Timeout: no notification received'); setConnecting(false); }
        try { if (Platform.OS !== 'android') monRef.current?.remove?.(); (bleRef as any).currentSubRef = null; debug('Step[Provision] FFF2 subscription removed'); } catch {}
      }, 30000);
    } catch (e: any) {
      setError(`Provisioning failed: ${e?.message || String(e)}`);
      debug(`Step[Provision] Provisioning flow failed: ${e?.message || e}`);
      setConnecting(false);
    }
  };
  // Trigger device Wi‑Fi scan via BLE and receive WIFI_LIST (FFF2 notifications); after selection, show password and Connect
  const scanWifiListViaBle = async () => {
    try {
      setError(null);
      setWifiItemsBle([]);
      setShowPasswordInput(false);
      setLastWifiStatus(null);
      let gotItem = false;
      let gotNone = false;
      let ended = false;
      let retried = false; // auto-rescan once if END arrives with no items
      // 环境预检：Web/Expo Go 不支持 BLE Wi‑Fi 扫描
      if (!supportsNativeModules) {
        setError('BLE Wi‑Fi scan is not supported in this environment. Please run in Dev Client or Release (Android/iOS). On Web, only the current connection can be shown.');
        setWifiBlePickerVisible(false);
        return;
      }
      // 设备连接预检：需先连接到设备
      if (!selected && !connectedTargetIdRef.current) {
        setError('Please select and connect a pinme device first, then scan Wi‑Fi');
        setPickerVisible(true);
        setWifiBlePickerVisible(false);
        return;
      }
      setWifiBlePickerVisible(true);
      const { BleManager } = await import('../../shims/ble');
      const manager = bleRef.current || new BleManager();
      bleRef.current = manager;
      const targetId = connectedTargetIdRef.current || selected?.id;
      const dev = await manager.connectToDevice(targetId!, { autoConnect: false });
      const d = await dev.discoverAllServicesAndCharacteristics();
      connectedTargetIdRef.current = targetId!;
      const serviceUUID = '0000fff0-0000-1000-8000-00805f9b34fb';
      const writeCharUUID = '0000fff1-0000-1000-8000-00805f9b34fb';
      const echoCharUUID = '0000fff2-0000-1000-8000-00805f9b34fb';
      // Start subscription (if not already)
      try {
        const sub = dev.monitorCharacteristicForService(serviceUUID, echoCharUUID, (error: any, characteristic: any) => {
          if (error) { debug(`Step[WiFiList] FFF2 subscription callback error: ${error?.message || error}`); return; }
          const b64 = characteristic?.value || '';
          let msg = '';
          try { msg = String(b64Decode(b64) || '').trim(); }
          catch (e:any) { debug(`Step[WiFiList] FFF2 decode error: ${e?.message || e}; raw=${b64}`); msg = ''; }
          // Always track status internally, but only log list-specific messages
          updateWifiStatusFromMsg(msg);
          if (/^(WIFI_LIST_|WIFI_ITEM\s)/.test(msg)) {
            debug(`Step[WiFiList] FFF2 notification: ${msg}`);
          }
          if (ended) return;
          // Parse list phase messages locally to support auto-rescan and suppression
          if (msg === 'WIFI_LIST_BEGIN') { setWifiItemsBle([]); gotItem = false; gotNone = false; return; }
          if (msg === 'WIFI_LIST_NONE') { gotNone = true; return; }
          if (msg === 'WIFI_LIST_END') {
            if (!gotItem && !retried) {
              ended = true; retried = true;
              setTimeout(async () => {
                ended = false; gotItem = false; gotNone = false; setWifiItemsBle([]);
                try {
                  await d.writeCharacteristicWithResponseForService(serviceUUID, writeCharUUID, b64Encode('WIFI_LIST'));
                  debug('Step[WiFiList] sent WIFI_LIST (auto-rescan)');
                } catch (e:any) {
                  debug(`Step[WiFiList] auto-rescan failed: ${e?.message || e}`);
                  try { if (Platform.OS !== 'android') (bleRef as any).currentSubRef?.current?.remove?.(); } catch {}
                  setWifiBlePickerVisible(false);
                }
              }, 1500);
              return;
            }
            ended = true;
            if (!gotItem) {
              setError('No Wi‑Fi found nearby. Please move closer to the router or retry.');
              setWifiBlePickerVisible(false);
            }
            try { if (Platform.OS !== 'android') (bleRef as any).currentSubRef?.current?.remove?.(); } catch {}
            return;
          }
          // Ignore non-list status messages during Wi‑Fi listing phase
          if (/^WIFI_(CONNECTING|AP_NOT_FOUND|OK|STA_CONNECTED)/i.test(msg)) { return; }
          if (msg.startsWith('WIFI_ITEM ')) {
            const payload = msg.substring('WIFI_ITEM '.length);
            const parts = payload.split('|');
            const ssid = parts[0] ?? '';
            const rssi = parseInt(parts[1] ?? '0', 10);
            const enc = parts[2] ?? '';
            gotItem = true;
            setWifiItemsBle(prev => {
              const filtered = prev.filter(i => i.ssid !== ssid);
              return [...filtered, { ssid, rssi, enc }];
            });
            return;
          }
        }, 'wifi-list');
        (bleRef as any).currentSubRef = { current: sub };
      } catch {}
      // 重置一次性触发标记（每次新的配网流程）
      hbNowSentRef.current = false;
      // Send WIFI_LIST request (Base64)
      await d.writeCharacteristicWithResponseForService(serviceUUID, writeCharUUID, b64Encode('WIFI_LIST'));
      debug('Step[WiFiList] sent WIFI_LIST request, waiting for device to push list via FFF2');
    } catch (e:any) {
      setError(`WIFI_LIST scan failed: ${e?.message || e}`);
      setWifiBlePickerVisible(false);
    }
  };
  const onPickWifiBle = (ssidSel: string, encSel?: string) => {
    setSsid(ssidSel);
    setSelectedWifiEnc(encSel || null);
    setShowPasswordInput(true);
    setWifiBlePickerVisible(false);
    appendStatus(`Pick SSID: ${ssidSel}`);
  };
  const openWebConfig = async () => {
    // Prefer mDNS; fallback to AP
    const urls = ['http://esp32.local/', 'http://192.168.4.1/'];
    for (const u of urls) {
      try { await Linking.openURL(u); return; } catch {}
    }
    setError('Unable to open device web config. Ensure you are connected to the device AP or the device is on your Wi‑Fi.');
  };
  // Save: allow saving as offline even if Wi‑Fi not confirmed; requires non-empty name/location
  const saveDeviceInfo = async () => {
    try {
      setError(null);
      setSending(true);
      saveTimeoutRef.current = setTimeout(() => {
        setSending(false);
        setError('Save timeout. Please check network and try again.');
      }, 15000);
      appendStatus('Step[Save] begin saving device into Supabase');
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes?.user?.id;
      if (!uid) { setError('Please sign in before saving'); setSending(false); return; }
    appendStatus(`Step[Save] got user id=${uid}`);
      // If connected, try reading the real device ID from FFF3
      let did = toDeviceId(deviceId);
      try {
        const targetId = connectedTargetIdRef.current || selected?.id;
        if (targetId && bleRef.current) {
          const dev = await bleRef.current.connectToDevice(targetId, { autoConnect: false }).catch(() => null);
          const d = dev ? await dev.discoverAllServicesAndCharacteristics() : null;
          if (d) {
            const ch3 = await d.readCharacteristicForService('0000fff0-0000-1000-8000-00805f9b34fb', '0000fff3-0000-1000-8000-00805f9b34fb').catch(() => null);
            const v = ch3?.value || '';
            let idUtf8 = '';
            try { idUtf8 = v ? String(b64Decode(v) || '').trim() : ''; }
            catch (e:any) { debug(`Step[Save] FFF3 decode error: ${e?.message || e}; raw=${v}`); idUtf8 = ''; }
            if (idUtf8 && /^ESP32_/i.test(idUtf8)) { did = toDeviceId(idUtf8); }
          }
        }
      } catch {}
    appendStatus(`Step[Save] device_id=${did}; name=${deviceName || 'Toy Reader'}; location=${location || 'Unknown'}`);
      // Duplicate check: Abort if device_id already exists
      try {
        const { data: exist } = await supabase
          .from('devices')
          .select('id, device_id')
          .eq('device_id', did)
          .limit(1);
        if (Array.isArray(exist) && exist.length > 0) {
          setError('Device ID already exists');
          setSending(false);
          return;
        }
      } catch { /* ignore and continue */ }
      const isoNow = new Date().toISOString();
      const up: any = {
        device_id: did,
        // If empty, use safe defaults to avoid blocking save
        name: (deviceName && deviceName.trim()) ? deviceName.trim() : 'Toy Reader',
        location: (location && location.trim()) ? location.trim() : 'Unknown',
        // Option B: save Wi‑Fi SSID/Password directly in devices table (security risk noted)
        wifi_ssid: ssid || null,
        wifi_password: (password && password.trim()) ? password.trim() : null,
        // Requirement: after Save, immediately show online
        status: 'online',
        last_seen: isoNow,
        config: { ...payload, device_id: did, last_wifi_status: lastWifiStatus || null },
        user_id: uid || null,
        updated_at: isoNow,
      };
      // Upsert and explicitly check for errors to avoid silent failures
      const { error: upErr } = await supabase.from('devices').upsert(up, { onConflict: 'device_id' });
    if (upErr) { setError(`Save failed: ${upErr.message}`); appendStatus(`Step[Save] upsert failed: ${upErr.message}`); setSending(false); return; }
      appendStatus('Step[Save] upsert succeeded; navigating back');
      // Disconnect Bluetooth
      try { await bleRef.current?.cancelDeviceConnection(connectedTargetIdRef.current || selected?.id); } catch {}
      setSnackbarMsg('Saved (online)');
      setSnackbarVisible(true);
      // Navigate back to device list/previous page: prefer goBack; otherwise navigate to DeviceManagement
      try {
        setTimeout(() => {
          try {
            if ((navigation as any)?.canGoBack?.()) navigation.goBack();
            else navigation.navigate('DeviceManagement');
          } catch { /* noop */ }
        }, 500);
      } catch { /* noop */ }
    } catch (e:any) {
      setError(`Save failed: ${e?.message || String(e)}`);
      appendStatus(`Step[Save] Error: ${e?.message || String(e)}`);
    } finally {
      if (saveTimeoutRef.current) { clearTimeout(saveTimeoutRef.current); saveTimeoutRef.current = null; }
      setSending(false);
    }
  };
  const applyPastedConfig = (text: string) => {
    try {
      const cfg = JSON.parse(text || '{}');
      const ss = cfg?.wifi?.ssid || cfg?.ssid || '';
      const pw = cfg?.wifi?.password || cfg?.password || '';
      const id = cfg?.device_id || cfg?.id || '';
      if (ss) setSsid(ss);
      if (pw) setPassword(pw);
      if (id) setDeviceId(id);
      appendStatus('QR config applied');
    } catch {
      // Fallback: if it's a URL, open it
      if (/^https?:\/\//i.test(text)) { Linking.openURL(text).catch(() => {}); }
      else setError('Invalid QR content');
    }
  };
  const requestCameraAndOpenQr = async () => {
    try {
      // Lazy load expo-camera only when needed
      if (!camModuleRef.current) {
        // Lazy-load expo-camera module
        camModuleRef.current = await import('expo-camera');
      }
      // Use the Camera permission helper from expo-camera
      const { status } = await camModuleRef.current.Camera.requestCameraPermissionsAsync();
      const granted = status === 'granted';
      setHasCamPermission(granted);
      if (!granted) { setError('Camera permission denied'); return; }
      setScanningQR(true);
    } catch {
      setHasCamPermission(false);
      setError('Failed to request camera permission');
    }
  };
  const onBarCodeScanned = ({ data }: any) => {
    try {
      setScanningQR(false);
      if (!data) { setError('Empty QR'); return; }
      // Content can be a JSON string or a URL
      applyPastedConfig(String(data));
    } catch { setError('Failed to read QR'); }
  };
  return (
    <ScreenErrorBoundary>
    {/* 解决 Portal 在未包裹 Provider 时的渲染错误：此处为屏幕级兜底 Provider */}
    <PaperProvider>
    <LinearGradient colors={cartoonGradient} style={{ flex: 1 }}>
      <ScrollView style={[styles.container, { backgroundColor: 'transparent' }]} contentContainerStyle={[styles.scrollContent, Platform.OS === 'web' && { width: '100%', maxWidth: 1000, alignSelf: 'center', paddingHorizontal: 32 }]} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
      {Platform.OS === 'web' && (
        <Card style={[styles.card, { backgroundColor: theme.colors.surface, borderWidth: 0, borderRadius: 20 }]}>
          <Card.Title
            title={<Text style={{ fontFamily: headerFont }}>Add Device (Web)</Text>}
            subtitle={<Text style={{ fontFamily: headerFont }}>BLE provisioning is only supported on Android/iOS</Text>}
            left={(p) => <List.Icon {...p} icon="information" />}
          />
          <Card.Content>
            <Text style={{ color: theme.colors.onSurfaceVariant, marginBottom: 8, fontFamily: headerFont }}>
              You are on the web. Browsers do not support Bluetooth scanning/provisioning. Please use the mobile app (Android/iOS Dev Client or release build) and open "Add Device".
            </Text>
            <Text style={{ color: theme.colors.onSurfaceVariant, marginBottom: 8, fontFamily: headerFont }}>
              If you need to open the device configuration page (AP/mDNS) via the web, you can try the button below.
            </Text>
            <Button mode="outlined" onPress={openWebConfig} labelStyle={{ fontFamily: headerFont }}>Open device Web config</Button>
          </Card.Content>
        </Card>
      )}
      {/* Title removed per request (keep navigation back arrow) */}
      {/* Intro Bluetooth banner removed */}
      {/* Bluetooth off banner removed */}
      {/* BLE scanning card removed */}
      {/* Single card mode: content merged below */}
      <Card style={[
        styles.card,
        { backgroundColor: theme.colors.surface, borderWidth: 0, borderRadius: 20 }
      ]}>
        <Card.Content>
          <Banner visible style={{ marginBottom: 8 }}>
            <Text style={{ fontFamily: headerFont }}>Please power on the device and keep it close to your phone.</Text>
          </Banner>
          {/* Device basic info */}
          <TextInput label="Device name" value={deviceName} onChangeText={setDeviceName} style={[styles.input, styles.flatFill]} mode="flat" contentStyle={{ fontFamily: headerFont }} />
          <Menu
            visible={locMenuOpen}
            onDismiss={() => setLocMenuOpen(false)}
            anchor={
              <Pressable onPress={() => { if (!locLockRef.current) setLocMenuOpen(true); }}>
                <TextInput label="Location" value={location} onChangeText={setLocation} style={[styles.input, styles.flatFill]} mode="flat" contentStyle={{ fontFamily: headerFont }} onFocus={() => { if (!locLockRef.current) setLocMenuOpen(true); }} />
              </Pressable>
            }
          >
            {DEFAULT_LOCATIONS.map((loc) => (
            <Menu.Item key={`def-${loc}`} title={loc} titleStyle={{ fontFamily: headerFont }} onPress={() => { setLocation(loc); setLocMenuOpen(false); locLockRef.current = true; setTimeout(() => { locLockRef.current = false; }, 150); }} />
            ))}
            {locSuggestions.filter(s => !DEFAULT_LOCATIONS.includes(s)).map((loc) => (
              <Menu.Item key={loc} title={loc} titleStyle={{ fontFamily: headerFont }} onPress={() => { setLocation(loc); setLocMenuOpen(false); locLockRef.current = true; setTimeout(() => { locLockRef.current = false; }, 150); }} />
            ))}
          </Menu>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
            <TextInput
              label="Device ID"
              value={toDisplaySuffixFromDeviceId(deviceId) || ''}
              onChangeText={(t) => setDeviceId(toDeviceId(t))}
              style={[styles.input, styles.flatFill, { flex: 1, marginBottom: 0 }]} mode="flat" contentStyle={{ fontFamily: headerFont }}
            />
            <Button mode="outlined" onPress={scanAndShowPinmeList} compact style={[styles.smallButton, styles.whiteOutlined, { marginLeft: 8 }]} contentStyle={{ height: 40 }} disabled={!supportsNativeModules} loading={scanLoading} labelStyle={{ fontFamily: headerFont }}>Scan</Button>
          </View>
          {/* Wi‑Fi controls */}
          <View style={{ flexDirection: 'row', justifyContent: 'flex-start', marginTop: 4, marginBottom: 16 }}>
            <Button mode="outlined" compact onPress={scanWifiListViaBle} style={[styles.smallButton, styles.whiteOutlined]} contentStyle={{ height: 40 }} disabled={!supportsNativeModules} labelStyle={{ fontFamily: headerFont }}>Scan Wi‑Fi</Button>
          </View>
          {showPasswordInput && (
            <View>
              <TextInput label="Wi‑Fi name" value={ssid} onChangeText={setSsid} style={[styles.input, styles.flatFill]} mode="flat" contentStyle={{ fontFamily: headerFont }} />
              <TextInput label="Password" placeholder="password" value={password} onChangeText={setPassword} secureTextEntry style={[styles.input, styles.flatFill]} mode="flat" disabled={selectedWifiEnc === 'OPEN'} contentStyle={{ fontFamily: headerFont }} />
          <View style={{ flexDirection: 'row', justifyContent: 'flex-start', marginTop: 4 }}>
            <Button mode="outlined" compact onPress={startProvisioning} loading={connecting} disabled={connecting} style={[styles.smallButton, styles.whiteOutlined]} contentStyle={{ height: 40 }} labelStyle={{ fontFamily: headerFont }}>Connect</Button>
          </View>
        </View>
      )}
        </Card.Content>
      </Card>
      {/* Progress card removed */}
      {/* Error banner (shown when saving fails) */}
      {error && (
        <Card style={[styles.card, { backgroundColor: theme.colors.errorContainer, borderWidth: 0, borderRadius: 20 }]}>
          <Card.Content>
            <Text style={{ color: theme.colors.onErrorContainer, fontFamily: headerFont }}>{error}</Text>
          </Card.Content>
        </Card>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <OrangeCapsuleButton title="Save" onPress={saveDeviceInfo} loading={sending} disabled={connecting} style={{ flex: 1 }} />
      </View>
      {/* Debug Log under Save button */}
      <Card style={[styles.card, { marginTop: 8, backgroundColor: theme.colors.surface, borderWidth: 0, borderRadius: 20 }]}>
        <Card.Title title="Debug log" titleStyle={{ fontFamily: headerFont }} subtitle="Key steps and device responses will appear here" />
        <Card.Content>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 8 }}>
            <Button mode="text" compact onPress={() => setStatus('')}>Clear</Button>
          </View>
          <View style={{ maxHeight: 200, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.outlineVariant, padding: 8 }}>
            <ScrollView
              nestedScrollEnabled
              scrollEnabled
              showsVerticalScrollIndicator
            >
              <Text style={{ fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 12, lineHeight: 16 }}>
                {status || 'No logs yet. After tapping "Connect" or performing actions, detailed steps and device responses (e.g. ACK, WIFI_*, JWT_SAVED) will appear here.'}
              </Text>
            </ScrollView>
          </View>
        </Card.Content>
      </Card>
      </ScrollView>
      {/* Connected/Success toast */}
      <Snackbar visible={snackbarVisible} onDismiss={() => setSnackbarVisible(false)} duration={1000} style={{ backgroundColor: theme.colors.secondaryContainer, alignSelf: 'center' }} wrapperStyle={{ position: 'absolute', top: '45%', left: 0, right: 0 }}>
        {/* RN requires text to be wrapped within <Text> */}
        <Text style={{ fontFamily: headerFont, color: theme.colors.onSecondaryContainer, textAlign: 'center' }}>{snackbarMsg}</Text>
      </Snackbar>
      <Portal>
        {/* Device picker dialog */}
        <Dialog visible={pickerVisible} onDismiss={closePicker} style={{ borderRadius: 16 }}>
          <Dialog.Content>
            {pinmeList.length === 0 ? (
              <Text style={{ fontFamily: headerFont }}>Scanning nearby pinme devices…</Text>
            ) : (
              pinmeList.map((d) => (
                <List.Item
                  key={d.id}
                  title={d.name || 'pinme'}
                  titleStyle={{ fontFamily: headerFont }}
                  description={d.rssi != null ? (<Text style={{ fontFamily: headerFont }}>Signal: {d.rssi}</Text>) : undefined}
                  left={(p) => <List.Icon {...p} icon="bluetooth" />}
                  onPress={() => onPickPinmeDevice(d)}
                />
              ))
            )}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={closePicker} labelStyle={{ fontFamily: headerFont }}>Close</Button>
          </Dialog.Actions>
        </Dialog>
        {/* Wi‑Fi picker dialog */}
        <Dialog visible={wifiPickerVisible} onDismiss={() => setWifiPickerVisible(false)} style={{ borderRadius: 16 }}>
          <Dialog.Content>
            {wifiList.length === 0 ? (
              <Text style={{ fontFamily: headerFont }}>Scanning nearby Wi‑Fi… (If the list is empty, a scan module may be missing; only the current connection will be shown)</Text>
            ) : (
              wifiList.map((w, idx) => (
                <List.Item
                  key={`${w.ssid}-${idx}`}
                  title={w.ssid}
                  titleStyle={{ fontFamily: headerFont }}
                  description={typeof w.strength === 'number' ? (<Text style={{ fontFamily: headerFont }}>Signal: {w.strength}</Text>) : undefined}
                  left={(p) => <List.Icon {...p} icon="wifi" />}
                  onPress={() => onPickWifi(w.ssid)}
                />
              ))
            )}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setWifiPickerVisible(false)} labelStyle={{ fontFamily: headerFont }}>Close</Button>
          </Dialog.Actions>
        </Dialog>
        {/* Wi‑Fi list from device (WIFI_LIST via BLE) */}
        <Dialog visible={wifiBlePickerVisible} onDismiss={() => setWifiBlePickerVisible(false)} style={{ borderRadius: 16 }}>
          <Dialog.Content>
            {wifiItemsBle.length === 0 ? (
              <Text style={{ fontFamily: headerFont }}>Waiting for the device to return the list…</Text>
            ) : (
              wifiItemsBle
                .sort((a,b) => b.rssi - a.rssi)
                .slice(0, 5)
                .map(item => (
                  <List.Item
                    key={`${item.ssid}-${item.rssi}`}
                    title={item.ssid || '(Hidden SSID)'}
                    titleStyle={{ fontFamily: headerFont }}
                    description={<Text style={{ fontFamily: headerFont }}>Signal: {item.rssi} | Encryption: {item.enc}</Text>}
                    left={(p) => <List.Icon {...p} icon="wifi" />}
                    onPress={() => onPickWifiBle(item.ssid, item.enc)}
                  />
                ))
            )}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setWifiBlePickerVisible(false)} labelStyle={{ fontFamily: headerFont }}>Close</Button>
          </Dialog.Actions>
        </Dialog>
        <Dialog visible={scanningQR} onDismiss={() => setScanningQR(false)} style={{ borderRadius: 16 }}>
          <Dialog.Content>
            {hasCamPermission === false ? (
              <Text style={{ color: theme.colors.error, fontFamily: headerFont }}>Camera permission not granted</Text>
            ) : (
              <View style={{ height: 260 }}>
                {camModuleRef.current ? (
                  // expo-camera v17 uses CameraView component for rendering
                  <camModuleRef.current.CameraView
                    style={{ width: '100%', height: '100%' }}
                    facing={camModuleRef.current.CameraType?.back || 'back'}
                    onBarcodeScanned={onBarCodeScanned}
                    // Correct prop casing: barcodeScannerSettings -> barcodeTypes
                    barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                  />
                ) : (
                  <Text style={{ fontFamily: headerFont }}>Loading camera…</Text>
                )}
              </View>
            )}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setScanningQR(false)} labelStyle={{ fontFamily: headerFont }}>Close</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </LinearGradient>
    </PaperProvider>
    </ScreenErrorBoundary>
  );
}
// Gradient orange capsule button for primary CTA
function OrangeCapsuleButton({ title, onPress, loading, disabled, style }: { title: string; onPress: () => void; loading?: boolean; disabled?: boolean; style?: any }) {
  const theme = useTheme();
  const font = Platform.select({ ios: 'Arial Rounded MT Bold', android: 'sans-serif-medium', default: 'System' });
  return (
    <Pressable onPress={disabled ? undefined : onPress} style={[{ borderRadius: 28, overflow: 'hidden' }, style]} disabled={disabled}>
      <LinearGradient colors={orangeCapsuleGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ paddingVertical: 12, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: '#FFFFFF', fontWeight: '600', fontSize: 16, fontFamily: font }}>{loading ? 'Saving…' : title}</Text>
      </LinearGradient>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 24 },
  title: { marginBottom: 8 },
  card: { marginBottom: 12, borderRadius: 20 },
  input: { marginBottom: 8 },
  smallButton: { minWidth: 120 },
  flatFill: { backgroundColor: softPurpleFill },
  whiteOutlined: { borderColor: '#FFFFFF', borderWidth: 2, borderRadius: 24 },
});
