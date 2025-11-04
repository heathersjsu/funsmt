import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Card, Button, List, useTheme } from 'react-native-paper';
import { getFunctionUrl, loadFigmaThemeOverrides, buildKidTheme } from '../../theme';
import { useThemeUpdate } from '../../theme/ThemeContext';
import { supabase } from '../../supabaseClient';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { scheduleLocalDailyCheck } from '../../utils/notifications';
import { useNavigation } from '@react-navigation/native';

type Props = NativeStackScreenProps<any>;

type DeviceToken = { id?: string; user_id: string; token: string };

export default function ReminderStatusScreen({}: Props) {
  const [tokens, setTokens] = useState<DeviceToken[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const { setTheme } = useThemeUpdate();
  const theme = useTheme();
  const navigation = useNavigation<any>();

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
    <ScrollView style={[styles.container, { backgroundColor: theme.colors.background }]} contentContainerStyle={{ paddingBottom: 24 }}>
      <Text variant="headlineMedium" style={[styles.title, { color: theme.colors.primary }]}>Reminders</Text>

      {/* Removed: Device Push Tokens card per request */}

      {/* Removed: Local Reminder card per request */}

      {/* Reminder Settings shortcuts */}
      <Card style={[styles.card, { backgroundColor: theme.colors.surface }]}> 
        <Card.Title title="Reminder Settings" subtitle="Manage reminder preferences" />
        <Card.Content>
          <List.Item title="Long Play Reminder" left={() => <List.Icon icon="timer-sand" />} onPress={() => navigation.navigate('Me', { screen: 'LongPlaySettings' })} right={() => <List.Icon icon="chevron-right" />} />
          <List.Item title="Idle Toy Reminder" left={() => <List.Icon icon="sleep" />} onPress={() => navigation.navigate('Me', { screen: 'IdleToySettings' })} right={() => <List.Icon icon="chevron-right" />} />
          <List.Item title="Smart Tidy-up" left={() => <List.Icon icon="broom" />} onPress={() => navigation.navigate('Me', { screen: 'SmartTidyingSettings' })} right={() => <List.Icon icon="chevron-right" />} />
          <List.Item title="Recovery Checklist" left={() => <List.Icon icon="clipboard-check-outline" />} onPress={() => navigation.navigate('Me', { screen: 'RecoveryChecklist' })} right={() => <List.Icon icon="chevron-right" />} />
        </Card.Content>
      </Card>

      {/* Design sync section removed */}

      {message && <Text style={[styles.message, { color: theme.colors.primary }]}>{message}</Text>}

      <Text style={[styles.note, { color: theme.colors.onSurfaceVariant }]}>Server-side daily reminder (notify-out-toys) is deployed. Ensure device tokens and database data are valid.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 /* bg moved to theme */ },
  title: { /* color moved to theme */ },
  card: { marginBottom: 12, borderRadius: 18 },
  message: { marginTop: 8 /* color moved to theme */ },
  note: { marginTop: 8 /* color moved to theme */ },
});