import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Card, Text, Switch, Button, HelperText, Checkbox, SegmentedButtons, useTheme, TextInput, Dialog, Portal } from 'react-native-paper';
import { getNotificationHistory, NotificationHistoryItem } from '../../utils/notifications';
import { supabase } from '../../supabaseClient';
import { IdleToySettings, runIdleScan } from '../../reminders/idleToy';
import { loadIdleToySettings, saveIdleToySettings } from '../../utils/reminderSettings';

// Settings centralized in Supabase with local fallback

function formatTime(ts: number) {
  try { return new Date(ts).toLocaleString(); } catch { return String(ts); }
}
function getToyNameFromBody(body?: string) {
  if (!body) return undefined as any;
  const prefix = 'Friendly reminder: ';
  const s = body.startsWith(prefix) ? body.slice(prefix.length) : body;
  let m = s.match(/^(.+?) has been played/i);
  if (m && m[1]) return m[1];
  m = s.match(/^(.+?) (has been idle|hasn't played)/i);
  if (m && m[1]) return m[1];
  m = s.replace(/^温馨提示：/, '').match(/^(?:(.+?)的)?(.+?)已连续玩\s*(\d+)\s*分钟/i);
  if (m) { const toy = m[2]; return toy?.trim(); }
  return undefined as any;
}

export default function IdleToySettingsScreen() {
  const theme = useTheme();
  const [enabled, setEnabled] = useState(false);
  const [days, setDays] = useState<string>('14');
  const [smartSuggest, setSmartSuggest] = useState(true);
  const [info, setInfo] = useState('');
  const [scanDialogOpen, setScanDialogOpen] = useState(false);
  const [scanItems, setScanItems] = useState<NotificationHistoryItem[]>([]);
  const [scanLoading, setScanLoading] = useState<boolean>(false);
  const [scanInfo, setScanInfo] = useState<string>('');

  useEffect(() => { (async () => { const s = await loadIdleToySettings(); setEnabled(s.enabled); setDays(String(s.days)); setSmartSuggest(s.smartSuggest); })(); }, []);

  const onSave = async () => {
    const n = parseInt(days, 10);
    const s: IdleToySettings = { enabled, days: isNaN(n) ? 14 : n, smartSuggest };
    const res = await saveIdleToySettings(s);
    if (!res.remoteSaved) {
      if (res.error === 'not_logged_in') {
        setInfo('Saved locally. Please sign in to sync to cloud.');
      } else {
        setInfo(`Saved locally. Cloud sync failed: ${res.error ?? 'unknown error'}`);
      }
    } else {
      setInfo('Idle Toy Reminder settings saved to cloud.');
    }
  };

  const onRunScan = async () => {
    const n = parseInt(days, 10);
    await runIdleScan({ enabled, days: isNaN(n) ? 14 : n, smartSuggest });
    setInfo('Idle scan triggered. Notifications will be sent for idle toys.');
  };

  const setPreset = (n: number) => setDays(String(n));

  const uniqueThresholds = (custom: number): number[] => {
    const set = new Set<number>([custom, 7, 30]);
    return Array.from(set).sort((a, b) => a - b);
  };

  const openScan = async () => {
    setScanInfo('');
    setScanLoading(true);
    setScanDialogOpen(true);
    const n = parseInt(days, 10);
    const threshold = isNaN(n) ? 14 : n;
    const thresholds = uniqueThresholds(threshold);

    let liveItems: NotificationHistoryItem[] = [];
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes?.user?.id;
      if (!uid) {
        setScanInfo('Not signed in. Showing local history if available.');
      }
      const { data: toys } = await supabase.from('toys').select('id,name');
      const arr = (toys || []) as any[];
      if (arr.length === 0) {
        setScanInfo((prev) => prev ? prev + ' No toys found in cloud.' : 'No toys found in cloud.');
      }
      for (const t of arr) {
        const tid = t.id as string;
        const name = (t.name as string) || 'Toy';
        const { data: last } = await supabase
          .from('play_sessions')
          .select('scan_time')
          .eq('toy_id', tid)
          .order('scan_time', { ascending: false })
          .limit(1);
        const lastScan = ((last || [])[0]?.scan_time as string) || null;
        const lastTime = lastScan ? new Date(lastScan).getTime() : 0;
        const daysSince = Math.floor((Date.now() - lastTime) / (24 * 60 * 60 * 1000));
        if (!lastScan) {
          const stageToUse = thresholds[0];
          liveItems.push({ id: `${tid}_never_${stageToUse}`, title: 'Idle Toy Reminder', body: `Friendly reminder: ${name} has not been played with yet (no play history).`, timestamp: Date.now(), source: `idleToy:${tid}:${stageToUse}` });
        } else if (daysSince >= threshold) {
          liveItems.push({ id: `${tid}_${lastScan}`, title: 'Idle Toy Reminder', body: `Friendly reminder: ${name} hasn't been played with for ${daysSince} days. It's waiting for you!`, timestamp: Date.now(), source: `idleToy:${tid}:${threshold}` });
        }
      }
      liveItems = liveItems.slice(0, 20);
    } catch (e) {
      setScanInfo('Cloud scan failed. Showing local history if available.');
    }
    const all = await getNotificationHistory();
    const historyItems = (all || []).sort((a, b) => b.timestamp - a.timestamp).slice(0, 20);
    const itemsToShow = liveItems.length ? liveItems : historyItems;
    setScanItems(itemsToShow);
    setScanLoading(false);
  };
  const closeScan = () => setScanDialogOpen(false);

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
          <Dialog.Title style={{ fontSize: 16 }}>Recent reminders</Dialog.Title>
          <Dialog.Content style={{ paddingHorizontal: 4 }}>
            {!!scanInfo && <Text style={{ marginBottom: 6, opacity: 0.7, fontSize: 12 }}>{scanInfo}</Text>}
            <View style={{ maxHeight: 380 }}>
              {scanLoading ? (
                <Text style={{ opacity: 0.8 }}>Scanning…</Text>
              ) : scanItems.length === 0 ? (
                <Text>No records.</Text>
              ) : (
                scanItems.map((it) => {
                  const name = getToyNameFromBody(it.body || '') || 'Toy';
                  return (
                    <View key={it.id} style={{ marginBottom: 6 }}>
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