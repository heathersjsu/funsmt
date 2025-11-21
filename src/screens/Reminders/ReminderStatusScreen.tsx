import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Card, Button, List, useTheme, Switch, TextInput, Checkbox, HelperText, Chip, Dialog, Portal } from 'react-native-paper';
import * as SecureStore from 'expo-secure-store';
import { getFunctionUrl, loadFigmaThemeOverrides, buildKidTheme } from '../../theme';
import { useThemeUpdate } from '../../theme/ThemeContext';
import { supabase } from '../../supabaseClient';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { scheduleLocalDailyCheck, getNotificationHistory, NotificationHistoryItem } from '../../utils/notifications';
import { useNavigation } from '@react-navigation/native';
import { startLongPlayMonitor, stopLongPlayMonitor, LongPlaySettings } from '../../reminders/longPlay';
import { IdleToySettings, runIdleScan } from '../../reminders/idleToy';
import { cancelAllReminders, scheduleSmartTidying } from '../../utils/notifications';
import { LinearGradient } from 'expo-linear-gradient';
import { cartoonGradient } from '../../theme/tokens';

type Props = NativeStackScreenProps<any>;

type DeviceToken = { id?: string; user_id: string; token: string };

export default function ReminderStatusScreen({}: Props) {
  const [tokens, setTokens] = useState<DeviceToken[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const { setTheme } = useThemeUpdate();
  const theme = useTheme();
  const navigation = useNavigation<any>();

  // ---- Scan popup state ----
  const [scanDialogOpen, setScanDialogOpen] = useState(false);
  const [scanItems, setScanItems] = useState<NotificationHistoryItem[]>([]);
  const [scanTitle, setScanTitle] = useState<string>('Recent items');
  const openScan = async (source: 'longPlay' | 'idleToy' | 'smartTidying') => {
    try {
      const all = await getNotificationHistory();
      const items = (all || [])
        .filter((i) => i.source === source)
        .sort((a, b) => (b.timestamp - a.timestamp))
        .slice(0, 20);
      const label = source === 'longPlay' ? 'Long Play — recent 20' : (source === 'idleToy' ? 'Idle Toy — recent 20' : 'Smart Tidy-up — recent 20');
      setScanTitle(label);
      setScanItems(items);
      setScanDialogOpen(true);
    } catch {
      setScanItems([]);
      setScanTitle('Recent items');
      setScanDialogOpen(true);
    }
  };
  const closeScan = () => setScanDialogOpen(false);
  const getToyNameFromBody = (body?: string) => {
    if (!body) return undefined;
    // Long Play: "<Toy> has been played for <n> minutes"
    let m = body.match(/^(.+?) has been played/i);
    if (m && m[1]) return m[1];
    // Idle Toy: "<Toy> has been idle for <n> days" OR "<Toy> hasn't played with you for <n> days"
    m = body.match(/^(.+?) (has been idle|hasn't played)/i);
    if (m && m[1]) return m[1];
    return undefined;
  };
  const formatTime = (ts: number) => {
    try { return new Date(ts).toLocaleString(); } catch { return String(ts); }
  };

  // ---- Long Play inline card state ----
  const [lpEnabled, setLpEnabled] = useState<boolean>(false);
  const [lpDurationMin, setLpDurationMin] = useState<string>('45');
  const [lpPush, setLpPush] = useState<boolean>(true);
  const [lpInApp, setLpInApp] = useState<boolean>(true);
  const [lpInfo, setLpInfo] = useState<string>('');

  const LP_KEY = 'reminder_longplay_settings';
  async function loadLp(): Promise<LongPlaySettings> {
    try { const raw = await SecureStore.getItemAsync(LP_KEY); if (raw) return JSON.parse(raw); } catch {}
    return { enabled: false, durationMin: 45, methods: { push: true, inApp: true } };
  }
  async function saveLp(s: LongPlaySettings) { try { await SecureStore.setItemAsync(LP_KEY, JSON.stringify(s)); } catch {} }

  const onLpMinus = () => { const n = Math.max(1, parseInt(lpDurationMin, 10) - 5); setLpDurationMin(String(n)); };
  const onLpPlus = () => { const n = Math.min(360, parseInt(lpDurationMin, 10) + 5); setLpDurationMin(String(n)); };
  const onLpSave = async () => {
    const n = parseInt(lpDurationMin, 10);
    const s: LongPlaySettings = { enabled: lpEnabled, durationMin: isNaN(n) ? 45 : n, methods: { push: lpPush, inApp: lpInApp } };
    await saveLp(s);
    setLpInfo('Long Play Reminder settings saved.');
    stopLongPlayMonitor();
    if (s.enabled) startLongPlayMonitor(s);
  };

  // ---- Idle Toy inline card state ----
  const IT_KEY = 'reminder_idletoy_settings';
  const [itEnabled, setItEnabled] = useState(false);
  const [itDays, setItDays] = useState<string>('14');
  const [itSmartSuggest, setItSmartSuggest] = useState(true);
  const [itInfo, setItInfo] = useState('');
  async function loadIt(): Promise<IdleToySettings> {
    try { const raw = await SecureStore.getItemAsync(IT_KEY); if (raw) return JSON.parse(raw); } catch {}
    return { enabled: false, days: 14, smartSuggest: true };
  }
  async function saveIt(s: IdleToySettings) { try { await SecureStore.setItemAsync(IT_KEY, JSON.stringify(s)); } catch {} }
  const onItSave = async () => {
    const n = parseInt(itDays, 10);
    const s: IdleToySettings = { enabled: itEnabled, days: isNaN(n) ? 14 : n, smartSuggest: itSmartSuggest };
    await saveIt(s);
    setItInfo('Idle Toy Reminder settings saved.');
  };
  const onItRunScan = async () => {
    const n = parseInt(itDays, 10);
    await runIdleScan({ enabled: itEnabled, days: isNaN(n) ? 14 : n, smartSuggest: itSmartSuggest });
    setItInfo('Idle scan triggered. Notifications will be sent for idle toys.');
  };

  // ---- Smart Tidying inline card state ----
  type Repeat = 'daily' | 'weekends' | 'weekdays';
  type TidyingSettings = { enabled: boolean; time: string; repeat: Repeat; dndStart?: string; dndEnd?: string };
  const ST_KEY = 'smart_tidying_settings';
  const [stEnabled, setStEnabled] = useState(false);
  const [stTime, setStTime] = useState('20:00');
  const [stRepeat, setStRepeat] = useState<Repeat>('daily');
  const [stDndStart, setStDndStart] = useState('22:00');
  const [stDndEnd, setStDndEnd] = useState('07:00');
  const [stInfo, setStInfo] = useState('');
  async function loadSt(): Promise<TidyingSettings> {
    try { const raw = await SecureStore.getItemAsync(ST_KEY); if (raw) return JSON.parse(raw); } catch {}
    return { enabled: false, time: '20:00', repeat: 'daily', dndStart: '22:00', dndEnd: '07:00' };
  }
  async function saveSt(s: TidyingSettings) { try { await SecureStore.setItemAsync(ST_KEY, JSON.stringify(s)); } catch {} }
  function parseTime(str: string): { hour: number; minute: number } {
    const m = str.match(/^(\d{1,2}):(\d{2})$/);
    const h = m ? parseInt(m[1], 10) : 20; const min = m ? parseInt(m[2], 10) : 0;
    return { hour: Math.min(23, Math.max(0, h)), minute: Math.min(59, Math.max(0, min)) };
  }
  function withinDnd(t: string, start?: string, end?: string) {
    if (!start || !end) return false;
    const toMin = (s: string) => { const m = s.match(/^(\d{1,2}):(\d{2})$/); if (!m) return null; return parseInt(m[1],10)*60 + parseInt(m[2],10); };
    const tt = toMin(t); const ss = toMin(start); const ee = toMin(end);
    if (tt==null || ss==null || ee==null) return false;
    if (ss <= ee) { return tt >= ss && tt < ee; }
    return tt >= ss || tt < ee;
  }
  const onStSave = async () => {
    const s: TidyingSettings = { enabled: stEnabled, time: stTime, repeat: stRepeat, dndStart: stDndStart, dndEnd: stDndEnd };
    await saveSt(s);
    setStInfo('Smart tidy-up settings saved.');
    await cancelAllReminders();
    if (stEnabled) {
      const { hour, minute } = parseTime(stTime);
      if (withinDnd(stTime, stDndStart, stDndEnd)) {
        setStInfo('The selected time is within Do Not Disturb. The system may still show notifications; consider adjusting the time.');
      }
      await scheduleSmartTidying('Tidy-up time!', "It's time to help toys go home! Tap to view the checklist.", hour, minute, stRepeat);
    }
  };

  const fetchTokens = async () => {
    const { data: userRes } = await supabase.auth.getUser();
    const uid = userRes?.user?.id;
    if (!uid) return;
    const { data } = await supabase.from('device_tokens').select('*').eq('user_id', uid);
    setTokens(data || []);
  };

  useEffect(() => {
    fetchTokens();
    // load inline cards' persisted settings
    (async () => {
      const lp = await loadLp(); setLpEnabled(lp.enabled); setLpDurationMin(String(lp.durationMin)); setLpPush(lp.methods.push); setLpInApp(lp.methods.inApp);
      const it = await loadIt(); setItEnabled(it.enabled); setItDays(String(it.days)); setItSmartSuggest(it.smartSuggest);
      const st = await loadSt(); setStEnabled(st.enabled); setStTime(st.time); setStRepeat(st.repeat); setStDndStart(st.dndStart || ''); setStDndEnd(st.dndEnd || '');
    })();
  }, []);

  const onScheduleLocal = async () => {
    await scheduleLocalDailyCheck();
    setMessage('Local daily reminder (20:00) has been set.');
  };

  // Design sync disabled per request
  const onSyncDesign = async () => {
    setMessage('Design sync is disabled.');
  };

  return (
    <LinearGradient colors={cartoonGradient} style={{ flex: 1 }}>
    <ScrollView style={[styles.container, { backgroundColor: 'transparent' }]} contentContainerStyle={{ paddingBottom: 24 }}>
      {/* 顶部“Reminders”字样按需求删除 */}

      {/* Removed: Device Push Tokens card per request */}

      {/* Removed: Local Reminder card per request */}

      {/* Inline: Long Play Reminder card */}
      <Card style={[styles.card, { backgroundColor: theme.colors.surface, borderWidth: 2, borderColor: theme.colors.surfaceVariant, borderRadius: 20 }]}> 
        <Card.Title title="Long Play Reminder" subtitle="Detect continuous play and gently remind" titleStyle={{ fontWeight: '700' }} />
        <Card.Content>
          <View style={styles.rowBetween}>
            <Text>Master Switch</Text>
            <Switch value={lpEnabled} onValueChange={setLpEnabled} />
          </View>
          <View style={[styles.rowBetween, { marginTop: 12 }]}> 
            <Text>Duration (minutes)</Text>
            <View style={styles.row}> 
        <TextInput
          value={lpDurationMin}
          onChangeText={setLpDurationMin}
          keyboardType="numeric"
          style={{ width: 100, height: 40, marginHorizontal: 8, borderRadius: 6 }}
          contentStyle={{ textAlign: 'center' }}
          dense
        />
            </View>
          </View>
          <Text style={{ marginTop: 12, marginBottom: 4 }}>Reminder Methods</Text>
          <View style={styles.row}> 
            <Checkbox.Item label="Push notification" status={lpPush ? 'checked' : 'unchecked'} onPress={() => setLpPush(!lpPush)} />
            <Checkbox.Item label="In-app tip" status={lpInApp ? 'checked' : 'unchecked'} onPress={() => setLpInApp(!lpInApp)} />
          </View>
          {lpInfo ? <HelperText type="info">{lpInfo}</HelperText> : null}
        </Card.Content>
        <Card.Actions>
          <Button mode="outlined" onPress={() => openScan('longPlay')}>Scan now</Button>
          <Button mode="contained" onPress={onLpSave}>Save</Button>
        </Card.Actions>
      </Card>

      {/* Inline: Idle Toy Reminder card */}
      <Card style={[styles.card, { backgroundColor: theme.colors.surface, borderWidth: 2, borderColor: theme.colors.surfaceVariant, borderRadius: 20 }]}> 
        <Card.Title title="Idle Toy Reminder" subtitle="Notice toys not played for days" titleStyle={{ fontWeight: '700' }} />
        <Card.Content>
          <View style={styles.rowBetween}>
            <Text>Master Switch</Text>
            <Switch value={itEnabled} onValueChange={setItEnabled} />
          </View>
          <Text style={{ marginTop: 12 }}>Idle duration</Text>
          <View style={[styles.row, { marginTop: 8 }]}> 
            <Button mode="outlined" compact onPress={() => setItDays('7')}>7 days</Button>
            <Button mode="outlined" compact style={{ marginHorizontal: 8 }} onPress={() => setItDays('30')}>30 days</Button>
            <Button mode="outlined" compact onPress={() => setItDays('90')}>90 days</Button>
          </View>
          <View style={[styles.rowBetween, { marginTop: 8 }]}> 
            <Text>Custom (days)</Text>
        <TextInput
          value={itDays}
          onChangeText={setItDays}
          keyboardType="numeric"
          style={{ width: 100, height: 40, borderRadius: 6 }}
          contentStyle={{ textAlign: 'center' }}
          dense
        />
          </View>
          <Checkbox.Item label="Include helpful suggestion in reminders" status={itSmartSuggest ? 'checked' : 'unchecked'} onPress={() => setItSmartSuggest(!itSmartSuggest)} />
          {itInfo ? <HelperText type="info">{itInfo}</HelperText> : null}
        </Card.Content>
        <Card.Actions>
          <Button onPress={() => openScan('idleToy')} mode="outlined">Scan now</Button>
          <Button onPress={onItSave} mode="contained">Save</Button>
        </Card.Actions>
      </Card>

      {/* Inline: Smart Tidy-up card */}
      <Card style={[styles.card, { backgroundColor: theme.colors.surface, borderWidth: 2, borderColor: theme.colors.surfaceVariant, borderRadius: 20 }]}> 
        <Card.Title title="Smart Tidy-up" subtitle="Build a tidy-up habit at a fixed time" titleStyle={{ fontWeight: '700' }} />
        <Card.Content>
          <View style={styles.rowBetween}>
            <Text>Master Switch</Text>
            <Switch value={stEnabled} onValueChange={setStEnabled} />
          </View>
          <Text style={{ marginTop: 12 }}>Daily tidy-up time</Text>
          <View style={[styles.rowBetween, { marginTop: 8 }]}> 
            <Text>HH:MM</Text>
        <TextInput
          value={stTime}
          onChangeText={setStTime}
          placeholder="20:00"
          style={{ width: 100, height: 40, borderRadius: 6 }}
          contentStyle={{ textAlign: 'center' }}
          dense
        />
          </View>
          <Text style={{ marginTop: 12 }}>Repeat</Text>
          <View style={[styles.row, { marginTop: 8 }]}> 
            <Chip selected={stRepeat==='daily'} onPress={() => setStRepeat('daily')} style={styles.chip}>Daily</Chip>
            <Chip selected={stRepeat==='weekends'} onPress={() => setStRepeat('weekends')} style={styles.chip}>Weekends</Chip>
            <Chip selected={stRepeat==='weekdays'} onPress={() => setStRepeat('weekdays')} style={styles.chip}>Weekdays</Chip>
          </View>
          <Text style={{ marginTop: 12 }}>Do Not Disturb</Text>
          <View style={[styles.rowBetween, { marginTop: 8 }]}> 
            <Text>Start (HH:MM)</Text>
        <TextInput
          value={stDndStart}
          onChangeText={setStDndStart}
          placeholder="22:00"
          style={{ width: 100, height: 40, borderRadius: 6 }}
          contentStyle={{ textAlign: 'center' }}
          dense
        />
          </View>
          <View style={[styles.rowBetween, { marginTop: 8 }]}> 
            <Text>End (HH:MM)</Text>
        <TextInput
          value={stDndEnd}
          onChangeText={setStDndEnd}
          placeholder="07:00"
          style={{ width: 100, height: 40, borderRadius: 6 }}
          contentStyle={{ textAlign: 'center' }}
          dense
        />
          </View>
          {stInfo ? <HelperText type="info">{stInfo}</HelperText> : null}
        </Card.Content>
        <Card.Actions>
          <Button mode="outlined" onPress={() => openScan('smartTidying')}>Scan now</Button>
          <Button mode="contained" onPress={onStSave}>Save</Button>
        </Card.Actions>
      </Card>

      {/* Design sync section removed */}

      {message && <Text style={[styles.message, { color: theme.colors.primary }]}>{message}</Text>}

      {/* Scan results dialog */}
      <Portal>
        <Dialog visible={scanDialogOpen} onDismiss={closeScan} style={{ borderRadius: 10 }}>
          <Dialog.Title style={{ fontSize: 16 }}>{scanTitle}</Dialog.Title>
          <Dialog.Content>
            <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ paddingVertical: 4 }}>
              {scanItems.length === 0 ? (
                <Text>No records yet. Please enable the corresponding reminder and try again after actual usage.</Text>
              ) : (
                scanItems.map((it) => {
                  const toy = getToyNameFromBody(it.body);
                  const title = toy ? `${toy}` : (it.title || 'Reminder');
                  const desc = `${formatTime(it.timestamp)} · ${it.source || 'unknown'}` + (it.body ? `\n${it.body}` : '');
                  return (
                    <List.Item
                      key={it.id}
                      title={title}
                      description={desc}
                      left={(p) => <List.Icon {...p} icon="history" />}
                      style={{ paddingVertical: 4 }}
                      titleStyle={{ fontSize: 14 }}
                      descriptionNumberOfLines={4}
                    />
                  );
                })
              )}
            </ScrollView>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={closeScan}>Close</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 /* bg moved to gradient */ },
  title: { /* color moved to theme */ },
  card: { marginBottom: 12 },
  message: { marginTop: 8 /* color moved to theme */ },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: { flexDirection: 'row', alignItems: 'center' },
  chip: { marginRight: 8 },
});