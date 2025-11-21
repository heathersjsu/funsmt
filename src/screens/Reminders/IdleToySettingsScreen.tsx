import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Card, Text, Switch, Button, HelperText, Checkbox, SegmentedButtons, useTheme, TextInput, Dialog, Portal } from 'react-native-paper';
import { getNotificationHistory, NotificationHistoryItem } from '../../utils/notifications';
import * as SecureStore from 'expo-secure-store';
import { IdleToySettings, runIdleScan } from '../../reminders/idleToy';

const KEY = 'reminder_idletoy_settings';

async function loadSettings(): Promise<IdleToySettings> {
  try { const raw = await SecureStore.getItemAsync(KEY); if (raw) return JSON.parse(raw); } catch {}
  return { enabled: false, days: 14, smartSuggest: true };
}
async function saveSettings(s: IdleToySettings) { try { await SecureStore.setItemAsync(KEY, JSON.stringify(s)); } catch {} }

export default function IdleToySettingsScreen() {
  const theme = useTheme();
  const [enabled, setEnabled] = useState(false);
  const [days, setDays] = useState<string>('14');
  const [smartSuggest, setSmartSuggest] = useState(true);
  const [info, setInfo] = useState('');
  const [scanDialogOpen, setScanDialogOpen] = useState(false);
  const [scanItems, setScanItems] = useState<NotificationHistoryItem[]>([]);

  useEffect(() => { (async () => { const s = await loadSettings(); setEnabled(s.enabled); setDays(String(s.days)); setSmartSuggest(s.smartSuggest); })(); }, []);

  const onSave = async () => {
    const n = parseInt(days, 10);
    const s: IdleToySettings = { enabled, days: isNaN(n) ? 14 : n, smartSuggest };
    await saveSettings(s);
    setInfo('Idle Toy Reminder settings saved.');
  };

  const onRunScan = async () => {
    const n = parseInt(days, 10);
    await runIdleScan({ enabled, days: isNaN(n) ? 14 : n, smartSuggest });
    setInfo('Idle scan triggered. Notifications will be sent for idle toys.');
  };

  const setPreset = (n: number) => setDays(String(n));

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}> 
      <Text variant="headlineMedium" style={{ marginBottom: 8 }}>Idle Toy Reminder</Text>
      <Card style={[styles.card, { backgroundColor: theme.colors.surface }]}> 
        <Card.Content>
          <View style={styles.rowBetween}>
            <Text>Master Switch</Text>
            <Switch value={enabled} onValueChange={setEnabled} />
          </View>

          <Text style={{ marginTop: 12 }}>Idle duration</Text>
          <View style={[styles.row, { marginTop: 8 }]}> 
            <Button mode="outlined" compact onPress={() => setPreset(7)}>7 days</Button>
            <Button mode="outlined" compact style={{ marginHorizontal: 8 }} onPress={() => setPreset(30)}>30 days</Button>
            <Button mode="outlined" compact onPress={() => setPreset(90)}>90 days</Button>
          </View>
          <View style={[styles.rowBetween, { marginTop: 8 }]}> 
            <Text>Custom (days)</Text>
            <TextInput value={days} onChangeText={setDays} keyboardType="numeric" style={{ width: 80 }} />
          </View>

          <Checkbox.Item label="Include helpful suggestion in reminders" status={smartSuggest ? 'checked' : 'unchecked'} onPress={() => setSmartSuggest(!smartSuggest)} />

          {/* 说明语句按需求删除，页面更紧凑 */}

          {info ? <HelperText type="info">{info}</HelperText> : null}
        </Card.Content>
        <Card.Actions>
          <Button mode="outlined" onPress={openScan}>Scan now</Button>
          <Button onPress={onRunScan} mode="outlined">Run scan now</Button>
          <Button onPress={onSave} mode="contained">Save</Button>
        </Card.Actions>
      </Card>
      <Portal>
        <Dialog visible={scanDialogOpen} onDismiss={closeScan} style={{ borderRadius: 10 }}>
          <Dialog.Title style={{ fontSize: 16 }}>Recent idle toys</Dialog.Title>
          <Dialog.Content>
            <View style={{ maxHeight: 380 }}>
              {scanItems.length === 0 ? (
                <Text>No records.</Text>
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
  card: { borderRadius: 10 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: { flexDirection: 'row', alignItems: 'center' },
});
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
    const idx = body.indexOf(" hasn't played with you");
    if (idx > 0) return body.slice(0, idx).trim();
    return null;
  };

  const openScan = async () => {
    const all = await getNotificationHistory();
    const items = all
      .filter((i) => (i.source || '').toLowerCase() === 'idletoy')
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 20);
    setScanItems(items);
    setScanDialogOpen(true);
  };
  const closeScan = () => setScanDialogOpen(false);