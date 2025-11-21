import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, Image, Platform, ScrollView } from 'react-native';
import { Text, TextInput, Button, Card, Divider, List, HelperText, Portal, Dialog, useTheme } from 'react-native-paper';
import { supabase } from '../../supabaseClient';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Device } from '../../types';
import { Camera, CameraType } from 'expo-camera';
import QRCode from 'react-native-qrcode-svg';

type Props = NativeStackScreenProps<any>;

function randomId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let s = '';
  for (let i=0;i<6;i++) s += chars[Math.floor(Math.random()*chars.length)];
  return `ESP32_${s}`;
}

export default function DeviceConfigScreen({ navigation, route }: Props) {
  const theme = useTheme();
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [networks, setNetworks] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [deviceName, setDeviceName] = useState('My Toy Reader_01');
  const [location, setLocation] = useState('Kids Room Toy Box');
  const [deviceId, setDeviceId] = useState(randomId());
  const [qrValue, setQrValue] = useState<string>('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [pastedConfig, setPastedConfig] = useState('');
  const [apProvisioning, setApProvisioning] = useState(false);
  const [hasCamPermission, setHasCamPermission] = useState<boolean | null>(null);
  const [scanningQR, setScanningQR] = useState(false);
  const [idScanOpen, setIdScanOpen] = useState(false);
  const [idHasCamPermission, setIdHasCamPermission] = useState<boolean | null>(null);

  const siteUrl = process.env.EXPO_PUBLIC_SITE_URL || '';
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

  const payload = useMemo(() => ({
    device_id: deviceId,
    name: deviceName,
    location,
    wifi: { ssid, password },
    api: { supabase_url: supabaseUrl, anon_key: anonKey, site_url: siteUrl },
  }), [deviceId, deviceName, location, ssid, password, supabaseUrl, anonKey, siteUrl]);

  useEffect(() => {
    const preset = route?.params?.preset as any;
    if (preset) {
      if (preset.device_id) setDeviceId(preset.device_id);
      if (preset.name) setDeviceName(preset.name);
      if (preset.location) setLocation(preset.location);
      if (preset.wifi_ssid) setSsid(preset.wifi_ssid);
      setMessage('Loaded device preset');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.params?.preset]);

  useEffect(() => {
    const loadDevices = async () => {
      setLoadingDevices(true);
      setError(null);
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes?.user?.id;
      const { data, error } = await supabase
        .from('devices')
        .select('device_id,name,location,status,last_seen,wifi_signal')
        .eq('user_id', uid);
      if (error) setError(error.message);
      setDevices(data || []);
      setLoadingDevices(false);
    };
    loadDevices();
  }, []);

  const applyPastedConfig = () => {
    try {
      const obj = JSON.parse(pastedConfig);
      if (obj.device_id) setDeviceId(obj.device_id);
      if (obj.name) setDeviceName(obj.name);
      if (obj.location) setLocation(obj.location);
      setShowAddDialog(false);
      setMessage('Config loaded from QR');
    } catch (e:any) {
      setError('Failed to parse QR JSON');
    }
  };

  const onProvisionToDeviceAP = async () => {
    setApProvisioning(true); setError(null); setMessage(null);
    const payloadToSend = {
      device_id: deviceId,
      wifi: { ssid, password },
      api: { supabase_url: supabaseUrl, anon_key: anonKey, site_url: siteUrl },
      name: deviceName,
      location,
    };
    const endpoints = [
      'http://192.168.4.1/config',
      'http://192.168.4.1/provision',
      'http://esp32.local/config',
      'http://esp32.local/provision',
    ];
    for (const url of endpoints) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payloadToSend),
        });
        if (res.ok) {
          setMessage(`Sent config to device AP (${url}).`);
          setApProvisioning(false);
          return;
        }
      } catch {}
    }
    setApProvisioning(false);
    setError('Failed to reach device AP. Ensure you are connected to the ESP32 AP.');
  };

  const onScanNetworks = async () => {
    setScanning(true);
    setMessage(null);
    // NOTE: Browser cannot scan WiFi; this simulates last reported networks from device/edge.
    // Future: fetch from an Edge Function or device local API.
    setTimeout(() => {
      setNetworks(['KidsRoom_2G','KidsRoom_5G','GuestWifi','Office_AP']);
      setScanning(false);
    }, 700);
  };

  const onGenerateQR = async () => {
    setError(null);
    try {
      const json = JSON.stringify(payload);
      setQrValue(json);
      setMessage('QR code generated');
    } catch (e:any) {
      setError(e?.message || 'Failed to generate QR');
    }
  };

  const startScanQR = async () => {
    setError(null); setMessage(null);
    if (Platform.OS === 'web') {
      setShowAddDialog(true);
      return;
    }
    const { status } = await Camera.requestCameraPermissionsAsync();
    setHasCamPermission(status === 'granted');
    if (status !== 'granted') {
      setError('Camera permission not granted. Please allow camera access.');
      return;
    }
    setScanningQR(true);
  };

  const openIdScanner = async () => {
    setError(null); setMessage(null);
    try {
      const { status } = await Camera.requestCameraPermissionsAsync();
      if (status === 'granted') {
        setIdHasCamPermission(true);
        setIdScanOpen(true);
      } else {
        setIdHasCamPermission(false);
        setError('Camera permission denied');
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to request camera permission');
    }
  };

  const onIdScanned = ({ data }: { data: string }) => {
    if (!data) return;
    setDeviceId(data);
    setIdScanOpen(false);
    setMessage('Device ID scanned');
  };

  const onBarCodeScanned = ({ type, data }: { type: string; data: string }) => {
    try {
      const obj = JSON.parse(data);
      if (obj.device_id) setDeviceId(obj.device_id);
      if (obj.name) setDeviceName(obj.name);
      if (obj.location) setLocation(obj.location);
      if (obj.wifi?.ssid) setSsid(obj.wifi.ssid);
      if (obj.wifi?.password) setPassword(obj.wifi.password);
      setScanningQR(false);
      setMessage('Config loaded from QR');
    } catch (e:any) {
      setScanningQR(false);
      setError('Failed to parse QR content. Ensure it is valid JSON.');
    }
  };

  const onSendConfig = async () => {
    setError(null); setMessage(null);
    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr) { setError(userErr.message); return; }
    const uid = userRes?.user?.id;
    if (!uid) { setError('Not signed in'); return; }
    const up = {
      device_id: deviceId,
      name: deviceName,
      location,
      wifi_ssid: ssid,
      status: 'offline',
      config: payload,
      user_id: uid,
      updated_at: new Date().toISOString(),
    };
    const { error: upErr } = await supabase.from('devices').upsert(up, { onConflict: 'device_id' });
    if (upErr) setError(upErr.message);
    else setMessage('Configuration saved. Device can fetch via edge function.');
  };

  const formatAgo = (iso?: string | null) => {
    if (!iso) return '-';
    const dt = new Date(iso);
    const diff = Math.floor((Date.now() - dt.getTime()) / 60000);
    if (diff < 1) return 'just now';
    if (diff < 60) return `${diff} min ago`;
    const h = Math.floor(diff/60);
    return `${h} h ago`;
  };

  const onTestConnection = async () => {
    setError(null); setMessage(null);

    // Try to reach device locally (AP or mDNS)
    const ping = async (url: string, timeoutMs = 1500): Promise<boolean> => {
      try {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(id);
        return res.ok;
      } catch {
        return false;
      }
    };

    const candidates = [
      'http://esp32.local/health',
      'http://esp32.local/ping',
      'http://192.168.4.1/health',
      'http://192.168.4.1/ping',
    ];
    let deviceReachable = false;
    for (const u of candidates) {
      // eslint-disable-next-line no-await-in-loop
      if (await ping(u)) { deviceReachable = true; break; }
    }

    // Supabase connectivity check (simple read)
    const { data: one, error: supaErr } = await supabase
      .from('devices')
      .select('device_id')
      .limit(1);
    const supabaseConnected = !supaErr;

    // Data flow check: recent last_seen within 5 minutes
    const { data, error: qErr } = await supabase
      .from('devices')
      .select('last_seen,status,wifi_signal,updated_at')
      .eq('device_id', deviceId)
      .maybeSingle();
    if (qErr) { setError(qErr.message); return; }

    let dataFlowWorking = false;
    if (data?.last_seen) {
      const last = new Date(data.last_seen as any).getTime();
      dataFlowWorking = (Date.now() - last) < 5 * 60 * 1000;
    }

    const lastText = data?.last_seen ? formatAgo(data.last_seen as any) : '-';
    const st = (data?.status as string) || 'offline';

    if (deviceReachable && supabaseConnected && dataFlowWorking) {
      setMessage(`All connection tests passed! Status: ${st}, Last: ${lastText}, WiFi: ${data?.wifi_signal ?? '-'}%`);
    } else {
      const parts: string[] = [];
      if (!deviceReachable) parts.push('Device unreachable');
      if (!supabaseConnected) parts.push('Supabase connection failed');
      if (!dataFlowWorking) parts.push('Data reporting inactive');
      setMessage(`Some tests failed (${parts.join(', ')}). Status: ${st}, Last: ${lastText}, WiFi: ${data?.wifi_signal ?? '-'}%`);
    }
  };

  const onSaveDevice = async () => {
    setError(null); setMessage(null);
    try {
      const { data: userRes, error: userErr } = await supabase.auth.getUser();
      if (userErr) { setError(userErr.message); return; }
      const uid = userRes?.user?.id;
      if (!uid) { setError('Not signed in'); return; }
      const up = {
        device_id: deviceId,
        name: deviceName,
        location,
        wifi_ssid: ssid || null,
        user_id: uid,
        updated_at: new Date().toISOString(),
      };
      const { error: upErr } = await supabase.from('devices').upsert(up, { onConflict: 'device_id' });
      if (upErr) setError(upErr.message);
      else {
        setMessage('Saved');
        try { if ((navigation as any)?.canGoBack?.()) navigation.goBack(); } catch {}
      }
    } catch (e:any) {
      setError(e?.message || 'Save failed');
    }
  };

  const onCancel = () => {
    try { if ((navigation as any)?.canGoBack?.()) navigation.goBack(); } catch {}
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.colors.background }]} contentContainerStyle={{ paddingBottom: 24 }}>
      <Text variant="headlineSmall" style={[styles.title, { color: theme.colors.primary }]}>
        Device Configuration
      </Text>
      
      <Card style={[styles.card, { backgroundColor: theme.colors.surface, borderWidth: 2, borderColor: theme.colors.surfaceVariant, borderRadius: 18 }]}>
        <Card.Content>
          <Text variant="titleMedium" style={{ marginBottom: 8, color: theme.colors.onSurface }}>
            Device Info
          </Text>
          <TextInput
            label="Device Name"
            value={deviceName}
            onChangeText={setDeviceName}
            style={styles.input}
            mode="outlined"
            outlineColor={theme.colors.outline}
            activeOutlineColor={theme.colors.primary}
          />
          <TextInput
            label="Location"
            value={location}
            onChangeText={setLocation}
            style={styles.input}
            mode="outlined"
            outlineColor={theme.colors.outline}
            activeOutlineColor={theme.colors.primary}
          />
          <TextInput
            label="Device ID"
            value={deviceId}
            onChangeText={setDeviceId}
            style={styles.input}
            mode="outlined"
            outlineColor={theme.colors.outline}
            activeOutlineColor={theme.colors.primary}
          />
        </Card.Content>
      </Card>
    
      {/* Your Devices section removed per request */}
    
      <Card style={[styles.card, { backgroundColor: theme.colors.surface, borderWidth: 2, borderColor: theme.colors.surfaceVariant, borderRadius: 18 }]}>
        <Card.Title title="Network Settings" />
        <Card.Content>
          <TextInput label="WiFi SSID" value={ssid} onChangeText={setSsid} style={styles.input} />
          <TextInput label="WiFi Password" value={password} onChangeText={setPassword} secureTextEntry style={styles.input} />
          <View style={styles.row}>
            <Button mode="contained" onPress={onScanNetworks} loading={scanning}>Scan Networks</Button>
            {networks.length > 0 && (
              <View style={{ marginLeft: 12, flex: 1 }}>
                {networks.map(n => (
                  <Button key={n} compact onPress={() => setSsid(n)}>{n}</Button>
                ))}
              </View>
            )}
          </View>
        </Card.Content>
      </Card>
    
      <Card style={[styles.card, { backgroundColor: theme.colors.surface, borderWidth: 2, borderColor: theme.colors.surfaceVariant, borderRadius: 18 }]}>
        <Card.Title title="Actions" />
        <Card.Content>
          <View style={styles.row}>
            <Button mode="contained" onPress={onGenerateQR} style={styles.actionBtn}>Generate Config QR</Button>
            <Button mode="contained" onPress={startScanQR} style={styles.actionBtn}>Scan Config QR</Button>
            <Button mode="contained" onPress={onSendConfig} style={styles.actionBtn}>Send Config to Device</Button>
            <Button mode="outlined" onPress={onProvisionToDeviceAP} loading={apProvisioning} style={styles.actionBtn}>Send to Device AP</Button>
            <Button mode="outlined" onPress={onTestConnection} style={styles.actionBtn}>Test Connection</Button>
          </View>
          <Divider style={styles.divider} />
          {qrValue ? (
            <View style={{ alignItems: 'center' }}>
              <QRCode value={qrValue} size={200} backgroundColor="#FFFFFF" />
              <Text style={{ marginTop: 8 }}>Scan this QR with provisioning app or device agent.</Text>
            </View>
          ) : (
            <Text>Generate a QR to share WiFi + API config.</Text>
          )}
          {message && <Text style={{ color: '#3D405B', marginTop: 8 }}>{message}</Text>}
          {error && <Text style={{ color: '#EF476F', marginTop: 8 }}>{error}</Text>}
        </Card.Content>
      </Card>

      <Portal>
        <Dialog visible={showAddDialog} onDismiss={() => setShowAddDialog(false)}>
          <Dialog.Title>Scan or Paste Config</Dialog.Title>
          <Dialog.Content>
            <Text style={{ marginBottom: 8 }}>On web, paste the QR JSON if camera scanning is unavailable.</Text>
            <TextInput label="QR JSON" value={pastedConfig} onChangeText={setPastedConfig} multiline />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setShowAddDialog(false)}>Cancel</Button>
            <Button onPress={applyPastedConfig}>Load</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      {scanningQR && Platform.OS !== 'web' && (
        <View style={styles.scannerOverlay}>
          <Camera
            type={CameraType.back}
            onBarCodeScanned={onBarCodeScanned as any}
            barCodeScannerSettings={{ barCodeTypes: ['qr'] } as any}
            style={styles.scanner}
          />
          <View style={{ position: 'absolute', bottom: 24, left: 0, right: 0, alignItems: 'center' }}>
            <Button mode="contained" onPress={() => setScanningQR(false)}>Cancel</Button>
          </View>
        </View>
      )}

      {/* Footer: Cancel / Save */}
      <Card style={[styles.card, { backgroundColor: theme.colors.surface, borderWidth: 2, borderColor: theme.colors.surfaceVariant, borderRadius: 18 }]}>
        <Card.Content>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
            <Button mode="text" onPress={onCancel} style={{ marginRight: 8 }}>Cancel</Button>
            <Button mode="contained" onPress={onSaveDevice}>Save</Button>
          </View>
        </Card.Content>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  title: { marginBottom: 8 },
  card: { marginBottom: 12, borderRadius: 18 },
  input: { marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  actionBtn: { marginRight: 8 },
  divider: { marginVertical: 12 },
  scannerOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000000' },
  scanner: { width: '100%', height: '100%' },
});