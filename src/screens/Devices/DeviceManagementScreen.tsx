import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView, RefreshControl, Platform } from 'react-native';
import { Text, Card, List, Divider, useTheme, IconButton } from 'react-native-paper';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { supabase } from '../../supabaseClient';
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
    const { data, error } = await supabase.from('devices').select('*').order('created_at', { ascending: false });
    if (error) setError(error.message);
    else setDevices((data || []) as SupabaseDevice[]);
  };

  useEffect(() => { fetchDevices(); }, []);

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

  // Online/Offline 显示规则：与 Supabase devices.status 字段保持一致
  const onlineDevices = useMemo(() => devices.filter(d => String(d.status || '').toLowerCase() === 'online'), [devices]);
  const offlineDevices = useMemo(() => devices.filter(d => String(d.status || '').toLowerCase() !== 'online'), [devices]);

  const onReconfigure = (d: SupabaseDevice) => {
    navigation.navigate('DeviceConfig', { preset: d });
  };

  // Optional: delete device (not requested, so hidden from UI)
  const deleteDevice = async (deviceId: string) => {
    const { error } = await supabase.from('devices').delete().eq('device_id', deviceId);
    if (error) setError(error.message); else { setMessage('Device deleted'); fetchDevices(); }
  };

  const onRefresh = async () => {
    try {
      setRefreshing(true);
      await fetchDevices();
    } finally {
      setRefreshing(false);
    }
  };

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
                    description={`${device.location || 'Unknown'} • last seen ${formatAgo(device.last_seen || undefined)}${device.wifi_ssid ? ` • SSID: ${device.wifi_ssid}` : ''}${typeof device.wifi_signal === 'number' ? ` • Signal: ${device.wifi_signal}` : ''}`}
                    titleStyle={{ color: theme.colors.onSurface, fontFamily: headerFont }}
                    descriptionStyle={{ color: theme.colors.onSurfaceVariant }}
                    titleNumberOfLines={2}
                    descriptionNumberOfLines={2}
                    left={(props) => (
                      <MaterialCommunityIcons name="router-wireless" size={24} color={theme.colors.primary} />
                    )}
                    right={(props) => (
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', columnGap: 0, marginRight: -12 }}>
                        <IconButton icon="information-outline" size={20} style={{ marginHorizontal: -6 }} onPress={() => navigation.navigate('DeviceDetail', { device_id: device.device_id })} />
                        <IconButton icon="pencil" size={20} style={{ marginHorizontal: -6 }} onPress={() => navigation.navigate('DeviceConfig', { preset: device })} />
                        <IconButton icon="delete-outline" size={20} style={{ marginHorizontal: -6 }} iconColor={theme.colors.error} onPress={() => deleteDevice(device.device_id)} />
                      </View>
                    )}
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
                    description={`${device.location || 'Unknown'} • last seen ${formatAgo(device.last_seen || undefined)}${device.wifi_ssid ? ` • SSID: ${device.wifi_ssid}` : ''}${typeof device.wifi_signal === 'number' ? ` • Signal: ${device.wifi_signal}` : ''}`}
                    titleStyle={{ color: theme.colors.onSurface, fontFamily: headerFont }}
                    descriptionStyle={{ color: theme.colors.onSurfaceVariant }}
                    titleNumberOfLines={2}
                    descriptionNumberOfLines={2}
                    left={(props) => (
                      <MaterialCommunityIcons name="router-wireless" size={24} color={theme.colors.onSurfaceVariant} />
                    )}
                    right={(props) => (
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', columnGap: 0, marginRight: -12 }}>
                        <IconButton icon="information-outline" size={20} style={{ marginHorizontal: -6 }} onPress={() => navigation.navigate('DeviceDetail', { device_id: device.device_id })} />
                        <IconButton icon="pencil" size={20} style={{ marginHorizontal: -6 }} onPress={() => navigation.navigate('DeviceConfig', { preset: device })} />
                        <IconButton icon="delete-outline" size={20} style={{ marginHorizontal: -6 }} iconColor={theme.colors.error} onPress={() => deleteDevice(device.device_id)} />
                      </View>
                    )}
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
        {message && (
          <Card style={[styles.cardSection, { backgroundColor: theme.colors.primaryContainer, borderWidth: 0, borderRadius: 20 }]}> 
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
