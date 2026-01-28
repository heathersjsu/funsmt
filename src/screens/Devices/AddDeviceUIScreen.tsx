import React, { useRef, useState } from 'react';
import { View, StyleSheet, Platform, Pressable, ScrollView, KeyboardAvoidingView } from 'react-native';
import { Text, TextInput, Button, useTheme, Portal, Dialog, List, Snackbar, Menu, Modal } from 'react-native-paper';
import { LinearGradient } from 'expo-linear-gradient';
import Constants from 'expo-constants';
import { cartoonGradient } from '../../theme/tokens';
import { BleManager } from '../../shims/ble';
import { PERMISSIONS, RESULTS, check, request } from '../../shims/permissions';
import { pushLog } from '../../utils/envDiagnostics';
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
  const scanActiveRef = useRef(false);
  const [bleScanning, setBleScanning] = useState(false);
  const [blePickerVisible, setBlePickerVisible] = useState(false);
  const [bleItems, setBleItems] = useState<Array<{ id: string; name: string; rssi?: number | null }>>([]);
  const [snackbarVisible, setSnackbarVisible] = useState(false);
  const [snackbarMsg, setSnackbarMsg] = useState('');
  const [inlineMsg, _setInlineMsg] = useState('');
  const [inlineType, setInlineType] = useState<'success'|'error'>('error');
  const showInlineMsg = (msg: string, type: 'success'|'error' = 'error') => {
    _setInlineMsg(msg);
    setInlineType(type);
  };
  // Backward compatibility for existing error calls
  const setInlineMsg = (msg: string) => showInlineMsg(msg, 'error');
  const [inlineVisible, setInlineVisible] = useState(false);
  const [isProvisioning, setIsProvisioning] = useState(false);
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
  const [wifiPwVisible, setWifiPwVisible] = useState(false);
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
      const chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
      const chr3 = ((enc3 & 3) << 6) | enc4;

      output += String.fromCharCode(chr1);
      if (enc3 !== 64) output += String.fromCharCode(chr2);
      if (enc4 !== 64) output += String.fromCharCode(chr3);
    }
    try { return decodeURIComponent(escape(output)).trim(); } catch { return output.trim(); }
  };

  // For long SSIDs without spaces, inject zero-width spaces to allow wrapping
  const wrapLongSsid = (ssid: string) => {
    try {
      if (!ssid) return ssid;
      // If there's whitespace, normal wrapping will work
      if (/\s/.test(ssid)) return ssid;
      // Insert a zero-width space every 8 characters for long words
      if (ssid.length > 12) {
        const parts: string[] = [];
        for (let i = 0; i < ssid.length; i += 8) {
          parts.push(ssid.substring(i, i + 8));
        }
        return parts.join('\u200B');
      }
      return ssid;
    } catch { return ssid; }
  };

  // Parse to display ID from adv name or fallback id
  const toDisplayIdFromNameOrId = (name?: string, id?: string) => {
    const s = String(name || id || '').trim();
    let m = /pinme-esp32_([0-9a-f]{6})/i.exec(s);
    if (m && m[1]) return `pinme_${String(m[1]).toUpperCase()}`;
    m = /pinme[_-]?([0-9a-f]{6})/i.exec(s);
    if (m && m[1]) return `pinme_${String(m[1]).toUpperCase()}`;
    m = /esp32[_-]?([0-9a-f]{6})/i.exec(s);
    if (m && m[1]) return `pinme_${String(m[1]).toUpperCase()}`;
    // fallback: last 6 of id
    const tail = String(id || '').replace(/[^0-9A-Fa-f]/g, '').slice(-6).toUpperCase();
    return tail ? `pinme_${tail}` : '';
  };

  const startBleScan = async () => {
    try { console.log('[AddDeviceUI] UI[Scan] Scan button pressed'); pushLog('AddDeviceUI: Scan pressed'); } catch {}
    // Guard: Web/Expo Go typically cannot use BLE
    if (Platform.OS === 'web') {
      setSnackbarMsg('Web 端不支持 BLE 扫描，请使用 Dev Client 或真机。');
      setSnackbarVisible(true);
      try { console.log('[AddDeviceUI] Step[Scan] Web does not support BLE'); pushLog('AddDeviceUI: Web BLE unsupported'); } catch {}
      return;
    }
    // Android 12+ 需要在运行时请求 BLE 扫描/连接权限；部分设备还需要定位权限以返回广播
    try {
      if (Platform.OS === 'android') {
        const isApi31Plus = (typeof Platform?.Version === 'number' ? Platform.Version >= 31 : true);
        if (isApi31Plus) {
          const locFineStatus = await check(PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION);
          try { console.log('[AddDeviceUI] Perm[ACCESS_FINE_LOCATION]=', locFineStatus); pushLog(`AddDeviceUI: Perm ACCESS_FINE_LOCATION=${String(locFineStatus)}`); } catch {}
          if (locFineStatus !== RESULTS.GRANTED) {
            const r = await request(PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION);
            try { console.log('[AddDeviceUI] PermReq[ACCESS_FINE_LOCATION]=', r); pushLog(`AddDeviceUI: PermReq ACCESS_FINE_LOCATION=${String(r)}`); } catch {}
            if (r !== RESULTS.GRANTED) { setSnackbarMsg('定位权限被拒绝，无法扫描 BLE'); setSnackbarVisible(true); return; }
          }
          const scanStatus = await check(PERMISSIONS.ANDROID.BLUETOOTH_SCAN);
          try { console.log('[AddDeviceUI] Perm[BLUETOOTH_SCAN]=', scanStatus); pushLog(`AddDeviceUI: Perm BLUETOOTH_SCAN=${String(scanStatus)}`); } catch {}
          if (scanStatus !== RESULTS.GRANTED) {
            const r = await request(PERMISSIONS.ANDROID.BLUETOOTH_SCAN);
            try { console.log('[AddDeviceUI] PermReq[BLUETOOTH_SCAN]=', r); pushLog(`AddDeviceUI: PermReq BLUETOOTH_SCAN=${String(r)}`); } catch {}
            if (r !== RESULTS.GRANTED) { setSnackbarMsg('蓝牙扫描权限被拒绝'); setSnackbarVisible(true); return; }
          }
          const connStatus = await check(PERMISSIONS.ANDROID.BLUETOOTH_CONNECT);
          try { console.log('[AddDeviceUI] Perm[BLUETOOTH_CONNECT]=', connStatus); pushLog(`AddDeviceUI: Perm BLUETOOTH_CONNECT=${String(connStatus)}`); } catch {}
          if (connStatus !== RESULTS.GRANTED) {
            const r = await request(PERMISSIONS.ANDROID.BLUETOOTH_CONNECT);
            try { console.log('[AddDeviceUI] PermReq[BLUETOOTH_CONNECT]=', r); pushLog(`AddDeviceUI: PermReq BLUETOOTH_CONNECT=${String(r)}`); } catch {}
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
      if (bleScanning) {
        try { console.log('[AddDeviceUI] BLE scan already active, skipping start'); } catch {}
        return;
      }
      setBleItems([]);
      setBleScanning(true);
      scanActiveRef.current = true;
      setBlePickerVisible(true);
      try { console.log('[AddDeviceUI] Step[Scan] BLE scanning started (10s window)'); pushLog('AddDeviceUI: BLE scan started'); } catch {}
      bleRef.current.startDeviceScan(null, null, (error: any, device: any) => {
        if (!scanActiveRef.current) return;
        if (error) {
          scanActiveRef.current = false;
          setBleScanning(false);
          setSnackbarMsg(error?.message || 'BLE 扫描不可用，请使用 Dev Client 或真机');
          setSnackbarVisible(true);
          try { console.log('[AddDeviceUI] Step[Scan] error=', error?.message || error); pushLog(`AddDeviceUI: Scan error ${String(error?.message || error)}`); } catch {}
          return;
        }
        const name: string = device?.name || '';
        const id: string = device?.id || device?.uuid || '';
        const rssi: number | null = typeof device?.rssi === 'number' ? device.rssi : null;
        try { console.log('[AddDeviceUI] Step[Scan] found', { name: name || '(no name)', id, rssi }); pushLog(`AddDeviceUI: found name=${name || '(no name)'} id=${id} rssi=${String(rssi)}`); } catch {}
        // Show PINME devices: accept PINME-ESP32_XXXXXX or PINME-XXXXXX or any name containing "pinme"
        const isPinme =
          /^pinme-esp32_[0-9a-f]{6}$/i.test(name) ||
          /^pinme[-_][0-9a-f]{6}$/i.test(name) ||
          /pinme/i.test(name) ||
          /esp32/i.test(name);
        if (isPinme) {
          let shown = name && name.length ? name : toDisplayIdFromNameOrId(name, id) || 'PINME DEVICE';
          // User request: Show pinme_ prefix in scan list instead of ESP32_
          if (/^ESP32_/i.test(shown)) {
            shown = shown.replace(/^ESP32_/i, 'pinme_');
          }
          setBleItems(prev => {
            const exists = prev.some(d => d.id === id);
            const next = exists ? prev : [{ id, name: shown, rssi: device?.rssi ?? null }, ...prev];
            // Keep list small and sorted by RSSI
            return next
              .sort((a,b) => ((b.rssi ?? -999) - (a.rssi ?? -999)))
              .slice(0, 8);
          });
          try { console.log('[AddDeviceUI] Step[Scan] added to picker', { id, name: shown }); pushLog(`AddDeviceUI: added id=${id} name=${shown}`); } catch {}
        }
      });
      // Auto stop after 10s
      setTimeout(() => { 
        if (scanActiveRef.current) {
          try { bleRef.current?.stopDeviceScan(); } catch {}; 
          scanActiveRef.current = false;
          setBleScanning(false); 
          try { console.log('[AddDeviceUI] Step[Scan] stopped (timeout)'); pushLog('AddDeviceUI: scan stopped timeout'); } catch {} 
        }
      }, 10000);
    } catch (e: any) {
      scanActiveRef.current = false;
      setBleScanning(false);
      setSnackbarMsg(e?.message || 'BLE 模块不可用');
      setSnackbarVisible(true);
      try { console.log('[AddDeviceUI] Step[Scan] exception=', e?.message || e); pushLog(`AddDeviceUI: Scan exception ${String(e?.message || e)}`); } catch {}
    }
  };

  const onPickBleDevice = async (dev: { id: string; name: string }) => {
    // Stop scanning immediately when user selects a device
    scanActiveRef.current = false;
    try { bleRef.current?.stopDeviceScan(); } catch {}
    setBleScanning(false);
    setBlePickerVisible(false);
    try {
      try { console.log('[AddDeviceUI] UI[Pick] user selected', { id: dev.id, name: dev.name }); pushLog(`AddDeviceUI: pick id=${dev.id} name=${dev.name}`); } catch {}
      // 连接前权限兜底（Android 12+ 要求 BLUETOOTH_CONNECT）
      if (Platform.OS === 'android') {
        const isApi31Plus = (typeof Platform?.Version === 'number' ? Platform.Version >= 31 : true);
        if (isApi31Plus) {
          const connStatus = await check(PERMISSIONS.ANDROID.BLUETOOTH_CONNECT);
          try { console.log('[AddDeviceUI] Perm[BLUETOOTH_CONNECT]=', connStatus); pushLog(`AddDeviceUI: Perm BLUETOOTH_CONNECT=${String(connStatus)}`); } catch {}
          if (connStatus !== RESULTS.GRANTED) {
            const r = await request(PERMISSIONS.ANDROID.BLUETOOTH_CONNECT);
            try { console.log('[AddDeviceUI] PermReq[BLUETOOTH_CONNECT]=', r); pushLog(`AddDeviceUI: PermReq BLUETOOTH_CONNECT=${String(r)}`); } catch {}
            if (r !== RESULTS.GRANTED) { throw new Error('蓝牙连接权限被拒绝'); }
          }
        }
      }
      if (!bleRef.current) bleRef.current = new BleManager();
      try { console.log('[AddDeviceUI] Step[Conn] connecting...'); pushLog('AddDeviceUI: connecting'); } catch {}
      const d = await bleRef.current.connectToDevice(dev.id, { timeout: 10000 }).catch((e: any) => { throw e; });
      try { console.log('[AddDevice] Step[Conn] connected, discovering services'); pushLog('AddDevice: connected'); } catch {}
      // Android: Request high MTU to avoid packet truncation (default is 20 bytes payload)
      if (Platform.OS === 'android') {
        try {
          const mtu = await d.requestMTU(512);
          try { console.log(`[AddDevice] MTU negotiated: ${mtu}`); pushLog(`AddDevice: MTU=${mtu}`); } catch {}
        } catch (e) {
          try { console.log('[AddDevice] MTU request failed', e); } catch {}
        }
      }
      await d.discoverAllServicesAndCharacteristics();
      setConnectedDevice(d);
      // Prompt (English) on successful Bluetooth connection
      // UI Update: Inline text, no background, centered, no overlay
      showInlineMsg('bluetooth connect success', 'success');
      setInlineVisible(true);
      setTimeout(() => setInlineVisible(false), 3000);
      
      const serviceUUID = '0000fff0-0000-1000-8000-00805f9b34fb';
      const idCharUUID3 = '0000fff3-0000-1000-8000-00805f9b34fb';
      const idCharUUID2 = '0000fff2-0000-1000-8000-00805f9b34fb';
      let ch: any = null;
      try { ch = await d.readCharacteristicForService(serviceUUID, idCharUUID3); }
      catch { ch = await d.readCharacteristicForService(serviceUUID, idCharUUID2); }
      const b64 = ch?.value || '';
      let val = '';
      try { val = b64DecodeUtf8(b64); } catch { val = ''; }
      let idText = (val && /(ESP32_|pinme_)/i.test(val)) ? val.trim() : toDisplayIdFromNameOrId(dev.name, dev.id);
      // User request: Force device ID to start with pinme_ instead of ESP32_
      if (/^ESP32_/i.test(idText)) {
        idText = idText.replace(/^ESP32_/i, 'pinme_');
      }
      setDeviceId(idText);
      try { console.log('[AddDeviceUI] Step[ReadID]', { rawBase64Preview: b64?.substring?.(0, 24), decoded: val, deviceId: idText }); pushLog(`AddDeviceUI: readID decoded=${val} deviceId=${idText}`); } catch {}
    } catch (e: any) {
      const idText = toDisplayIdFromNameOrId(dev.name, dev.id);
      setDeviceId(idText);
      try { console.log('[AddDeviceUI] Device ID set to:', idText); } catch {}
      setSnackbarMsg(`读取设备ID失败，使用回退：${idText}${e?.message ? `（${e.message}）` : ''}`);
      setSnackbarVisible(true);
      try { console.log('[AddDeviceUI] Step[ReadID] failed, fallback deviceId', { deviceId: idText, err: e?.message || e }); pushLog(`AddDeviceUI: readID failed, fallback=${idText} err=${String(e?.message || e)}`); } catch {}
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
        // Support standard "WIFI_ITEM " and compact "W:" prefix
        if (msg.startsWith('WIFI_ITEM ') || msg.startsWith('W:')) {
          const payload = msg.startsWith('W:') ? msg.substring(2) : msg.substring('WIFI_ITEM '.length);
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
          try { console.log('[AddDevice] WIFI_ITEM parsed', { ssid, rssi, enc }); pushLog(`AddDevice: WIFI_ITEM ssid=${ssid} rssi=${rssi}`); } catch {}
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
    // Force stop any lingering scan to prevent interference
    scanActiveRef.current = false;
    try { bleRef.current?.stopDeviceScan(); } catch {}
    setBleScanning(false);

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
          // UI Update: Inline text, no background, centered, no overlay
          showInlineMsg('wifi connect success', 'success');
          setInlineVisible(true);
          setTimeout(() => setInlineVisible(false), 3000);

          // 自动下发 Supabase 配置与设备 JWT，并触发一次 HEARTBEAT_NOW
          if (!autoJwtSentRef.current) {
            autoJwtSentRef.current = true;
            setIsProvisioning(true); // Start spinner on Save button
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
                
                // User requirement: Unified use of pinme_ prefix (no ESP32_)
                const dbDeviceId = did;

                if (!did) {
                  const msg = 'missing device id, cannot issue jwt';
                  setInlineMsg(msg);
                  setInlineVisible(true);
                  setTimeout(() => setInlineVisible(false), 3000);
                  try { console.log('[AddDevice] issue-device-jwt failed: missing device id'); pushLog('AddDevice: issue-jwt failed missing device id'); } catch {}
                } else {
                  // Pre-register device to ensure ownership for RLS
                  try {
                    const { data: uData } = await supabase.auth.getUser();
                    const uid = uData?.user?.id;
                    if (uid) {
                       // Upsert minimal record to claim ownership
                       // Use dbDeviceId (ESP32_...) for the database record to match JWT subject
                       const tempName = name && name.trim() ? name.trim() : `Device ${did.slice(-6)}`;
                       await supabase.from('devices').upsert({
                         device_id: dbDeviceId,
                         user_id: uid,
                         name: tempName,
                         status: 'provisioning' 
                       }, { onConflict: 'device_id' });
                    }
                  } catch (preErr) {
                    console.log('[AddDevice] Pre-register failed', preErr);
                  }

                  try { console.log('[AddDevice] Invoking issue-device-jwt', { device_id: dbDeviceId }); } catch {}
                  const { data: issueData, error: issueErr } = await supabase.functions.invoke('issue-device-jwt', { body: { device_id: dbDeviceId } });
                  if (issueErr) {
                    try { 
                      console.error('[AddDevice] issue-device-jwt ERROR:', JSON.stringify(issueErr, null, 2));
                      pushLog(`AddDevice: issue-jwt error ${JSON.stringify(issueErr)}`);
                    } catch {}
                    showInlineMsg(`issue jwt failed: ${JSON.stringify(issueErr)}`, 'error');
                    setInlineVisible(true);
                    setTimeout(() => setInlineVisible(false), 5000);
                  } else if (issueData?.jwt || issueData?.token) {
                    const jwtVal = issueData?.jwt || issueData?.token;
                    try { 
                      console.log('[AddDevice] Device JWT issued', { jwtPreview: (jwtVal as string).slice(0, 24) + '...' });
                      const parts = (jwtVal as string).split('.');
                      if (parts.length === 3) {
                        const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
                        const pad = b64.length % 4;
                        const padded = pad ? b64 + '='.repeat(4 - pad) : b64;
                        const decoded = JSON.parse(b64DecodeUtf8(padded));
                        console.log('[AddDevice] JWT Payload Decoded:', JSON.stringify(decoded, null, 2));
                        
                        // Allow prefix mismatch (pinme_ vs ESP32_) as long as suffix matches
                        const normalizeDid = (id: string) => id.replace(/^(pinme|ESP32|PINME)_/i, '');
                        if (normalizeDid(decoded.device_id) !== normalizeDid(did)) {
                          console.warn('[AddDevice] WARNING: JWT device_id mismatch!', { expected: did, actual: decoded.device_id });
                        } else if (decoded.device_id !== did) {
                          console.log(`[AddDevice] Note: JWT ID prefix mismatch (${decoded.device_id} vs ${did}), but suffix matches. Proceeding.`);
                        }
                      }
                    } catch (e) {
                      console.log('[AddDevice] Failed to decode JWT for debug', e);
                    }
                    const jwtJson = JSON.stringify({ jwt: jwtVal });
                    // JWT is long as well; use chunked framing under tag JWT_SET
                    const { encodeChunkCommands } = await import('../../utils/chunk');
                    const cmds = encodeChunkCommands('JWT_SET', jwtJson, 16);
                    for (const c of cmds) {
                      await connectedDevice.writeCharacteristicWithResponseForService(serviceUUID, writeCharUUID, b64Encode(c));
                    }
                    try { console.log('[AddDevice] JWT_SET sent to device (chunked)'); } catch {}
                  } else {
                    const msg = 'issue jwt failed: missing jwt in response';
                    showInlineMsg(msg, 'error');
                    setInlineVisible(true);
                    setTimeout(() => setInlineVisible(false), 3000);
                    try { 
                      console.error('[AddDevice] issue-device-jwt failed: missing jwt. Data:', JSON.stringify(issueData, null, 2)); 
                      pushLog('AddDevice: issue-jwt failed missing jwt'); 
                    } catch {}
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
                showInlineMsg('Device Provisioned Successfully', 'success');
              } catch (e: any) {
                showInlineMsg(`auto send jwt failed: ${e?.message || String(e)}`, 'error');
                setInlineVisible(true);
                setTimeout(() => setInlineVisible(false), 3000);
                try { 
                  console.error('[AddDevice] Auto JWT send failed exception:', e); 
                  pushLog(`AddDevice: Auto JWT exception ${String(e)}`);
                } catch {}
              } finally {
                setIsProvisioning(false); // Stop spinner
                // If user clicked Save (or we want to auto-save), do it here if needed. 
                // Currently user must click Save manually, or we can trigger it.
                // The Save button is disabled/loading while isProvisioning is true.
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
          setInlineMsg('wifi password incorrect');
          setInlineVisible(true);
          setTimeout(() => setInlineVisible(false), 3000);
          try { console.log('[AddDevice] Unsubscribe FFF2 after auth fail'); if (Platform.OS !== 'android') (bleRef.current as any)?.cancelTransaction?.(txId as string); } catch {}
          monTxIdRef.current = null;
          return;
        }
        if (/WIFI_FAIL|WIFI_DISCONNECTED_REASON_|WIFI_AP_NOT_FOUND/i.test(msg)) {
          if (!retried) {
            retried = true;
            try { console.log('[AddDevice] WIFI_FAIL/NOT_FOUND; retry once'); } catch {}
            setTimeout(async () => {
              try {
                const wifiObj: any = { ssid, password };
                const wifiJson = JSON.stringify(wifiObj);
                const wifiCmd = `WIFI_SET ${wifiJson}`;
                await connectedDevice.writeCharacteristicWithResponseForService(serviceUUID, writeCharUUID, b64Encode(wifiCmd));
                try { console.log('[AddDevice] WIFI_SET resent'); } catch {}
              } catch {}
            }, 2000); // Increased retry delay to 2s to let device state settle
            return;
          }
          done = true;
          try { clearTimeout(timeout); } catch {}
          setConnectBusy(false);
          setInlineMsg('connection failed');
          setInlineVisible(true);
          setTimeout(() => setInlineVisible(false), 3000);
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
          setInlineMsg('connection timeout');
          setInlineVisible(true);
          setTimeout(() => setInlineVisible(false), 3000);
          try { console.log('[AddDevice] Unsubscribe FFF2 after timeout'); if (Platform.OS !== 'android') (bleRef.current as any)?.cancelTransaction?.(txId as string); } catch {}
      monTxIdRef.current = null;
        }
      }, 20000);
      // Try to disconnect any ongoing connection attempts first to avoid "wifi:sta is connecting" error
      try {
        try { console.log('[AddDevice] Sending WIFI_DISCONNECT before set'); } catch {}
        await connectedDevice.writeCharacteristicWithResponseForService(serviceUUID, writeCharUUID, b64Encode('WIFI_DISCONNECT'));
        await new Promise(resolve => setTimeout(resolve, 800)); // Wait for device to process
      } catch (e) {
        try { console.log('[AddDevice] WIFI_DISCONNECT ignored/failed', e); } catch {}
      }

      const wifiObj: any = { ssid: ssid.trim(), password: password.trim() };
      const wifiJson = JSON.stringify(wifiObj);
      const wifiCmd = `WIFI_SET ${wifiJson}`;
      try { console.log('[AddDevice] Sending WIFI_SET', { ssid, pwLen: password.length }); } catch {}
      await connectedDevice.writeCharacteristicWithResponseForService(serviceUUID, writeCharUUID, b64Encode(wifiCmd));
      try { console.log('[AddDevice] WIFI_SET sent'); } catch {}
      setTimeout(() => { try { clearTimeout(timeout); } catch {} }, 22000);
    } catch (e: any) {
      setConnectBusy(false);
      setInlineMsg('device wifi connection failed');
      setInlineVisible(true);
      setTimeout(() => setInlineVisible(false), 3000);
    }
  };

  // Save: upload to Supabase, disconnect BLE, and return to device list (online)
  const onSave = async () => {
    if (isProvisioning) {
      setSnackbarMsg('正在下发设备凭证，请稍候...');
      setSnackbarVisible(true);
      return;
    }
    // Force stop scan just in case
    scanActiveRef.current = false;
    try { bleRef.current?.stopDeviceScan(); } catch {}
    
    try { console.log('[AddDeviceUI] onSave clicked', { deviceId, name, location, selectedWifi, hasConnectedDevice: !!connectedDevice }); } catch {}

    try {
      const did = (deviceId && deviceId.trim()) ? deviceId.trim() : '';
      if (!did) { setSnackbarMsg('请先选择设备（扫描并连接蓝牙读取ID）'); setSnackbarVisible(true); return; }
      
      const trimmedName = name ? name.trim() : '';
      if (!trimmedName) { setSnackbarMsg('请填写 Device Name'); setSnackbarVisible(true); return; }
      
      const trimmedLocation = location ? location.trim() : '';
      if (!trimmedLocation) { setSnackbarMsg('请填写 Location'); setSnackbarVisible(true); return; }

      const nowIso = new Date().toISOString();
      // Optional: attach current user
      let uid: string | null = null;
      try { const { data } = await supabase.auth.getUser(); uid = data?.user?.id || null; } catch {}
      const up: any = {
        device_id: did,
        name: trimmedName,
        location: trimmedLocation,
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
      // Show save success inline (orange, non-bold), then navigate after 2s
      showInlineMsg('save success', 'success');
      setInlineVisible(true);
      try { console.log('[AddDeviceUI] Save success, navigating in 2s'); } catch {}
      setTimeout(() => {
        setInlineVisible(false);
        try { navigation.navigate('DeviceManagement'); } catch { /* fallback */ }
      }, 2000);
    } catch (e: any) {
      const errMsg = String(e?.message || e || '保存失败');
      setSnackbarMsg(errMsg);
      setSnackbarVisible(true);
      try { console.log('[AddDeviceUI] Save failed', e); } catch {}
    }
  };

  return (
    <LinearGradient colors={cartoonGradient} style={{ flex: 1 }}>
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
      >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          { paddingHorizontal: 32, paddingVertical: 24, paddingBottom: 150 },
          Platform.OS === 'web' && { width: '100%', maxWidth: 1000, alignSelf: 'center' }
        ]}
        keyboardShouldPersistTaps="handled"
      >
          <View>
            <View style={{ alignItems: 'center', marginBottom: 24, marginTop: 16 }}>
              <Text style={{ fontSize: 16, fontFamily: headerFont, color: '#666', textAlign: 'center', paddingHorizontal: 16, lineHeight: 22 }}>
                Turn on the device and bring it close to your phone.
              </Text>
            </View>

            <TextInput
              label="Device Name"
              value={name}
              onChangeText={setName}
              style={styles.input}
              mode="outlined"
              contentStyle={{ fontFamily: headerFont }}
            />
            <Menu
              visible={locMenuOpen}
              onDismiss={() => setLocMenuOpen(false)}
              contentStyle={{ paddingVertical: 8, backgroundColor: 'white' }}
              anchor={
                <Pressable onPress={() => { if (!locLockRef.current) setLocMenuOpen(true); }}>
                  <TextInput label="Location" value={location} onChangeText={setLocation} style={styles.input} mode="outlined" contentStyle={{ fontFamily: headerFont }} onFocus={() => { if (!locLockRef.current) setLocMenuOpen(true); }} />
                </Pressable>
              }
            >
              {DEFAULT_LOCATIONS.map((loc) => (
                <Menu.Item key={`def-${loc}`} title={loc} titleStyle={{ fontFamily: headerFont }} style={{ paddingHorizontal: 16 }} onPress={() => { setLocation(loc); setLocMenuOpen(false); locLockRef.current = true; setTimeout(() => { locLockRef.current = false; }, 150); }} />
              ))}
              {locSuggestions.filter(s => !DEFAULT_LOCATIONS.includes(s)).map((loc) => (
                <Menu.Item key={loc} title={loc} titleStyle={{ fontFamily: headerFont }} style={{ paddingHorizontal: 16 }} onPress={() => { setLocation(loc); setLocMenuOpen(false); locLockRef.current = true; setTimeout(() => { locLockRef.current = false; }, 150); }} />
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
            <View style={{ alignItems: 'center', marginTop: 16 }}>
              <Button 
                mode="outlined" 
                onPress={scanWifiListViaBle} 
                disabled={Platform.OS === 'web'} 
                labelStyle={{ fontFamily: headerFont, fontSize: 14 }}
                contentStyle={{ height: 40 }}
                style={{ width: '60%' }}
              >
                Scan Wi‑Fi
              </Button>
            </View>

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
                  secureTextEntry={!wifiPwVisible}
                  right={<TextInput.Icon icon={wifiPwVisible ? "eye-off" : "eye"} onPress={() => setWifiPwVisible(!wifiPwVisible)} />}
                  mode="outlined"
                  style={{ marginTop: 8 }}
                  contentStyle={{ fontFamily: headerFont }}
                />
                <View style={{ alignItems: 'center', marginTop: 16 }}>
                  <Button 
                    mode="outlined" 
                    onPress={connectWifiViaBle} 
                    loading={connectBusy} 
                    labelStyle={{ fontFamily: headerFont, fontSize: 14 }}
                    contentStyle={{ height: 40 }}
                    style={{ width: '60%' }}
                  >
                    Connect
                  </Button>
                </View>
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
        <Button 
          mode="contained" 
          style={{ marginTop: 16, borderRadius: 20, alignSelf: 'center' }} 
          contentStyle={{ height: 44 }} 
          onPress={onSave} 
          loading={isProvisioning}
          disabled={isProvisioning}
          labelStyle={{ fontFamily: headerFont }}
        >
          Save
        </Button>
        {inlineVisible ? (
          <View style={{ alignSelf: 'center', marginTop: 16, marginBottom: 8, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: inlineType === 'success' ? '#FF8A00' : 'red', fontSize: 16, textAlign: 'center' }}>{inlineMsg}</Text>
          </View>
        ) : null}

        <Snackbar visible={snackbarVisible} onDismiss={() => setSnackbarVisible(false)} duration={2500} style={{ backgroundColor: theme.colors.secondaryContainer, alignSelf: 'center' }} wrapperStyle={{ position: 'absolute', top: '45%', left: 0, right: 0 }}>
          <Text style={{ fontFamily: headerFont, color: theme.colors.onSecondaryContainer, textAlign: 'center' }}>{snackbarMsg}</Text>
        </Snackbar>

        {/* Wi‑Fi scan popup (Custom Modal for full width control) */}
        <Portal>
          <Modal
            visible={wifiBlePickerVisible}
            onDismiss={() => setWifiBlePickerVisible(false)}
            contentContainerStyle={{
              backgroundColor: 'white',
              borderRadius: 16,
              width: '85%',
              alignSelf: 'center',
              paddingVertical: 20,
              paddingHorizontal: 0, // Ensure full width for list items
              overflow: 'hidden'
            }}
          >
            {wifiItemsBle.length === 0 ? (
              <Text style={{ fontFamily: headerFont, padding: 24, textAlign: 'center' }}>Waiting for device...</Text>
            ) : (
              <ScrollView style={{ maxHeight: 400, width: '100%' }} contentContainerStyle={{ paddingHorizontal: 0 }}>
                {wifiItemsBle
                  .sort((a, b) => b.rssi - a.rssi)
                  .slice(0, 50)
                  .map((item, idx) => (
                    <Pressable
                      key={`${item.ssid}-${idx}`}
                      onPress={() => { setSelectedWifi(item.ssid); setWifiBlePickerVisible(false); }}
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
                    >
                      <Text style={{ fontSize: 16, fontFamily: headerFont, color: theme.colors.onSurface, flexWrap: 'wrap', width: '100%' }}>
                        {wrapLongSsid(item.ssid)}
                      </Text>
                      <Text style={{ fontSize: 12, color: theme.colors.outline, fontFamily: headerFont, marginTop: 4 }}>
                        {item.enc} • RSSI {item.rssi}
                      </Text>
                    </Pressable>
                  ))}
              </ScrollView>
            )}
            <View style={{ paddingHorizontal: 24, paddingTop: 12 }}>
              <Button mode="text" onPress={() => setWifiBlePickerVisible(false)} labelStyle={{ fontFamily: headerFont }}>Close</Button>
            </View>
          </Modal>
        </Portal>
      </ScrollView>
      {/* End KeyboardAvoidingView */}
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  banner: { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12 },
  input: { marginTop: 12 },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
});
