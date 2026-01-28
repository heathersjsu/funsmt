import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView, Platform, TouchableOpacity, Animated } from 'react-native';
import { Text, Card, Button, List, useTheme, Switch, TextInput, Checkbox, HelperText, Chip, Dialog, Portal, SegmentedButtons, Divider, Snackbar, Avatar } from 'react-native-paper';
import * as SecureStore from 'expo-secure-store';
import { getFunctionUrl, loadFigmaThemeOverrides, buildKidTheme } from '../../theme';
import { useThemeUpdate } from '../../theme/ThemeContext';
import { supabase } from '../../supabaseClient';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { scheduleLocalDailyCheck, getNotificationHistory, NotificationHistoryItem, recordNotificationHistory } from '../../utils/notifications';
import { useNavigation } from '@react-navigation/native';
import { startLongPlayMonitor, stopLongPlayMonitor, LongPlaySettings } from '../../reminders/longPlay';
import { IdleToySettings, runIdleScan } from '../../reminders/idleToy';
import { cancelAllReminders, scheduleSmartTidying } from '../../utils/notifications';
import { LinearGradient } from 'expo-linear-gradient';
import { cartoonGradient } from '../../theme/tokens';
import { loadLongPlaySettings, saveLongPlaySettings, loadIdleToySettings, saveIdleToySettings, loadTidyingSettings, saveTidyingSettings, TidyingSettings, syncLocalFromRemote } from '../../utils/reminderSettings';
import type { Repeat } from '../../utils/reminderSettings';
import { MaterialCommunityIcons } from '@expo/vector-icons';

type Props = NativeStackScreenProps<any>;

type DeviceToken = { id?: string; user_id: string; token: string };

interface ScanToyItem {
  id: string;
  name: string;
  photo_url?: string | null;
  owner?: string | null;
  location?: string | null;
  durationLabel: string; // "XX min played" or "XX days idle"
}

export default function ReminderStatusScreen({}: Props) {
  const [tokens, setTokens] = useState<DeviceToken[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const { setTheme } = useThemeUpdate();
  const theme = useTheme();
  const navigation = useNavigation<any>();
  const headerFont = Platform.select({ ios: 'Arial Rounded MT Bold', android: 'sans-serif-medium', default: 'System' });
  const [snackbarVisible, setSnackbarVisible] = useState(false);
  const [snackbarMsg, setSnackbarMsg] = useState('');
  const MinimalSwitch = ({ val, onToggle }: { val: boolean; onToggle: () => void }) => {
    const anim = React.useRef(new Animated.Value(val ? 1 : 0)).current;
    React.useEffect(() => { Animated.timing(anim, { toValue: val ? 1 : 0, duration: 180, useNativeDriver: true }).start(); }, [val]);
    const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: [2, 22] });
    return (
      <TouchableOpacity
        onPress={onToggle}
        activeOpacity={0.8}
        style={{ width: 48, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: theme.colors.primary, backgroundColor: val ? theme.colors.primary : 'white', padding: 2, overflow: 'hidden' }}
      >
        <Animated.View style={{ position: 'absolute', top: 1, width: 24, height: 24, borderRadius: 12, backgroundColor: 'white', borderWidth: val ? 0 : 1, borderColor: theme.colors.primary, transform: [{ translateX }] }} />
      </TouchableOpacity>
    );
  };

  // ---- Scan popup state ----
  const [scanDialogOpen, setScanDialogOpen] = useState(false);
  const [scanItems, setScanItems] = useState<NotificationHistoryItem[]>([]);
  const [scanToys, setScanToys] = useState<ScanToyItem[]>([]);
  const [scanType, setScanType] = useState<'longPlay' | 'idleToy' | 'smartTidying'>('smartTidying');
  const [scanTitle, setScanTitle] = useState<string>('Recent items');
  const [scanMeta, setScanMeta] = useState<Record<string, { toy?: string; owner?: string }>>({});
  
  const openScan = async (source: 'longPlay' | 'idleToy' | 'smartTidying') => {
    setScanType(source);
    try {
      if (source === 'longPlay') {
        const lp = await loadLongPlaySettings();
        const { data: outToys } = await supabase.from('toys').select('id,name,photo_url,owner,location,status').eq('status', 'out');
        const items: ScanToyItem[] = [];
        const now = Date.now();
        for (const t of (outToys || []) as any[]) {
           const { data: sess } = await supabase.from('play_sessions').select('scan_time').eq('toy_id', t.id).order('scan_time', { ascending: false }).limit(1);
           const st = ((sess || [])[0]?.scan_time as string) || null;
           if (!st) continue;
           const mins = Math.floor((now - new Date(st).getTime()) / 60000);
           if (mins >= lp.durationMin) {
             items.push({
               id: t.id,
               name: t.name || 'Toy',
               photo_url: t.photo_url,
               owner: t.owner,
               location: t.location,
               durationLabel: `${mins} min played`,
            });
          }
       }
        setScanToys(items);
        setScanTitle('Currently exceeding play threshold');
        setScanDialogOpen(true);
        return;
      }

      if (source === 'idleToy') {
        const it = await loadIdleToySettings();
        const { data: inToys } = await supabase.from('toys').select('id,name,photo_url,owner,location,status,created_at').eq('status', 'in');
        const items: ScanToyItem[] = [];
        const now = Date.now();
        for (const t of (inToys || []) as any[]) {
           const { data: sess } = await supabase.from('play_sessions').select('scan_time').eq('toy_id', t.id).order('scan_time', { ascending: false }).limit(1);
           const st = ((sess || [])[0]?.scan_time as string) || t.created_at; 
           const lastTime = st ? new Date(st).getTime() : 0;
           const days = lastTime > 0 ? Math.floor((now - lastTime) / (1000 * 60 * 60 * 24)) : 999;
           if (days >= it.days) {
             items.push({
               id: t.id,
               name: t.name || 'Toy',
               photo_url: t.photo_url,
               owner: t.owner,
               location: t.location,
               durationLabel: `${days} days idle`,
            });
          }
       }
        setScanToys(items);
        setScanTitle('Currently idle toys');
        setScanDialogOpen(true);
        return;
      }

      // Default: show recent history for smartTidying
      const all = await getNotificationHistory();
      const items = (all || [])
        .filter((i) => (i.source || '').toLowerCase().startsWith(source.toLowerCase()))
        .sort((a, b) => (b.timestamp - a.timestamp))
        .slice(0, 20);
      const label = 'Smart Tidy-up — recent 20';
      setScanTitle(label);
      setScanItems(items);
      setScanDialogOpen(true);
    } catch {
      setScanItems([]);
      setScanToys([]);
      setScanTitle('Recent items');
      setScanDialogOpen(true);
    }
  };
  const closeScan = () => setScanDialogOpen(false);
  const getToyNameFromBody = (body?: string) => {
    if (!body) return undefined;
    const prefix = 'Friendly reminder: ';
    const s = body.startsWith(prefix) ? body.slice(prefix.length) : body;
    // Long Play: "<Toy> has been played for <n> minutes"
    let m = s.match(/^(.+?) has been played/i);
    if (m && m[1]) return m[1];
    // Idle Toy: "<Toy> has been idle for <n> days" OR "<Toy> hasn't played with you for <n> days"
    m = s.match(/^(.+?) (has been idle|hasn't played)/i);
    if (m && m[1]) return m[1];
    // Chinese Long Play historic format: "温馨提示：<owner?>的?<Toy>已连续玩 <n> 分钟..."
    m = s.replace(/^温馨提示：/, '').match(/^(?:(.+?)的)?(.+?)已连续玩\s*(\d+)\s*分钟/i);
    if (m) {
      const owner = m[1];
      const toy = m[2];
      return toy?.trim();
    }
    return undefined;
  };
  const formatTime = (ts: number) => {
    try { return new Date(ts).toLocaleString(); } catch { return String(ts); }
  };
  const parseOwnerAndToy = (body?: string): { owner?: string; toy?: string } => {
    if (!body) return {};
    try {
      const s = body.trim();
      // English pattern: Friendly reminder: Alex's Teddy has been ...
      let m = s.match(/^Friendly reminder:\s+(?:(.+?)'s\s+)?(.+?)\s+(?:has|hasn't|hasn’t)\b/i);
      if (m) {
        const owner = m[1] ? m[1].trim() : undefined;
        const toy = m[2] ? m[2].trim() : undefined;
        return { owner, toy };
      }
      // Chinese historic pattern: 温馨提示：Alex 的 Teddy 已连续玩 ...
      m = s.replace(/^温馨提示：/, '').match(/^(?:(.+?)的)?(.+?)(?:已|还|已经)/);
      if (m) {
        const owner = m[1] ? m[1].trim() : undefined;
        const toy = m[2] ? m[2].trim() : undefined;
        return { owner, toy };
      }
    } catch {}
    return {};
  };

  // ---- Long Play inline card state ----
  const [lpEnabled, setLpEnabled] = useState<boolean>(false);
  const [lpDurationMin, setLpDurationMin] = useState<string>('45');
  const [lpSeg, setLpSeg] = useState<string>('45');
  const [lpPush, setLpPush] = useState<boolean>(true);
  const [lpInApp, setLpInApp] = useState<boolean>(true);
  const [lpInfo, setLpInfo] = useState<string>('');

  async function loadLp(): Promise<LongPlaySettings> { return await loadLongPlaySettings(); }
  async function saveLp(s: LongPlaySettings) { return await saveLongPlaySettings(s); }

  useEffect(() => {
    const presets = ['30', '45', '60'];
    if (presets.includes(lpSeg)) setLpDurationMin(lpSeg);
  }, [lpSeg]);
  const onLpSave = async () => {
    const n = parseInt(lpDurationMin, 10);
    const s: LongPlaySettings = { enabled: lpEnabled, durationMin: isNaN(n) ? 45 : n, methods: { push: lpPush, inApp: lpInApp } };
    const res = await saveLp(s);
    setLpInfo('');
    setSnackbarMsg('Long Play Reminder is saved');
    setSnackbarVisible(true);
    stopLongPlayMonitor();
    if (s.enabled) startLongPlayMonitor(s);
  };

  // ---- Idle Toy inline card state ----
  const [itEnabled, setItEnabled] = useState(false);
  const [itDays, setItDays] = useState<string>('14');
  const [itSeg, setItSeg] = useState<string>('14');
  const [itSmartSuggest, setItSmartSuggest] = useState(true);
  const [itInfo, setItInfo] = useState('');
  async function loadIt(): Promise<IdleToySettings> { return await loadIdleToySettings(); }
  async function saveIt(s: IdleToySettings) { return await saveIdleToySettings(s); }
  useEffect(() => {
    const presets = ['7', '14', '30'];
    if (presets.includes(itSeg)) setItDays(itSeg);
  }, [itSeg]);
  const onItSave = async () => {
    const n = parseInt(itDays, 10);
    const s: IdleToySettings = { enabled: itEnabled, days: isNaN(n) ? 14 : n, smartSuggest: itSmartSuggest };
    const res = await saveIt(s);
    setItInfo('');
    setSnackbarMsg('Idle Toy Reminder is saved');
    setSnackbarVisible(true);
  };
  const onItRunScan = async () => {
    const n = parseInt(itDays, 10);
    await runIdleScan({ enabled: itEnabled, days: isNaN(n) ? 14 : n, smartSuggest: itSmartSuggest });
    setItInfo('Idle scan triggered. Notifications will be sent for idle toys.');
  };

  // ---- Smart Tidying inline card state ----
  const [stEnabled, setStEnabled] = useState(false);
  const [stTime, setStTime] = useState('20:00');
  const [stRepeat, setStRepeat] = useState<Repeat>('daily');
  const [stDays, setStDays] = useState<boolean[]>([true, true, true, true, true, true, true]); // S M T W T F S
  const [stDndStart, setStDndStart] = useState('22:00');
  const [stDndEnd, setStDndEnd] = useState('07:00');
  const [stInfo, setStInfo] = useState('');
  async function loadSt(): Promise<TidyingSettings> { return await loadTidyingSettings(); }
  async function saveSt(s: TidyingSettings) { return await saveTidyingSettings(s); }
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
    let repeatToSave = stRepeat;
    if (stRepeat === 'custom') {
      repeatToSave = stDays.map(d => d ? '1' : '0').join('');
    }
    const s: TidyingSettings = { enabled: stEnabled, time: stTime, repeat: repeatToSave, dndStart: stDndStart, dndEnd: stDndEnd };
    const res = await saveSt(s);
    setStInfo('');
    setSnackbarMsg('Smart tidy-up is saved');
    setSnackbarVisible(true);
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
    // hydrate local settings from remote (if logged in), then load into UI
    (async () => {
      try { await syncLocalFromRemote(); } catch {}
      const lp = await loadLp(); setLpEnabled(lp.enabled); setLpDurationMin(String(lp.durationMin)); setLpPush(lp.methods.push); setLpInApp(lp.methods.inApp);
      const it = await loadIt(); setItEnabled(it.enabled); setItDays(String(it.days)); setItSmartSuggest(it.smartSuggest);
      const st = await loadSt(); 
      setStEnabled(st.enabled); 
      setStTime(st.time); 
      setStDndStart(st.dndStart || ''); 
      setStDndEnd(st.dndEnd || '');

      if (st.repeat === 'daily') {
        setStRepeat('daily');
        setStDays([true,true,true,true,true,true,true]);
      } else if (st.repeat === 'weekdays') {
        setStRepeat('weekdays');
        setStDays([false,true,true,true,true,true,false]);
      } else if (st.repeat === 'weekends') {
        setStRepeat('weekends');
        setStDays([true,false,false,false,false,false,true]);
      } else if (/^[01]{7}$/.test(st.repeat)) {
        setStRepeat('custom');
        setStDays(st.repeat.split('').map(c => c === '1'));
      } else {
        setStRepeat('daily');
        setStDays([true,true,true,true,true,true,true]);
      }
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
    <ScrollView 
      style={[styles.container, { backgroundColor: 'transparent' }]} 
      contentContainerStyle={[
        { paddingBottom: 24, paddingLeft: 8, paddingRight: 8 },
        Platform.OS === 'web' && { width: '100%', maxWidth: 1000, alignSelf: 'center', paddingHorizontal: 16 }
      ]}
    >
      {/* 顶部“Reminders”字样按需求删除 */}

      {/* Removed: Device Push Tokens card per request */}

      {/* Removed: Local Reminder card per request */}

      {/* Inline: Long Play Reminder card */}
      <Card style={[styles.card, { backgroundColor: theme.colors.surface, borderWidth: 0, borderRadius: 20 }]}> 
          <Card.Title
          title={<Text style={{ fontSize: 16, fontWeight: '700', fontFamily: headerFont, color: '#FF6B9D' }}>Long Play Reminder</Text>}
          subtitle="Detect continuous play"
          titleStyle={{}}
          subtitleStyle={{ fontFamily: headerFont, opacity: 0.7 }}
          left={(p) => <List.Icon {...p} icon="timer" color="#FF6B9D" />}
          right={(p) => <View style={{ marginRight: 8, alignItems: 'center', justifyContent: 'center' }}><MinimalSwitch val={lpEnabled} onToggle={() => setLpEnabled(!lpEnabled)} /></View>}
          />
        <Card.Content style={{ paddingHorizontal: 16 }}>
          <View style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ fontFamily: headerFont }}>Remind me after</Text>
            <Text style={{ fontFamily: headerFont, color: theme.colors.onSurfaceVariant, fontSize: 12 }}>
              Current: {parseInt(lpDurationMin || '0', 10) || 45} min
            </Text>
          </View>
          <SegmentedButtons
            value={lpSeg}
            onValueChange={setLpSeg}
            style={{ marginTop: 8 }}
            buttons={[
              { value: '30', label: '30 min', style: { minWidth: 76 }, labelStyle: { fontSize: 12 } },
              { value: '45', label: '45 min', style: { minWidth: 76 }, labelStyle: { fontSize: 12 } },
              { value: '60', label: '60 min', style: { minWidth: 76 }, labelStyle: { fontSize: 12 } },
              { value: 'custom', label: 'Customize', style: { minWidth: 100 }, labelStyle: { fontSize: 12 } },
            ]}
          />
          {lpSeg === 'custom' && (
            <View style={[styles.rowBetween, { marginTop: 8 }]}>
              <Text style={{ fontFamily: headerFont }}>Custom minutes</Text>
              <TextInput
                mode="outlined"
                value={lpDurationMin}
                onChangeText={(t) => setLpDurationMin(String(t || '').replace(/\D/g, ''))}
                keyboardType="number-pad"
                style={{ width: 120, height: 40, backgroundColor: theme.colors.surface }}
                contentStyle={{ textAlign: 'center' }}
                outlineColor={theme.colors.primary}
                activeOutlineColor={theme.colors.primary}
                right={<TextInput.Affix text="min" />}
                dense
              />
            </View>
          )}
          <Text style={{ marginTop: 12, marginBottom: 4, fontFamily: headerFont }}>Reminder Methods</Text>
          <View style={styles.row}> 
            <Checkbox.Item label="Push notification" status={lpPush ? 'checked' : 'unchecked'} onPress={() => setLpPush(!lpPush)} labelStyle={{ fontSize: 13, fontWeight: '400' }} />
            <Checkbox.Item label="In-app tip" status={lpInApp ? 'checked' : 'unchecked'} onPress={() => setLpInApp(!lpInApp)} labelStyle={{ fontSize: 13, fontWeight: '400' }} />
          </View>
          {lpInfo ? <HelperText type="info" style={{ fontFamily: headerFont }}>{lpInfo}</HelperText> : null}
        </Card.Content>
        <Card.Actions style={{ justifyContent: 'center' }}>
          <Button mode="outlined" onPress={() => openScan('longPlay')} style={{ borderRadius: 20, marginRight: 8, borderColor: theme.colors.primary }} contentStyle={{ height: 40 }} labelStyle={{ fontFamily: headerFont }} textColor={theme.colors.primary}>Scan</Button>
          <Button mode="outlined" onPress={onLpSave} style={{ borderRadius: 20, borderColor: theme.colors.primary }} contentStyle={{ height: 40 }} labelStyle={{ fontFamily: headerFont }} textColor={theme.colors.primary}>Save Changes</Button>
        </Card.Actions>
      </Card>

      {/* Inline: Idle Toy Reminder card */}
      <Card style={[styles.card, { backgroundColor: theme.colors.surface, borderWidth: 0, borderRadius: 20 }]}> 
          <Card.Title
          title={<Text style={{ fontSize: 16, fontWeight: '700', fontFamily: headerFont, color: '#4ECDC4' }}>Idle Toy Reminder</Text>}
          subtitle={<Text style={{ fontFamily: headerFont, color: theme.colors.onSurface, opacity: 0.7 }}>Detect idle toys</Text>}
          left={(p) => <List.Icon {...p} icon="sleep" color="#4ECDC4" />}
          right={(p) => <View style={{ marginRight: 8, alignItems: 'center', justifyContent: 'center' }}><MinimalSwitch val={itEnabled} onToggle={() => setItEnabled(!itEnabled)} /></View>}
          />
        <Card.Content style={{ paddingHorizontal: 16 }}>
          <View style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ fontFamily: headerFont }}>Remind me after</Text>
            <Text style={{ fontFamily: headerFont, color: theme.colors.onSurfaceVariant, fontSize: 12 }}>
              Current: {parseInt(itDays || '0', 10) || 14} days
            </Text>
          </View>
          <SegmentedButtons
            value={itSeg}
            onValueChange={setItSeg}
            style={{ marginTop: 8 }}
            buttons={[
              { value: '7', label: '7 days', style: { minWidth: 60, backgroundColor: theme.colors.surface }, labelStyle: { fontSize: 12, color: theme.colors.onSurface } },
              { value: '14', label: '14 days', style: { minWidth: 68, backgroundColor: theme.colors.surface }, labelStyle: { fontSize: 12, color: theme.colors.onSurface } },
              { value: '30', label: '30 days', style: { minWidth: 70, backgroundColor: theme.colors.surface }, labelStyle: { fontSize: 12, color: theme.colors.onSurface } },
              { value: 'custom', label: 'Customize', style: { minWidth: 92, backgroundColor: theme.colors.surface }, labelStyle: { fontSize: 12, color: theme.colors.onSurface } },
            ]}
          />
          {itSeg === 'custom' && (
            <View style={[styles.rowBetween, { marginTop: 8 }]}>
              <Text style={{ fontFamily: headerFont }}>Custom days</Text>
              <TextInput
                mode="outlined"
                value={itDays}
                onChangeText={(t) => setItDays(String(t || '').replace(/\D/g, ''))}
                keyboardType="number-pad"
                style={{ width: 120, height: 40, backgroundColor: theme.colors.surface }}
                contentStyle={{ textAlign: 'center' }}
                outlineColor={theme.colors.primary}
                activeOutlineColor={theme.colors.primary}
                right={<TextInput.Affix text="days" />}
                dense
              />
            </View>
          )}
          <Checkbox.Item label="Include helpful suggestion in reminders" status={itSmartSuggest ? 'checked' : 'unchecked'} onPress={() => setItSmartSuggest(!itSmartSuggest)} labelStyle={{ fontSize: 13, fontWeight: '400' }} />
          {itInfo ? <HelperText type="info" style={{ fontFamily: headerFont }}>{itInfo}</HelperText> : null}
        </Card.Content>
        <Card.Actions style={{ justifyContent: 'center' }}>
          <Button mode="outlined" onPress={() => openScan('idleToy')} style={{ borderRadius: 20, marginRight: 8, borderColor: theme.colors.primary }} contentStyle={{ height: 40 }} labelStyle={{ fontFamily: headerFont }} textColor={theme.colors.primary}>Scan</Button>
          <Button mode="outlined" onPress={onItSave} style={{ borderRadius: 20, borderColor: theme.colors.primary }} contentStyle={{ height: 40 }} labelStyle={{ fontFamily: headerFont }} textColor={theme.colors.primary}>Save Changes</Button>
        </Card.Actions>
      </Card>

      {/* Inline: Smart Tidy-up card */}
      <Card style={[styles.card, { backgroundColor: theme.colors.surface, borderWidth: 0, borderRadius: 20 }]}> 
          <Card.Title
          title={<Text style={{ fontSize: 16, fontWeight: '700', fontFamily: headerFont, color: '#6A5ACD' }}>Smart Tidy-up</Text>}
          subtitle={<Text style={{ fontFamily: headerFont, color: theme.colors.onSurface, opacity: 0.7 }}>Scheduled tidy-up habit</Text>}
          left={(p) => <List.Icon {...p} icon="broom" color="#6A5ACD" />}
          right={(p) => <View style={{ marginRight: 8, alignItems: 'center', justifyContent: 'center' }}><MinimalSwitch val={stEnabled} onToggle={() => setStEnabled(!stEnabled)} /></View>}
          />
        <Divider style={{ marginHorizontal: 16, opacity: 0.2 }} />
        <Card.Content style={{ paddingHorizontal: 16 }}>
          <View style={[styles.rowBetween, { marginTop: 12 }]}>
            <Text style={{ fontFamily: headerFont }}>Daily tidy-up time</Text>
            <TextInput
              mode="outlined"
              value={stTime}
              onChangeText={setStTime}
              placeholder="08:00 PM"
              style={{ width: 110, height: 40, backgroundColor: theme.colors.surface }}
              contentStyle={{ textAlign: 'center' }}
              outlineColor={theme.colors.primary}
              activeOutlineColor={theme.colors.primary}
              right={<TextInput.Icon icon="clock-outline" />}
            />
          </View>
          <Text style={{ marginTop: 12, fontFamily: headerFont }}>Repeat</Text>
          <View style={[styles.row, { marginTop: 8, flexWrap: 'wrap' }]}> 
            {['S','M','T','W','T','F','S'].map((d, idx) => {
              const selected = !!stDays[idx];
              return (
                <TouchableOpacity
                  key={`${d}-${idx}`}
                  onPress={() => {
                    const next = [...stDays]; next[idx] = !next[idx]; setStDays(next);
                    const all = next.every(Boolean);
                    const wk = next.slice(1,6).every(Boolean) && !next[0] && !next[6];
                    const we = next[0] && next[6] && next.slice(1,6).every((v)=>!v);
                    setStRepeat(all ? 'daily' : wk ? 'weekdays' : we ? 'weekends' : 'custom');
                  }}
                  style={{
                    width: 32, height: 32, borderRadius: 16, borderWidth: 2,
                    borderColor: theme.colors.primary,
                    backgroundColor: selected ? theme.colors.primary : theme.colors.surfaceVariant,
                    alignItems: 'center', justifyContent: 'center', marginRight: 8, marginBottom: 6
                  }}
                >
                  <Text style={{ color: selected ? theme.colors.onPrimary : theme.colors.onSurface, fontSize: 12 }}>{d}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <View style={{ marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: theme.colors.secondaryContainer }}>
            <View style={styles.rowBetween}>
              <Text style={{ fontFamily: headerFont }}>Do Not Disturb</Text>
              <MinimalSwitch val={!!(stDndStart || stDndEnd)} onToggle={() => {
                const enable = !(stDndStart || stDndEnd);
                if (!enable) { setStDndStart(''); setStDndEnd(''); } else { setStDndStart('22:00'); setStDndEnd('07:00'); }
              }} />
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
              <View style={{ width: '46%', flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ fontFamily: headerFont }}>Start</Text>
                <TextInput
                  mode="outlined"
                  value={stDndStart}
                  onChangeText={setStDndStart}
                  placeholder="10:00 PM"
                  dense
                  style={{ width: 104, height: 32, marginLeft: 2, backgroundColor: theme.colors.surface, paddingHorizontal: 0, paddingRight: 6 }}
                  contentStyle={{ textAlign: 'left', paddingLeft: 16, paddingRight: 0, paddingVertical: 2 }}
                  outlineColor={theme.colors.primary}
                  activeOutlineColor={theme.colors.primary}
                  right={<TextInput.Icon icon="clock-outline" />}
                />
              </View>
              <Text style={{ width: '6%', textAlign: 'center', opacity: 0.8 }}>→</Text>
              <View style={{ width: '46%', flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ fontFamily: headerFont }}>End</Text>
                <TextInput
                  mode="outlined"
                  value={stDndEnd}
                  onChangeText={setStDndEnd}
                  placeholder="07:00 AM"
                  dense
                  style={{ width: 104, height: 32, marginLeft: 2, backgroundColor: theme.colors.surface, paddingHorizontal: 0, paddingRight: 6 }}
                  contentStyle={{ textAlign: 'left', paddingLeft: 16, paddingRight: 0, paddingVertical: 2 }}
                  outlineColor={theme.colors.primary}
                  activeOutlineColor={theme.colors.primary}
                  right={<TextInput.Icon icon="clock-outline" />}
                />
              </View>
            </View>
          </View>
          {stInfo ? <HelperText type="info" style={{ fontFamily: headerFont, marginTop: 8 }}>{stInfo}</HelperText> : null}
        </Card.Content>
        <Card.Actions style={{ justifyContent: 'center' }}>
          <Button mode="outlined" onPress={onStSave} style={{ borderRadius: 20, borderColor: theme.colors.primary }} contentStyle={{ height: 40 }} labelStyle={{ fontFamily: headerFont }} textColor={theme.colors.primary}>Save Changes</Button>
        </Card.Actions>
      </Card>

      {/* Design sync section removed */}

      {message && <Text style={[styles.message, { color: theme.colors.primary, fontFamily: headerFont }]}>{message}</Text>}

      {/* Scan results dialog */}
      <Portal>
        <Dialog visible={scanDialogOpen} onDismiss={closeScan} style={{ borderRadius: 10 }}>
          <Dialog.Title style={{ fontSize: 16, fontFamily: headerFont }}>{scanTitle}</Dialog.Title>
          <Dialog.Content style={{ paddingHorizontal: 8 }}>
            <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ paddingVertical: 4 }}>
              {scanType !== 'smartTidying' && scanToys.length > 0 ? (
                // Checklist style card list
                scanToys.map(item => (
                  <Card key={item.id} style={{ marginBottom: 12, backgroundColor: theme.colors.surface, borderRadius: 20 }}>
                    <Card.Content>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        {item.photo_url ? (
                          <Avatar.Image source={{ uri: item.photo_url }} size={48} style={{ marginRight: 12 }} />
                        ) : (
                          <Avatar.Icon icon="cube-outline" size={48} style={{ marginRight: 12, backgroundColor: theme.colors.secondaryContainer }} />
                        )}
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontFamily: headerFont, fontSize: 16 }}>{item.name}</Text>
                          {item.location && (
                            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                                <MaterialCommunityIcons name="map-marker" size={14} color={theme.colors.onSurfaceVariant} style={{ marginRight: 4 }} />
                                <Text style={{ fontSize: 13, color: theme.colors.onSurfaceVariant }}>{item.location}</Text>
                            </View>
                          )}
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                              <MaterialCommunityIcons name="clock-outline" size={14} color={theme.colors.onSurfaceVariant} style={{ marginRight: 4 }} />
                              <Text style={{ fontSize: 13, color: theme.colors.onSurfaceVariant }}>{item.durationLabel}</Text>
                          </View>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          {item.owner && <Text style={{ fontFamily: headerFont, fontSize: 16 }}>{item.owner}</Text>}
                        </View>
                      </View>
                    </Card.Content>
                  </Card>
                ))
              ) : scanType !== 'smartTidying' && scanToys.length === 0 ? (
                <Text style={{ fontFamily: headerFont }}>No toys found matching the criteria.</Text>
              ) : scanItems.length === 0 ? (
                <Text style={{ fontFamily: headerFont }}>No records yet. Please enable the corresponding reminder and try again after actual usage.</Text>
              ) : (
                scanItems.map((it) => {
                  const src = (it.source || '').toLowerCase();
                  if (src.startsWith('longplay')) {
                    const { owner: ownerParsed, toy: toyParsed } = parseOwnerAndToy(it.body);
                    const toy = toyParsed || getToyNameFromBody(it.body);
                    const owner = ownerParsed;
                    const top = [formatTime(it.timestamp), toy, owner].filter(Boolean).join(' · ');
                    const minsMatch = (it.body || '').match(/(\d+)\s*minutes/i);
                    const mins = minsMatch && minsMatch[1] ? parseInt(minsMatch[1], 10) : null;
                    const second = toy && mins != null
                      ? `${owner ? `${owner}'s ` : ''}${toy} has been playing for ${mins} minutes. Take a short break, drink some water, and rest your eyes.`
                      : (String(it.body || '').replace(/^Friendly reminder:\s*/i, '').replace(/^温馨提示：\s*/i, ''));
                    return (
                      <View key={it.id} style={{ marginBottom: 8, backgroundColor: 'rgba(255,255,255,0.7)', borderRadius: 12, padding: 8 }}>
                        <Text style={{ fontSize: 14, fontFamily: headerFont }}>{top}</Text>
                        <Text style={{ opacity: 0.9, fontSize: 12, marginTop: 4, fontFamily: headerFont }}>{second}</Text>
                      </View>
                    );
                  }
                  const toy = getToyNameFromBody(it.body) || scanMeta[it.id]?.toy;
                  const { owner: ownerParsed } = parseOwnerAndToy(it.body);
                  const owner = ownerParsed || scanMeta[it.id]?.owner;
                  const title = toy ? `${toy}` : (it.title || 'Reminder');
                  const descTop = [formatTime(it.timestamp), toy, owner].filter(Boolean).join(' · ');
                  const daysMatch = (it.body || '').match(/(\d+)\s*days/i);
                  const days = daysMatch && daysMatch[1] ? parseInt(daysMatch[1], 10) : null;
                  const second = toy && days != null
                    ? `${toy} hasn't been played with for ${days} days. It's waiting for you!`
                    : (String(it.body || '').replace(/^Friendly reminder:\s*/i, '').replace(/^温馨提示：\s*/i, ''));
                  const desc = `${descTop}\n${second}`;
                  return (
                    <View key={it.id} style={{ marginBottom: 8, backgroundColor: 'rgba(255,255,255,0.7)', borderRadius: 12, padding: 8 }}>
                      <Text style={{ fontSize: 14, fontFamily: headerFont }}>{descTop}</Text>
                      <Text style={{ opacity: 0.9, fontSize: 12, marginTop: 4, fontFamily: headerFont }}>{second}</Text>
                    </View>
                  );
                })
              )}
            </ScrollView>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={closeScan} labelStyle={{ fontFamily: headerFont }}>Close</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </ScrollView>
    <Snackbar visible={snackbarVisible} onDismiss={() => setSnackbarVisible(false)} duration={2000} style={{ backgroundColor: theme.colors.secondaryContainer, alignSelf: 'center' }} wrapperStyle={{ position: 'absolute', top: '45%', left: 0, right: 0 }}>
      <Text style={{ fontFamily: headerFont, color: theme.colors.onSecondaryContainer, textAlign: 'center' }}>{snackbarMsg}</Text>
    </Snackbar>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 8 /* bg moved to gradient */ },
  title: { /* color moved to theme */ },
  card: { marginBottom: 12 },
  message: { marginTop: 8 /* color moved to theme */ },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: { flexDirection: 'row', alignItems: 'center' },
  chip: { marginRight: 8 },
});
