import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Card, Text, Switch, TextInput, Button, Checkbox, HelperText, useTheme } from 'react-native-paper';
import * as SecureStore from 'expo-secure-store';
import { startLongPlayMonitor, stopLongPlayMonitor, LongPlaySettings } from '../../reminders/longPlay';

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

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}> 
      <Text variant="headlineMedium" style={{ marginBottom: 8 }}>Long Play Reminder</Text>
      <Card style={[styles.card, { backgroundColor: theme.colors.surface }]}> 
        <Card.Content>
          <View style={styles.rowBetween}>
            <Text>Master Switch</Text>
            <Switch value={enabled} onValueChange={setEnabled} />
          </View>
          <View style={[styles.rowBetween, { marginTop: 12 }]}> 
            <Text>Duration (minutes)</Text>
            <View style={styles.row}> 
              <Button onPress={onMinus} mode="outlined" compact>-5</Button>
              <TextInput value={durationMin} onChangeText={setDurationMin} keyboardType="numeric" style={{ width: 80, marginHorizontal: 8 }} />
              <Button onPress={onPlus} mode="outlined" compact>+5</Button>
            </View>
          </View>
          <Text style={{ marginTop: 12, marginBottom: 4 }}>Reminder Methods</Text>
          <View style={styles.row}> 
            <Checkbox.Item label="Push notification" status={push ? 'checked' : 'unchecked'} onPress={() => setPush(!push)} />
            <Checkbox.Item label="In-app tip" status={inApp ? 'checked' : 'unchecked'} onPress={() => setInApp(!inApp)} />
          </View>
          <Text style={{ marginTop: 8, color: theme.colors.onSurfaceVariant }}>
            "When a single toy is played continuously over the set duration, we'll gently remind kids to take a break." 
          </Text>
          {info ? <HelperText type="info">{info}</HelperText> : null}
        </Card.Content>
        <Card.Actions>
          <Button mode="contained" onPress={onSave}>Save</Button>
        </Card.Actions>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  card: { borderRadius: 18 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: { flexDirection: 'row', alignItems: 'center' },
});