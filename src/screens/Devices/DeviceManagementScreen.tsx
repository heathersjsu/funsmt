import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Card, Button, List, Divider, TextInput, useTheme, IconButton } from 'react-native-paper';
import { Camera } from 'expo-camera';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { supabase } from '../../supabaseClient';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { Reader } from '../../types';
import { listReaders, createReader, deleteReader, updateReader, formatAgo } from '../../utils/readers';
import { subscribeReaderEvents, type ReaderEvent } from '../../utils/readerEvents';
import { cartoonGradient } from '../../theme/tokens';

type Props = NativeStackScreenProps<any>;
type Device = {
  id?: string;
  device_id: string;
  name?: string;
  location?: string;
  wifi_signal?: number | null;
  status?: 'online' | 'offline' | string;
  last_seen?: string | null;
};

const formatDeviceAgo = (iso?: string | null) => {
  if (!iso) return '-';
  const dt = new Date(iso);
  const diff = Math.floor((Date.now() - dt.getTime()) / 60000);
  if (diff < 1) return 'just now';
  if (diff < 60) return `${diff} min ago`;
  const h = Math.floor(diff/60);
  return `${h} h ago`;
};

const signalBars = (signal?: number | null) => {
  if (signal == null) return '     ';
  const bars = Math.round(Math.min(100, Math.max(0, signal)) / 20);
  return '█'.repeat(bars) + ' '.repeat(5 - bars);
};

export default function DeviceManagementScreen({ navigation }: Props) {
  const theme = useTheme();
  const [devices, setDevices] = useState<Device[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Readers state
  const [readers, setReaders] = useState<Reader[]>([]);
  const [creating, setCreating] = useState(false);
  const [rName, setRName] = useState('');
  const [rLocation, setRLocation] = useState('');
  const [rDeviceId, setRDeviceId] = useState('');

  // Tick to recompute online/offline every minute
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  // Latest events map: device_id -> text
  const [latestEvents, setLatestEvents] = useState<Record<string, string>>({});
  useEffect(() => {
    const stop = subscribeReaderEvents((evt: ReaderEvent) => {
      const text = evt.event_type === 'rfid_read'
        ? `RFID: ${evt.payload?.tag_id || ''}`
        : evt.event_type === 'heartbeat'
          ? `HB ${evt.payload?.rssi ?? ''}`
          : evt.event_type;
      setLatestEvents(prev => ({ ...prev, [evt.device_id]: text }));
    });
    return () => { try { stop(); } catch {} };
  }, []);

  // fetchDevices removed: using readers only

  const fetchReaders = async () => {
    const { data, error } = await listReaders();
    if (error) setError(error);
    else setReaders(data || []);
  };

  useEffect(() => { fetchReaders(); }, []);

  // Realtime: subscribe readers changes only
  useEffect(() => {
    const readersCh = supabase
      .channel('readers-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'readers' }, (payload: any) => {
        setReaders(prev => {
          const r = (payload.new || payload.old) as any;
          if (!r?.device_id) return prev;
          if (payload.eventType === 'DELETE') {
            return prev.filter(x => x.device_id !== r.device_id);
          }
          const idx = prev.findIndex(x => x.device_id === r.device_id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = { ...next[idx], ...(payload.new as Reader) };
            return next;
          }
          return [(payload.new as Reader), ...prev];
        });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(readersCh);
    };
  }, []);

  // removed devices online/offline computations; using readers lists below

  // Online status rule: authoritative by readers.is_online only (no last_seen fallback)
  const onlineReaders = useMemo(() => readers.filter(r => !!(r as any).is_online), [readers]);
  const offlineReaders = useMemo(() => readers.filter(r => !(r as any).is_online), [readers]);
  const onReconfigure = (d: Device) => {
    navigation.navigate('DeviceConfig', { preset: d });
  };

  const onRestart = async (d: Device) => {
    setError(null); setMessage(null);
    const { data: userRes } = await supabase.auth.getUser();
    const uid = userRes?.user?.id;
    const { error } = await supabase.from('device_commands').insert({ device_id: d.device_id, user_id: uid, command: 'reboot', payload: {} });
    if (error) setError(error.message);
    else setMessage(`Restart command queued for ${d.device_id}`);
  };

  // removed device logs feature per request

  const [scanOpen, setScanOpen] = useState(false);
  const [hasCamPermission, setHasCamPermission] = useState<boolean | null>(null);

  const openScanner = async () => {
    setError(null); setMessage(null);
    try {
      const { status } = await Camera.requestCameraPermissionsAsync();
      if (status === 'granted') {
        setHasCamPermission(true);
        setScanOpen(true);
      } else {
        setHasCamPermission(false);
        setError('Camera permission denied');
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to request camera permission');
    }
  };

  const onScanned = ({ data }: { data: string }) => {
    if (!data) return;
    setRDeviceId(data);
    setScanOpen(false);
    setMessage('Device ID scanned');
  };

  const handleCreateReader = async () => {
    if (!rName || !rDeviceId) {
      setError('Name and Device ID are required');
      return;
    }
    const { error } = await createReader({
      device_id: rDeviceId,
      name: rName,
      location: rLocation,
    });
    if (error) {
      setError(error);
    } else {
      setMessage('Reader created successfully');
      setRName('');
      setRLocation('');
      setRDeviceId('');
      setCreating(false);
      fetchReaders();
    }
  };

  const handleDeleteReader = async (deviceId: string) => {
    const { error } = await deleteReader(deviceId);
    if (error) {
      setError(error);
    } else {
      setMessage('Reader deleted successfully');
      fetchReaders();
    }
  };

  return (
    <LinearGradient colors={cartoonGradient} style={{ flex: 1 }}>
      <ScrollView style={[styles.container, { backgroundColor: 'transparent' }]} contentContainerStyle={styles.content}>
        <Text variant="headlineSmall" style={[styles.title, { color: theme.colors.primary }]}> 
          Device Management
        </Text>

        {/* Readers Section */}
        <Card style={[styles.cardSection, { backgroundColor: theme.colors.surface }]}> 
          {/* Removed header title and Add button per request */}
          <Card.Content>
            {false && <View />}

            {/* Online Section */}
            <List.Subheader style={{ color: theme.colors.onSurface }}>Online</List.Subheader>
            {onlineReaders.length === 0 ? (
              <Text style={{ color: theme.colors.onSurfaceVariant }}>No online devices</Text>
            ) : (
              onlineReaders.map((reader, idx) => (
                <View key={`on-${reader.device_id}`}>
                  <List.Item
                    title={reader.name || reader.device_id}
                    description={`${reader.location || 'Unknown'} • online • ${formatAgo(reader.last_seen_at)}`}
                    titleStyle={{ color: theme.colors.onSurface }}
                    descriptionStyle={{ color: theme.colors.onSurfaceVariant }}
                    titleNumberOfLines={2}
                    descriptionNumberOfLines={2}
                    left={(props) => (
                      <MaterialCommunityIcons name="router-wireless" size={24} color={theme.colors.primary} />
                    )}
                    right={(props) => (
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', columnGap: 0, marginRight: -12 }}>
                        <IconButton icon="information-outline" size={20} style={{ marginHorizontal: -6 }} onPress={() => navigation.navigate('DeviceDetail', { device_id: reader.device_id })} />
                        <IconButton icon="pencil" size={20} style={{ marginHorizontal: -6 }} onPress={() => navigation.navigate('DeviceConfig', { preset: { device_id: reader.device_id, name: reader.name, location: reader.location } })} />
                        <IconButton icon="delete-outline" size={20} style={{ marginHorizontal: -6 }} iconColor={theme.colors.error} onPress={() => handleDeleteReader(reader.device_id)} />
                      </View>
                    )}
                  />
                  {idx < onlineReaders.length - 1 && <Divider />}
                </View>
              ))
            )}
          
            <Divider style={styles.divider} />
          
            {/* Offline Section */}
            <List.Subheader style={{ color: theme.colors.onSurface }}>Offline</List.Subheader>
            {offlineReaders.length === 0 ? (
              <Text style={{ color: theme.colors.onSurfaceVariant }}>No offline devices</Text>
            ) : (
              offlineReaders.map((reader, idx) => (
                <View key={`off-${reader.device_id}`}>
                  <List.Item
                    title={reader.name || reader.device_id}
                    description={`${reader.location || 'Unknown'} • offline • ${formatAgo(reader.last_seen_at)}`}
                    titleStyle={{ color: theme.colors.onSurface }}
                    descriptionStyle={{ color: theme.colors.onSurfaceVariant }}
                    titleNumberOfLines={2}
                    descriptionNumberOfLines={2}
                    left={(props) => (
                      <MaterialCommunityIcons name="router-wireless" size={24} color={theme.colors.onSurfaceVariant} />
                    )}
                    right={(props) => (
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', columnGap: 0, marginRight: -12 }}>
                        <IconButton icon="information-outline" size={20} style={{ marginHorizontal: -6 }} onPress={() => navigation.navigate('DeviceDetail', { device_id: reader.device_id })} />
                        <IconButton icon="pencil" size={20} style={{ marginHorizontal: -6 }} onPress={() => navigation.navigate('DeviceConfig', { preset: { device_id: reader.device_id, name: reader.name, location: reader.location } })} />
                        <IconButton icon="delete-outline" size={20} style={{ marginHorizontal: -6 }} iconColor={theme.colors.error} onPress={() => handleDeleteReader(reader.device_id)} />
                      </View>
                    )}
                  />
                  {idx < offlineReaders.length - 1 && <Divider />}
                </View>
              ))
            )}
          </Card.Content>
        </Card>

        {/* Error/Message Display */}
        {error && (
          <Card style={[styles.cardSection, { backgroundColor: theme.colors.errorContainer }]}> 
            <Card.Content>
              <Text style={{ color: theme.colors.onErrorContainer }}>{error}</Text>
            </Card.Content>
          </Card>
        )}
        {message && (
          <Card style={[styles.cardSection, { backgroundColor: theme.colors.primaryContainer }]}> 
            <Card.Content>
              <Text style={{ color: theme.colors.onPrimaryContainer }}>{message}</Text>
            </Card.Content>
          </Card>
        )}
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  content: { paddingBottom: 24 },
  title: { marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardSection: { marginBottom: 12, borderRadius: 20 },
  divider: { marginVertical: 8 },
  bannerCard: { borderRadius: 20, marginBottom: 12 },
  bannerTitle: { fontSize: 22, fontWeight: '700' },
  bannerSubtitle: { fontSize: 16, marginTop: 4 },
});