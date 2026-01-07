import React, { useEffect, useRef, useState } from 'react';
import { View, Platform, ScrollView } from 'react-native';
import { useTheme, Button, Card, Text, TextInput, Portal, Dialog, List, Snackbar, Banner, Switch, Appbar } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { supabase } from '../../supabaseClient';
import { LinearGradient } from 'expo-linear-gradient';
import { cartoonGradient } from '../../theme/tokens';
import { BleManager } from '../../shims/ble';
import EnvDiagnosticsBanner from '../../components/EnvDiagnosticsBanner';
import { getLogs, clearLogs, pushLog } from '../../utils/envDiagnostics';
import { buildGetPowerCmd, buildSetPowerCmd, buildGetVersionCmd } from '../../utils/rfidCommands';

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
  const bleMonitorSub = useRef<any>(null);
  const [bleScanning, setBleScanning] = useState(false);
  const [blePickerVisible, setBlePickerVisible] = useState(false);
  const [bleItems, setBleItems] = useState<Array<{ id: string; name: string; rssi?: number | null }>>([]);
  const [esp32Id, setEsp32Id] = useState<string>('');
  const [connectedDevice, setConnectedDevice] = useState<any>(null);

  // Device HTTP Debug (UART)
  const [uartResult, setUartResult] = useState<string>('Pending');
  const [uartDebug, setUartDebug] = useState<string>('');
  const [dbLoading, setDbLoading] = useState(false);
  const [deviceIp, setDeviceIp] = useState<string>('');
  const [cmdLoading, setCmdLoading] = useState(false);

  // RFID Data Access State
  const [rfidAp, setRfidAp] = useState('00000000');
  const [rfidMb, setRfidMb] = useState('3'); // User bank default
  const [rfidSa, setRfidSa] = useState('0');
  const [rfidDl, setRfidDl] = useState('2'); // 2 words = 4 bytes
  const [rfidWriteData, setRfidWriteData] = useState('11223344');
  
  // Initialization Process State
  const [initFreq, setInitFreq] = useState('920.375');
  const [initRunning, setInitRunning] = useState(false);

  // Listen for Realtime updates from Supabase
  useEffect(() => {
    // We don't have the device ID from context easily unless we parse it or use auth user's device
    // But this screen seems to be for generic environment check.
    // Assuming the user has selected a device or we just provisioned one.
    // If we just provisioned, we might not have the ID stored in a convenient way for subscription 
    // without querying the DB first or parsing from BLE.
    
    // However, if we are in this screen, we might be checking a specific device.
    // For now, let's just listen to the `devices` table if we can identify the device.
    // Since this is a debug screen often used right after provisioning, we might rely on `connectedDevice` name.
    
    let channel: any = null;
    
    const setupRealtime = async () => {
         // If we have a connected BLE device, we can try to derive ID from its name "PINME-XXXXXX"
         // But if BLE is disconnected (as per requirement), we need another way.
         // Maybe we can list user's devices and pick the latest one?
         // Or just listen to ALL devices for this user (if RLS allows).
         
         // Listen to `testuart` table (INSERT and UPDATE)
    // - INSERT: When we (App) create the pending command.
    // - UPDATE: When the ESP32 processes it and writes the result.
    channel = supabase
      .channel('public:testuart')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'testuart' },
        (payload) => {
          const newData = payload.new;
          if (newData && newData.uart_result) {
             if (esp32Id && newData.device_id && newData.device_id !== esp32Id) return;
             // Only update UI if it's relevant (e.g. not 'PENDING' anymore, or if it is our just-inserted pending)
             // But actually showing 'PENDING' is fine too.
             setUartResult(newData.uart_result);
             setUartDebug(`[Realtime ${payload.eventType} id=${newData.id}] ${new Date().toLocaleTimeString()}\n${newData.uart_debug || ''}`);
          }
        }
      )
      .subscribe();
     };

    setupRealtime();

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    // Try to get IP from devices table if we have a hint
    const fetchIp = async () => {
      // Just get the most recently active device
      try {
        const { data } = await supabase.from('devices').select('ip').order('last_seen', { ascending: false }).limit(1);
        if (data && data.length > 0 && data[0].ip) {
          setDeviceIp(data[0].ip);
          appendStatus(`Target Device IP: ${data[0].ip}`);
        }
      } catch {}
    };
    fetchIp();
  }, []);

  const sendRfidRequest = async (path: string) => {
    setCmdLoading(true);
    const candidates = [];
    if (deviceIp) candidates.push(`http://${deviceIp}`);
    candidates.push('http://esp32.local');
    candidates.push('http://192.168.4.1');

    let success = false;
    for (const base of candidates) {
      try {
        appendStatus(`Sending ${path} to ${base}...`);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        
        const res = await fetch(`${base}${path}`, {
          method: 'GET',
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (res.ok) {
           const text = await res.text();
           setUartResult(text);
           setUartDebug(`[HTTP] ${new Date().toLocaleTimeString()}\n${text}`);
           appendStatus(`Success: ${text}`);
           success = true;
           break;
        }
      } catch (e: any) {
        // ignore
      }
    }
    if (!success) appendStatus('Request failed on all IPs.');
    setCmdLoading(false);
  };

  const sendHttpCommand = async (hex: string) => {
    setCmdLoading(true);
    const candidates = [];
    if (deviceIp) candidates.push(`http://${deviceIp}`);
    candidates.push('http://esp32.local');
    candidates.push('http://192.168.4.1');

    let success = false;
    for (const base of candidates) {
      try {
        appendStatus(`Sending cmd to ${base}...`);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        
        const res = await fetch(`${base}/cmd`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hex }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (res.ok) {
           const json = await res.json();
           setUartResult(json.result);
           setUartDebug(json.debug);
           appendStatus(`Cmd success via ${base}`);
           success = true;
           break;
        }
      } catch (e: any) {
        // appendStatus(`Failed ${base}: ${e.message}`);
      }
    }
    if (!success) appendStatus('Cmd failed on all IPs. Ensure device is on same Wi-Fi.');
    setCmdLoading(false);
  };

  const fetchDeviceDebug = async () => {
      // Manual fetch from DB as fallback (Get latest from testuart for this device)
      setDbLoading(true);
      try {
        // Prefer filtering by device_id if we have it, and order by id desc to avoid relying on created_at
        if (esp32Id) {
          const { data, error } = await supabase
            .from('testuart')
            .select('id, uart_result, uart_debug, created_at')
            .eq('device_id', esp32Id)
            .order('id', { ascending: false })
            .limit(1);
          if (error) throw error;
          if (data && data.length > 0) {
            setUartResult(data[0].uart_result);
            setUartDebug(`[DB Fetch id=${data[0].id}] ${new Date(data[0].created_at).toLocaleTimeString()}\n${data[0].uart_debug || ''}`);
          }
        } else {
          // Fallback: latest across all devices
          const { data, error } = await supabase
            .from('testuart')
            .select('id, uart_result, uart_debug, created_at')
            .order('id', { ascending: false })
            .limit(1);
          if (error) throw error;
          if (data && data.length > 0) {
            setUartResult(data[0].uart_result);
            setUartDebug(`[DB Fetch id=${data[0].id}] ${new Date(data[0].created_at).toLocaleTimeString()}\n${data[0].uart_debug || ''}`);
          }
        }
      } catch (e: any) {
        appendStatus(`Fetch Error: ${e.message}`);
      }
      setDbLoading(false);
  };


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
    try { pushLog(`EnvCheck: ${msg}`); } catch {}
    setStatus(prev => (msg + (prev ? '\n' + prev : '')));
  };

  const startBleMonitor = async (device: any) => {
    if (bleMonitorSub.current) return;
    const serviceUUID = '0000fff0-0000-1000-8000-00805f9b34fb';
    const echoCharUUID = '0000fff2-0000-1000-8000-00805f9b34fb';
    
    try {
      bleMonitorSub.current = device.monitorCharacteristicForService(serviceUUID, echoCharUUID, (error: any, characteristic: any) => {
         if (error) return;
         const b64 = characteristic?.value || '';
         const msg = b64DecodeUtf8(b64);
         
         if (msg && msg.startsWith('UART:')) {
            const val = msg.substring(5);
            setUartResult(val);
            setUartDebug(`[BLE Live] ${new Date().toLocaleTimeString()}\n${val}`);
         }
      });
      appendStatus('BLE Monitor started');
    } catch (e: any) {
      appendStatus(`BLE Monitor failed: ${e.message}`);
    }
  };

  const sendBleCmd = async (cmd: string) => {
    if (!connectedDevice) return;
    const serviceUUID = '0000fff0-0000-1000-8000-00805f9b34fb';
    const writeCharUUID = '0000fff1-0000-1000-8000-00805f9b34fb';
    try {
      appendStatus(`[BLE Cmd] Sending: ${cmd}`);
      await connectedDevice.writeCharacteristicWithResponseForService(serviceUUID, writeCharUUID, b64Encode(cmd));
    } catch (e: any) {
      appendStatus(`[BLE Cmd] Error: ${e.message}`);
    }
  };

  const handleRfidAction = async (httpPath: string, bleCmd: string) => {
    if (cmdLoading) return; // Prevent double click
    setCmdLoading(true);
      setUartResult('Sending command...');
      setUartDebug(`[${new Date().toLocaleTimeString()}] Queuing ${bleCmd}...`);
      
      let timer: NodeJS.Timeout | null = null;
      try {
      // Safety timeout (15 seconds)
      const timeoutPromise = new Promise((_, reject) => {
         timer = setTimeout(() => reject(new Error("Request timed out (15s)")), 15000);
      });

      // Check Auth Session first
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
         throw new Error("No active session. Please log in.");
      }
      const userId = sessionData.session.user.id;
      appendStatus(`User ID: ${userId}`);

      // Determine target device ID
      let targetId = esp32Id;
      
      if (!targetId) {
         // Try to fetch the most recent device
         const { data, error } = await Promise.race([
            supabase
            .from('devices')
            .select('device_id')
            .order('last_seen', { ascending: false })
            .limit(1),
            timeoutPromise
         ]) as any;
         
         if (data && data.length > 0) {
             targetId = data[0].device_id;
             setEsp32Id(targetId);
             appendStatus(`Targeting Device: ${targetId}`);
         } else {
             throw new Error("No target device found. Please connect BLE or ensure a device is registered.");
         }
      }

      appendStatus(`Sending via Supabase: ${bleCmd} to ${targetId}`);
      console.log(`[handleRfidAction] Inserting cmd='${bleCmd}' for device='${targetId}'`);
      
      // Insert command into testuart (as requested)
      const insertPromise = supabase.from('testuart').insert({
          device_id: targetId,
          uart_debug: bleCmd,
          uart_result: 'PENDING'
      }).select(); // Use select() to get the inserted row back

      const { data, error } = await Promise.race([insertPromise, timeoutPromise]) as any;
      
      if (error) {
        console.error('[handleRfidAction] Insert error:', error);
        const errStr = JSON.stringify(error);
        // Show explicit error in UI
        setUartResult(`Insert Failed: ${error.message || errStr}`);
        appendStatus(`Insert Failed: ${errStr}`);
        throw error;
      }
      
      if (data && data.length > 0) {
         const rowId = data[0].id;
         appendStatus(`Command queued (ID: ${rowId}). Waiting for response...`);
         setUartDebug(`[${new Date().toLocaleTimeString()}] Cmd ID: ${rowId} (PENDING)`);
      } else {
         appendStatus("Command queued (No ID returned). Check RLS policies.");
      }
      
    } catch (e: any) {
      console.error('[handleRfidAction] Exception:', e);
      appendStatus(`Cmd Error: ${e.message}`);
      setUartResult(`Error: ${e.message}`);
    } finally {
      if (timer) clearTimeout(timer);
      setCmdLoading(false);
    }
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



  const clearPendingCommands = async () => {
    let targetId = esp32Id;
    setCmdLoading(true);
    try {
        if (!targetId) {
            appendStatus("Auto-detecting device ID...");
            const { data } = await supabase
                .from('devices')
                .select('device_id')
                .order('last_seen', { ascending: false })
                .limit(1);
            if (data && data.length > 0) {
                targetId = data[0].device_id;
                setEsp32Id(targetId);
                appendStatus(`Targeting: ${targetId}`);
            }
        }

        if (!targetId) {
            appendStatus("No Device ID found. Please connect BLE or wait for device heartbeat.");
            setCmdLoading(false);
            return;
        }

        // Step 1: Check if we can see the pending commands
        appendStatus(`Checking pending queue for ${targetId}...`);
        const { data: pendingRows, error: fetchError } = await supabase
            .from('testuart')
            .select('id, uart_result')
            .eq('device_id', targetId)
            .eq('uart_result', 'PENDING');
            
        if (fetchError) throw fetchError;
        
        const countFound = pendingRows?.length || 0;
        appendStatus(`Found ${countFound} pending commands.`);

        if (countFound === 0) {
            setCmdLoading(false);
            return;
        }

        // Step 2: Update by ID list to ensure we target exactly what we found
        const ids = pendingRows.map(r => r.id);
        
        // Try DELETE first (Since UPDATE failed with 0)
        const { error: deleteError, count: deleteCount } = await supabase
            .from('testuart')
            .delete({ count: 'exact' })
            .in('id', ids);

        if (!deleteError) {
             appendStatus(`Success: Deleted ${deleteCount} commands.`);
             setUartResult('Queue Deleted');
             return;
        }

        // Fallback to UPDATE if DELETE fails (though unlikely if UPDATE failed too)
        appendStatus(`Delete failed (${deleteError.message}), trying Update...`);
        const { error: updateError, data: updatedData } = await supabase
            .from('testuart')
            .update({ uart_result: 'Skipped (User Request)' })
            .in('id', ids)
            .select();

        if (updateError) throw updateError;
        
        const countUpdated = updatedData?.length || 0;
        appendStatus(`Success: Cleared ${countUpdated} commands.`);
        setUartResult('Queue Cleared');
        
    } catch (e: any) {
        appendStatus(`Clear Failed: ${e.message}`);
    } finally {
        setCmdLoading(false);
    }
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

  // Helper to check and enable Bluetooth state safely
  const ensureBleState = async (): Promise<boolean> => {
    try {
      if (!bleRef.current) bleRef.current = new BleManager();
      const state = await bleRef.current.state();
      if (state === 'PoweredOn') return true;
      
      if (state === 'PoweredOff' && Platform.OS === 'android') {
        appendStatus('Step[BLE] enabling Bluetooth...');
        await bleRef.current.enable();
        // Wait a moment for state to change
        await new Promise(r => setTimeout(r, 1000));
        const newState = await bleRef.current.state();
        return newState === 'PoweredOn';
      }
      return false;
    } catch (e: any) {
      appendStatus(`Step[BLE] check state failed: ${e?.message || e}`);
      return false;
    }
  };

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
      
      const ready = await ensureBleState();
      if (!ready) {
        setSnackbarMsg('蓝牙未开启或不可用');
        setSnackbarVisible(true);
        appendStatus('Step[BLE] not ready (PoweredOff or unauthorized)');
        return;
      }

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
      
      const ready = await ensureBleState();
      if (!ready) {
         appendStatus('Step[BLE] connect aborted: Bluetooth off');
         return;
      }

      const d = await bleRef.current.connectToDevice(dev.id, { timeout: 10000 }).catch((e: any) => { throw e; });
      appendStatus('Step[BLE] connected');
      await d.discoverAllServicesAndCharacteristics();
      appendStatus('Step[BLE] discovered services');
      // Hold the connected device instance for subsequent Wi‑Fi scan/commands
      setConnectedDevice(d);
      startBleMonitor(d);
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

  const disconnectBle = async () => {
    if (connectedDevice) {
      if (bleMonitorSub.current) {
        bleMonitorSub.current.remove();
        bleMonitorSub.current = null;
      }
      try { await connectedDevice.cancelConnection(); } catch {}
      setConnectedDevice(null);
      appendStatus('BLE Disconnected per requirement');
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
      
      // Send one-time PING to ensure notifications are flowing if idle
      try {
        await connectedDevice.writeCharacteristicWithResponseForService(serviceUUID, writeCharUUID, b64Encode('PING'));
      } catch {}

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
        
        // UART Live Data
        if (msg.startsWith('UART:')) {
           const val = msg.substring(5);
           setUartResult(val);
           setUartDebug(`[BLE Live] Received at ${new Date().toLocaleTimeString()}\n${val}`);
           return;
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

        // UART Live Data
        if (msg.startsWith('UART:')) {
           const val = msg.substring(5);
           setUartResult(val);
           setUartDebug(`[BLE Live] Received at ${new Date().toLocaleTimeString()}\n${val}`);
           return;
        }

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
  const [autoRefresh, setAutoRefresh] = useState(false);

  // Auto-refresh timer for DB poll (if Realtime fails or for initial sync)
  useEffect(() => {
    let interval: any;
    if (autoRefresh) {
      interval = setInterval(fetchDeviceDebug, 3000);
    }
    return () => clearInterval(interval);
  }, [autoRefresh]);

  const runInit = async () => {
    if (initRunning || cmdLoading) return;
    setInitRunning(true);
    try {
        appendStatus('--- Starting Initialization ---');
        
        // 1. Region China (01)
        appendStatus('1. Setting Region: China (01)...');
        await handleRfidAction('/rfid_region_set?region=1', 'RFID_REGION_SET 1');
        await new Promise(r => setTimeout(r, 2000));

        // 2. Power 15dBm
        appendStatus('2. Setting Power: 26dBm...');
        await handleRfidAction('/rfid_set_power?dbm=26', 'RFID_POWER_SET 26');
        await new Promise(r => setTimeout(r, 2000));

        // 3. Channel
        const f = parseFloat(initFreq);
        if (isNaN(f)) throw new Error("Invalid Frequency");
        // Formula: Index = (Freq_CH - 920.125M) / 0.25M
        const idx = Math.round((f - 920.125) / 0.25);
        if (idx < 0 || idx > 19) { // China 920.125-924.875MHz approx 20 channels
           appendStatus(`Warning: Calculated Channel Index ${idx} might be out of range.`);
        }
        appendStatus(`3. Setting Channel: ${f}MHz (Index ${idx})...`);
        await handleRfidAction(`/rfid_channel_set?ch=${idx}`, `RFID_CHANNEL_SET ${idx}`);
        await new Promise(r => setTimeout(r, 2000));

        // 4. Query Params (Using Recommended Raw Hex)
        // Default: S1, Q=4 -> 0x1104
        const qRaw = "1104";
        appendStatus(`4. Setting Query Params: 0x${qRaw} (S1, Q=4)...`);
        await handleRfidAction(`/rfid_query_set_raw?val=${qRaw}`, `RFID_QUERY_SET_RAW ${qRaw}`);
        await new Promise(r => setTimeout(r, 2000));

        // 5. Single Poll
        appendStatus('5. Performing Single Poll...');
        await handleRfidAction('/rfid_poll_single', 'RFID_POLL_SINGLE');
        
        appendStatus('--- Initialization Complete ---');
        setSnackbarMsg('Initialization Complete');
        setSnackbarVisible(true);
    } catch (e: any) {
        appendStatus(`Init Failed: ${e.message}`);
    } finally {
        setInitRunning(false);
    }
  };

  const renderLogSection = () => null; // Deprecated, using unified log card

  return (
    <LinearGradient colors={cartoonGradient} style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          { padding: 16, paddingBottom: 40 },
          isWeb && { width: '100%', maxWidth: 1000, alignSelf: 'center', paddingHorizontal: 32 }
        ]}
      >
        <EnvDiagnosticsBanner 
          bleOk={bleOk} 
          wifiOk={wifiOk} 
          jwtOk={jwtOk} 
          onRetry={runChecks} 
        />

        {/* Unified Device Log Card */}
        <Card style={{ borderRadius: 20, backgroundColor: theme.colors.surface, marginTop: 16, marginBottom: 8, borderColor: theme.colors.primary, borderWidth: 1 }}>
          <Card.Title 
            title="Device Monitor" 
            subtitle="Real-time Command Responses"
            left={(props) => <MaterialCommunityIcons {...props} name="monitor-dashboard" color={theme.colors.primary} />} 
            right={(props) => (
              <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 16 }}>
                 <Switch value={autoRefresh} onValueChange={setAutoRefresh} />
                 <Text style={{ marginLeft: 8, fontSize: 12, color: theme.colors.outline }}>Auto-Sync</Text>
              </View>
            )}
          />
          <Card.Content>
             <View style={{ backgroundColor: theme.colors.elevation.level1, borderRadius: 8, padding: 12 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                  <Text variant="labelSmall" style={{color: theme.colors.outline}}>Status:</Text>
                  <Text variant="labelSmall" style={{color: theme.colors.outline}}>
                    {uartDebug ? uartDebug.split('\n')[0] : ''}
                  </Text>
                </View>
                <Text variant="bodyLarge" style={{ fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontWeight: 'bold', color: theme.colors.primary }}>
                  {uartResult || 'No data yet'}
                </Text>
                {uartDebug && uartDebug.includes('\n') && (
                  <Text variant="bodySmall" numberOfLines={4} style={{ fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', color: theme.colors.secondary, marginTop: 4 }}>
                    {uartDebug.split('\n').slice(1).join('\n')}
                  </Text>
                )}
             </View>
             <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8, flexWrap: 'wrap', gap: 8 }}>
                {connectedDevice && (
                  <Button mode="text" compact onPress={disconnectBle}>
                    Disconnect BLE
                  </Button>
                )}
                <Button mode="contained" compact buttonColor={theme.colors.error} onPress={clearPendingCommands} loading={cmdLoading}>
                  Clear Queue
                </Button>
                <Button mode="outlined" compact onPress={fetchDeviceDebug} loading={dbLoading} icon="refresh">
                  Fetch Latest
                </Button>
             </View>
          </Card.Content>
        </Card>

        {/* Initialization Process Card */}
        <Card style={{ borderRadius: 20, backgroundColor: theme.colors.surface, marginTop: 16 }}>
          <Card.Title title="Initialization Process" titleStyle={{ fontFamily: headerFont }} left={(props) => <MaterialCommunityIcons {...props} name="play-box-outline" />} />
          <Card.Content>
              <View style={{ gap: 8 }}>
                <Text variant="bodyMedium">1. Region: <Text style={{fontWeight: 'bold'}}>China (01)</Text></Text>
                <Text variant="bodyMedium">2. Power: <Text style={{fontWeight: 'bold'}}>15 dBm</Text></Text>
                
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                   <Text variant="bodyMedium">3. Freq (MHz):</Text>
                   <TextInput 
                      mode="outlined" 
                      value={initFreq} 
                      onChangeText={setInitFreq} 
                      style={{ flex: 1, backgroundColor: theme.colors.background, height: 40 }}
                      dense
                      keyboardType="numeric"
                   />
                   <Button mode="contained" compact onPress={async () => {
                        try {
                            const f = parseFloat(initFreq);
                            if (isNaN(f)) { appendStatus("Invalid Freq"); return; }
                            const idx = Math.round((f - 920.125) / 0.25);
                            appendStatus(`Setting Channel: ${f}MHz (Index ${idx})...`);
                            await handleRfidAction(`/rfid_channel_set?ch=${idx}`, `RFID_CHANNEL_SET ${idx}`);
                        } catch(e:any) {
                            appendStatus(`Error: ${e.message}`);
                        }
                   }}>Set</Button>
                </View>
                <Text variant="labelSmall" style={{ color: theme.colors.outline }}>
                   Formula: Index = (Freq - 920.125) / 0.25
                </Text>

                <Text variant="bodyMedium">4. Query: <Text style={{fontWeight: 'bold'}}>0x1104 (S1, Q=4)</Text></Text>
                <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>
                    <Button mode="outlined" compact onPress={() => handleRfidAction('/rfid_query_set_raw?val=1104', 'RFID_QUERY_SET_RAW 1104')}>
                        Set S1, Q=4 (Rec)
                    </Button>
                    <Button mode="outlined" compact onPress={() => handleRfidAction('/rfid_query_set_raw?val=1106', 'RFID_QUERY_SET_RAW 1106')}>
                        Set S1, Q=6
                    </Button>
                    <Button mode="outlined" compact onPress={() => handleRfidAction('/rfid_query_set_raw?val=1304', 'RFID_QUERY_SET_RAW 1304')}>
                        Set S3, Q=4
                    </Button>
                </View>

                <Text variant="bodyMedium">5. Freq Hopping: <Text style={{fontWeight: 'bold'}}>Auto</Text></Text>
                <Button mode="outlined" compact onPress={() => handleRfidAction('/rfid_fh_set?mode=255', 'RFID_FH_SET 255')}>
                    Enable Auto Freq Hopping
                </Button>
                
                <Text variant="bodyMedium">6. Action: <Text style={{fontWeight: 'bold'}}>Single Poll (Smart)</Text></Text>

                <Button 
                    mode="contained" 
                    onPress={() => handleRfidAction('/rfid_poll_retry_smart', 'RFID_POLL_RETRY_SMART')} 
                    loading={initRunning || cmdLoading} 
                    icon="radar"
                    style={{ marginTop: 8 }}
                >
                    Smart Poll (Retry Logic)
                </Button>
                
                <Button 
                    mode="outlined" 
                    onPress={runInit} 
                    loading={initRunning || cmdLoading} 
                    icon="play"
                    style={{ marginTop: 8 }}
                >
                    Run Full Init Sequence
                </Button>
              </View>
          </Card.Content>
        </Card>

        <Card style={{ borderRadius: 20, backgroundColor: theme.colors.surface, marginTop: 16 }}>
          <Card.Title title="Power Control (Test)" titleStyle={{ fontFamily: headerFont }} left={(props) => <MaterialCommunityIcons {...props} name="lightning-bolt" />} />
          <Card.Content>
             <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>
               <Button mode="contained" onPress={() => handleRfidAction('/rfid_get_power', 'RFID_POWER_GET')} loading={cmdLoading} compact>
                 Query Power
               </Button>
               <Button mode="outlined" onPress={() => handleRfidAction('/rfid_set_power?dbm=5', 'RFID_POWER_SET 5')} loading={cmdLoading} compact>
                 Set 5dBm
               </Button>
               <Button mode="outlined" onPress={() => handleRfidAction('/rfid_set_power?dbm=10', 'RFID_POWER_SET 10')} loading={cmdLoading} compact>
                 Set 10dBm
               </Button>
               <Button mode="outlined" onPress={() => handleRfidAction('/rfid_set_power?dbm=15', 'RFID_POWER_SET 15')} loading={cmdLoading} compact>
                 Set 15dBm
               </Button>
               <Button mode="outlined" onPress={() => handleRfidAction('/rfid_set_power?dbm=20', 'RFID_POWER_SET 20')} loading={cmdLoading} compact>
                 Set 20dBm
               </Button>
             </View>
             <Text variant="bodySmall" style={{marginTop: 8, color: theme.colors.outline}}>
               Sends HTTP GET to Device IP or BLE Command if connected.
             </Text>
          </Card.Content>
        </Card>

        <Card style={{ borderRadius: 20, backgroundColor: theme.colors.surface, marginTop: 16 }}>
          <Card.Title title="RFID Data Access" titleStyle={{ fontFamily: headerFont }} left={(props) => <MaterialCommunityIcons {...props} name="database-edit" />} />
          <Card.Content>
             <View style={{ gap: 12 }}>
               <View style={{ flexDirection: 'row', gap: 8 }}>
                 <TextInput
                   mode="outlined"
                   label="Access Pwd (Hex)"
                   value={rfidAp}
                   onChangeText={setRfidAp}
                   style={{ flex: 1, backgroundColor: theme.colors.background }}
                   dense
                 />
                 <TextInput
                   mode="outlined"
                   label="Mem Bank (0-3)"
                   value={rfidMb}
                   onChangeText={setRfidMb}
                   keyboardType="numeric"
                   style={{ flex: 1, backgroundColor: theme.colors.background }}
                   dense
                 />
               </View>
               <View style={{ flexDirection: 'row', gap: 8 }}>
                 <TextInput
                   mode="outlined"
                   label="Start Addr"
                   value={rfidSa}
                   onChangeText={setRfidSa}
                   keyboardType="numeric"
                   style={{ flex: 1, backgroundColor: theme.colors.background }}
                   dense
                 />
                 <TextInput
                   mode="outlined"
                   label="Len (Words)"
                   value={rfidDl}
                   onChangeText={setRfidDl}
                   keyboardType="numeric"
                   style={{ flex: 1, backgroundColor: theme.colors.background }}
                   dense
                 />
               </View>
               
               <Button 
                mode="contained" 
                onPress={() => handleRfidAction(`/rfid_read_data?ap=${rfidAp}&mb=${rfidMb}&sa=${rfidSa}&dl=${rfidDl}`, `RFID_READ_DATA ${rfidAp} ${rfidMb} ${rfidSa} ${rfidDl}`)} 
                loading={cmdLoading}
              >
                Read Data
              </Button>
              
              <View style={{ height: 1, backgroundColor: theme.colors.outlineVariant }} />
              
              <TextInput
                mode="outlined"
                label="Write Data (Hex)"
                value={rfidWriteData}
                onChangeText={setRfidWriteData}
                style={{ backgroundColor: theme.colors.background }}
                dense
              />
              
              <Button 
                mode="contained" 
                buttonColor={theme.colors.error}
                onPress={() => handleRfidAction(`/rfid_write_data?ap=${rfidAp}&mb=${rfidMb}&sa=${rfidSa}&dl=${rfidDl}&data=${rfidWriteData}`, `RFID_WRITE_DATA ${rfidAp} ${rfidMb} ${rfidSa} ${rfidDl} ${rfidWriteData}`)} 
                loading={cmdLoading}
              >
                Write Data
              </Button>
             </View>
             <Text variant="bodySmall" style={{marginTop: 8, color: theme.colors.outline}}>
               MB: 0=Reserved, 1=EPC, 2=TID, 3=User. Len is in 16-bit words.
             </Text>
          </Card.Content>
        </Card>

        <Card style={{ borderRadius: 20, backgroundColor: theme.colors.surface, marginTop: 16 }}>
          <Card.Title title="RFID Poll Test" titleStyle={{ fontFamily: headerFont }} left={(props) => <MaterialCommunityIcons {...props} name="access-point-network" />} />
          <Card.Content>
             <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>
               <Button mode="contained" onPress={() => handleRfidAction('/rfid_single_poll', 'RFID_POLL_SINGLE')} loading={cmdLoading} compact>
                 Single Poll
               </Button>
               <Button mode="outlined" onPress={() => handleRfidAction('/rfid_multi_poll?count=100', 'RFID_POLL_MULTI 100')} loading={cmdLoading} compact>
                 Multi Poll (100)
               </Button>
               <Button mode="outlined" onPress={() => handleRfidAction('/rfid_stop_poll', 'RFID_POLL_STOP')} loading={cmdLoading} compact>
                 Stop Poll
               </Button>
             </View>
             <Text variant="bodySmall" style={{marginTop: 8, color: theme.colors.outline}}>
               Tests Inventory Commands. Check logs for Tag EPC/RSSI.
             </Text>
          </Card.Content>
        </Card>

        <Card style={{ borderRadius: 20, backgroundColor: theme.colors.surface, marginTop: 16 }}>
          <Card.Title title="RFID Select Config" titleStyle={{ fontFamily: headerFont }} left={(props) => <MaterialCommunityIcons {...props} name="filter-variant" />} />
          <Card.Content>
             <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>
               <Button mode="outlined" onPress={() => handleRfidAction('/rfid_set_select_default', 'RFID_SELECT_SET_DEFAULT')} loading={cmdLoading} compact>
                 Set Mask (Default)
               </Button>
               <Button mode="outlined" onPress={() => handleRfidAction('/rfid_get_select', 'RFID_SELECT_GET')} loading={cmdLoading} compact>
                 Get Mask
               </Button>
               <View style={{width: '100%', height: 1, backgroundColor: theme.colors.outlineVariant, marginVertical: 4}} />
               <Button mode="outlined" onPress={() => handleRfidAction('/rfid_set_select_mode?mode=1', 'RFID_SELECT_MODE 1')} loading={cmdLoading} compact>
                 Mode 1 (No Sel)
               </Button>
               <Button mode="outlined" onPress={() => handleRfidAction('/rfid_set_select_mode?mode=0', 'RFID_SELECT_MODE 0')} loading={cmdLoading} compact>
                 Mode 0 (Always)
               </Button>
               <Button mode="outlined" onPress={() => handleRfidAction('/rfid_set_select_mode?mode=2', 'RFID_SELECT_MODE 2')} loading={cmdLoading} compact>
                 Mode 2 (No Inv)
               </Button>
             </View>
             <Text variant="bodySmall" style={{marginTop: 8, color: theme.colors.outline}}>
               Configure Select Mask/Mode for filtering tags.
             </Text>
          </Card.Content>
        </Card>

        <Card style={{ borderRadius: 20, backgroundColor: theme.colors.surface, marginTop: 16 }}>
          <Card.Title title="Region & Channel Config" titleStyle={{ fontFamily: headerFont }} left={(props) => <MaterialCommunityIcons {...props} name="earth" />} />
          <Card.Content>
             <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>
               <Button mode="outlined" onPress={() => handleRfidAction('/rfid_get_region', 'RFID_REGION_GET')} loading={cmdLoading} compact>
                 Get Region
               </Button>
               <Button mode="outlined" onPress={() => handleRfidAction('/rfid_set_region?region=1', 'RFID_REGION_SET 1')} loading={cmdLoading} compact>
                 Set CN 900
               </Button>
               <Button mode="outlined" onPress={() => handleRfidAction('/rfid_set_region?region=2', 'RFID_REGION_SET 2')} loading={cmdLoading} compact>
                 Set US
               </Button>
               <Button mode="outlined" onPress={() => handleRfidAction('/rfid_set_region?region=3', 'RFID_REGION_SET 3')} loading={cmdLoading} compact>
                 Set EU
               </Button>
               
               <View style={{width: '100%', height: 1, backgroundColor: theme.colors.outlineVariant, marginVertical: 4}} />
               
               <Button mode="outlined" onPress={() => handleRfidAction('/rfid_get_channel', 'RFID_CHANNEL_GET')} loading={cmdLoading} compact>
                 Get Channel
               </Button>
               <Button mode="outlined" onPress={() => handleRfidAction('/rfid_set_channel?ch=1', 'RFID_CHANNEL_SET 1')} loading={cmdLoading} compact>
                 Set CH 1
               </Button>
               <Button mode="outlined" onPress={() => handleRfidAction('/rfid_set_channel?ch=5', 'RFID_CHANNEL_SET 5')} loading={cmdLoading} compact>
                 Set CH 5
               </Button>
             </View>
          </Card.Content>
        </Card>

        {/* Restore Peripheral Debug (UART) Card */}
        <Card style={{ borderRadius: 20, backgroundColor: theme.colors.surface, marginTop: 16, marginBottom: 32 }}>
          <Card.Title title="Peripheral Debug (UART)" titleStyle={{ fontFamily: headerFont }} left={(props) => <MaterialCommunityIcons {...props} name="chip" />} />
          <Card.Content>
             <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                    <Switch value={autoRefresh} onValueChange={setAutoRefresh} />
                    <Text style={{ marginLeft: 8 }}>Auto Refresh (3s)</Text>
                  </View>
                </View>
                <Button mode="contained" compact onPress={() => handleRfidAction('/rfid_info', 'RFID_INFO')} loading={dbLoading}>
                  Get Info
                </Button>
             </View>
             <View style={{ marginBottom: 12 }}>
                <Text variant="labelMedium" style={{color: theme.colors.outline}}>Last UART Result (from Supabase):</Text>
                <Text variant="bodyLarge" style={{ fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontWeight: 'bold', color: theme.colors.primary }}>
                  {uartResult}
                </Text>
             </View>
             <View>
                <Text variant="labelMedium" style={{color: theme.colors.outline}}>Debug Log:</Text>
                <View style={{ backgroundColor: theme.colors.elevation.level2, padding: 8, borderRadius: 8, marginTop: 4 }}>
                  <Text variant="bodySmall" style={{ fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>
                    {uartDebug}
                  </Text>
                </View>
                {connectedDevice && (
                  <Button mode="outlined" compact style={{ marginTop: 12 }} onPress={disconnectBle}>
                    Disconnect BLE (Switch to Cloud)
                  </Button>
                )}
             </View>
          </Card.Content>
        </Card>
      </ScrollView>
    </LinearGradient>
  );
}
