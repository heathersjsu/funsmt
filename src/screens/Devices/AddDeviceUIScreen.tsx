import React, { useRef, useState } from 'react';
import { View, StyleSheet, Platform, Pressable } from 'react-native';
import { Text, Card, TextInput, Button, useTheme, Portal, Dialog, List, Snackbar, Menu } from 'react-native-paper';
import { LinearGradient } from 'expo-linear-gradient';
import { cartoonGradient } from '../../theme/tokens';
import { BleManager } from '../../shims/ble';
import { supabase } from '../../supabaseClient';

export default function AddDeviceUIScreen() {
  const theme = useTheme();
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
  const [connectedDevice, setConnectedDevice] = useState<any>(null);
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
      if (!bleRef.current) bleRef.current = new BleManager();
      const d = await bleRef.current.connectToDevice(dev.id, { timeout: 10000 }).catch((e: any) => { throw e; });
      await d.discoverAllServicesAndCharacteristics();
      setConnectedDevice(d);
      const serviceUUID = '0000fff0-0000-1000-8000-00805f9b34fb';
      const idCharUUID3 = '0000fff3-0000-1000-8000-00805f9b34fb';
      const idCharUUID2 = '0000fff2-0000-1000-8000-00805f9b34fb';
      let ch: any = null;
      try { ch = await d.readCharacteristicForService(serviceUUID, idCharUUID3); }
      catch { ch = await d.readCharacteristicForService(serviceUUID, idCharUUID2); }
      const b64 = ch?.value || '';
      const val = b64DecodeUtf8(b64);
      const idText = (val && /ESP32_/i.test(val)) ? val.trim() : toDisplayIdFromNameOrId(dev.name, dev.id);
      setDeviceId(idText);
      setSnackbarMsg(`已选择设备：${idText}`);
      setSnackbarVisible(true);
    } catch (e: any) {
      const idText = toDisplayIdFromNameOrId(dev.name, dev.id);
      setDeviceId(idText);
      setSnackbarMsg(`读取设备ID失败，使用回退：${idText}`);
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
      const serviceUUID = '0000fff0-0000-1000-8000-00805f9b34fb';
      const writeCharUUID = '0000fff1-0000-1000-8000-00805f9b34fb';
      const echoCharUUID = '0000fff2-0000-1000-8000-00805f9b34fb';
      const sub = connectedDevice.monitorCharacteristicForService(serviceUUID, echoCharUUID, (error: any, characteristic: any) => {
        if (error) { setSnackbarMsg(error?.message || '设备通知错误'); setSnackbarVisible(true); return; }
        const b64 = characteristic?.value || '';
        const msg = b64DecodeUtf8(b64);
        if (!msg) return;
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
      // auto unsubscribe after 12s
      setTimeout(() => { try { sub?.remove?.(); } catch {}; }, 12000);
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
      const sub = connectedDevice.monitorCharacteristicForService(serviceUUID, echoCharUUID, (error: any, characteristic: any) => {
        if (error) { setSnackbarMsg(error?.message || '设备通知错误'); setSnackbarVisible(true); return; }
        const b64 = characteristic?.value || '';
        const msg = b64DecodeUtf8(b64);
        if (!msg) return;
        if (/WIFI_OK/i.test(msg) || /WIFI_STA_CONNECTED/i.test(msg)) {
          setConnectBusy(false);
          setSnackbarMsg('Wi‑Fi 连接成功');
          setSnackbarVisible(true);
          try { sub?.remove?.(); } catch {}
        }
      }, 'wifi-provision');
      const wifiObj: any = { ssid, password };
      const wifiJson = JSON.stringify(wifiObj);
      const wifiCmd = `WIFI_SET ${wifiJson}`;
      await connectedDevice.writeCharacteristicWithResponseForService(serviceUUID, writeCharUUID, b64Encode(wifiCmd));
    } catch (e: any) {
      setConnectBusy(false);
      setSnackbarMsg(e?.message || '设备连接 Wi‑Fi 失败');
      setSnackbarVisible(true);
    }
  };

  return (
    <LinearGradient colors={cartoonGradient} style={{ flex: 1 }}>
      <View style={styles.container}>
        <Card style={[styles.card, { backgroundColor: theme.colors.surface, borderWidth: 2, borderColor: theme.colors.surfaceVariant }]}> 
          <Card.Content>
            {/* Banner */}
            <View style={[styles.banner, { backgroundColor: theme.colors.surfaceVariant }]}> 
              <Text style={{ color: theme.colors.onSurface }}>Power on the device and keep it close to your phone.</Text>
            </View>

            {/* Inputs */}
            <TextInput label="Device Name" value={name} onChangeText={setName} style={styles.input} mode="outlined" />
            <Menu
              visible={locMenuOpen}
              onDismiss={() => setLocMenuOpen(false)}
              anchor={
                <Pressable onPress={() => { if (!locLockRef.current) setLocMenuOpen(true); }}>
                  <TextInput label="Location" value={location} onChangeText={setLocation} style={styles.input} mode="outlined" onFocus={() => { if (!locLockRef.current) setLocMenuOpen(true); }} />
                </Pressable>
              }
            >
              {DEFAULT_LOCATIONS.map((loc) => (
                <Menu.Item key={`def-${loc}`} title={loc} onPress={() => { setLocation(loc); setLocMenuOpen(false); locLockRef.current = true; setTimeout(() => { locLockRef.current = false; }, 150); }} />
              ))}
              {locSuggestions.filter(s => !DEFAULT_LOCATIONS.includes(s)).map((loc) => (
                <Menu.Item key={loc} title={loc} onPress={() => { setLocation(loc); setLocMenuOpen(false); locLockRef.current = true; setTimeout(() => { locLockRef.current = false; }, 150); }} />
              ))}
            </Menu>

            {/* Device ID + Scan */}
            <View style={styles.row}> 
              <View style={{ flex: 1, marginRight: 8 }}>
                <TextInput label="Device ID" value={deviceId} onChangeText={setDeviceId} mode="outlined" contentStyle={{ textAlign: 'left' }} />
              </View>
              <Button mode="outlined" onPress={startBleScan} disabled={Platform.OS === 'web'}>Scan</Button>
            </View>

            {/* Scan Wi‑Fi */}
            <Button mode="outlined" style={{ marginTop: 12 }} onPress={scanWifiListViaBle} disabled={Platform.OS === 'web'}>Scan Wi‑Fi</Button>
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
        </Portal>

        {/* Save */}
        <Button mode="contained" style={styles.saveButton}>Save</Button>

        <Snackbar visible={snackbarVisible} onDismiss={() => setSnackbarVisible(false)} duration={2500}>
          {snackbarMsg}
        </Snackbar>

        {/* Wi‑Fi list from device */}
        <Portal>
          <Dialog visible={wifiBlePickerVisible} onDismiss={() => setWifiBlePickerVisible(false)} style={{ borderRadius: 16 }}>
            <Dialog.Title>选择 Wi‑Fi（最多显示 5 个）</Dialog.Title>
            <Dialog.Content>
              {wifiItemsBle.length === 0 ? (
                <Text>等待设备回应…</Text>
              ) : (
                wifiItemsBle
                  .sort((a, b) => b.rssi - a.rssi)
                  .slice(0, 5)
                  .map((item, idx) => (
                    <List.Item
                      key={`${item.ssid}-${idx}`}
                      title={item.ssid}
                      description={`${item.enc} • RSSI ${item.rssi}`}
                      left={(p) => <List.Icon {...p} icon="wifi" />}
                      onPress={() => { setSelectedWifi(item.ssid); setWifiBlePickerVisible(false); }}
                    />
                  ))
              )}
              {selectedWifi ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                  <Text style={{ marginRight: 8 }}>Selected: {selectedWifi}</Text>
                  <TextInput
                    placeholder="password"
                    value={wifiPassword}
                    onChangeText={setWifiPassword}
                    secureTextEntry
                    style={{ flex: 1 }}
                  />
                  <Button mode="contained" onPress={connectWifiViaBle} loading={connectBusy} style={{ marginLeft: 8 }}>
                    Connect
                  </Button>
                </View>
              ) : null}
            </Dialog.Content>
            <Dialog.Actions>
              <Button onPress={() => setWifiBlePickerVisible(false)}>关闭</Button>
            </Dialog.Actions>
          </Dialog>
        </Portal>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  card: { borderRadius: 20 },
  banner: { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12 },
  input: { marginTop: 12 },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  saveButton: { marginTop: 16, borderRadius: 20, paddingVertical: 6 },
});