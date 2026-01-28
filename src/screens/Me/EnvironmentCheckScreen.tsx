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
import { buildGetPowerCmd, buildSetPowerCmd, buildGetVersionCmd, buildGetDemodulatorParamsCmd, buildSetDemodulatorParamsCmd, buildGetQueryCmd, buildSetQueryCmd, buildSetRegionCmd, buildSetAutoFhCmd, buildSetChannelCmd } from '../../utils/rfidCommands';
import { normalizeRfid } from '../../utils/rfid';
import { discoverDevices } from '../../utils/zeroconf';

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
  const lastResultRef = useRef('');
  useEffect(() => { lastResultRef.current = uartResult; }, [uartResult]);

  // RFID Data Access State
  const [rfidAp, setRfidAp] = useState('00000000');
  const [rfidMb, setRfidMb] = useState('3'); // User bank default
  const [rfidSa, setRfidSa] = useState('0');
  const [rfidDl, setRfidDl] = useState('2'); // 2 words = 4 bytes
  const [rfidWriteData, setRfidWriteData] = useState('11223344');
  
  // Initialization Process State
  const [initRunning, setInitRunning] = useState(false);

  // Frequency Control State
  const [targetFreq, setTargetFreq] = useState('920.125');

  // Demodulator Config State
  const [mixerGain, setMixerGain] = useState('3');
  const [ifGain, setIfGain] = useState('6');
  const [demodThreshold, setDemodThreshold] = useState('0100');

  // Gen2 Query Config State
  const [querySession, setQuerySession] = useState('2'); // S2
  const [queryQ, setQueryQ] = useState('4');
  const [queryTarget, setQueryTarget] = useState('0'); // A
  const [querySel, setQuerySel] = useState('0'); // All

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

    // Pre-fetch user ID to avoid timeout during actions
    const fetchUser = async () => {
        try {
            const { data } = await supabase.auth.getUser();
            if (data?.user?.id) {
                setSessionUserId(data.user.id);
            } else {
                const { data: sess } = await supabase.auth.getSession();
                if (sess?.session?.user?.id) {
                    setSessionUserId(sess.session.user.id);
                }
            }
        } catch (e) {
            console.log('[EnvCheck] Pre-fetch user failed:', e);
        }
    };
    fetchUser();
  }, []);

  const sendRfidRequest = async (path: string) => {
    setCmdLoading(true);
    const candidates = [];
    if (deviceIp) candidates.push(`http://${deviceIp}`);
    candidates.push('http://esp32.local');
    candidates.push('http://192.168.4.1');
    try {
      const found = await discoverDevices(2000);
      found.forEach(d => {
        const base = d.ip ? `http://${d.ip}` : (d.host || '');
        if (base && !candidates.includes(base)) candidates.push(base);
      });
    } catch {}

    let success = false;
    for (const base of candidates) {
      try {
        appendStatus(`Sending ${path} to ${base}...`);
        const controller = new AbortController();
        const t = path.startsWith('/rfid_multi_poll') ? 65000 : 3000;
        const timeoutId = setTimeout(() => controller.abort(), t);
        
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
    if (!success) appendStatus('Request failed on all IPs. Check Wi-Fi connection.');
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
    setCmdLoading(true);
      setUartResult('Sending command...');
      setUartDebug(`[${new Date().toLocaleTimeString()}] Queuing ${bleCmd}...`);
      let timer: NodeJS.Timeout | null = null;
      const safetyMs = 5000;
      try {
      const timeoutPromise = new Promise((_, reject) => {
         timer = setTimeout(() => reject(new Error(`Request timed out (${Math.round(safetyMs/1000)}s)`)), safetyMs);
      });

      // Check Auth Session first (with timeout)
      // Try to get user from memory/network with increased timeout and fallbacks
      let userId: string | undefined = sessionUserId;
      
      if (!userId) {
        try {
            // 1. Try getUser() first (often more reliable for current state)
            const getUserPromise = supabase.auth.getUser();
            const authTimeout = new Promise((_, r) => setTimeout(() => r(new Error("Auth check timed out")), 2000)); // Reduced to 2s for faster fallback
            
            const { data: userData } = await Promise.race([getUserPromise, authTimeout]) as any;
            if (userData?.user) {
                userId = userData.user.id;
                setSessionUserId(userId!); // Cache it
            } else {
                // 2. Fallback to getSession()
                const sessionPromise = supabase.auth.getSession();
                const { data: sessionData } = await Promise.race([sessionPromise, authTimeout]) as any;
                if (sessionData?.session?.user) {
                    userId = sessionData.session.user.id;
                    setSessionUserId(userId!); // Cache it
                }
            }
        } catch (e: any) {
            console.log('[handleRfidAction] Auth check failed/timed out:', e.message);
            // If we timed out, we might still want to proceed if we can?
            // No, RLS will likely block us.
            throw new Error(`Auth check failed: ${e.message}`);
        }
      }

      if (!userId) {
         throw new Error("No active session. Please log in.");
      }
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
      const msg = String(e?.message || '');
      const isTimeout = msg.includes('timed out');
      
      if (isTimeout) {
        console.log(`[handleRfidAction] Timeout (${Math.round(safetyMs/1000)}s) - Triggering Fallback`);
      } else {
        console.error('[handleRfidAction] Exception:', e);
        appendStatus(`Cmd Error: ${e.message}`);
      }

      if (isTimeout) {
        try {
          if (connectedDevice) {
            await sendBleCmd(bleCmd);
            appendStatus('Fallback via BLE sent');
          } else {
            let fallbackPath = httpPath;
            if (httpPath.startsWith('/rfid_poll_multi')) {
              const m = /RFID_POLL_MULTI\s+(\d+)/i.exec(bleCmd);
              const count = m ? m[1] : '30';
              fallbackPath = `/rfid_multi_poll?count=${count}`;
            }
            await sendRfidRequest(fallbackPath);
            appendStatus('Fallback via HTTP sent');
          }
        } catch {}
      }
      setUartResult(`Error: ${e.message}`);
    } finally {
      if (timer) clearTimeout(timer);
      setCmdLoading(false);
    }
  };

  const startContinuousScan = async () => {
    if (isContinuousScanningRef.current) return;
    setIsContinuousScanning(true);
    isContinuousScanningRef.current = true;
    appendStatus('Starting Continuous Scan (ESP32 Auto Loop)...');

    try {
        // Send single start command to ESP32
        // ESP32 will handle the loop internally and update the DB with results
        await handleRfidAction('/rfid_start_continuous', 'RFID_START_CONTINUOUS');
        appendStatus('Continuous Scan Command Sent. Waiting for updates...');
    } catch (e: any) {
        console.log('Start Continuous scan error:', e);
        appendStatus(`Start Error: ${e.message}`);
        setIsContinuousScanning(false);
        isContinuousScanningRef.current = false;
    }
  };

  const stopContinuousScan = async () => {
      appendStatus('Stopping Continuous Scan...');
      setIsContinuousScanning(false);
      isContinuousScanningRef.current = false;
      try {
          await handleRfidAction('/rfid_stop_poll', 'RFID_POLL_STOP');
      } catch (e) {
          console.log('Stop command skipped/failed (likely busy):', e);
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

  const handleGetDemodParams = async () => {
    const cmd = buildGetDemodulatorParamsCmd();
    await handleRfidAction('/rfid_get_demod_params', cmd);
    
    // We need to parse the result from `lastResultRef.current` or wait for it.
    // For simplicity, let's poll for a short time to see if we get a matching response pattern.
    // Expected response: BB 01 F1 00 04 [Mixer] [IF] [ThrdH] [ThrdL] [CS] 7E
    // Hex string in uartResult might look like "BB01F10004030601B0B07E" (without spaces potentially, or with spaces)
    // The current implementation of `handleRfidAction` sets `uartResult`.
    
    // Let's setup a temporary watcher or just parse manually after a delay/user action.
    // Ideally we parse it here if possible. 
    // Since handleRfidAction is async but doesn't return the *result* (it sets state), we might need to rely on the user to see it or use the Ref trick again.
    
    const start = Date.now();
    let found = false;
    while (Date.now() - start < 3000) {
        await new Promise(r => setTimeout(r, 200));
        const res = lastResultRef.current.replace(/\s+/g, '').toUpperCase();
        // Look for F1 command response
        // BB 01 F1 ...
        const idx = res.indexOf('BB01F1');
        if (idx !== -1 && res.length >= idx + 22) { // 11 bytes * 2 chars = 22
             const packet = res.substring(idx, idx + 22);
             // Packet: BB 01 F1 00 04 [Mixer] [IF] [ThrdH] [ThrdL] [CS] 7E
             // Indices: 01 23 45 67 89 1011 1213 1415 1617 1819 2021
             // Mixer: 1011 -> chars 10,11
             // IF: 1213 -> chars 12,13
             // Thrd: 1415 1617 -> chars 14-17
             
             const m = parseInt(packet.substring(10, 12), 16);
             const i = parseInt(packet.substring(12, 14), 16);
             const t = packet.substring(14, 18);
             
             if (!isNaN(m)) setMixerGain(String(m));
             if (!isNaN(i)) setIfGain(String(i));
             if (t) setDemodThreshold(t);
             
             appendStatus(`Parsed Demod Params: Mixer=${m}, IF=${i}, Thrd=${t}`);
             found = true;
             break;
        }
    }
    if (!found) appendStatus("Could not parse Demod Params from response automatically.");
  };

  const handleSetDemodParams = async () => {
      const m = parseInt(mixerGain, 10);
      const i = parseInt(ifGain, 10);
      const t = parseInt(demodThreshold, 16);
      
      if (isNaN(m) || m < 0 || m > 6) { appendStatus("Invalid Mixer Gain (0-6)"); return; }
      if (isNaN(i) || i < 0 || i > 7) { appendStatus("Invalid IF Gain (0-7)"); return; }
      if (isNaN(t) || t < 0 || t > 0xFFFF) { appendStatus("Invalid Threshold (Hex 0000-FFFF)"); return; }
      
      const cmd = buildSetDemodulatorParamsCmd(m, i, t);
      await handleRfidAction(`/rfid_set_demod_params?m=${m}&i=${i}&t=${t}`, cmd);
  };

  const handleGetQueryParams = async () => {
    try {
        const cmd = buildGetQueryCmd();
        await handleRfidAction('/rfid_get_query', cmd);
        
        // Parse Logic
        // Expected: BB 01 0D 00 02 [Byte1] [Byte2] [CS] 7E
        const start = Date.now();
        let found = false;
        while (Date.now() - start < 3000) {
            await new Promise(r => setTimeout(r, 200));
            const res = lastResultRef.current.replace(/\s+/g, '').toUpperCase();
            // Look for 0D command response
            const idx = res.indexOf('BB010D');
            if (idx !== -1 && res.length >= idx + 18) { // 9 bytes * 2 = 18
                const packet = res.substring(idx, idx + 18);
                // Packet: BB 01 0D 00 02 [Byte1] [Byte2] [CS] 7E
                // Indices: 01 23 45 67 89 1011 1213 1415 1617
                // Byte1: 1011
                // Byte2: 1213
                
                const b1 = parseInt(packet.substring(10, 12), 16);
                const b2 = parseInt(packet.substring(12, 14), 16);
                
                if (!isNaN(b1) && !isNaN(b2)) {
                    // Decode Byte 1
                    // Bit 1-0: Session
                    const sess = b1 & 0x03;
                    // Bit 3-2: Sel
                    const sel = (b1 >> 2) & 0x03;
                    
                    // Decode Byte 2
                    // Bit 7: Target
                    const tgt = (b2 >> 7) & 0x01;
                    // Bit 6-3: Q (4 bits)
                    const q = (b2 >> 3) & 0x0F;
                    
                    setQuerySel(String(sel));
                    setQueryTarget(String(tgt));
                    setQueryQ(String(q));
                    
                    appendStatus(`Parsed Query: S${sess}, Q=${q}, Tgt=${tgt===0?'A':'B'}, Sel=${sel}`);
                    found = true;
                    break;
                }
            } else if (res.includes('ERROR') || res.includes('UNKNOWN')) {
                // Detected explicit error from device
                appendStatus('Device returned Error/Unknown Command. Firmware might not support this.');
                found = true; // Stop spinning
                break;
            }
        }
        if (!found) appendStatus("Could not parse Query Params from response automatically.");
    } catch (e: any) {
        appendStatus(`Get Query Error: ${e.message}`);
    }
  };

  const handleSetQueryParams = async () => {
      const sess = parseInt(querySession, 10);
      const q = parseInt(queryQ, 10);
      const tgt = parseInt(queryTarget, 10);
      const sel = parseInt(querySel, 10);
      
      if (isNaN(sess) || sess < 0 || sess > 3) { appendStatus("Invalid Session (0-3)"); return; }
      if (isNaN(q) || q < 0 || q > 15) { appendStatus("Invalid Q (0-15)"); return; }
      if (isNaN(tgt) || (tgt !== 0 && tgt !== 1)) { appendStatus("Invalid Target (0=A, 1=B)"); return; }
      
      // Defaults for others: DR=0, M=1 (M2), TRext=1
      const cmd = buildSetQueryCmd(sess, q, tgt, 0, 1, 1, sel);
      await handleRfidAction(`/rfid_set_query?s=${sess}&q=${q}&t=${tgt}&sel=${sel}`, cmd);
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
  const [scannedTags, setScannedTags] = useState<Set<string>>(new Set());
  const scannedTagsRef = useRef<Set<string>>(new Set());
  useEffect(() => { scannedTagsRef.current = scannedTags; }, [scannedTags]);

  const [isContinuousScanning, setIsContinuousScanning] = useState(false);
  const isContinuousScanningRef = useRef(false);
  useEffect(() => { isContinuousScanningRef.current = isContinuousScanning; }, [isContinuousScanning]);

  // Auto-refresh timer for DB poll (if Realtime fails or for initial sync)
  useEffect(() => {
    let interval: any;
    if (autoRefresh) {
      interval = setInterval(fetchDeviceDebug, 3000);
    }
    return () => clearInterval(interval);
  }, [autoRefresh]);

  // Listen for EPCs in uartResult to update scannedTags (covers both manual and auto)
  useEffect(() => {
    if (!uartResult) return;
    // Match standard EPCs (24 hex chars) or longer raw hex strings
    const matches = uartResult.match(/[0-9A-Fa-f]{24}/g) || uartResult.match(/[0-9A-Fa-f]{8,}/g);
    
    if (matches) {
        setScannedTags(prev => {
            const next = new Set(prev);
            let changed = false;
            matches.forEach(m => {
                // Filter out short noise
                if (m.length < 8) return;
                
                // Normalize using the utility function (handles casing, spacing, etc)
                const norm = normalizeRfid(m);
                
                // Basic validation: EPC is usually 24 chars (96 bits)
                // But we allow others if they look like valid hex tags
                if (!next.has(norm)) {
                    next.add(norm);
                    changed = true;
                }
            });
            return changed ? next : prev;
        });
    }
  }, [uartResult]);

  const runInit = async () => {
    if (initRunning || cmdLoading) return;
    setInitRunning(true);
    try {
        appendStatus('--- Starting Initialization ---');
        
        // 1. Get Firmware Version (Verify communication)
        appendStatus('1. Get Firmware Version...');
        await handleRfidAction('/rfid_get_version', buildGetVersionCmd());
        await new Promise(r => setTimeout(r, 2000));

        // 2. Set Region: China 900MHz (01)
        appendStatus('2. Setting Region: China 900MHz (01)...');
        await handleRfidAction('/rfid_region_set?region=1', buildSetRegionCmd(1));
        await new Promise(r => setTimeout(r, 2000));

        // 3. Set Power: 26 dBm (Balanced)
        appendStatus('3. Setting Power: 26 dBm...');
        await handleRfidAction('/rfid_set_power?dbm=26', buildSetPowerCmd(2600));
        await new Promise(r => setTimeout(r, 2000));

        // 4. Set Auto Frequency Hopping
        appendStatus('4. Setting Auto Frequency Hopping...');
        await handleRfidAction('/rfid_set_auto_fh?mode=255', buildSetAutoFhCmd(true));
        await new Promise(r => setTimeout(r, 2000));

        // 5. Set Demodulator Parameters: Mixer=3, IF=6, Thrd=0x0100 (Balanced)
        appendStatus('5. Setting Demodulator: Mixer=3, IF=6, Thrd=0x0100 (Balanced)...');
        await handleRfidAction('/rfid_set_demod', buildSetDemodulatorParamsCmd(3, 6, 0x0100));
        await new Promise(r => setTimeout(r, 2000));

        // 6. 设置 Select 模式 (Set Mode)
        appendStatus('6. 设置 Select 模式 (Set Mode)...');
        await handleRfidAction('/rfid_set_select_mode?mode=1', 'RFID_SELECT_MODE 1');
        await new Promise(r => setTimeout(r, 1000));

        // 7. 设置 Query 参数
        appendStatus('7. 设置 Query 参数...');
        await handleRfidAction('/rfid_set_query', buildSetQueryCmd(0, 4, 0, 0, 1, 1, 0));
        
        
        appendStatus('--- Initialization Complete ---');
        setSnackbarMsg('Initialization Complete');
        setSnackbarVisible(true);
    } catch (e: any) {
        appendStatus(`Init Failed: ${e.message}`);
    } finally {
        setInitRunning(false);
    }
  };

  const runSmartScan = async () => {
    if (initRunning) return;
    setInitRunning(true);
    
    appendStatus('Step 6: Preparing Continuous Scan...');
    
    // 1. Fetch expected tags from toys table
    let expectedTags = new Set<string>();
    try {
        const { data } = await supabase.from('toys').select('rfid');
        if (data) {
            data.forEach(t => {
                if(t.rfid) expectedTags.add(normalizeRfid(t.rfid));
            });
        }
        appendStatus(`Step 6: Expecting ${expectedTags.size} registered tags.`);
    } catch (e: any) {
        appendStatus(`Step 6 Warning: Could not fetch expected tags (${e.message}). Scanning blindly.`);
    }

    const startTime = Date.now();
    const TIMEOUT = 5 * 60 * 1000; // 5 minutes
    // Local set for logging progress only (not for logic)
    const loggedTags = new Set<string>();
    
    appendStatus('Step 6: Scanning (Multi-Poll)... (Timeout: 5 mins)');
    
    const BATCH_SIZE = 100;
    
    // Clear scanned tags for new session
    setScannedTags(new Set());
    
    while (Date.now() - startTime < TIMEOUT) {
        // Async Check: Verify if all tags are found using the real-time Ref
        const currentScanned = scannedTagsRef.current;
        let foundCount = 0;
        let allFound = true;
        
        expectedTags.forEach(tag => {
            if (currentScanned.has(tag)) {
                foundCount++;
                if (!loggedTags.has(tag)) {
                    loggedTags.add(tag);
                    appendStatus(`[Step 6] Found Registered Tag: ${tag} (${foundCount}/${expectedTags.size})`);
                }
            } else {
                allFound = false;
            }
        });

        if (expectedTags.size > 0 && allFound) {
             appendStatus(`Step 6 Success: All expected tags found! (${foundCount}/${expectedTags.size})`);
             setSnackbarMsg('All tags found!');
             setSnackbarVisible(true);
             break;
        }

        try {
            // Send Multi-Poll Command
            // We use the raw hex command which SupabaseCommands.h supports via "BB ..."
            // Or we can use the "RFID_POLL_MULTI 20" string alias if we prefer readable logs.
            // Let's use the readable alias for clarity in logs, as SupabaseCommands.h supports it.
            // Actually, using the raw buildMultiPollCmd is safer if we want to ensure exact hex.
            // But SupabaseCommands.h handles "BB ..." correctly.
            // Let's use the readable string "RFID_POLL_MULTI 20" to leverage the specific handler 
            // and ensure count is parsed correctly.
            
            await handleRfidAction(`/rfid_multi_poll?count=${BATCH_SIZE}`, `RFID_POLL_MULTI ${BATCH_SIZE}`);
            
            await new Promise(r => setTimeout(r, 50));
            
            // Ensure we fetch the latest result to update scannedTags
            await fetchDeviceDebug();
            
        } catch (e: any) {
            appendStatus(`Scan Loop Error: ${e.message}`);
            await new Promise(r => setTimeout(r, 1000));
        }
    }
    
    if (Date.now() - startTime >= TIMEOUT) {
        const currentCount = [...expectedTags].filter(t => scannedTagsRef.current.has(t)).length;
        appendStatus(`Step 6 Timeout. Found ${currentCount}/${expectedTags.size} tags.`);
    }
    
    setInitRunning(false);
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
             
             {/* Manual IP Input for Fallback */}
             <View style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center' }}>
                <TextInput
                    mode="outlined"
                    label="Target IP (Fallback)"
                    value={deviceIp}
                    onChangeText={setDeviceIp}
                    placeholder="e.g. 192.168.1.100"
                    style={{ flex: 1, backgroundColor: theme.colors.elevation.level1, height: 40 }}
                    dense
                    right={<TextInput.Icon icon="ip-network" />}
                />
             </View>
             
             {/* Swap UART Pins Button */}
             <Button 
                mode="contained" 
                compact 
                onPress={() => handleRfidAction('/rfid_info', 'RFID_SWAP_UART')} 
                style={{ marginTop: 8, backgroundColor: theme.colors.error }}
                icon="swap-horizontal"
             >
                Swap RX/TX (Fix Timeout)
             </Button>
          </Card.Content>
        </Card>

        {/* Scanned Tags Card */}
        <Card style={{ borderRadius: 20, backgroundColor: theme.colors.surface, marginTop: 16 }}>
          <Card.Title 
            title={`Scanned Tags (${scannedTags.size})`} 
            titleStyle={{ fontFamily: headerFont }} 
            left={(props) => <MaterialCommunityIcons {...props} name="tag-multiple" />} 
            right={(props) => (
                <Button compact onPress={() => setScannedTags(new Set())}>Clear</Button>
            )}
          />
          <Card.Content>
             {scannedTags.size === 0 ? (
                 <Text variant="bodyMedium" style={{color: theme.colors.outline, fontStyle: 'italic'}}>No tags scanned yet...</Text>
             ) : (
                 <View style={{ gap: 8 }}>
                    {Array.from(scannedTags).map((tag, idx) => (
                        <View key={tag} style={{flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.elevation.level1, padding: 8, borderRadius: 8}}>
                            <Text variant="labelMedium" style={{width: 30, color: theme.colors.outline}}>#{idx + 1}</Text>
                            <Text variant="bodyMedium" style={{fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontWeight: 'bold'}}>{tag}</Text>
                        </View>
                    ))}
                 </View>
             )}
          </Card.Content>
        </Card>

        {/* Initialization Process Card */}
        <Card style={{ borderRadius: 20, backgroundColor: theme.colors.surface, marginTop: 16 }}>
          <Card.Title title="初始化流程" titleStyle={{ fontFamily: headerFont }} left={(props) => <MaterialCommunityIcons {...props} name="play-box-outline" />} />
          <Card.Content>
              <View style={{ gap: 8 }}>
                <Text variant="bodyMedium">1. 获取固件版本（通信校验）</Text>
                <Text variant="bodyMedium">2. 设置区域：<Text style={{fontWeight: 'bold'}}>中国 900MHz 频段（920–925MHz）</Text></Text>
                <Text variant="bodyMedium">3. 设置功率：<Text style={{fontWeight: 'bold'}}>默认 26 dBm</Text></Text>
                <Text variant="bodyMedium">4. 设置频点：<Text style={{fontWeight: 'bold'}}>自动跳频 (Auto Frequency Hopping)</Text></Text>
                <Text variant="bodyMedium">5. 设置解调：<Text style={{fontWeight: 'bold'}}>Mixer=3，IF=6，Thrd=0x0100</Text></Text>
                <Text variant="bodyMedium">6. 设置 Select 模式：<Text style={{fontWeight: 'bold'}}>Mode=1 (Set Mode)</Text></Text>
                <Text variant="bodyMedium">7. 设置 Query 参数：<Text style={{fontWeight: 'bold'}}>DR=8，M=1，TRext=1，Sel=ALL，S=0，Q=4</Text></Text>

                
                <Button 
                    mode="contained" 
                    onPress={runInit} 
                    loading={initRunning || cmdLoading} 
                    icon="play"
                    style={{ marginTop: 16 }}
                >
                    运行完整初始化
                </Button>

                <View style={{ height: 1, backgroundColor: theme.colors.outlineVariant, marginVertical: 16 }} />
                
                <Text variant="titleSmall" style={{ color: theme.colors.primary, marginBottom: 8 }}>初始化后动作</Text>
                
                <Button 
                    mode="outlined" 
                    onPress={runSmartScan} 
                    loading={initRunning || cmdLoading} 
                    icon="radar"
                >
                    开始智能扫描（5分钟超时）
                </Button>
              </View>
          </Card.Content>
        </Card>

        {/* Frequency Control Card */}
        <Card style={{ borderRadius: 20, backgroundColor: theme.colors.surface, marginTop: 16 }}>
          <Card.Title title="Frequency Control" titleStyle={{ fontFamily: headerFont }} left={(props) => <MaterialCommunityIcons {...props} name="access-point-network" />} />
          <Card.Content>
             <View style={{ gap: 12 }}>
                <View>
                   <Text variant="titleSmall" style={{marginBottom: 8}}>Manual Frequency Set</Text>
                   <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                     <TextInput
                       mode="outlined"
                       label="Freq (MHz)"
                       value={targetFreq}
                       onChangeText={setTargetFreq}
                       keyboardType="numeric"
                       style={{ flex: 1, backgroundColor: theme.colors.background }}
                       dense
                     />
                     <Button 
                       mode="contained" 
                       onPress={async () => {
                         const f = parseFloat(targetFreq);
                         if (isNaN(f)) {
                           setSnackbarMsg("Invalid Frequency");
                           setSnackbarVisible(true);
                           return;
                         }
                         // China 920.125-924.875MHz (Step 0.25MHz)
                         // Index = (Freq - 920.125) / 0.25
                         const idx = Math.round((f - 920.125) / 0.25);
                         if (idx < 0 || idx > 19) {
                           appendStatus(`Warning: Channel Index ${idx} out of typical range (0-19)`);
                         }
                         appendStatus(`Disabling Auto FH & Setting Channel: ${f}MHz (Index ${idx})...`);
                         
                         // 1. Disable Auto Frequency Hopping first
                         await handleRfidAction('/rfid_set_auto_fh?enable=0', buildSetAutoFhCmd(false));
                         
                         // 2. Set the specific channel
                         await handleRfidAction(`/rfid_channel_set?ch=${idx}`, buildSetChannelCmd(idx));
                       }}
                       loading={cmdLoading}
                     >
                       Set
                     </Button>
                   </View>
                   <Text variant="bodySmall" style={{color: theme.colors.outline, marginTop: 4}}>
                     Range: 920.125 - 924.875 MHz (Step 0.25)
                   </Text>
                </View>
                
                <View style={{ height: 1, backgroundColor: theme.colors.outlineVariant }} />
                
                <View>
                   <Text variant="titleSmall" style={{marginBottom: 8}}>Frequency Hopping</Text>
                   <View style={{ flexDirection: 'row', gap: 8 }}>
                      <Button 
                        mode="contained" 
                        buttonColor={theme.colors.secondary}
                        icon="check"
                        style={{flex: 1}}
                        onPress={() => handleRfidAction('/rfid_set_auto_fh?enable=1', buildSetAutoFhCmd(true))}
                        loading={cmdLoading}
                      >
                        Enable Auto
                      </Button>
                      <Button 
                        mode="contained" 
                        buttonColor={theme.colors.error}
                        icon="close"
                        style={{flex: 1}}
                        onPress={() => handleRfidAction('/rfid_set_auto_fh?enable=0', buildSetAutoFhCmd(false))}
                        loading={cmdLoading}
                      >
                        Disable
                      </Button>
                   </View>
                   <Button 
                        mode="outlined" 
                        icon="refresh"
                        style={{marginTop: 8}}
                        onPress={() => handleRfidAction('/rfid_channel_get', 'RFID_CHANNEL_GET')}
                        loading={cmdLoading}
                      >
                        Query Frequency (Check Log)
                   </Button>
                </View>
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
               <Button mode="outlined" onPress={() => handleRfidAction('/rfid_set_power?dbm=26', 'RFID_POWER_SET 26')} loading={cmdLoading} compact>
                 Set 26dBm
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
               <Button mode="contained" onPress={async () => {
                   await handleRfidAction('/rfid_single_poll', 'RFID_POLL_SINGLE');
                   // Auto-fetch result after short delay
                   appendStatus('Fetching Single Poll Result...');
                   await new Promise(r => setTimeout(r, 1000));
                   await fetchDeviceDebug();
               }} loading={cmdLoading} compact>
                 Single Poll
               </Button>
               <Button mode="outlined" onPress={async () => {
                   await handleRfidAction('/rfid_multi_poll?count=300', 'RFID_POLL_MULTI 300');
                   // Multi-poll takes longer to return
                   appendStatus('Fetching Multi Poll Result...');
                   await new Promise(r => setTimeout(r, 3000));
                   await fetchDeviceDebug();
               }} loading={cmdLoading} compact>
                 Multi Poll (300)
               </Button>
               <Button mode="contained" onPress={startContinuousScan} loading={isContinuousScanning} disabled={isContinuousScanning} compact>
                 Continuous Scan
               </Button>
               <Button mode="outlined" onPress={stopContinuousScan} loading={cmdLoading && !isContinuousScanning} compact>
                 Stop Scan
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

        {/* Demodulator Config Card */}
        <Card style={{ borderRadius: 20, backgroundColor: theme.colors.surface, marginTop: 16 }}>
          <Card.Title title="Demodulator Params (Rx)" titleStyle={{ fontFamily: headerFont }} left={(props) => <MaterialCommunityIcons {...props} name="tune" />} />
          <Card.Content>
             <View style={{ gap: 12 }}>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                   <TextInput
                      mode="outlined"
                      label="Mixer Gain (0-6)"
                      value={mixerGain}
                      onChangeText={setMixerGain}
                      keyboardType="numeric"
                      style={{ flex: 1, backgroundColor: theme.colors.background }}
                      dense
                   />
                   <TextInput
                      mode="outlined"
                      label="IF AMP (0-7)"
                      value={ifGain}
                      onChangeText={setIfGain}
                      keyboardType="numeric"
                      style={{ flex: 1, backgroundColor: theme.colors.background }}
                      dense
                   />
                </View>
                <TextInput
                   mode="outlined"
                   label="Threshold (Hex 16-bit)"
                   value={demodThreshold}
                   onChangeText={setDemodThreshold}
                   style={{ backgroundColor: theme.colors.background }}
                   dense
                />
                <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
                   <Button mode="outlined" onPress={handleGetDemodParams} loading={cmdLoading}>
                      Get Params
                   </Button>
                   <Button mode="contained" onPress={handleSetDemodParams} loading={cmdLoading}>
                      Set Params
                   </Button>
                </View>
                <Text variant="bodySmall" style={{color: theme.colors.outline}}>
                   Mixer: 0=0dB ... 6=16dB{'\n'}
                   IF AMP: 0=12dB ... 7=40dB{'\n'}
                   Threshold: Lower = more sensitive but unstable. Rec min: 0x01B0.
                </Text>
             </View>
          </Card.Content>
        </Card>

        {/* Gen2 Query Params Card */}
        <Card style={{ borderRadius: 20, backgroundColor: theme.colors.surface, marginTop: 16 }}>
          <Card.Title title="Gen2 Query Params (Tx)" titleStyle={{ fontFamily: headerFont }} left={(props) => <MaterialCommunityIcons {...props} name="access-point-network" />} />
          <Card.Content>
             <View style={{ gap: 12 }}>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                   <TextInput
                      mode="outlined"
                      label="Session (0-3)"
                      value={querySession}
                      onChangeText={setQuerySession}
                      keyboardType="numeric"
                      style={{ flex: 1, backgroundColor: theme.colors.background }}
                      dense
                   />
                   <TextInput
                      mode="outlined"
                      label="Q Value (0-15)"
                      value={queryQ}
                      onChangeText={setQueryQ}
                      keyboardType="numeric"
                      style={{ flex: 1, backgroundColor: theme.colors.background }}
                      dense
                   />
                </View>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                   <TextInput
                      mode="outlined"
                      label="Target (0=A, 1=B)"
                      value={queryTarget}
                      onChangeText={setQueryTarget}
                      keyboardType="numeric"
                      style={{ flex: 1, backgroundColor: theme.colors.background }}
                      dense
                   />
                   <TextInput
                      mode="outlined"
                      label="Select (0=All, 2=SL)"
                      value={querySel}
                      onChangeText={setQuerySel}
                      keyboardType="numeric"
                      style={{ flex: 1, backgroundColor: theme.colors.background }}
                      dense
                   />
                </View>
                <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
                   <Button mode="outlined" onPress={handleGetQueryParams} loading={cmdLoading}>
                      Get Query
                   </Button>
                   <Button mode="contained" onPress={handleSetQueryParams} loading={cmdLoading}>
                      Set Query
                   </Button>
                </View>
                <Text variant="bodySmall" style={{color: theme.colors.outline}}>
                   Session: S0=0, S1=1, S2=2 (Rec), S3=3{'\n'}
                   Q: 0-15 (Rec 4). Target: 0=A, 1=B.{'\n'}
                   Defaults: DR=0, M=1 (M2), Pilot=On.
                </Text>
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
