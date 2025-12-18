import React, { useRef, useState } from 'react';
import { View, StyleSheet, Platform, Pressable, ScrollView } from 'react-native';
import { Text, TextInput, Button, useTheme, Portal, Dialog, List, Snackbar, Menu } from 'react-native-paper';
import { LinearGradient } from 'expo-linear-gradient';
import Constants from 'expo-constants';
import { cartoonGradient } from '../../theme/tokens';
import { BleManager } from '../../shims/ble';
import { PERMISSIONS, RESULTS, check, request } from '../../shims/permissions';
import { supabase } from '../../supabaseClient';
import { useNavigation } from '@react-navigation/native';

export default function AddDeviceUIScreen() {
  const theme = useTheme();
  const headerFont = Platform.select({ ios: 'Arial Rounded MT Bold', android: 'sans-serif-medium', default: 'System' });
  const navigation = useNavigation<any>();
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [deviceId, setDeviceId] = useState('');

  // BLE scanning state (same filter & read logic as EnvironmentCheckScreen)
  const bleRef = useRef<any>(null);
  const [bleScanning, setBleScanning] = useState(false);
  const [blePickerVisible, setBlePickerVisible] = useState(false);
  const [bleItems, setBleItems] = useState<Array<{ id: string; name: string; rssi?: number | null }>>([]);
  const [snackbarVisible, setSnackbarVisible] = useState(false);
  const [snackbarMsg, setSnackbarMsg] = useState('');
  const [inlineMsg, setInlineMsg] = useState('');
  const [inlineVisible, setInlineVisible] = useState(false);
  const [connectedDevice, setConnectedDevice] = useState<any>(null);
  const monRef = useRef<any>(null);
  const monTxIdRef = useRef<string | null>(null);
  // Wi‑Fi 成功后自动发送 Supabase 配置与设备 JWT（只执行一次）
  const autoJwtSentRef = useRef(false);
  // Location dropdown (align with Toy list / DeviceProvisioning)
  const DEFAULT_LOCATIONS = ['Living room','Bedroom','Toy house','others'];
  const [locSuggestions, setLocSuggestions] = useState<string[]>([]);
  const [locMenuOpen, setLocMenuOpen] = useState(false);
  const locLockRef = useRef(false);
  React.useEffect(() => {
    const loadLocs = async () => {
      try {
        const { data } = await supabase.from('toys').select('location').limit(100);
        const locs = Array.from(new Set((data || []).map((t: any) => t.location).filter(Boolean)));
        setLocSuggestions(locs);
      } catch {}
    };
    loadLocs();
  }, []);

  // Wi‑Fi via ESP32 BLE
  const [wifiBlePickerVisible, setWifiBlePickerVisible] = useState(false);
  const [wifiItemsBle, setWifiItemsBle] = useState<Array<{ ssid: string; rssi: number; enc: string }>>([]);
  const [selectedWifi, setSelectedWifi] = useState<string>('');
  const [wifiPassword, setWifiPassword] = useState<string>('');
  const [connectBusy, setConnectBusy] = useState(false);

  // Base64 helpers (UTF‑8 safe)
  const _b64Table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  const b64Encode = (str: string): string => {
    const bytes = unescape(encodeURIComponent(str));
    let output = ''; let i = 0;
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
  const b64DecodeUtf8 = (b64: string): string => {
    try {
      const raw = (globalThis as any)?.atob ? (globalThis as any).atob(b64) : '';
      if (raw) {
        try { return decodeURIComponent(escape(raw)).trim(); } catch { return raw.trim(); }
      }
    } catch {}
    // Fallback polyfill
    const tbl = _b64Table;
    let output = '';
    let i = 0;
    while (i < b64.length) {
      const enc1 = tbl.indexOf(b64.charAt(i++));
      const enc2 = tbl.indexOf(b64.charAt(i++));
      const enc3 = tbl.indexOf(b64.charAt(i++));
      const enc4 = tbl.indexOf(b64.charAt(i++));
      const chr1 = (enc1 << 2) | (enc2 >> 4);
      const chr2 = ((enc2 & 15) << 2) | (enc3 >> 6);
      const chr3 = enc4 === 64 ? 0 : (enc3 & 63);
      output += String.fromCharCode(chr1);
      if (enc3 !== 64) output += String.fromCharCode(chr2);
      if (enc4 !== 64) output += String.fromCharCode(chr3);
    }
    try { return decodeURIComponent(escape(output)).trim(); } catch { return output.trim(); }
  };

  // Parse to display ID from adv name or fallback id
  const toDisplayIdFromNameOrId = (name?: string, id?: string) => {
    const s = String(name || id || '').trim();
    // Prefer explicit advertising name: pinme-ESP32_XXXXXX
    let m = /pinme-esp32_([0-9a-f]{6})/i.exec(s);
    if (m && m[1]) return `ESP32_${String(m[1]).toUpperCase()}`;
    // Fallback: plain ESP32_XXXXXX anywhere
    m = /esp32[_-]?([0-9a-f]{6})/i.exec(s);
    if (m && m[1]) return `ESP32_${String(m[1]).toUpperCase()}`;
    // fallback: last 6 of id
    const tail = String(id || '').replace(/[^0-9A-Fa-f]/g, '').slice(-6).toUpperCase();
    return tail ? `ESP32_${tail}` : '';
  };

  const startBleScan = async () => {
    // Guard: Web/Expo Go typically cannot use BLE
    if (Platform.OS === 'web') {
      setSnackbarMsg('Web 端不支持 BLE 扫描，请使用 Dev Client 或真机。');
      setSnackbarVisible(true);
      return;
    }
    // Android 12+ 需要在运行时请求 BLE 扫描/连接权限；部分设备还需要定位权限以返回广播
    try {
      if (Platform.OS === 'android') {
        const isApi31Plus = (typeof Platform?.Version === 'number' ? Platform.Version >= 31 : true);
        if (isApi31Plus) {
          const locFineStatus = await check(PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION);
          if (locFineStatus !== RESULTS.GRANTED) {
            const r = await request(PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION);
            if (r !== RESULTS.GRANTED) { setSnackbarMsg('定位权限被拒绝，无法扫描 BLE'); setSnackbarVisible(true); return; }
          }
          const scanStatus = await check(PERMISSIONS.ANDROID.BLUETOOTH_SCAN);
          if (scanStatus !== RESULTS.GRANTED) {
            const r = await request(PERMISSIONS.ANDROID.BLUETOOTH_SCAN);
            if (r !== RESULTS.GRANTED) { setSnackbarMsg('蓝牙扫描权限被拒绝'); setSnackbarVisible(true); return; }
          }
          const connStatus = await check(PERMISSIONS.ANDROID.BLUETOOTH_CONNECT);
          if (connStatus !== RESULTS.GRANTED) {
            const r = await request(PERMISSIONS.ANDROID.BLUETOOTH_CONNECT);
            if (r !== RESULTS.GRANTED) { setSnackbarMsg('蓝牙连接权限被拒绝'); setSnackbarVisible(true); return; }
          }
        } else {
          // Android < 12 使用定位权限进行 BLE 扫描
          try {
            const locFineStatus = await check(PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION);
            if (locFineStatus !== RESULTS.GRANTED) {
              const r = await request(PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION);
              if (r !== RESULTS.GRANTED) { setSnackbarMsg('定位权限被拒绝，无法扫描 BLE'); setSnackbarVisible(true); return; }
            }
          } catch {}
        }
      }
    } catch {}
    try {
      if (!bleRef.current) bleRef.current = new BleManager();
      setBleItems([]);
      setBleScanning(true);
      setBlePickerVisible(true);
      bleRef.current.startDeviceScan(null, null, (error: any, device: any) => {
        if (error) {
          setBleScanning(false);
          setSnackbarMsg(error?.message || 'BLE 扫描不可用，请使用 Dev Client 或真机');
          setSnackbarVisible(true);
          return;
        }
        const name: string = device?.name || '';
        const id: string = device?.id || device?.uuid || '';
        // Only show pinme-ESP32_XXXXXX
        if (/^pinme-esp32_[0-9a-f]{6}$/i.test(name)) {
          setBleItems(prev => {
            const exists = prev.some(d => d.id === id);
            return exists ? prev : [{ id, name, rssi: device?.rssi ?? null }, ...prev];
          });
        }
      });
      // Auto stop after 10s
      setTimeout(() => { try { bleRef.current?.stopDeviceScan(); } catch {}; setBleScanning(false); }, 10000);
    } catch (e: any) {
      setBleScanning(false);
      setSnackbarMsg(e?.message || 'BLE 模块不可用');
      setSnackbarVisible(true);
    }
  };

  const onPickBleDevice = async (dev: { id: string; name: string }) => {
    setBlePickerVisible(false);
    try {
      // 连接前权限兜底（Android 12+ 要求 BLUETOOTH_CONNECT）
      if (Platform.OS === 'android') {
        const isApi31Plus = (typeof Platform?.Version === 'number' ? Platform.Version >= 31 : true);
        if (isApi31Plus) {
          const connStatus = await check(PERMISSIONS.ANDROID.BLUETOOTH_CONNECT);
          if (connStatus !== RESULTS.GRANTED) {
            const r = await request(PERMISSIONS.ANDROID.BLUETOOTH_CONNECT);
            if (r !== RESULTS.GRANTED) { throw new Error('蓝牙连接权限被拒绝'); }
          }
        }
      }
      if (!bleRef.current) bleRef.current = new BleManager();
      const d = await bleRef.current.connectToDevice(dev.id, { timeout: 10000 }).catch((e: any) => { throw e; });
      await d.discoverAllServicesAndCharacteristics();
      setConnectedDevice(d);
      // Prompt (English) on successful Bluetooth connection
      setSnackbarMsg('connect bluetooth success');
      setSnackbarVisible(true);
      setInlineMsg('Scan success');
      setInlineVisible(true);
      setTimeout(() => setInlineVisible(false), 2000);
      const serviceUUID = '0000fff0-0000-1000-8000-00805f9b34fb';
      const idCharUUID3 = '0000fff3-0000-1000-8000-00805f9b34fb';
      const idCharUUID2 = '0000fff2-0000-1000-8000-00805f9b34fb';
      let ch: any = null;
      try { ch = await d.readCharacteristicForService(serviceUUID, idCharUUID3); }
      catch { ch = await d.readCharacteristicForService(serviceUUID, idCharUUID2); }
      const b64 = ch?.value || '';
      let val = '';
      try { val = b64DecodeUtf8(b64); } catch { val = ''; }
      const idText = (val && /ESP32_/i.test(val)) ? val.trim() : toDisplayIdFromNameOrId(dev.name, dev.id);
      setDeviceId(idText);
    } catch (e: any) {
      const idText = toDisplayIdFromNameOrId(dev.name, dev.id);
      setDeviceId(idText);
      setSnackbarMsg(`读取设备ID失败，使用回退：${idText}${e?.message ? `（${e.message}）` : ''}`);
      setSnackbarVisible(true);
    }
  };

  // Trigger device Wi‑Fi scan via BLE and receive WIFI_LIST (FFF2 notifications)
  const scanWifiListViaBle = async () => {
    if (Platform.OS === 'web') {
      setSnackbarMsg('Web 端不支持 BLE 扫描，请使用 Dev Client 或真机。');
      setSnackbarVisible(true);
      return;
    }
    if (!connectedDevice) {
      setSnackbarMsg('请先扫描并选择设备，再扫描 Wi‑Fi');
      setSnackbarVisible(true);
      return;
    }
    try {
      setWifiItemsBle([]);
      setWifiBlePickerVisible(true);
      let gotItem = false;
      let gotNone = false;
      let ended = false;
      let retried = false; // auto-rescan once when END arrives with no items
      const serviceUUID = '0000fff0-0000-1000-8000-00805f9b34fb';
      const writeCharUUID = '0000fff1-0000-1000-8000-00805f9b34fb';
  const echoCharUUID = '0000fff2-0000-1000-8000-00805f9b34fb';
  // --- Helper: write long text over BLE with chunking and BEGIN/END framing ---
  // Many BLE stacks have MTU ~23 (payload ~20 bytes). Our payloads (anon key, JWT) are much longer.
  // We frame as:
  //   <TAG>_BEGIN <len>
  //   <TAG>_DATA <seq> <chunk>
  //   <TAG>_END
  // Firmware should reassemble by TAG.
  async function bleWriteChunked(
    device: any,
    serviceUUID: string,
    writeCharUUID: string,
    tag: 'SUPA_CFG' | 'JWT_SET',
    text: string,
    chunkSize = 16
  ) {
    const total = text.length;
    try { console.log(`[AddDevice][BLE] ${tag}_BEGIN`, { total }); } catch {}
    await device.writeCharacteristicWithResponseForService(serviceUUID, writeCharUUID, b64Encode(`${tag}_BEGIN ${total}`));
    let seq = 0;
    for (let i = 0; i < total; i += chunkSize) {
      const part = text.substring(i, i + chunkSize);
      // Log a preview to avoid huge terminal output
      try { console.log(`[AddDevice][BLE] ${tag}_DATA`, { seq, preview: part }); } catch {}
      await device.writeCharacteristicWithResponseForService(serviceUUID, writeCharUUID, b64Encode(`${tag}_DATA ${seq} ${part}`));
      seq++;
    }
    try { console.log(`[AddDevice][BLE] ${tag}_END`, { chunks: seq }); } catch {}
    await device.writeCharacteristicWithResponseForService(serviceUUID, writeCharUUID, b64Encode(`${tag}_END`));
  }
      // Watchdog: 25s. Only show tip if no items and not ended; do NOT close the dialog.
      const watchdog = setTimeout(() => {
        if (!gotItem && !ended) {
          setSnackbarMsg('timeout: device did not finish scan (no END)');
          setSnackbarVisible(true);
        }
      }, 25000);
      const txId = Platform.OS === 'android' ? undefined : `env-wifi-provision-${Date.now()}`;
      const sub = connectedDevice.monitorCharacteristicForService(serviceUUID, echoCharUUID, (error: any, characteristic: any) => {
        if (error) { ended = true; setConnectBusy(false); setSnackbarMsg(error?.message || '设备通知错误'); setSnackbarVisible(true); try { sub?.remove?.(); } catch {}; return; }
        const b64 = characteristic?.value || '';
        const msg = b64DecodeUtf8(b64);
        if (!msg) return;
        // Suppress non-list status logs during Wi‑Fi listing; only handle WIFI_LIST_* and WIFI_ITEM
        if (ended) return;
        if (msg === 'WIFI_LIST_BEGIN') { setWifiItemsBle([]); gotItem = false; gotNone = false; return; }
        if (msg === 'WIFI_LIST_NONE') { gotNone = true; return; }
        if (msg === 'WIFI_LIST_END') {
          if (!gotItem && !retried) {
            ended = true;
            retried = true;
            setTimeout(async () => {
              ended = false; gotItem = false; gotNone = false; setWifiItemsBle([]);
              try {
                await connectedDevice.writeCharacteristicWithResponseForService(serviceUUID, writeCharUUID, b64Encode('WIFI_LIST'));
                // silently rescan
              } catch (e:any) {
                setSnackbarMsg(e?.message || '自动重扫 Wi‑Fi 失败'); setSnackbarVisible(true);
                try { if (Platform.OS !== 'android') sub?.remove?.(); } catch {}
                setWifiBlePickerVisible(false);
              }
            }, 1500);
            return;
          }
          ended = true;
          if (!gotItem) { setSnackbarMsg('未发现可用的 Wi‑Fi（可重试或靠近路由器）'); setSnackbarVisible(true); /* keep dialog open */ }
          try { if (Platform.OS !== 'android') sub?.remove?.(); } catch {}
          try { clearTimeout(watchdog); } catch {}
          return;
        }
        // Ignore non-list status messages during Wi‑Fi listing phase
        if (/^WIFI_(CONNECTING|AP_NOT_FOUND|OK|STA_CONNECTED)/i.test(msg)) { return; }
        if (msg.startsWith('WIFI_ITEM ')) {
          const payload = msg.substring('WIFI_ITEM '.length);
          // Prefer JSON, fallback to pipe-delimited "ssid|rssi|enc"
          let ssid = '';
          let rssi = 0;
          let enc = 'OPEN';
          let parsed = false;
          try {
            const obj = JSON.parse(payload);
            if (obj && (obj.ssid || obj.rssi || obj.enc)) {
              ssid = obj.ssid || '';
              rssi = Number(obj.rssi || 0);
              enc = String(obj.enc || 'OPEN');
              parsed = true;
            }
          } catch {}
          if (!parsed) {
            const parts = payload.split('|');
            ssid = parts[0] ?? '';
            rssi = parseInt(parts[1] ?? '0', 10);
            enc = parts[2] ?? 'OPEN';
            parsed = true;
          }
          gotItem = true;
          setWifiItemsBle(prev => {
            const filtered = prev.filter(i => i.ssid !== ssid);
            return [{ ssid, rssi, enc }, ...filtered].slice(0, 50);
          });
          try { clearTimeout(watchdog); } catch {}
          return;
        }
      });
      await connectedDevice.writeCharacteristicWithResponseForService(serviceUUID, writeCharUUID, b64Encode('WIFI_LIST'));
    } catch (e: any) {
      setSnackbarMsg(e?.message || '请求设备扫描 Wi‑Fi 失败');
      setSnackbarVisible(true);
      setWifiBlePickerVisible(false);
    }
  };

  const connectWifiViaBle = async () => {
    const ssid = selectedWifi.trim();
    const password = wifiPassword.trim();
    if (!ssid) { setSnackbarMsg('请选择要连接的 Wi‑Fi'); setSnackbarVisible(true); return; }
    if (!connectedDevice) { setSnackbarMsg('请先选择设备'); setSnackbarVisible(true); return; }
    setConnectBusy(true);
    try {
      const serviceUUID = '0000fff0-0000-1000-8000-00805f9b34fb';
      const writeCharUUID = '0000fff1-0000-1000-8000-00805f9b34fb';
      const echoCharUUID = '0000fff2-0000-1000-8000-00805f9b34fb';
      let done = false;
      let retried = false;
      let busyRetries = 0;
      const maxBusyRetries = 2;
      try { monRef.current?.remove?.(); } catch {}
      try { if (bleRef.current?.cancelTransaction && monTxIdRef.current && Platform.OS !== 'android') bleRef.current.cancelTransaction(monTxIdRef.current); } catch {}
      try { console.log('[AddDevice] Subscribe FFF2 notifications'); } catch {}
      const txId = `wifi-provision-${Date.now()}`;
      const sub = connectedDevice.monitorCharacteristicForService(serviceUUID, echoCharUUID, (error: any, characteristic: any) => {
        if (done) return;
        if (error) { done = true; setConnectBusy(false); setSnackbarMsg(error?.message || '设备通知错误'); setSnackbarVisible(true); try { sub?.remove?.(); } catch {}; return; }
        const b64 = characteristic?.value || '';
        const msg = b64DecodeUtf8(b64);
        // Verbose terminal logs for BLE echo
        try { console.log('[AddDevice][BLE FFF2 echo]', { rawBase64: b64?.substring?.(0, 80), msg }); } catch {}
        if (!msg) { try { console.log('[AddDevice][BLE FFF2 echo] empty msg'); } catch {}; return; }
        if (/WIFI_OK/i.test(msg) || /WIFI_STA_CONNECTED/i.test(msg)) {
          done = true;
          try { clearTimeout(timeout); } catch {}
          setConnectBusy(false);
          // Prompt (English) per request
          setSnackbarMsg('connect WIFI success');
          setSnackbarVisible(true);
          setInlineMsg('Connect success');
          setInlineVisible(true);
          setTimeout(() => setInlineVisible(false), 2000);
          // 自动下发 Supabase 配置与设备 JWT，并触发一次 HEARTBEAT_NOW
          if (!autoJwtSentRef.current) {
            autoJwtSentRef.current = true;
            (async () => {
              try {
                // 1) 保存 Supabase 配置（anon + supabase_url）到设备
                const supabaseUrl = (
                  process.env.EXPO_PUBLIC_SUPABASE_URL
                  || ((Constants as any)?.expoConfig?.extra as any)?.SUPABASE_URL
                  || ((Constants as any)?.manifest?.extra as any)?.SUPABASE_URL
                  || ''
                ).trim();
                const anonKey = (
                  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
                  || ((Constants as any)?.expoConfig?.extra as any)?.SUPABASE_ANON_KEY
                  || ((Constants as any)?.manifest?.extra as any)?.SUPABASE_ANON_KEY
                  || ''
                ).trim();
                if (supabaseUrl && anonKey) {
                  const configJson = JSON.stringify({ anon: anonKey, supabase_url: supabaseUrl });
                  try { console.log('[AddDevice] Sending Supabase config to device', { urlLen: supabaseUrl.length, anonLen: anonKey.length, jsonLen: configJson.length }); } catch {}
                  // Long payloads must be chunked. Use SUPA_CFG framing.
                  const { encodeChunkCommands } = await import('../../utils/chunk');
                  const cmds = encodeChunkCommands('SUPA_CFG', configJson, 16);
                  for (const c of cmds) {
                    await connectedDevice.writeCharacteristicWithResponseForService(serviceUUID, writeCharUUID, b64Encode(c));
                  }
                  try { console.log('[AddDevice] Supabase config sent (chunked)'); } catch {}
                }

                // 2) 调用 Edge Function 颁发设备专用 JWT 并下发到设备
                const did = (deviceId && deviceId.trim()) ? deviceId.trim() : '';
                if (!did) {
                  setSnackbarMsg('缺少设备ID，无法颁发设备 JWT');
                  setSnackbarVisible(true);
                } else {
                  try { console.log('[AddDevice] Invoking issue-device-jwt', { device_id: did }); } catch {}
                  const { data: issueData, error: issueErr } = await supabase.functions.invoke('issue-device-jwt', { body: { device_id: did } });
                  if (issueErr) {
                    try { console.log('[AddDevice] issue-device-jwt error', issueErr); } catch {}
                    setSnackbarMsg(`颁发设备 JWT 失败：${issueErr.message || issueErr}`);
                    setSnackbarVisible(true);
                  } else if (issueData?.jwt) {
                    try { console.log('[AddDevice] Device JWT issued', { jwtPreview: (issueData.jwt as string).slice(0, 24) + '...' }); } catch {}
                    const jwtJson = JSON.stringify({ jwt: issueData.jwt });
                    // JWT is long as well; use chunked framing under tag JWT_SET
                    const { encodeChunkCommands } = await import('../../utils/chunk');
                    const cmds = encodeChunkCommands('JWT_SET', jwtJson, 16);
                    for (const c of cmds) {
                      await connectedDevice.writeCharacteristicWithResponseForService(serviceUUID, writeCharUUID, b64Encode(c));
                    }
                    try { console.log('[AddDevice] JWT_SET sent to device (chunked)'); } catch {}
                  } else {
                    setSnackbarMsg('颁发设备 JWT 失败：返回数据缺少 jwt');
                    setSnackbarVisible(true);
                  }
                }
                try {
                  await connectedDevice.writeCharacteristicWithResponseForService(
                    serviceUUID,
                    writeCharUUID,
                    b64Encode('DEV_INSECURE_ON')
                  );
                  try { console.log('[AddDevice] DEV_INSECURE_ON sent'); } catch {}
                } catch {}

                // 3) 触发一次 HEARTBEAT_NOW，验证 last_seen 是否立即更新
                try { console.log('[AddDevice] Sending HEARTBEAT_NOW'); } catch {}
                await connectedDevice.writeCharacteristicWithResponseForService(
                  serviceUUID,
                  writeCharUUID,
                  b64Encode('HEARTBEAT_NOW')
                );
                try { console.log('[AddDevice] HEARTBEAT_NOW sent'); } catch {}
              } catch (e: any) {
                setSnackbarMsg(`自动发送 JWT 失败：${e?.message || String(e)}`);
                setSnackbarVisible(true);
                try { console.log('[AddDevice] Auto JWT send failed', e); } catch {}
              }
            })();
          }
          try { console.log('[AddDevice] Unsubscribe FFF2 after success'); if (Platform.OS !== 'android') (bleRef.current as any)?.cancelTransaction?.(txId as string); } catch {}
      monTxIdRef.current = null;
        }
        if (/WIFI_BUSY/i.test(msg)) {
          if (busyRetries < maxBusyRetries) {
            busyRetries += 1;
            try { console.log('[AddDevice] WIFI_BUSY, retry WIFI_SET'); } catch {}
            setTimeout(async () => {
              try {
                const wifiObj: any = { ssid, password };
                const wifiJson = JSON.stringify(wifiObj);
                const wifiCmd = `WIFI_SET ${wifiJson}`;
                await connectedDevice.writeCharacteristicWithResponseForService(serviceUUID, writeCharUUID, b64Encode(wifiCmd));
                try { console.log('[AddDevice] WIFI_SET resent (busy)'); } catch {}
              } catch {}
            }, 1200);
          }
          return;
        }
        if (/WIFI_AUTH_FAIL/i.test(msg)) {
          done = true;
          try { clearTimeout(timeout); } catch {}
          setConnectBusy(false);
          setSnackbarMsg('Wi‑Fi 密码错误，请检查后重试');
          setSnackbarVisible(true);
          try { console.log('[AddDevice] Unsubscribe FFF2 after auth fail'); if (Platform.OS !== 'android') (bleRef.current as any)?.cancelTransaction?.(txId as string); } catch {}
          monTxIdRef.current = null;
          return;
        }
        if (/WIFI_FAIL|WIFI_DISCONNECTED_REASON_/i.test(msg)) {
          if (!retried) {
            retried = true;
            try { console.log('[AddDevice] WIFI_FAIL; retry once'); } catch {}
            setTimeout(async () => {
              try {
                const wifiObj: any = { ssid, password };
                const wifiJson = JSON.stringify(wifiObj);
                const wifiCmd = `WIFI_SET ${wifiJson}`;
                await connectedDevice.writeCharacteristicWithResponseForService(serviceUUID, writeCharUUID, b64Encode(wifiCmd));
                try { console.log('[AddDevice] WIFI_SET resent'); } catch {}
              } catch {}
            }, 1200);
            return;
          }
          done = true;
          try { clearTimeout(timeout); } catch {}
          setConnectBusy(false);
          setSnackbarMsg('连接 Wi‑Fi 失败（可重试或靠近路由器）');
          setSnackbarVisible(true);
          try { console.log('[AddDevice] Unsubscribe FFF2 after failure'); if (Platform.OS !== 'android') (bleRef.current as any)?.cancelTransaction?.(txId as string); } catch {}
          monTxIdRef.current = null;
          return;
        }
      }, txId);
      monRef.current = sub;
      monTxIdRef.current = txId;
      const timeout = setTimeout(() => {
        if (!done) {
          setConnectBusy(false);
          setSnackbarMsg('连接超时');
          setSnackbarVisible(true);
          try { console.log('[AddDevice] Unsubscribe FFF2 after timeout'); if (Platform.OS !== 'android') (bleRef.current as any)?.cancelTransaction?.(txId as string); } catch {}
      monTxIdRef.current = null;
        }
      }, 20000);
      const wifiObj: any = { ssid: ssid.trim(), password: password.trim() };
      const wifiJson = JSON.stringify(wifiObj);
      const wifiCmd = `WIFI_SET ${wifiJson}`;
      try { console.log('[AddDevice] Sending WIFI_SET', { ssid, pwLen: password.length }); } catch {}
      await connectedDevice.writeCharacteristicWithResponseForService(serviceUUID, writeCharUUID, b64Encode(wifiCmd));
      try { console.log('[AddDevice] WIFI_SET sent'); } catch {}
      setTimeout(() => { try { clearTimeout(timeout); } catch {} }, 22000);
    } catch (e: any) {
      setConnectBusy(false);
      setSnackbarMsg(e?.message || '设备连接 Wi‑Fi 失败');
      setSnackbarVisible(true);
    }
  };

  // Save: upload to Supabase, disconnect BLE, and return to device list (online)
  const onSave = async () => {
    try {
      const did = (deviceId && deviceId.trim()) ? deviceId.trim() : '';
      if (!did) { setSnackbarMsg('请先选择设备（扫描并连接蓝牙读取ID）'); setSnackbarVisible(true); return; }
      const nowIso = new Date().toISOString();
      // Optional: attach current user
      let uid: string | null = null;
      try { const { data } = await supabase.auth.getUser(); uid = data?.user?.id || null; } catch {}
      const up: any = {
        device_id: did,
        name: (name && name.trim()) ? name.trim() : did,
        location: (location && location.trim()) ? location.trim() : 'Unknown',
        wifi_ssid: selectedWifi || null,
        wifi_password: (wifiPassword && wifiPassword.trim()) ? wifiPassword.trim() : null,
        status: 'online',
        last_seen: nowIso,
      };
      if (uid) up.user_id = uid;
      const { error } = await supabase.from('devices').upsert(up, { onConflict: 'device_id' });
      if (error) { setSnackbarMsg(error.message); setSnackbarVisible(true); return; }
      // Disconnect BLE (prefer manager API; fallback to device API)
      try {
        if (bleRef.current && connectedDevice?.id) {
          await bleRef.current.cancelDeviceConnection(connectedDevice.id);
        } else if (connectedDevice?.cancelConnection) {
          await connectedDevice.cancelConnection();
        }
      } catch {}
      // Navigate to device list
      try { navigation.navigate('DeviceManagement'); } catch { /* fallback */ }
    } catch (e: any) {
      setSnackbarMsg(e?.message || '保存失败');
      setSnackbarVisible(true);
    }
  };

  return (
    <LinearGradient colors={cartoonGradient} style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          { padding: 16, paddingBottom: 48 },
          Platform.OS === 'web' && { width: '100%', maxWidth: 1000, alignSelf: 'center', paddingHorizontal: 16 }
        ]}
      >
          <View>
            <TextInput
              label="Device Name (e.g. Living Room Monitor)"
              value={name}
              onChangeText={setName}
              style={styles.input}
              contentStyle={{ fontFamily: headerFont }}
            />
            <Menu
              visible={locMenuOpen}
              onDismiss={() => setLocMenuOpen(false)}
              anchor={
                <Pressable onPress={() => { if (!locLockRef.current) setLocMenuOpen(true); }}>
                  <TextInput label="Location" value={location} onChangeText={setLocation} style={styles.input} mode="outlined" contentStyle={{ fontFamily: headerFont }} onFocus={() => { if (!locLockRef.current) setLocMenuOpen(true); }} />
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

                {/* Device ID + Scan */}
            <View style={styles.row}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <TextInput label="Device ID" value={deviceId} onChangeText={setDeviceId} mode="outlined" contentStyle={{ textAlign: 'left', fontFamily: headerFont }} />
              </View>
              <Button mode="outlined" onPress={startBleScan} disabled={Platform.OS === 'web'} labelStyle={{ fontFamily: headerFont }}>Scan</Button>
            </View>

            {/* Scan Wi‑Fi */}
            <Button mode="outlined" style={{ marginTop: 12 }} onPress={scanWifiListViaBle} disabled={Platform.OS === 'web'} labelStyle={{ fontFamily: headerFont }}>Scan Wi‑Fi</Button>

            {/* After selecting SSID from popup, show SSID/PW rows on main screen */}
            {selectedWifi ? (
              <View style={{ marginTop: 12 }}>
                <TextInput
                  label="WiFi SSID"
                  value={selectedWifi}
                  onChangeText={setSelectedWifi}
                  mode="outlined"
                  contentStyle={{ fontFamily: headerFont }}
                />
                <TextInput
                  label="WiFi Password"
                  value={wifiPassword}
                  onChangeText={setWifiPassword}
                  secureTextEntry
                  mode="outlined"
                  style={{ marginTop: 8 }}
                  contentStyle={{ fontFamily: headerFont }}
                />
                <Button mode="outlined" onPress={connectWifiViaBle} loading={connectBusy} style={{ marginTop: 8 }} labelStyle={{ fontFamily: headerFont }}>
                  Connect
                </Button>
              </View>
            ) : null}
          </View>

        {/* BLE picker: UI unified with Wi‑Fi scan popup (no title, compact list) */}
        <Portal>
          <Dialog visible={blePickerVisible} onDismiss={() => setBlePickerVisible(false)} style={{ borderRadius: 16 }}>
            {/* No Title (to match Wi‑Fi popup) */}
            <Dialog.Content>
              {bleItems.length === 0 ? (
                <Text style={{ fontFamily: headerFont }}>Waiting for device...</Text>
              ) : (
                bleItems.map((d) => (
                  <List.Item
                    key={d.id}
                    title={d.name}
                    description={`${d.id}${typeof d.rssi === 'number' ? ` • RSSI ${d.rssi}` : ''}`}
                    // Compact styles to match Wi‑Fi popup
                    style={{ paddingVertical: 4 }}
                    titleStyle={{ fontSize: 14, fontFamily: headerFont }}
                    descriptionStyle={{ fontSize: 12, color: '#666', fontFamily: headerFont }}
                    onPress={() => onPickBleDevice({ id: d.id, name: d.name })}
                  />
                ))
              )}
            </Dialog.Content>
            <Dialog.Actions>
              <Button onPress={() => { try { bleRef.current?.stopDeviceScan(); } catch {}; setBlePickerVisible(false); }} labelStyle={{ fontFamily: headerFont }}>Close</Button>
            </Dialog.Actions>
          </Dialog>
        </Portal>

        {/* Save */}
        <Button mode="contained" style={{ marginTop: 16, borderRadius: 20, alignSelf: 'center' }} contentStyle={{ height: 44 }} onPress={onSave} labelStyle={{ fontFamily: headerFont }}>Save</Button>
        {inlineVisible ? (
          <View style={{ alignSelf: 'center', marginTop: 8, backgroundColor: theme.colors.secondaryContainer, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 }}>
            <Text style={{ fontFamily: headerFont, color: theme.colors.onSecondaryContainer }}>{inlineMsg}</Text>
          </View>
        ) : null}

        <Snackbar visible={snackbarVisible} onDismiss={() => setSnackbarVisible(false)} duration={2500} style={{ backgroundColor: theme.colors.secondaryContainer, alignSelf: 'center' }} wrapperStyle={{ position: 'absolute', top: '45%', left: 0, right: 0 }}>
          <Text style={{ fontFamily: headerFont, color: theme.colors.onSecondaryContainer, textAlign: 'center' }}>{snackbarMsg}</Text>
        </Snackbar>

        {/* Wi‑Fi scan popup (no title, English prompts, compact list) */}
        <Portal>
          <Dialog visible={wifiBlePickerVisible} onDismiss={() => setWifiBlePickerVisible(false)} style={{ borderRadius: 16 }}>
            {/* No Title as requested */}
            <Dialog.Content>
              {wifiItemsBle.length === 0 ? (
                <Text style={{ fontFamily: headerFont }}>Waiting for device...</Text>
              ) : (
                wifiItemsBle
                  .sort((a, b) => b.rssi - a.rssi)
                  .slice(0, 5)
                  .map((item, idx) => (
                    <List.Item
                      key={`${item.ssid}-${idx}`}
                      title={item.ssid}
                      description={`${item.enc} • RSSI ${item.rssi}`}
                      // Compact styles
                      style={{ paddingVertical: 4 }}
                      titleStyle={{ fontSize: 14, fontFamily: headerFont }}
                      descriptionStyle={{ fontSize: 12, color: '#666', fontFamily: headerFont }}
                      onPress={() => { setSelectedWifi(item.ssid); setWifiBlePickerVisible(false); }}
                    />
                  ))
              )}
              {/* Main screen handles SSID/PW inputs; keep popup simple */}
            </Dialog.Content>
            <Dialog.Actions>
              <Button onPress={() => setWifiBlePickerVisible(false)} labelStyle={{ fontFamily: headerFont }}>Close</Button>
            </Dialog.Actions>
          </Dialog>
        </Portal>
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  banner: { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12 },
  input: { marginTop: 12 },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
});
