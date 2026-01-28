import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView, Platform } from 'react-native';
import { Card, Text, Switch, Button, HelperText, Checkbox, SegmentedButtons, useTheme, TextInput, Dialog, Portal, Snackbar } from 'react-native-paper';
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
  const headerFont = Platform.select({ ios: 'Arial Rounded MT Bold', android: 'sans-serif-medium', default: 'System' });
  const [snackbarVisible, setSnackbarVisible] = useState(false);
  const [snackbarMsg, setSnackbarMsg] = useState('');

  useEffect(() => { (async () => { const s = await loadIdleToySettings(); setEnabled(s.enabled); setDays(String(s.days)); setSmartSuggest(s.smartSuggest); })(); }, []);

  const onSave = async () => {
    const n = parseInt(days, 10);
    const s: IdleToySettings = { enabled, days: isNaN(n) ? 14 : n, smartSuggest };
    const res = await saveIdleToySettings(s);
    setInfo('');
    setSnackbarMsg('Idle Toy Reminder is saved');
    setSnackbarVisible(true);
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
    <ScrollView 
      style={[styles.container, { backgroundColor: theme.colors.background }]} 
      contentContainerStyle={[
        { paddingBottom: 24 },
        Platform.OS === 'web' && { width: '100%', maxWidth: 1000, alignSelf: 'center', paddingHorizontal: 32 }
      ]}
    >
      <Text variant="headlineMedium" style={{ marginBottom: 8, fontFamily: headerFont }}>Idle Toy Reminder</Text>
      <Card style={[styles.card, { backgroundColor: theme.colors.surface }]}> 
        <Card.Content>
          <View style={styles.rowBetween}>
            <Text style={{ fontFamily: headerFont }}>Master Switch</Text>
            <Switch value={enabled} onValueChange={setEnabled} />
          </View>

          <View style={[styles.rowBetween, { marginTop: 12 }]}>
            <Text style={{ fontFamily: headerFont }}>Idle duration</Text>
            <Text style={{ fontFamily: headerFont, color: theme.colors.onSurfaceVariant, fontSize: 12 }}>
              Current: {isNaN(parseInt(days, 10)) ? 14 : parseInt(days, 10)} days
            </Text>
          </View>
          <View style={[styles.row, { marginTop: 8 }]}> 
            <Button mode="outlined" compact onPress={() => setPreset(7)} labelStyle={{ fontFamily: headerFont }}>7 days</Button>
            <Button mode="outlined" compact style={{ marginHorizontal: 8 }} onPress={() => setPreset(30)} labelStyle={{ fontFamily: headerFont }}>30 days</Button>
            <Button mode="outlined" compact onPress={() => setPreset(90)} labelStyle={{ fontFamily: headerFont }}>90 days</Button>
          </View>
          <View style={[styles.rowBetween, { marginTop: 8 }]}> 
            <Text style={{ fontFamily: headerFont }}>Custom (days)</Text>
            <TextInput value={days} onChangeText={setDays} keyboardType="numeric" style={{ width: 80 }} contentStyle={{ fontFamily: headerFont }} />
          </View>

          <Checkbox.Item label="Include helpful suggestion in reminders" status={smartSuggest ? 'checked' : 'unchecked'} onPress={() => setSmartSuggest(!smartSuggest)} labelStyle={{ fontSize: 13, fontWeight: '400' }} />

          {/* 说明语句按需求删除，页面更紧凑 */}

          {info ? <HelperText type="info" style={{ fontFamily: headerFont }}>{info}</HelperText> : null}
        </Card.Content>
        <Card.Actions>
          <Button mode="outlined" onPress={openScan} style={{ borderColor: theme.colors.primary }} textColor={theme.colors.primary} labelStyle={{ fontFamily: headerFont }}>Scan</Button>
          <Button onPress={onRunScan} mode="outlined" style={{ borderColor: theme.colors.primary }} textColor={theme.colors.primary} labelStyle={{ fontFamily: headerFont }}>Run Scan</Button>
          <Button onPress={onSave} mode="outlined" style={{ borderColor: theme.colors.primary }} textColor={theme.colors.primary} labelStyle={{ fontFamily: headerFont }}>Save Changes</Button>
        </Card.Actions>
      </Card>
      <Portal>
        <Dialog visible={scanDialogOpen} onDismiss={closeScan} style={{ borderRadius: 10 }}>
          <Dialog.Title style={{ fontSize: 16, fontFamily: headerFont }}>Recent reminders</Dialog.Title>
          <Dialog.Content style={{ paddingHorizontal: 4 }}>
            {!!scanInfo && <Text style={{ marginBottom: 6, opacity: 0.7, fontSize: 12, fontFamily: headerFont }}>{scanInfo}</Text>}
            <View style={{ maxHeight: 380 }}>
              {scanLoading ? (
                <Text style={{ opacity: 0.8, fontFamily: headerFont }}>Scanning…</Text>
              ) : scanItems.length === 0 ? (
                <Text style={{ fontFamily: headerFont }}>No records.</Text>
              ) : (
                scanItems.map((it) => {
                  const name = getToyNameFromBody(it.body || '') || 'Toy';
                  return (
                    <View key={it.id} style={{ marginBottom: 6 }}>
                      <Text style={{ fontWeight: '600', fontSize: 14, fontFamily: headerFont }}>{name}</Text>
                      <Text style={{ opacity: 0.7, fontSize: 12, fontFamily: headerFont }}>{formatTime(it.timestamp)} · {it.title}</Text>
                      {it.body ? <Text style={{ opacity: 0.8, fontSize: 12, fontFamily: headerFont }}>{it.body}</Text> : null}
                    </View>
                  );
                })
              )}
            </View>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={closeScan} labelStyle={{ fontFamily: headerFont }}>Close</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
      <Snackbar visible={snackbarVisible} onDismiss={() => setSnackbarVisible(false)} duration={2000} style={{ backgroundColor: theme.colors.secondaryContainer, alignSelf: 'center' }} wrapperStyle={{ position: 'absolute', top: '45%', left: 0, right: 0 }}>
        <Text style={{ fontFamily: headerFont, color: theme.colors.onSecondaryContainer, textAlign: 'center' }}>{snackbarMsg}</Text>
      </Snackbar>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 8 },
  card: { borderRadius: 10 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: { flexDirection: 'row', alignItems: 'center' },
});
