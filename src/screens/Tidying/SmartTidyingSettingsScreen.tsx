import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Card, Text, Switch, Button, HelperText, Chip, TextInput, useTheme, Dialog, Portal } from 'react-native-paper';
import { getNotificationHistory, NotificationHistoryItem } from '../../utils/notifications';
import * as SecureStore from 'expo-secure-store';
import { cancelAllReminders, scheduleSmartTidying } from '../../utils/notifications';
import { useNavigation } from '@react-navigation/native';

const KEY = 'smart_tidying_settings';

type Repeat = 'daily' | 'weekends' | 'weekdays';

type TidyingSettings = {
  enabled: boolean;
  time: string; // HH:MM (24h)
  repeat: Repeat;
  dndStart?: string; // HH:MM
  dndEnd?: string; // HH:MM
};

async function loadSettings(): Promise<TidyingSettings> {
  try { const raw = await SecureStore.getItemAsync(KEY); if (raw) return JSON.parse(raw); } catch {}
  return { enabled: false, time: '20:00', repeat: 'daily', dndStart: '22:00', dndEnd: '07:00' };
}

async function saveSettings(s: TidyingSettings) { try { await SecureStore.setItemAsync(KEY, JSON.stringify(s)); } catch {} }

function parseTime(str: string): { hour: number; minute: number } {
  const m = str.match(/^(\d{1,2}):(\d{2})$/);
  const h = m ? parseInt(m[1], 10) : 20; const min = m ? parseInt(m[2], 10) : 0;
  return { hour: Math.min(23, Math.max(0, h)), minute: Math.min(59, Math.max(0, min)) };
}

export default function SmartTidyingSettingsScreen() {
  const theme = useTheme();
  const nav = useNavigation<any>();
  const [enabled, setEnabled] = useState(false);
  const [time, setTime] = useState('20:00');
  const [repeat, setRepeat] = useState<Repeat>('daily');
  const [dndStart, setDndStart] = useState('22:00');
  const [dndEnd, setDndEnd] = useState('07:00');
  const [info, setInfo] = useState('');
  const [scanDialogOpen, setScanDialogOpen] = useState(false);
  const [scanItems, setScanItems] = useState<NotificationHistoryItem[]>([]);

  useEffect(() => { (async () => { const s = await loadSettings(); setEnabled(s.enabled); setTime(s.time); setRepeat(s.repeat); setDndStart(s.dndStart || ''); setDndEnd(s.dndEnd || ''); })(); }, []);

  function withinDnd(t: string, start?: string, end?: string) {
    if (!start || !end) return false;
    const toMin = (s: string) => {
      const m = s.match(/^(\d{1,2}):(\d{2})$/); if (!m) return null; return parseInt(m[1],10)*60 + parseInt(m[2],10);
    };
    const tt = toMin(t); const ss = toMin(start); const ee = toMin(end);
    if (tt==null || ss==null || ee==null) return false;
    // handle overnight window
    if (ss <= ee) { return tt >= ss && tt < ee; }
    // e.g., 22:00-07:00
    return tt >= ss || tt < ee;
  }

  const onSave = async () => {
    const s: TidyingSettings = { enabled, time, repeat, dndStart, dndEnd };
    await saveSettings(s);
    setInfo('Smart tidy-up settings saved.');
    await cancelAllReminders();
    if (enabled) {
      const { hour, minute } = parseTime(time);
      if (withinDnd(time, dndStart, dndEnd)) {
        setInfo('The selected time is within Do Not Disturb. The system may still show notifications; consider adjusting the time.');
      }
      await scheduleSmartTidying('Tidy-up time!', "It's time to help toys go home! Tap to view the checklist.", hour, minute, repeat);
    }
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

  const openScan = async () => {
    const all = await getNotificationHistory();
    const items = all
      .filter((i) => (i.source || '').toLowerCase() === 'smarttidying')
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 20);
    setScanItems(items);
    setScanDialogOpen(true);
  };
  const closeScan = () => setScanDialogOpen(false);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}> 
      <Text variant="headlineMedium" style={{ marginBottom: 8 }}>Smart Tidy-up Reminder</Text>
      <Card style={[styles.card, { backgroundColor: theme.colors.surface, borderWidth: 2, borderColor: theme.colors.surfaceVariant, borderRadius: 16 }]}> 
        <Card.Content>
          <View style={styles.rowBetween}>
            <Text>Master Switch</Text>
            <Switch value={enabled} onValueChange={setEnabled} />
          </View>

          <Text style={{ marginTop: 12 }}>Daily tidy-up time</Text>
          <View style={[styles.rowBetween, { marginTop: 8 }]}> 
            <Text>HH:MM</Text>
            <TextInput value={time} onChangeText={setTime} placeholder="20:00" dense style={{ width: 120, height: 36 }} />
          </View>

          <Text style={{ marginTop: 12 }}>Repeat</Text>
          <View style={[styles.row, { marginTop: 8 }]}> 
            <Chip selected={repeat==='daily'} onPress={() => setRepeat('daily')} style={styles.chip}>Daily</Chip>
            <Chip selected={repeat==='weekends'} onPress={() => setRepeat('weekends')} style={styles.chip}>Weekends</Chip>
            <Chip selected={repeat==='weekdays'} onPress={() => setRepeat('weekdays')} style={styles.chip}>Weekdays</Chip>
          </View>

          <Text style={{ marginTop: 12, fontWeight: '700' }}>Do Not Disturb</Text>
          <View style={[styles.rowBetween, { marginTop: 8 }]}> 
            <Text>Start (HH:MM)</Text>
            <TextInput value={dndStart} onChangeText={setDndStart} placeholder="22:00" dense style={{ width: 120, height: 36 }} />
          </View>
          <View style={[styles.rowBetween, { marginTop: 8 }]}> 
            <Text>End (HH:MM)</Text>
            <TextInput value={dndEnd} onChangeText={setDndEnd} placeholder="07:00" dense style={{ width: 120, height: 36 }} />
          </View>

          {/* 说明语句按需求删除，保持页面更紧凑 */}

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
          <Dialog.Title style={{ fontSize: 16 }}>Recent smart tidy-up reminders</Dialog.Title>
          <Dialog.Content style={{ paddingHorizontal: 8 }}>
            <View style={{ maxHeight: 380 }}>
              {scanItems.length === 0 ? (
                <Text>No records.</Text>
              ) : (
                scanItems.map((it) => (
                  <View key={it.id} style={{ marginBottom: 8 }}>
                    <Text style={{ fontWeight: '600', fontSize: 14 }}>{it.title}</Text>
                    <Text style={{ opacity: 0.7, fontSize: 12 }}>{formatTime(it.timestamp)}</Text>
                    {it.body ? <Text style={{ opacity: 0.8, fontSize: 12 }}>{it.body}</Text> : null}
                  </View>
                ))
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
  chip: { marginRight: 8 },
});