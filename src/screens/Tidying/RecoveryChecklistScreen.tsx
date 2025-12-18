import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView, Platform } from 'react-native';
import { Card, Text, Checkbox, Button, ProgressBar, useTheme, Avatar, HelperText } from 'react-native-paper';
import { supabase } from '../../supabaseClient';
import { LinearGradient } from 'expo-linear-gradient';
import { cartoonGradient } from '../../theme/tokens';
import { MaterialCommunityIcons } from '@expo/vector-icons';

interface ChecklistItem {
  id: string;
  name: string;
  photo_url?: string;
  location?: string | null;
  outMs?: number;
  owner?: string | null;
  checked: boolean;
}

export default function RecoveryChecklistScreen() {
  const theme = useTheme();
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [info, setInfo] = useState('');

  const headerFont = Platform.select({ ios: 'Arial Rounded MT Bold', android: 'sans-serif-medium', default: 'System' });

  const progress = useMemo(() => {
    const total = items.length || 1;
    const done = items.filter(i => i.checked).length;
    return done / total;
  }, [items]);

  const formatOutDuration = (ms?: number) => {
    if (!ms || ms < 0) return 'out';
    const m = Math.floor(ms / 60000);
    const h = Math.floor(m / 60);
    const mm = m % 60;
    if (h > 0) return `${h}h ${mm}m out`;
    return `${mm}m out`;
  };

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.from('toys').select('id,name,photo_url,status,location,owner');
        const arr = (data || []) as any[];
        const outToys = arr.filter(t => t.status === 'out');
        const toyIds = outToys.map((t: any) => t.id);
        let latestByToy: Record<string, string> = {};
        if (toyIds.length) {
          const { data: sessions } = await supabase
            .from('play_sessions')
            .select('toy_id,scan_time')
            .in('toy_id', toyIds)
            .order('scan_time', { ascending: false });
          (sessions || []).forEach((row: any) => {
            const tid = row?.toy_id; const st = row?.scan_time;
            if (!tid || !st) return;
            if (!latestByToy[tid]) latestByToy[tid] = st;
          });
        }
        const now = Date.now();
        setItems(outToys.map(t => {
          const startISO = latestByToy[t.id];
          const outMs = startISO ? (now - new Date(startISO).getTime()) : undefined;
          return { id: t.id, name: t.name || 'Toy', photo_url: t.photo_url || undefined, location: t.location || null, outMs, owner: t.owner || null, checked: false };
        }));
      } catch {}
    })();
  }, []);

  const toggle = (id: string) => setItems(prev => prev.map(i => i.id === id ? { ...i, checked: !i.checked } : i));

  const onSave = async () => {
    const checked = items.filter(i => i.checked);
    if (checked.length === 0) { setInfo('Please select toys you have tidied up first'); return; }
    setSaving(true);
    try {
      for (const it of checked) {
        await supabase.from('toys').update({ status: 'in' }).eq('id', it.id);
      }
      setItems(prev => prev.filter(i => !i.checked));
      setInfo('Selected toys have been marked as in-stock');
    } catch (e: any) {
      setInfo('Save failed: ' + (e?.message || 'unknown error'));
    }
    setSaving(false);
  };

  return (
    <LinearGradient colors={cartoonGradient} style={{ flex: 1 }}>
    <ScrollView 
      style={[styles.container, { backgroundColor: 'transparent' }]} 
      contentContainerStyle={[
        { paddingBottom: 24 },
        Platform.OS === 'web' && { width: '100%', maxWidth: 1000, alignSelf: 'center', paddingHorizontal: 32 }
      ]}
    >
      <Text variant="titleMedium" style={{ marginBottom: 8, fontFamily: headerFont }}>Help your toys find their way home</Text>

      <Card style={[styles.card, { backgroundColor: theme.colors.surface, borderWidth: 0, borderRadius: 20 }]}> 
        <Card.Content>
          <Text style={{ marginBottom: 8, fontFamily: headerFont }}>Completed {items.filter(i => i.checked).length}/{items.length}</Text>
          <ProgressBar progress={progress} color={theme.colors.primary} style={{ height: 8, borderRadius: 4 }} />
        </Card.Content>
      </Card>

      {items.map(item => (
        <Card key={item.id} style={[styles.card, { backgroundColor: theme.colors.surface, borderWidth: 0, borderRadius: 20 }]}> 
          <Card.Content>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {item.photo_url ? (
                <Avatar.Image source={{ uri: item.photo_url }} size={48} style={{ marginRight: 12 }} />
              ) : (
                <Avatar.Icon icon="cube-outline" size={48} style={{ marginRight: 12, backgroundColor: theme.colors.secondaryContainer }} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={[item.checked ? styles.checkedText : undefined, { fontFamily: headerFont }]}>{item.name}</Text>
                {item.location ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                    <MaterialCommunityIcons name="map-marker" size={14} color={theme.colors.onSurfaceVariant} style={{ marginRight: 6 }} />
                    <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 13, fontFamily: headerFont }}>{item.location}</Text>
                  </View>
                ) : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                  <MaterialCommunityIcons name="clock-outline" size={14} color={theme.colors.onSurfaceVariant} style={{ marginRight: 6 }} />
                  <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 13, fontFamily: headerFont }}>{formatOutDuration(item.outMs)}</Text>
                </View>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                {item.owner ? (
                  <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 13, fontFamily: headerFont, marginBottom: 6 }}>{item.owner}</Text>
                ) : null}
                <Checkbox status={item.checked ? 'checked' : 'unchecked'} onPress={() => toggle(item.id)} />
              </View>
            </View>
          </Card.Content>
        </Card>
      ))}

      {items.length > 0 && items.every(i => i.checked) ? (
        <Card style={[styles.card, { backgroundColor: theme.colors.primaryContainer, borderWidth: 0, borderRadius: 20 }]}> 
          <Card.Content>
            <Text style={{ color: theme.colors.onPrimaryContainer, fontFamily: headerFont }}>Awesome! All toys are safely home! 🎉</Text>
          </Card.Content>
        </Card>
      ) : null}

      <View style={{ paddingVertical: 8 }}>
        {info ? <HelperText type="info" style={{ fontFamily: headerFont }}>{info}</HelperText> : null}
      </View>
    </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  card: { marginBottom: 12 },
  checkedText: { textDecorationLine: 'line-through', color: '#888' },
});
