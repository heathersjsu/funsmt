import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView, RefreshControl, Platform } from 'react-native';
import { Text, Card, List, Divider, useTheme, IconButton, Snackbar } from 'react-native-paper';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { supabase } from '../../supabaseClient';
import { pushLog } from '../../utils/envDiagnostics';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { Device } from '../../types';
import { formatAgo } from '../../utils/readers';
import { cartoonGradient } from '../../theme/tokens';

type Props = NativeStackScreenProps<any>;

// Supabase devices table columns reference:
// device_id, user_id, name, location, status, wifi_signal, last_seen, config, wifi_ssid, wifi_password, created_at
type SupabaseDevice = {
  device_id: string;
  user_id?: string | null;
  name?: string | null;
  location?: string | null;
  status?: string | null; // e.g., 'online' | 'offline'
  wifi_signal?: number | null; // RSSI or percentage
  last_seen?: string | null; // ISO timestamp
  config?: any | null;
  wifi_ssid?: string | null;
  wifi_password?: string | null;
  created_at?: string | null;
};

export default function DeviceManagementScreen({ navigation }: Props) {
  const theme = useTheme();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Devices state
  const [devices, setDevices] = useState<SupabaseDevice[]>([]);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  // Realtime 已订阅 devices 表，状态实时更新；无需按 5 分钟阈值轮询
  // 如需定期刷新，可保留轻量 tick，但本实现改为直接依据 Supabase devices.status 字段

  // No reader events here; devices list is from Supabase 'devices' table

  const fetchDevices = async () => {
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u?.user?.id || null;
      console.log('fetchDevices session uid:', uid);
      if (!uid) { setError('Not signed in yet (web session). Waiting for session...'); setDevices([]); try { pushLog('Devices: Web session uid missing; waiting for INITIAL_SESSION/SIGNED_IN'); } catch {} return; }
      const { data, error } = await supabase.from('devices').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      
      const rows = (data || []) as SupabaseDevice[];
      setDevices(rows);
      try { pushLog(`Devices: query ok, rows=${rows.length}`); } catch {}
      
      // Cache success result
      if (Platform.OS === 'web') {
        try { localStorage.setItem('pinme_devices_cache', JSON.stringify(rows)); } catch {}
      }
    } catch (e: any) {
      const msg = e?.message || 'Failed to load devices';
      setError(msg);
      try { pushLog(`Devices: query error ${msg}`); } catch {}
      
      // Fallback to cache
      if (Platform.OS === 'web') {
        try {
          const raw = localStorage.getItem('pinme_devices_cache');
          if (raw) {
            const cached = JSON.parse(raw);
            if (Array.isArray(cached) && cached.length > 0) {
              setDevices(cached as SupabaseDevice[]);
              setError(`Network error (${msg}). Showing cached devices.`);
              try { pushLog(`Devices: using cached devices (${cached.length})`); } catch {}
              return;
            }
          }
        } catch {}
      }
      setDevices([]);
    }
  };

  useEffect(() => { fetchDevices(); }, []);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((evt, session) => {
      console.log('auth state change:', evt, !!session);
      if (evt === 'INITIAL_SESSION' || evt === 'SIGNED_IN' || evt === 'TOKEN_REFRESHED') {
        fetchDevices();
      }
      if (evt === 'SIGNED_OUT') {
        setDevices([]);
      }
    });
    return () => { try { sub?.subscription?.unsubscribe(); } catch {} };
  }, []);

  // Realtime: subscribe devices table changes
  useEffect(() => {
    const ch = supabase
      .channel('devices-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'devices' }, (payload: any) => {
        setDevices(prev => {
          const d = (payload.new || payload.old) as SupabaseDevice;
          if (!d?.device_id) return prev;
          if (payload.eventType === 'DELETE') {
            return prev.filter(x => x.device_id !== d.device_id);
          }
          const idx = prev.findIndex(x => x.device_id === d.device_id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = { ...next[idx], ...(payload.new as SupabaseDevice) };
            return next;
          }
          return [(payload.new as SupabaseDevice), ...prev];
        });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  // Online/Offline 显示规则：
  // 1. last_seen 在 2 分钟内
  // 2. (可选) status 字段为 'online' —— 但为确保实时性，主要依赖 last_seen
  const isOnline = (d: SupabaseDevice) => {
    if (!d.last_seen) return false;
    const diff = new Date().getTime() - new Date(d.last_seen).getTime();
    return diff < 2 * 60 * 1000; // < 2 mins
  };

  const onlineDevices = useMemo(() => devices.filter(d => isOnline(d)), [devices]);
  const offlineDevices = useMemo(() => devices.filter(d => !isOnline(d)), [devices]);

  const deleteDevice = async (deviceId: string) => {
    const { error } = await supabase.from('devices').delete().eq('device_id', deviceId);
    if (error) setError(error.message); else { setMessage('device deleted'); fetchDevices(); }
  };

  const onRefresh = async () => {
    try {
      setRefreshing(true);
      await fetchDevices();
    } finally {
      setRefreshing(false);
    }
  };

  // Auto-dismiss message after 2s
  useEffect(() => {
    if (message) {
      const t = setTimeout(() => setMessage(null), 2000);
      return () => clearTimeout(t);
    }
  }, [message]);

  const isWeb = Platform.OS === 'web';
  const headerFont = Platform.select({ ios: 'Arial Rounded MT Bold', android: 'sans-serif-medium', default: 'System' });

  return (
    <LinearGradient colors={cartoonGradient} style={{ flex: 1 }}>
      <ScrollView
        style={[styles.container, { backgroundColor: 'transparent' }]}
        contentContainerStyle={[
          styles.content,
          isWeb && { width: '100%', maxWidth: 1000, alignSelf: 'center', paddingHorizontal: 32 }
        ]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Title removed per request; restore readers list with online/offline sections */}

        {/* Devices Section with online/offline grouping, aligned with Supabase 'devices' table */}
        <Card style={[styles.cardSection, { backgroundColor: theme.colors.surface, borderWidth: 0, borderRadius: 20 }]}> 
          <Card.Content>
            <List.Subheader style={{ color: theme.colors.onSurface, fontFamily: headerFont }}>Online</List.Subheader>
            {onlineDevices.length === 0 ? (
              <Text style={{ color: theme.colors.onSurfaceVariant }}>No online devices</Text>
            ) : (
              onlineDevices.map((device, idx) => (
                <View key={`on-${device.device_id}`}>
                  <List.Item
                    title={device.name || device.device_id}
                    description={() => (
                      <View style={{ marginTop: 2 }}>
                        <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 13 }}>
                          {device.location || 'Unknown'} • last seen: {formatAgo(device.last_seen || undefined)}
                        </Text>
                        <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 13, marginTop: 2 }}>
                          SSID: {device.wifi_ssid || 'N/A'}
                        </Text>
                      </View>
                    )}
                    titleStyle={{ color: theme.colors.primary, fontFamily: headerFont }}
                    titleNumberOfLines={2}
                    left={(props) => (
                      <MaterialCommunityIcons name="router-wireless" size={24} color={theme.colors.primary} />
                    )}
                    right={(props) => (
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', columnGap: 0, marginRight: -32 }}>
                        <IconButton icon="pencil" size={20} onPress={() => navigation.navigate('DeviceEdit', { device: device })} />
                        <IconButton icon="delete-outline" size={20} iconColor={theme.colors.error} style={{ margin: -4 }} onPress={() => deleteDevice(device.device_id)} />
                      </View>
                    )}
                    onPress={() => navigation.navigate('DeviceEdit', { device: device })}
                  />
                  {idx < onlineDevices.length - 1 && <Divider />}
                </View>
              ))
            )}
            <Divider style={styles.divider} />
            <List.Subheader style={{ color: theme.colors.onSurface, fontFamily: headerFont }}>Offline</List.Subheader>
            {offlineDevices.length === 0 ? (
              <Text style={{ color: theme.colors.onSurfaceVariant }}>No offline devices</Text>
            ) : (
              offlineDevices.map((device, idx) => (
                <View key={`off-${device.device_id}`}>
                  <List.Item
                    title={device.name || device.device_id}
                    description={() => (
                      <View style={{ marginTop: 2 }}>
                        <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 13 }}>
                          {device.location || 'Unknown'} • last seen: {formatAgo(device.last_seen || undefined)}
                        </Text>
                        <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 13, marginTop: 2 }}>
                          SSID: {device.wifi_ssid || 'N/A'}
                        </Text>
                      </View>
                    )}
                    titleStyle={{ color: theme.colors.onSurface, fontFamily: headerFont }}
                    titleNumberOfLines={2}
                    left={(props) => (
                      <MaterialCommunityIcons name="router-wireless" size={24} color={theme.colors.onSurfaceVariant} />
                    )}
                    right={(props) => (
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', columnGap: 0, marginRight: -32 }}>
                        <IconButton icon="pencil" size={20} onPress={() => navigation.navigate('DeviceEdit', { device: device })} />
                        <IconButton icon="delete-outline" size={20} iconColor={theme.colors.error} style={{ margin: -4 }} onPress={() => deleteDevice(device.device_id)} />
                      </View>
                    )}
                    onPress={() => navigation.navigate('DeviceEdit', { device: device })}
                  />
                  {idx < offlineDevices.length - 1 && <Divider />}
                </View>
              ))
            )}
          </Card.Content>
        </Card>

        {/* Error/Message Display */}
        {error && (
          <Card style={[styles.cardSection, { backgroundColor: theme.colors.errorContainer, borderWidth: 0, borderRadius: 20 }]}> 
            <Card.Content>
              <Text style={{ color: theme.colors.onErrorContainer }}>{error}</Text>
            </Card.Content>
          </Card>
        )}
      </ScrollView>

      {/* Custom Centered Message (No background box) */}
      {message && (
        <View style={{ 
          position: 'absolute', 
          top: 0, bottom: 0, left: 0, right: 0, 
          justifyContent: 'center', alignItems: 'center', 
          zIndex: 9999, pointerEvents: 'none' 
        }}>
          <Text style={{ 
            color: theme.colors.error, // Keep error color or red as per original
            fontSize: 18, 
            fontWeight: 'normal',
            fontFamily: headerFont,
            textShadowColor: 'rgba(255,255,255,0.8)', 
            textShadowRadius: 4
          }}>
            {message}
          </Text>
        </View>
      )}
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
