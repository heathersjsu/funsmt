import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Card, Button, List } from 'react-native-paper';
import { getFunctionUrl, loadFigmaThemeOverrides, buildKidTheme } from '../../theme';
import { useThemeUpdate } from '../../theme/ThemeContext';
import { supabase } from '../../supabaseClient';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { scheduleLocalDailyCheck } from '../../utils/notifications';

type Props = NativeStackScreenProps<any>;

type DeviceToken = { id?: string; user_id: string; token: string };

export default function ReminderStatusScreen({}: Props) {
  const [tokens, setTokens] = useState<DeviceToken[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const { setTheme } = useThemeUpdate();

  const fetchTokens = async () => {
    const { data: userRes } = await supabase.auth.getUser();
    const uid = userRes?.user?.id;
    if (!uid) return;
    const { data } = await supabase.from('device_tokens').select('*').eq('user_id', uid);
    setTokens(data || []);
  };

  useEffect(() => {
    fetchTokens();
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
    <View style={styles.container}>
      <Text variant="headlineMedium" style={styles.title}>Reminders</Text>

      <Card style={[styles.card, { backgroundColor: '#D5E5FF' }]}>
        <Card.Title title="Device Push Tokens" subtitle={tokens.length ? `Registered ${tokens.length}` : 'Not registered yet'} />
        <Card.Content>
          {tokens.length ? tokens.map(t => (
            <List.Item key={t.token} title={t.token} />
          )) : <Text>After signing in, device push token registration is automatic.</Text>}
        </Card.Content>
      </Card>

      <Card style={[styles.card, { backgroundColor: '#FFE2C6' }]}>
        <Card.Title title="Local Reminder" subtitle="Every day at 20:00" />
        <Card.Actions>
          <Button mode="contained" onPress={onScheduleLocal}>Set Local Reminder</Button>
        </Card.Actions>
      </Card>

      {/* Design sync section removed */}

      {message && <Text style={styles.message}>{message}</Text>}

      <Text style={styles.note}>Server-side daily reminder (notify-out-toys) is deployed. Ensure device tokens and database data are valid.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#FFF9E6' },
  title: { color: '#6C63FF' },
  card: { marginBottom: 12, borderRadius: 18 },
  message: { color: 'green', marginTop: 8 },
  note: { marginTop: 8, color: '#3D405B' },
});