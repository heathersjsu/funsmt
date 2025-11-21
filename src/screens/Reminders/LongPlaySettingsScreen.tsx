import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Card, Text, Switch, TextInput, Button, Checkbox, HelperText, useTheme, Dialog, Portal } from 'react-native-paper';
import { getNotificationHistory, NotificationHistoryItem } from '../../utils/notifications';
import * as SecureStore from 'expo-secure-store';
import { startLongPlayMonitor, stopLongPlayMonitor, LongPlaySettings } from '../../reminders/longPlay';
import { supabase } from '../../supabaseClient';

const KEY = 'reminder_longplay_settings';

async function loadSettings(): Promise<LongPlaySettings> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { enabled: false, durationMin: 45, methods: { push: true, inApp: true } };
}

async function saveSettings(s: LongPlaySettings) {
  try { await SecureStore.setItemAsync(KEY, JSON.stringify(s)); } catch {}
}

export default function LongPlaySettingsScreen() {
  const theme = useTheme();
  const [enabled, setEnabled] = useState<boolean>(false);
  const [durationMin, setDurationMin] = useState<string>('45');
  const [push, setPush] = useState<boolean>(true);
  const [inApp, setInApp] = useState<boolean>(true);
  const [info, setInfo] = useState<string>('');
  const [scanDialogOpen, setScanDialogOpen] = useState(false);
  const [scanItems, setScanItems] = useState<NotificationHistoryItem[]>([]);
  const [scanTitle, setScanTitle] = useState('');

  useEffect(() => {
    (async () => {
      const s = await loadSettings();
      setEnabled(s.enabled);
      setDurationMin(String(s.durationMin));
      setPush(s.methods.push);
      setInApp(s.methods.inApp);
      if (s.enabled) startLongPlayMonitor(s);
    })();
    return () => { stopLongPlayMonitor(); };
  }, []);

  const onMinus = () => { const n = Math.max(1, parseInt(durationMin, 10) - 5); setDurationMin(String(n)); };
  const onPlus = () => { const n = Math.min(360, parseInt(durationMin, 10) + 5); setDurationMin(String(n)); };

  const onSave = async () => {
    const n = parseInt(durationMin, 10);
    const s: LongPlaySettings = { enabled, durationMin: isNaN(n) ? 45 : n, methods: { push, inApp } };
    await saveSettings(s);
    setInfo('Long Play Reminder settings saved.');
    stopLongPlayMonitor();
    if (s.enabled) startLongPlayMonitor(s);
  };

  const formatTime = (ts: number) => {
    try {
      const d = new Date(ts);
      const now = new Date();
      const sameDay = d.toDateString() === now.toDateString();
      const hh = d.getHours().toString().padStart(2, '0');
      const mm = d.getMinutes().toString().padStart(2, '0');
      const md = `${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')}`;
      return sameDay ? `${hh}:${mm}` : `${md} ${hh}:${mm}`;
    } catch { return ''; }
  };

  const getToyNameFromBody = (body?: string): string | null => {
    if (!body) return null;
    const idx = body.indexOf(' has been played');
    if (idx > 0) return body.slice(0, idx).trim();
    return null;
  };

  const openScan = async () => {
    const min = parseInt(durationMin, 10);
    const thresholdMs = (isNaN(min) ? 45 : min) * 60 * 1000;
    // 1) 实时扫描：找出当前正在 Playing 且已超过阈值的玩具
    let liveItems: NotificationHistoryItem[] = [];
    try {
      const { data: toys } = await supabase
        .from('toys')
        .select('id,name,status')
        .eq('status', 'out');
      const toyIds = (toys || []).map((t: any) => t.id);
      if (toyIds.length) {
        const { data: sessions } = await supabase
          .from('play_sessions')
          .select('toy_id,scan_time')
          .in('toy_id', toyIds)
          .order('scan_time', { ascending: false });
        const latestByToy: Record<string, string> = {};
        (sessions || []).forEach((row: any) => {
          const tid = row?.toy_id; const st = row?.scan_time;
          if (!tid || !st) return;
          if (!latestByToy[tid]) latestByToy[tid] = st; // 首条为最新
        });
        liveItems = (toys || [])
          .map((t: any) => {
            const startISO = latestByToy[t.id];
            if (!startISO) return null;
            const start = new Date(startISO).getTime();
            const durMs = Date.now() - start;
            if (durMs < thresholdMs) return null;
            const durMin = Math.floor(durMs / 60000);
            const title = 'Long Play';
            const body = `${t.name || 'Toy'} has been playing for ${durMin} minutes`;
            return { id: `${t.id}_${startISO}`, title, body, timestamp: Date.now(), source: 'longplay' } as NotificationHistoryItem;
          })
          .filter(Boolean) as NotificationHistoryItem[];
        // 只保留信号（时长）最长的 3 个
        liveItems = liveItems
          .sort((a, b) => (b.body || '').localeCompare(a.body || ''))
          .slice(0, 3);
      }
    } catch {}

    // 2) History fallback
    const all = await getNotificationHistory();
    const historyItems = all
      .filter((i) => (i.source || '').toLowerCase() === 'longplay')
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 20);

    const itemsToShow = liveItems.length ? liveItems : historyItems;
    setScanTitle(liveItems.length ? 'Currently exceeding play threshold' : 'Recent Long Play reminders');
    setScanItems(itemsToShow);
    setScanDialogOpen(true);
  };
  const closeScan = () => setScanDialogOpen(false);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}> 
      <Text variant="headlineMedium" style={{ marginBottom: 8 }}>Long Play Reminder</Text>
      <Card style={[styles.card, { backgroundColor: theme.colors.surface, borderWidth: 2, borderColor: theme.colors.surfaceVariant, borderRadius: 16 }]}> 
        <Card.Content>
          <View style={styles.rowBetween}>
            <Text>Master Switch</Text>
            <Switch value={enabled} onValueChange={setEnabled} />
          </View>
          <View style={[styles.rowBetween, { marginTop: 12 }]}> 
            <Text>Duration (minutes)</Text>
            {/* 仅保留一个输入框，统一尺寸 */}
            <TextInput
              value={durationMin}
              onChangeText={setDurationMin}
              keyboardType="numeric"
              dense
              style={{ width: 120, height: 36 }}
            />
          </View>
          <Text style={{ marginTop: 12, marginBottom: 4 }}>Reminder Methods</Text>
          <View style={styles.row}> 
            <Checkbox.Item label="Push notification" status={push ? 'checked' : 'unchecked'} onPress={() => setPush(!push)} />
            <Checkbox.Item label="In-app tip" status={inApp ? 'checked' : 'unchecked'} onPress={() => setInApp(!inApp)} />
          </View>
          {/* 说明语句按需求删除，页面更紧凑 */}
          {info ? <HelperText type="info">{info}</HelperText> : null}
        </Card.Content>
        <Card.Actions>
          <Button mode="outlined" onPress={openScan}>Scan now</Button>
          {/* Save 与 Scan now 保持一致的样式 */}
          <Button mode="outlined" onPress={onSave}>Save</Button>
        </Card.Actions>
      </Card>
      <Portal>
        {/* 弹窗保留小号标题 */}
        <Dialog visible={scanDialogOpen} onDismiss={closeScan} style={{ borderRadius: 16 }}>
          <Dialog.Title style={{ fontSize: 16 }}>{scanTitle || 'Recent Long Play reminders'}</Dialog.Title>
          <Dialog.Content style={{ paddingHorizontal: 8 }}>
            <View style={{ maxHeight: 380 }}>
              {scanItems.length === 0 ? (
                <Text>No records yet. Please enable Long Play and set the duration; records will appear after actual play.</Text>
              ) : (
                scanItems.map((it) => {
                  const name = getToyNameFromBody(it.body || '') || 'Toy';
                  return (
                    <View key={it.id} style={{ marginBottom: 8 }}>
                      <Text style={{ fontWeight: '600', fontSize: 14 }}>{name}</Text>
                      <Text style={{ opacity: 0.7, fontSize: 12 }}>{formatTime(it.timestamp)} · {it.title}</Text>
                      {it.body ? <Text style={{ opacity: 0.8, fontSize: 12 }}>{it.body}</Text> : null}
                    </View>
                  );
                })
              )}
            </View>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={closeScan}>Close</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  card: { borderRadius: 16 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: { flexDirection: 'row', alignItems: 'center' },
});