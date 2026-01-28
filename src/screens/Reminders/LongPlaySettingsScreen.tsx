import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView, Platform, TouchableOpacity, Animated } from 'react-native';
import { Card, Text, Switch, TextInput, Button, Checkbox, HelperText, useTheme, Dialog, Portal, SegmentedButtons, List, Snackbar } from 'react-native-paper';
import { getNotificationHistory, NotificationHistoryItem, recordNotificationHistory } from '../../utils/notifications';
import { startLongPlayMonitor, stopLongPlayMonitor, LongPlaySettings } from '../../reminders/longPlay';
import { loadLongPlaySettings, saveLongPlaySettings } from '../../utils/reminderSettings';
import { supabase } from '../../supabaseClient';

// Settings are now centrally persisted to Supabase with local fallback

const MinimalSwitch = ({ val, onToggle }: { val: boolean; onToggle: () => void }) => {
  const theme = useTheme();
  const anim = useRef(new Animated.Value(val ? 1 : 0)).current;
  useEffect(() => { Animated.timing(anim, { toValue: val ? 1 : 0, duration: 180, useNativeDriver: true }).start(); }, [val]);
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
  const [seg, setSeg] = useState<string>('45');
  const [snackbarVisible, setSnackbarVisible] = useState(false);
  const [snackbarMsg, setSnackbarMsg] = useState('');

  const headerFont = Platform.select({ ios: 'Arial Rounded MT Bold', android: 'sans-serif-medium', default: 'System' });

  useEffect(() => {
    (async () => {
      const s = await loadLongPlaySettings();
      setEnabled(s.enabled);
      setDurationMin(String(s.durationMin));
      setPush(s.methods.push);
      setInApp(s.methods.inApp);
      if (s.enabled) startLongPlayMonitor(s);
      const presets = [30, 45, 60];
      if (presets.includes(s.durationMin)) setSeg(String(s.durationMin));
      else setSeg('custom');
    })();
    return () => { stopLongPlayMonitor(); };
  }, []);

  useEffect(() => {
    if (seg === 'custom') return;
    setDurationMin(seg);
  }, [seg]);

  const onSave = async () => {
    const n = parseInt(durationMin, 10);
    const s: LongPlaySettings = { enabled, durationMin: isNaN(n) ? 45 : n, methods: { push, inApp } };
    const res = await saveLongPlaySettings(s);
    setInfo('');
    setSnackbarMsg('Long Play Reminder is saved');
    setSnackbarVisible(true);
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
    const prefix = 'Friendly reminder: ';
    const s = body.startsWith(prefix) ? body.slice(prefix.length) : body;
    // Handle messages like "Teddy has been playing for 50 minutes"
    const markers = [' has been playing', ' has been played', ' has been'];
    for (const m of markers) {
      const idx = s.indexOf(m);
      if (idx > 0) return s.slice(0, idx).trim();
    }
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
        .select('id,name,owner,status')
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
            const ownerLabel = t.owner ? `${t.owner}'s ` : '';
            const title = 'Long Play';
            const body = `Friendly reminder: ${ownerLabel}${t.name || 'Toy'} has been playing for ${durMin} minutes`;
            return { id: `${t.id}_${startISO}`, title, body, timestamp: Date.now(), source: `longplay:scan:${t.id}:${durMin}` } as NotificationHistoryItem;
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
      .filter((i) => (i.source || '').toLowerCase().startsWith('longplay'))
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 20);

    const itemsToShow = liveItems.length ? liveItems : historyItems;
    setScanTitle(liveItems.length ? 'Currently exceeding play threshold' : 'Recent Long Play reminders');
    setScanItems(itemsToShow);
    // Record live scan results into notification history for bell icon
    if (liveItems.length) {
      try {
        const history = await getNotificationHistory();
        const now = Date.now();
        for (const it of liveItems) {
          const dup = (history || []).some(h => h.title === it.title && h.body === it.body && Math.abs(now - (h.timestamp || 0)) < 180000);
          if (!dup) {
            await recordNotificationHistory(it.title, it.body || '', it.source);
          }
        }
      } catch {}
    }
    setScanDialogOpen(true);
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
      <Card style={[styles.card, { backgroundColor: theme.colors.surface, borderRadius: 16 }]}>
        <Card.Title
          title="Long Play Reminder"
          subtitle="Detect continuous play"
          titleStyle={{ fontFamily: headerFont }}
          subtitleStyle={{ fontFamily: headerFont, opacity: 0.7 }}
          left={(p) => <List.Icon {...p} icon="timer" color={theme.colors.primary} />}
          right={(p) => <View style={{ marginRight: 8, alignItems: 'center', justifyContent: 'center' }}><MinimalSwitch val={enabled} onToggle={() => setEnabled(!enabled)} /></View>}
        />
        <Card.Content>

          <View style={[styles.rowBetween, { marginTop: 16 }]}>
            <Text style={{ fontFamily: headerFont }}>Remind me after</Text>
            <Text style={{ fontFamily: headerFont, color: theme.colors.onSurfaceVariant, fontSize: 12 }}>
              Current: {isNaN(parseInt(durationMin, 10)) ? 45 : parseInt(durationMin, 10)} min
            </Text>
          </View>
          <SegmentedButtons
            value={seg}
            onValueChange={setSeg}
            style={{ marginTop: 8 }}
            buttons={[
              { value: '30', label: '30 min', style: { minWidth: 76 }, labelStyle: { fontSize: 13 } },
              { value: '45', label: '45 min', style: { minWidth: 76 }, labelStyle: { fontSize: 13 } },
              { value: '60', label: '60 min', style: { minWidth: 76 }, labelStyle: { fontSize: 13 } },
              { value: 'custom', label: 'Customize', style: { minWidth: 110 }, labelStyle: { fontSize: 13 } },
            ]}
          />
          {seg === 'custom' && (
            <View style={[styles.rowBetween, { marginTop: 8 }]}>
              <Text style={{ fontFamily: headerFont }}>Custom minutes</Text>
              <TextInput
                mode="outlined"
                value={durationMin}
                onChangeText={(t) => setDurationMin(String(t || '').replace(/\D/g, ''))}
                keyboardType="number-pad"
                dense
                style={{ width: 120, height: 40, backgroundColor: theme.colors.surface }}
                contentStyle={{ textAlign: 'center' }}
                outlineColor={theme.colors.primary}
                activeOutlineColor={theme.colors.primary}
                right={<TextInput.Affix text="min" />}
              />
            </View>
          )}

          <Text style={{ marginTop: 16, fontFamily: headerFont }}>Notification methods</Text>
          <View style={[styles.row, { marginTop: 8 }]}>
            <Checkbox.Item label="Push notification" status={push ? 'checked' : 'unchecked'} onPress={() => setPush(!push)} labelStyle={{ fontSize: 13, fontWeight: '400' }} />
            <Checkbox.Item label="In-app tip" status={inApp ? 'checked' : 'unchecked'} onPress={() => setInApp(!inApp)} labelStyle={{ fontSize: 13, fontWeight: '400' }} />
          </View>

          {info ? <HelperText type="info" style={{ fontFamily: headerFont }}>{info}</HelperText> : null}
        </Card.Content>
        <Card.Actions>
          <Button mode="outlined" onPress={openScan} style={{ borderColor: theme.colors.primary }} labelStyle={{ fontFamily: headerFont }} textColor={theme.colors.primary}>Scan</Button>
          <Button mode="outlined" onPress={onSave} style={{ marginLeft: 8, borderColor: theme.colors.primary }} labelStyle={{ fontFamily: headerFont }} textColor={theme.colors.primary}>Save Changes</Button>
        </Card.Actions>
      </Card>

      <Portal>
        <Dialog visible={scanDialogOpen} onDismiss={closeScan} style={{ borderRadius: 16 }}>
          <Dialog.Title style={{ fontSize: 16, fontFamily: headerFont }}>{scanTitle || 'Recent Long Play reminders'}</Dialog.Title>
          <Dialog.Content style={{ paddingHorizontal: 8 }}>
            <View style={{ maxHeight: 380 }}>
              {scanItems.length === 0 ? (
                <Text style={{ fontFamily: headerFont }}>No records yet. Please enable Long Play and set the duration; records will appear after actual play.</Text>
              ) : (
                scanItems.map((it, idx) => (
                  <React.Fragment key={it.id}>
                    <List.Item
                      title={it.title}
                      description={`${formatTime(it.timestamp)}\n${it.body || ''}`}
                      left={(p) => <List.Icon {...p} icon="history" />}
                      titleStyle={{ fontSize: 14, fontFamily: headerFont }}
                      descriptionStyle={{ fontFamily: headerFont }}
                    />
                    {idx < scanItems.length - 1 && <List.Divider />}
                  </React.Fragment>
                ))
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
  card: { borderRadius: 16 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: { flexDirection: 'row', alignItems: 'center' },
});
