import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Card, Text, Switch, Button, HelperText, Chip, TextInput, useTheme } from 'react-native-paper';
import * as SecureStore from 'expo-secure-store';
import { cancelAllReminders, scheduleDailyReminder } from '../../utils/notifications';
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

  useEffect(() => { (async () => { const s = await loadSettings(); setEnabled(s.enabled); setTime(s.time); setRepeat(s.repeat); setDndStart(s.dndStart || ''); setDndEnd(s.dndEnd || ''); })(); }, []);

  const onSave = async () => {
    const s: TidyingSettings = { enabled, time, repeat, dndStart, dndEnd };
    await saveSettings(s);
    setInfo('Smart tidy-up settings saved.');
    await cancelAllReminders();
    if (enabled) {
      const { hour, minute } = parseTime(time);
      await scheduleDailyReminder('Tidy-up time!', "It's time to help toys go home! Tap to view the checklist.", hour, minute);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}> 
      <Text variant="headlineMedium" style={{ marginBottom: 8 }}>Smart Tidy-up Reminder</Text>
      <Card style={[styles.card, { backgroundColor: theme.colors.surface }]}> 
        <Card.Content>
          <View style={styles.rowBetween}>
            <Text>Master Switch</Text>
            <Switch value={enabled} onValueChange={setEnabled} />
          </View>

          <Text style={{ marginTop: 12 }}>Daily tidy-up time</Text>
          <View style={[styles.rowBetween, { marginTop: 8 }]}> 
            <Text>HH:MM</Text>
            <TextInput value={time} onChangeText={setTime} placeholder="20:00" style={{ width: 100 }} />
          </View>

          <Text style={{ marginTop: 12 }}>Repeat</Text>
          <View style={[styles.row, { marginTop: 8 }]}> 
            <Chip selected={repeat==='daily'} onPress={() => setRepeat('daily')} style={styles.chip}>Daily</Chip>
            <Chip selected={repeat==='weekends'} onPress={() => setRepeat('weekends')} style={styles.chip}>Weekends</Chip>
            <Chip selected={repeat==='weekdays'} onPress={() => setRepeat('weekdays')} style={styles.chip}>Weekdays</Chip>
          </View>

          <Text style={{ marginTop: 12 }}>Do Not Disturb</Text>
          <View style={[styles.rowBetween, { marginTop: 8 }]}> 
            <Text>Start (HH:MM)</Text>
            <TextInput value={dndStart} onChangeText={setDndStart} placeholder="22:00" style={{ width: 100 }} />
          </View>
          <View style={[styles.rowBetween, { marginTop: 8 }]}> 
            <Text>End (HH:MM)</Text>
            <TextInput value={dndEnd} onChangeText={setDndEnd} placeholder="07:00" style={{ width: 100 }} />
          </View>

          <Text style={{ marginTop: 8, color: theme.colors.onSurfaceVariant }}>
            "Build tidy-up habits with a fixed time and a playful checklist."
          </Text>

          {info ? <HelperText type="info">{info}</HelperText> : null}
        </Card.Content>
        <Card.Actions>
          <Button mode="outlined" onPress={() => nav.navigate('RecoveryChecklist')}>Open checklist</Button>
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
  chip: { marginRight: 8 },
});