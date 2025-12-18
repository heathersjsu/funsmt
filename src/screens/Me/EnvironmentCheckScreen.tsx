import React, { useEffect, useRef, useState } from 'react';
import { View, Platform, ScrollView } from 'react-native';
import { useTheme, Button, Card, Text, TextInput, Portal, Dialog, List, Snackbar, Banner } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { supabase } from '../../supabaseClient';
import { LinearGradient } from 'expo-linear-gradient';
import { cartoonGradient } from '../../theme/tokens';
import { BleManager } from '../../shims/ble';

export default function EnvironmentCheckScreen() {
  const theme = useTheme();
  const headerFont = Platform.select({ ios: 'Arial Rounded MT Bold', android: 'sans-serif-medium', default: 'System' });
  const [bleOk, setBleOk] = useState<boolean | null>(null);
  const [wifiOk, setWifiOk] = useState<boolean | null>(null);
  const [jwtOk, setJwtOk] = useState<boolean | null>(null);
  const [status, setStatus] = useState<string>(''); // 新日志在上面
  const [showAllLogs, setShowAllLogs] = useState<boolean>(false);
  const [snackbarMsg, setSnackbarMsg] = useState<string>('');
  const [snackbarVisible, setSnackbarVisible] = useState<boolean>(false);
  const [storageKeys, setStorageKeys] = useState<string[]>([]);
  const [sessionUserId, setSessionUserId] = useState<string>('');

  // BLE
  const bleRef = useRef<any>(null);
  const [bleScanning, setBleScanning] = useState(false);
  const [blePickerVisible, setBlePickerVisible] = useState(false);
  const [bleItems, setBleItems] = useState<Array<{ id: string; name: string; rssi?: number | null }>>([]);
  const [esp32Id, setEsp32Id] = useState<string>('');
  const [connectedDevice, setConnectedDevice] = useState<any>(null);

  // Wi‑Fi via ESP32 BLE
  const [wifiBlePickerVisible, setWifiBlePickerVisible] = useState(false);
  const [wifiItemsBle, setWifiItemsBle] = useState<Array<{ ssid: string; rssi: number; enc: string }>>([]);
  const [selectedWifi, setSelectedWifi] = useState<string>('');
  const [wifiPassword, setWifiPassword] = useState<string>('');
  const [connectBusy, setConnectBusy] = useState(false);
  // Wi‑Fi list watchdog timer to avoid UI hanging when device reboots or never sends END
  const wifiListWatchdogRef = useRef<NodeJS.Timeout | null>(null);

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
  // Robust Base64 decode (UTF‑8 safe) for RN environments where atob may be unavailable
  const b64DecodeUtf8 = (b64: string): string => {
    try {
      const clean = (b64 || '').replace(/[^A-Za-z0-9+/=]/g, '');
      const raw = (globalThis as any)?.atob ? (globalThis as any).atob(clean) : '';
      if (raw) {
        try { return decodeURIComponent(escape(raw)).trim(); } catch { return raw.trim(); }
      }
    } catch { /* ignore */ }
    // Fallback polyfill
    try {
      const tbl = _b64Table;
      const clean = (b64 || '').replace(/[^A-Za-z0-9+/=]/g, '');
      let output = '';
      let i = 0;
      while (i < clean.length) {
        const enc1 = tbl.indexOf(clean.charAt(i++));
        const enc2 = tbl.indexOf(clean.charAt(i++));
        const enc3 = tbl.indexOf(clean.charAt(i++));
        const enc4 = tbl.indexOf(clean.charAt(i++));
        if (enc1 < 0 || enc2 < 0) break;
        const chr1 = (enc1 << 2) | (enc2 >> 4);
        output += String.fromCharCode(chr1);
        if (enc3 >= 0 && enc3 !== 64) {
          const chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
          output += String.fromCharCode(chr2);
        }
        if (enc4 >= 0 && enc4 !== 64) {
          const chr3 = ((enc3 & 3) << 6) | enc4;
          output += String.fromCharCode(chr3);
        }
      }
      try { return decodeURIComponent(escape(output)).trim(); } catch { return output.trim(); }
    } catch { return ''; }
  };

  // 同步将日志输出到终端（Metro/Node/浏览器控制台）
  const appendStatus = (msg: string) => {
    try {
      // 统一加上前缀，便于在终端过滤
      console.log(`[EnvCheck] ${msg}`);
    } catch {}
    setStatus(prev => (msg + (prev ? '\n' + prev : '')));
  };

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

  const runChecks = async () => {
    // BLE availability check (best-effort)
    try {
      // Try dynamic require; on Web/native without module this throws
      const mod: any = require('react-native-ble-plx');
      setBleOk(!!(mod?.BleManager));
    } catch {
      setBleOk(false);
    }
    // Wi‑Fi / network check by probing Supabase (RLS-safe lightweight query)
    try {
      const { data, error } = await supabase.from('toys').select('id').limit(1);
      setWifiOk(!error);
    } catch {
      setWifiOk(false);
    }
    // JWT available
    try {
      const { data } = await supabase.auth.getSession();
      const ok = !!data.session?.access_token;
      setJwtOk(ok);
    } catch {
      setJwtOk(false);
    }
    try {
      const { data: u } = await supabase.auth.getUser();
      setSessionUserId((u?.user?.id as string | undefined) || '');
    } catch {
      setSessionUserId('');
    }
  };

  const refreshWebStorage = () => {
    if (Platform.OS !== 'web') { setStorageKeys([]); return; }
    try {
      const keys = Object.keys((window as any)?.localStorage || {})
        .filter((k) => k.startsWith('sb-') || k.includes('auth-token'))
        .sort();
      setStorageKeys(keys);
    } catch { setStorageKeys([]); }
  };

  const clearSbStorageAndReload = () => {
    if (Platform.OS !== 'web') return;
    try { 
      Object.keys((window as any)?.localStorage || {}).forEach((k) => { 
        if (k.startsWith('sb-') || k.includes('auth-token')) (window as any).localStorage.removeItem(k); 
      }); 
    } catch {}
    try { (globalThis as any).location?.reload?.(); } catch {}
  };

  useEffect(() => { runChecks(); refreshWebStorage(); }, []);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange(async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const ok = !!data.session?.access_token;
        setJwtOk(ok);
      } catch { setJwtOk(false); }
      try {
        const { data: u } = await supabase.auth.getUser();
        setSessionUserId((u?.user?.id as string | undefined) || '');
      } catch { setSessionUserId(''); }
      refreshWebStorage();
    });
    return () => { try { sub?.subscription?.unsubscribe(); } catch {} };
  }, []);

  // 预热依赖，避免在点击时首次动态加载引起的打包卡顿
  useEffect(() => {
    const prewarm = async () => {
      try {
        if (Platform.OS === 'android') {
          // 预先加载权限模块与定位模块（Android < 12 某些机型 BLE 通知依赖定位权限）
          try { await import('../../shims/permissions'); } catch {}
          try { await import('expo-location'); } catch {}
        }
        // 预先创建 BLE 管理实例，避免首次构造触发额外的打包/初始化开销
        try { if (!bleRef.current) bleRef.current = new BleManager(); } catch {}
        appendStatus('Step[Prewarm] modules ready');
      } catch (e:any) {
        appendStatus(`Step[Prewarm] failed: ${e?.message || e}`);
      }
    };
    prewarm();
  }, []);

  // Start BLE scan and show pinme-ESP32_XXXXXX only
  const startBleScan = async () => {
    // Web 端不支持 BLE，直接提示
    if (Platform.OS === 'web') {
      setSnackbarMsg('Web 端不支持 BLE 扫描，请使用 Dev Client 或真机。');
      setSnackbarVisible(true);
      return;
    }
    // Android 运行时权限校验：点击 Scan 时先弹系统权限框，拒绝则不开始扫描
    try {
      if (Platform.OS === 'android') {
        const { PERMISSIONS, RESULTS, check, request } = await import('../../shims/permissions');
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

    appendStatus('Step[BLE] start scan');
    try {
      if (!bleRef.current) bleRef.current = new BleManager();
      setBleItems([]);
      setBleScanning(true);
      setBlePickerVisible(true);
      bleRef.current.startDeviceScan(null, null, (error: any, device: any) => {
        if (error) {
          appendStatus(`Step[BLE] scan error: ${error?.message || error}`);
          setBleScanning(false);
          return;
        }
        const name: string = device?.name || '';
        const id: string = device?.id || device?.uuid || '';
        if (/^pinme-esp32_[0-9a-f]{6}$/i.test(name)) {
          setBleItems(prev => {
            const exists = prev.some(d => d.id === id);
            return exists ? prev : [{ id, name, rssi: device?.rssi ?? null }, ...prev];
          });
        }
      });
      // Auto stop after 10s
      setTimeout(() => { try { bleRef.current?.stopDeviceScan(); } catch {}; setBleScanning(false); appendStatus('Step[BLE] auto stop scan (10s)'); }, 10000);
    } catch (e: any) {
      appendStatus(`Step[BLE] failed to start scan: ${e?.message || e}`);
      setBleScanning(false);
    }
  };

  const onPickBleDevice = async (dev: { id: string; name: string }) => {
    setBlePickerVisible(false);
    appendStatus(`Step[BLE] pick ${dev.name || dev.id}`);
    try {
      if (!bleRef.current) bleRef.current = new BleManager();
      const d = await bleRef.current.connectToDevice(dev.id, { timeout: 10000 }).catch((e: any) => { throw e; });
      appendStatus('Step[BLE] connected');
      await d.discoverAllServicesAndCharacteristics();
      appendStatus('Step[BLE] discovered services');
      // Hold the connected device instance for subsequent Wi‑Fi scan/commands
      setConnectedDevice(d);
      const serviceUUID = '0000fff0-0000-1000-8000-00805f9b34fb';
      const idCharUUID3 = '0000fff3-0000-1000-8000-00805f9b34fb';
      const idCharUUID2 = '0000fff2-0000-1000-8000-00805f9b34fb';
      let ch: any = null;
      try { ch = await d.readCharacteristicForService(serviceUUID, idCharUUID3); }
      catch { ch = await d.readCharacteristicForService(serviceUUID, idCharUUID2); }
      const b64 = ch?.value || '';
      const val = b64DecodeUtf8(b64);
      if (!val) appendStatus(`Step[BLE] read ID b64(raw) = ${b64}`);
      const idText = (val && /ESP32_/i.test(val)) ? val : toDisplayIdFromNameOrId(dev.name, dev.id);
      setEsp32Id(idText);
      appendStatus(`Step[BLE] device ID = ${idText}`);
    } catch (e: any) {
      const idText = toDisplayIdFromNameOrId(dev.name, dev.id);
      setEsp32Id(idText);
      appendStatus(`Step[BLE] read ID failed, fallback ${idText}: ${e?.message || e}`);
    }
  };

  // Trigger device Wi‑Fi scan via BLE and receive WIFI_LIST (FFF2 notifications)
  const scanWifiListViaBle = async () => {
    appendStatus('Step[WiFiList] request');
    try {
      // Permissions pre-check to avoid immediate native errors on Android 12+
      if (Platform.OS === 'android') {
        try {
          const { PERMISSIONS, RESULTS, check, request } = await import('../../shims/permissions');
          const isAtLeast12 = (Platform.Version as any) >= 31;
          if (isAtLeast12) {
            const scanStatus = await check(PERMISSIONS.ANDROID.BLUETOOTH_SCAN);
            if (scanStatus !== RESULTS.GRANTED) {
              const r = await request(PERMISSIONS.ANDROID.BLUETOOTH_SCAN);
              if (r !== RESULTS.GRANTED) {
                appendStatus('Step[WiFiList] failed: Bluetooth scan permission denied');
                setSnackbarMsg('需要授予蓝牙扫描权限'); setSnackbarVisible(true);
                return;
              }
            }
            const connStatus = await check(PERMISSIONS.ANDROID.BLUETOOTH_CONNECT);
            if (connStatus !== RESULTS.GRANTED) {
              const r = await request(PERMISSIONS.ANDROID.BLUETOOTH_CONNECT);
              if (r !== RESULTS.GRANTED) {
                appendStatus('Step[WiFiList] failed: Bluetooth connect permission denied');
                setSnackbarMsg('需要授予蓝牙连接权限'); setSnackbarVisible(true);
                return;
              }
            }
            // Nearby Wi‑Fi Devices (Android 13+) is optional for BLE, but helpful for Wi‑Fi related operations
            const nearby = await check(PERMISSIONS.ANDROID.NEARBY_WIFI_DEVICES).catch(() => RESULTS.GRANTED as any);
            if (nearby !== RESULTS.GRANTED) { await request(PERMISSIONS.ANDROID.NEARBY_WIFI_DEVICES).catch(() => {}); }
          } else {
            // Android < 12: require Location for BLE scan/notifications on some devices
            try {
              const loc = await import('expo-location');
              const { status } = await loc.Location.requestForegroundPermissionsAsync();
              if (status !== 'granted') {
                appendStatus('Step[WiFiList] failed: location permission denied');
                setSnackbarMsg('需要授予定位权限用于 BLE'); setSnackbarVisible(true);
                return;
              }
            } catch (e:any) {
              appendStatus(`Step[WiFiList] location permission error: ${e?.message || e}`);
            }
          }
        } catch (e:any) {
          appendStatus(`Step[WiFiList] permission check error: ${e?.message || e}`);
        }
      }
      if (!connectedDevice) {
        appendStatus('Step[WiFiList] failed: no connected device (please Scan BLE and select a device first)');
        return;
      }
      setWifiItemsBle([]);
      setWifiBlePickerVisible(true);
      let gotItem = false;
      let gotNone = false;
      let ended = false;
      let retried = false; // ensure we only auto-rescan once when END arrives with no items
      const serviceUUID = '0000fff0-0000-1000-8000-00805f9b34fb';
      const writeCharUUID = '0000fff1-0000-1000-8000-00805f9b34fb';
      const echoCharUUID = '0000fff2-0000-1000-8000-00805f9b34fb';
      // Use the connected device instance for notifications
      const txId = Platform.OS === 'android' ? undefined : 'env-wifi-list';
      // Clear any previous watchdog and start a new one for this scan session
      try { if (wifiListWatchdogRef.current) { clearTimeout(wifiListWatchdogRef.current); wifiListWatchdogRef.current = null; } } catch {}
      // Watchdog only closes picker if没有任何条目且未结束，避免“刚超时立刻到条目”的场景导致弹窗关闭
      wifiListWatchdogRef.current = setTimeout(() => {
        if (!ended && !gotItem) {
          appendStatus('Step[WiFiList] timeout: device did not finish scan (no END) — maybe rebooted, keeping picker open');
          setSnackbarMsg('Wi‑Fi 扫描超时，但可能仍在返回结果，请稍后或重试');
          setSnackbarVisible(true);
          // 不再主动关闭弹窗，允许迟到的 WIFI_ITEM 展示
        }
      }, 15000);
      const sub = connectedDevice.monitorCharacteristicForService(serviceUUID, echoCharUUID, (error: any, characteristic: any) => {
        if (error) { appendStatus(`Step[WiFiList] notify error: ${error?.message || error}`); return; }
        const b64 = characteristic?.value || '';
        const msg = b64DecodeUtf8(b64);
        if (!msg) { appendStatus(`Step[WiFiList] raw base64: ${b64}`); return; }
        // Strictly suppress non-list status logs during Wi‑Fi listing; only log WIFI_LIST_* or WIFI_ITEM
        if (/^(WIFI_LIST_|WIFI_ITEM\s)/.test(msg)) {
          appendStatus(`Step[WiFiList] device: ${msg}`);
        }
        if (ended) { return; }
        // Parse WIFI_LIST
        if (msg === 'WIFI_LIST_BEGIN') { setWifiItemsBle([]); gotItem = false; gotNone = false; return; }
        if (msg === 'WIFI_LIST_NONE') { gotNone = true; return; }
        if (msg === 'WIFI_LIST_END') {
          // If no items found, auto-rescan once after ~1.5s; otherwise finish
          if (!gotItem && !retried) {
            ended = true; // pause processing until rescan
            retried = true;
            setTimeout(async () => {
              // Prepare for rescan
              ended = false; gotItem = false; gotNone = false; setWifiItemsBle([]);
              try {
                await connectedDevice.writeCharacteristicWithResponseForService(serviceUUID, writeCharUUID, b64Encode('WIFI_LIST'));
                appendStatus('Step[WiFiList] sent WIFI_LIST (auto-rescan)');
              } catch (e:any) {
                appendStatus(`Step[WiFiList] auto-rescan failed: ${e?.message || e}`);
                // Give up and close the picker on failure
                setWifiBlePickerVisible(false);
                try { if (Platform.OS !== 'android') (bleRef.current as any)?.cancelTransaction?.(txId as string); } catch {}
              }
            }, 1500);
            return;
          }
          ended = true;
          if (!gotItem) {
            setSnackbarMsg('未发现可用的 Wi‑Fi（可重试或检查权限/靠近路由器）');
            setSnackbarVisible(true);
            setWifiBlePickerVisible(false);
          }
          // Clear watchdog when END received
          try { if (wifiListWatchdogRef.current) { clearTimeout(wifiListWatchdogRef.current); wifiListWatchdogRef.current = null; } } catch {}
          try { if (Platform.OS !== 'android') (bleRef.current as any)?.cancelTransaction?.(txId as string); } catch {}
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
          return;
        }
      }, txId as any);
      await connectedDevice.writeCharacteristicWithResponseForService(serviceUUID, writeCharUUID, b64Encode('WIFI_LIST'));
      appendStatus('Step[WiFiList] sent WIFI_LIST');
      // auto unsubscribe after 12s
      setTimeout(() => {
        try { if (Platform.OS !== 'android') (bleRef.current as any)?.cancelTransaction?.(txId as string); } catch {}
        // also clear watchdog when we proactively stop listening to avoid leaking timers
        try { if (wifiListWatchdogRef.current) { clearTimeout(wifiListWatchdogRef.current); wifiListWatchdogRef.current = null; } } catch {}
      }, 12000);
    } catch (e: any) {
      appendStatus(`Step[WiFiList] failed: ${e?.message || e}`);
      setWifiBlePickerVisible(false);
      try { if (wifiListWatchdogRef.current) { clearTimeout(wifiListWatchdogRef.current); wifiListWatchdogRef.current = null; } } catch {}
    }
  };

  const connectWifiViaBle = async () => {
    const ssid = selectedWifi.trim();
    const password = wifiPassword.trim();
    if (!ssid) { appendStatus('Step[Provision] SSID required'); return; }
    setConnectBusy(true);
    appendStatus(`Step[Provision] send WIFI_SET for ${ssid}`);
    try {
      if (!connectedDevice) { appendStatus('Step[Provision] failed: no connected device (please Scan BLE and select a device first)'); setConnectBusy(false); return; }
      const serviceUUID = '0000fff0-0000-1000-8000-00805f9b34fb';
      const writeCharUUID = '0000fff1-0000-1000-8000-00805f9b34fb';
      const echoCharUUID = '0000fff2-0000-1000-8000-00805f9b34fb';
      const txId = Platform.OS === 'android' ? undefined : 'env-wifi-provision';
      const sub = connectedDevice.monitorCharacteristicForService(serviceUUID, echoCharUUID, (error: any, characteristic: any) => {
        if (error) { appendStatus(`Step[Provision] notify error: ${error?.message || error}`); return; }
        const b64 = characteristic?.value || '';
        const msg = b64DecodeUtf8(b64);
        if (!msg) { appendStatus(`Step[Provision] raw base64: ${b64}`); return; }
        appendStatus(`Step[Provision] device: ${msg}`);
        if (/WIFI_OK/i.test(msg) || /WIFI_STA_CONNECTED/i.test(msg)) {
          setConnectBusy(false);
          setSnackbarMsg('connect wifi success');
          setSnackbarVisible(true);
          appendStatus('connect wifi success');
          try { if (Platform.OS !== 'android') (bleRef.current as any)?.cancelTransaction?.(txId as string); } catch {}
        }
      }, txId as any);
      const wifiObj: any = { ssid, password };
      const wifiJson = JSON.stringify(wifiObj);
      const wifiCmd = `WIFI_SET ${wifiJson}`;
      await connectedDevice.writeCharacteristicWithResponseForService(serviceUUID, writeCharUUID, b64Encode(wifiCmd));
    } catch (e: any) {
      setConnectBusy(false);
      appendStatus(`Step[Provision] failed: ${e?.message || e}`);
    }
  };

  const isWeb = Platform.OS === 'web';

  return (
    <LinearGradient colors={cartoonGradient} style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          { padding: 16, paddingBottom: 40 },
          isWeb && { width: '100%', maxWidth: 1000, alignSelf: 'center', paddingHorizontal: 32 }
        ]}
      >
        <View />
      </ScrollView>
    </LinearGradient>
  );
}
