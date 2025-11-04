import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Card, Text, Switch, Button, HelperText, Checkbox, SegmentedButtons, useTheme, TextInput } from 'react-native-paper';
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
            <Button mode="outlined" compact style={{ marginHorizontal: 8 }} onPress={() => setPreset(14)}>14 days</Button>
            <Button mode="outlined" compact onPress={() => setPreset(30)}>30 days</Button>
          </View>
          <View style={[styles.rowBetween, { marginTop: 8 }]}> 
            <Text>Custom (days)</Text>
            <TextInput value={days} onChangeText={setDays} keyboardType="numeric" style={{ width: 80 }} />
          </View>

          <Checkbox.Item label="Include helpful suggestion in reminders" status={smartSuggest ? 'checked' : 'unchecked'} onPress={() => setSmartSuggest(!smartSuggest)} />

          <Text style={{ marginTop: 8, color: theme.colors.onSurfaceVariant }}>
            "We will remind you which toys haven't been played with for a while to encourage rotation and keep things fresh."
          </Text>

          {info ? <HelperText type="info">{info}</HelperText> : null}
        </Card.Content>
        <Card.Actions>
          <Button onPress={onRunScan} mode="outlined">Run scan now</Button>
          <Button onPress={onSave} mode="contained">Save</Button>
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