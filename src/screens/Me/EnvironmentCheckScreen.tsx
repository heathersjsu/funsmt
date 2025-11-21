import React, { useEffect, useRef, useState } from 'react';
import { View, Platform, ScrollView } from 'react-native';
import { useTheme, Button, Card, Text, TextInput, Portal, Dialog, List, Snackbar } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { supabase } from '../../supabaseClient';
import { LinearGradient } from 'expo-linear-gradient';
import { cartoonGradient } from '../../theme/tokens';
import { BleManager } from '../../shims/ble';

export default function EnvironmentCheckScreen() {
  const theme = useTheme();
  const [bleOk, setBleOk] = useState<boolean | null>(null);
  const [wifiOk, setWifiOk] = useState<boolean | null>(null);
  const [jwtOk, setJwtOk] = useState<boolean | null>(null);
  const [status, setStatus] = useState<string>(''); // 新日志在上面
  const [showAllLogs, setShowAllLogs] = useState<boolean>(false);
  const [snackbarMsg, setSnackbarMsg] = useState<string>('');
  const [snackbarVisible, setSnackbarVisible] = useState<boolean>(false);

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

  const appendStatus = (msg: string) => setStatus(prev => (msg + (prev ? '\n' + prev : '')));

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
  };

  useEffect(() => { runChecks(); }, []);

  // Start BLE scan and show pinme-ESP32_XXXXXX only
  const startBleScan = async () => {
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
      if (!connectedDevice) {
        appendStatus('Step[WiFiList] failed: no connected device (please Scan BLE and select a device first)');
        return;
      }
      setWifiItemsBle([]);
      setWifiBlePickerVisible(true);
      const serviceUUID = '0000fff0-0000-1000-8000-00805f9b34fb';
      const writeCharUUID = '0000fff1-0000-1000-8000-00805f9b34fb';
      const echoCharUUID = '0000fff2-0000-1000-8000-00805f9b34fb';
      // Use the connected device instance for notifications
      const sub = connectedDevice.monitorCharacteristicForService(serviceUUID, echoCharUUID, (error: any, characteristic: any) => {
        if (error) { appendStatus(`Step[WiFiList] notify error: ${error?.message || error}`); return; }
        const b64 = characteristic?.value || '';
        const msg = b64DecodeUtf8(b64);
        if (!msg) { appendStatus(`Step[WiFiList] raw base64: ${b64}`); return; }
        // Parse WIFI_LIST
        if (msg === 'WIFI_LIST_BEGIN') { setWifiItemsBle([]); return; }
        if (msg.startsWith('WIFI_ITEM ')) {
          const payload = msg.substring('WIFI_ITEM '.length);
          try {
            const obj = JSON.parse(payload);
            setWifiItemsBle(prev => [{ ssid: obj?.ssid || '', rssi: Number(obj?.rssi || 0), enc: String(obj?.enc || 'OPEN') }, ...prev].slice(0, 50));
          } catch {}
          return;
        }
      }, 'wifi-list');
      await connectedDevice.writeCharacteristicWithResponseForService(serviceUUID, writeCharUUID, b64Encode('WIFI_LIST'));
      appendStatus('Step[WiFiList] sent WIFI_LIST');
      // auto unsubscribe after 12s
      setTimeout(() => { try { sub?.remove?.(); } catch {}; }, 12000);
    } catch (e: any) {
      appendStatus(`Step[WiFiList] failed: ${e?.message || e}`);
      setWifiBlePickerVisible(false);
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
          try { sub?.remove?.(); } catch {}
        }
      }, 'wifi-provision');
      const wifiObj: any = { ssid, password };
      const wifiJson = JSON.stringify(wifiObj);
      const wifiCmd = `WIFI_SET ${wifiJson}`;
      await connectedDevice.writeCharacteristicWithResponseForService(serviceUUID, writeCharUUID, b64Encode(wifiCmd));
    } catch (e: any) {
      setConnectBusy(false);
      appendStatus(`Step[Provision] failed: ${e?.message || e}`);
    }
  };

  return (
    <LinearGradient colors={cartoonGradient} style={{ flex: 1 }}>
      <View style={{ flex: 1, padding: 16 }}>
        <Card style={{ backgroundColor: theme.colors.surface, borderWidth: 2, borderColor: theme.colors.surfaceVariant, borderRadius: 20 }}>
          <Card.Title title="Environment Check" subtitle="Quick status" />
          <Card.Content>
            {/* Row: BLE */}
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}>
              <MaterialCommunityIcons name="bluetooth" size={22} color={theme.colors.onSurfaceVariant} style={{ marginRight: 12 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '600' }}>连接蓝牙</Text>
                <Text style={{ color: theme.colors.onSurfaceVariant }}>
                  {bleOk == null ? '检测中…' : (bleOk ? 'BLE 模块可用' : '未检测到 BLE 支持（Web/Expo Go 可能不支持）')}
                </Text>
              </View>
              <MaterialCommunityIcons
                name={bleOk ? 'check-circle' : 'close-circle'}
                size={22}
                color={bleOk ? theme.colors.primary : theme.colors.error}
              />
            </View>

            {/* Row: Wi‑Fi */}
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}>
              <MaterialCommunityIcons name="wifi" size={22} color={theme.colors.onSurfaceVariant} style={{ marginRight: 12 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '600' }}>连接 Wi‑Fi</Text>
                <Text style={{ color: theme.colors.onSurfaceVariant }}>
                  {wifiOk == null ? '检测中…' : (wifiOk ? '网络可达（Supabase 正常响应）' : '网络不可达或服务错误')}
                </Text>
              </View>
              <MaterialCommunityIcons
                name={wifiOk ? 'check-circle' : 'close-circle'}
                size={22}
                color={wifiOk ? theme.colors.primary : theme.colors.error}
              />
            </View>

            {/* Row: JWT */}
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}>
              <MaterialCommunityIcons name="shield-check" size={22} color={theme.colors.onSurfaceVariant} style={{ marginRight: 12 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '600' }}>JWT 成功</Text>
                <Text style={{ color: theme.colors.onSurfaceVariant }}>
                  {jwtOk == null ? '检测中…' : (jwtOk ? '已获取访问令牌' : '未登录或令牌缺失')}
                </Text>
              </View>
              <MaterialCommunityIcons
                name={jwtOk ? 'check-circle' : 'close-circle'}
                size={22}
                color={jwtOk ? theme.colors.primary : theme.colors.error}
              />
            </View>

            {/* Actions & Inputs */}
            <View style={{ marginTop: 12 }}>
              <Text style={{ marginBottom: 6 }}>ESP32 设备 ID</Text>
              <TextInput value={esp32Id} onChangeText={setEsp32Id} mode="outlined" style={{ maxWidth: 240 }} contentStyle={{ textAlign: 'center' }} />
              <View style={{ flexDirection: 'row', marginTop: 8 }}>
                <Button mode="contained" onPress={startBleScan} style={{ marginRight: 8 }} disabled={Platform.OS === 'web'}>
                  Scan BLE
                </Button>
                <Button mode="outlined" onPress={scanWifiListViaBle} disabled={!connectedDevice || Platform.OS === 'web'}>
                  Scan Wi‑Fi
                </Button>
              </View>
              {selectedWifi ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                  <Text style={{ marginRight: 8 }}>Selected: {selectedWifi}</Text>
                  <TextInput
                    placeholder="password"
                    value={wifiPassword}
                    onChangeText={setWifiPassword}
                    secureTextEntry
                    style={{ flex: 1, maxWidth: 240 }}
                  />
                  <Button mode="contained" onPress={connectWifiViaBle} loading={connectBusy} style={{ marginLeft: 8 }}>
                    Connect
                  </Button>
                </View>
              ) : null}
            </View>
          </Card.Content>
          <Card.Actions>
            <Button mode="outlined" onPress={runChecks}>刷新</Button>
            <Button mode="outlined" style={{ marginLeft: 8 }} onPress={async () => {
              try {
                const clip = await import('expo-clipboard');
                if ((clip as any)?.setStringAsync) {
                  await (clip as any).setStringAsync(status || '');
                } else if ((navigator as any)?.clipboard?.writeText) {
                  await (navigator as any).clipboard.writeText(status || '');
                }
                setSnackbarMsg('日志已复制');
                setSnackbarVisible(true);
              } catch (e: any) {
                setSnackbarMsg('复制失败，请手动选择复制');
                setSnackbarVisible(true);
              }
            }}>复制日志</Button>
            <Button mode="text" style={{ marginLeft: 8 }} onPress={() => setShowAllLogs(false)}>最近 50 条</Button>
            <Button mode="text" onPress={() => setShowAllLogs(true)}>全部</Button>
          </Card.Actions>
        </Card>

        {/* Logs: newest on top */}
        <Card style={{ marginTop: 12, backgroundColor: theme.colors.surface, borderWidth: 2, borderColor: theme.colors.surfaceVariant, borderRadius: 20 }}>
          <Card.Title title="日志" subtitle={showAllLogs ? '显示全部（新信息在上面）' : '显示最近 50 条（新信息在上面）'} left={(p) => <List.Icon {...p} icon="file-document-outline" />} />
          <Card.Content>
            <ScrollView style={{ maxHeight: 240 }}>
              <Text style={{ fontFamily: Platform.OS === 'web' ? 'monospace' : undefined }}>
                {(showAllLogs ? status : (status ? status.split('\n').slice(0, 50).join('\n') : '')) || '暂无日志（点击 Scan BLE / Scan Wi‑Fi / Connect 后会显示详细步骤和设备回应）'}
              </Text>
            </ScrollView>
          </Card.Content>
        </Card>

        {/* BLE picker: only pinme-ESP32_XXXXXX */}
        <Portal>
          <Dialog visible={blePickerVisible} onDismiss={() => setBlePickerVisible(false)} style={{ borderRadius: 16 }}>
            <Dialog.Title>选择 pinme-ESP32 设备</Dialog.Title>
            <Dialog.Content>
              {bleItems.length === 0 ? (
                <Text>{bleScanning ? '扫描中…' : '未发现 pinme-ESP32_XXXXXX 设备'}</Text>
              ) : (
                bleItems.map((d) => (
                  <List.Item key={d.id} title={d.name} description={d.id} left={(p) => <List.Icon {...p} icon="bluetooth" />} onPress={() => onPickBleDevice({ id: d.id, name: d.name })} />
                ))
              )}
            </Dialog.Content>
            <Dialog.Actions>
              <Button onPress={() => { try { bleRef.current?.stopDeviceScan(); } catch {}; setBlePickerVisible(false); }}>关闭</Button>
            </Dialog.Actions>
          </Dialog>

          {/* Wi‑Fi list from device */}
          <Dialog visible={wifiBlePickerVisible} onDismiss={() => setWifiBlePickerVisible(false)} style={{ borderRadius: 16 }}>
            <Dialog.Title>选择 Wi‑Fi（最多显示 5 个）</Dialog.Title>
            <Dialog.Content>
              {wifiItemsBle.length === 0 ? (
                <Text>等待设备回应…</Text>
              ) : (
                wifiItemsBle.slice(0, 5).map((item, idx) => (
                  <List.Item key={`${item.ssid}-${idx}`} title={item.ssid} description={`${item.enc} • RSSI ${item.rssi}`} left={(p) => <List.Icon {...p} icon="wifi" />} onPress={() => { setSelectedWifi(item.ssid); setWifiBlePickerVisible(false); }} />
                ))
              )}
            </Dialog.Content>
            <Dialog.Actions>
              <Button onPress={() => setWifiBlePickerVisible(false)}>关闭</Button>
            </Dialog.Actions>
          </Dialog>
        </Portal>

        <Snackbar visible={snackbarVisible} onDismiss={() => setSnackbarVisible(false)} duration={2500}>
          {snackbarMsg}
        </Snackbar>
      </View>
    </LinearGradient>
  );
}