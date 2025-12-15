import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Card, TextInput, Button, Switch, Divider, List, HelperText, useTheme } from 'react-native-paper';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { supabase } from '../../supabaseClient';
import type { Reader } from '../../types';
import { listReaderEvents, type ReaderEvent } from '../../utils/readerEvents';
import { updateReader } from '../../utils/readers';
import { discoverDevices, type DiscoveredDevice } from '../../utils/zeroconf';

type Props = NativeStackScreenProps<any>;

export default function DeviceDetailScreen({ route }: Props) {
  const deviceId: string = route?.params?.device_id;
  const theme = useTheme();
  const [reader, setReader] = useState<Reader | null>(null);
  const [deviceRow, setDeviceRow] = useState<any | null>(null);
  const [events, setEvents] = useState<ReaderEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Config form
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [readPower, setReadPower] = useState<'low'|'medium'|'high'>('medium');
  const [scanInterval, setScanInterval] = useState<number>(1000);
  const [autoScan, setAutoScan] = useState<boolean>(true);
  const [beepOn, setBeepOn] = useState<boolean>(false);

  const [lanDevices, setLanDevices] = useState<DiscoveredDevice[]>([]);
  const [discovering, setDiscovering] = useState(false);

  const loadReader = async () => {
    setLoading(true); setError(null); setMessage(null);
    const { data, error } = await supabase
      .from('readers')
      .select('*')
      .eq('device_id', deviceId)
      .maybeSingle();
    if (error) setError(error.message);
    const r = data as Reader | null;
    setReader(r || null);
    setName(r?.name || '');
    setLocation(r?.location || '');
    const cfg: any = r?.config || {};
    if (cfg.read_power) setReadPower(cfg.read_power);
    if (cfg.scan_interval) setScanInterval(Number(cfg.scan_interval));
    if (typeof cfg.auto_scan === 'boolean') setAutoScan(cfg.auto_scan);
    if (typeof cfg.beep_on === 'boolean') setBeepOn(cfg.beep_on);
    setLoading(false);
  };

  const loadDeviceRow = async () => {
    const { data, error } = await supabase
      .from('devices')
      .select('status,last_seen,wifi_signal,wifi_ssid,fw_version,uptime_s,free_heap')
      .eq('device_id', deviceId)
      .maybeSingle();
    if (error) setError(error.message);
    setDeviceRow(data || null);
  };

  const loadEvents = async () => {
    const { data, error } = await listReaderEvents(deviceId, 50);
    if (error) setError(error);
    setEvents(data);
  };

  useEffect(() => { loadReader(); loadEvents(); loadDeviceRow(); }, [deviceId]);

  const saveConfig = async () => {
    setError(null); setMessage(null);
    const cfg = { read_power: readPower, scan_interval: scanInterval, auto_scan: autoScan, beep_on: beepOn };
    const { error } = await updateReader(deviceId, { name, location, config: cfg });
    if (error) setError(error); else setMessage('Configuration saved');
  };

  const prettyEvent = (evt: ReaderEvent) => {
    const t = evt.event_type;
    const p = evt.payload || {};
    if (t === 'heartbeat') return `Heartbeat · RSSI=${p?.rssi ?? '-'} · uptime=${p?.uptime ?? '-'} · ${new Date(evt.created_at).toLocaleTimeString()}`;
    if (t === 'rfid_read') return `RFID read · tag=${p?.tag_id ?? '-'} · ${new Date(evt.created_at).toLocaleTimeString()}`;
    if (t === 'status') return `Status · ${p?.status ?? '-'} · ${new Date(evt.created_at).toLocaleTimeString()}`;
    if (t === 'error') return `Error · ${p?.code ?? '-'} · ${p?.message ?? ''} · ${new Date(evt.created_at).toLocaleTimeString()}`;
    if (t === 'config_applied') return `Config applied · ${new Date(evt.created_at).toLocaleTimeString()}`;
    return `${t} · ${new Date(evt.created_at).toLocaleTimeString()}`;
  };

  const onDiscover = async () => {
    setDiscovering(true); setError(null); setMessage(null);
    const found = await discoverDevices(5000);
    setLanDevices(found);
    setDiscovering(false);
    if (found.length === 0) setMessage('No devices found on LAN (Expo Go environment or mDNS service not enabled)');
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.colors.background }] }>
      <Text variant="headlineMedium" style={[styles.title, { color: theme.colors.primary }]}>Device Details</Text>
      <Text style={{ marginBottom: 8 }}>ID: {deviceId}</Text>

      <Card style={[styles.card, { backgroundColor: theme.colors.surface, borderWidth: 2, borderColor: theme.colors.surfaceVariant, borderRadius: 18 }]}> 
        <Card.Title title="Device Status" right={() => (
          <Button compact onPress={loadDeviceRow}>Refresh</Button>
        )} />
        <Card.Content>
          {!deviceRow ? (
            <Text>No device row</Text>
          ) : (
            <View style={{ gap: 6 }}>
              <Text>Status: {deviceRow.status || '-'}</Text>
              <Text>Last seen: {deviceRow.last_seen ? new Date(deviceRow.last_seen).toLocaleString() : '-'}</Text>
              <Text>Wi‑Fi: {deviceRow.wifi_ssid || '-'} · RSSI={typeof deviceRow.wifi_signal==='number'? deviceRow.wifi_signal : '-'}</Text>
              <Divider style={{ marginVertical: 6 }} />
              <Text>Firmware: {deviceRow.fw_version || '-'}</Text>
              <Text>Uptime: {typeof deviceRow.uptime_s==='number' ? `${deviceRow.uptime_s}s` : '-'}</Text>
              <Text>Free heap: {typeof deviceRow.free_heap==='number' ? `${deviceRow.free_heap} B` : '-'}</Text>
            </View>
          )}
        </Card.Content>
      </Card>

      <Card style={[styles.card, { backgroundColor: theme.colors.surface, borderWidth: 2, borderColor: theme.colors.surfaceVariant, borderRadius: 18 }]}>
        <Card.Title title="Hardware Config" />
        <Card.Content>
          <TextInput label="Name" mode="outlined" value={name} onChangeText={setName} style={styles.input} />
          <TextInput label="Location" mode="outlined" value={location} onChangeText={setLocation} style={styles.input} />
          <View style={styles.row}><Text>Read Power</Text>
            <View style={styles.row}>
              <Button mode={readPower==='low'?'contained':'outlined'} onPress={() => setReadPower('low')}>Low</Button>
              <Button style={{ marginLeft: 6 }} mode={readPower==='medium'?'contained':'outlined'} onPress={() => setReadPower('medium')}>Medium</Button>
              <Button style={{ marginLeft: 6 }} mode={readPower==='high'?'contained':'outlined'} onPress={() => setReadPower('high')}>High</Button>
            </View>
          </View>
          <TextInput label="Scan Interval (ms)" mode="outlined" value={String(scanInterval)} keyboardType="numeric" onChangeText={(t)=>setScanInterval(Number(t)||0)} style={styles.input} />
          <View style={styles.row}><Text>Auto Scan</Text><Switch value={autoScan} onValueChange={setAutoScan} /></View>
          <View style={styles.row}><Text>Beep On Read</Text><Switch value={beepOn} onValueChange={setBeepOn} /></View>
          <View style={styles.row}>
            <Button mode="contained" onPress={saveConfig}>Save</Button>
            {message && <HelperText type="info" style={{ marginLeft: 8 }}>{message}</HelperText>}
            {error && <HelperText type="error" style={{ marginLeft: 8 }}>{error}</HelperText>}
          </View>
        </Card.Content>
      </Card>

      <Card style={[styles.card, { backgroundColor: theme.colors.surface, borderWidth: 2, borderColor: theme.colors.surfaceVariant, borderRadius: 18 }]}>
        <Card.Title title="Recent Events" right={() => (
          <Button compact onPress={loadEvents}>Refresh</Button>
        )} />
        <Card.Content>
          {events.length === 0 ? <Text>No events</Text> : (
            events.map(e => (
              <List.Item key={e.id} title={prettyEvent(e)} description={`type=${e.event_type}`} />
            ))
          )}
        </Card.Content>
      </Card>

      <Card style={[styles.card, { backgroundColor: theme.colors.surface, borderWidth: 2, borderColor: theme.colors.surfaceVariant, borderRadius: 18 }]}>
        <Card.Title title="LAN Discovery (mDNS)" right={() => (
          <Button compact onPress={onDiscover} loading={discovering}>Scan</Button>
        )} />
        <Card.Content>
          {lanDevices.length === 0 ? <Text>No devices found</Text> : (
            lanDevices.map((d, idx) => (
              <List.Item key={`${d.ip}-${idx}`} title={`${d.name || 'Device'} · ${d.ip || d.host || ''}:${d.port || 80}`} description={d.fullName || ''} />
            ))
          )}
        </Card.Content>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 /* backgroundColor moved to theme */ },
  title: { marginBottom: 8 /* color moved to theme */ },
  card: { marginBottom: 12, borderRadius: 18 /* backgroundColor moved to theme */ },
  input: { marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
});