import React, { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Card, List, Text, Button, useTheme, ActivityIndicator } from 'react-native-paper';
import { clearNotificationHistory, getNotificationHistory, NotificationHistoryItem } from '../../utils/notifications';
import { useFocusEffect } from '@react-navigation/native';

function formatTime(ts: number) {
  try {
    const d = new Date(ts);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
  } catch {
    return String(ts);
  }
}

export default function NotificationHistoryScreen() {
  const theme = useTheme();
  const [items, setItems] = useState<NotificationHistoryItem[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const arr = await getNotificationHistory();
    // newest first
    setItems(arr.slice().sort((a, b) => b.timestamp - a.timestamp));
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleClear = async () => {
    setLoading(true);
    await clearNotificationHistory();
    await load();
  };

  const isEmpty = (items || []).length === 0;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
      <Card style={{ marginBottom: 16 }}>
        <Card.Title title="Notifications" subtitle="Notification history" />
        <Card.Content>
          {loading && !items ? (
            <View style={{ paddingVertical: 24, alignItems: 'center' }}>
              <ActivityIndicator />
            </View>
          ) : isEmpty ? (
            <Text style={{ color: theme.colors.onSurfaceVariant, paddingVertical: 12 }}>
              No notification history yet.
            </Text>
          ) : (
            (items || []).map((it) => (
              <List.Item
                key={it.id}
                title={it.title}
                description={`${it.body || ''}`.trim()}
                right={() => (
                  <View style={{ alignItems: 'flex-end', justifyContent: 'center' }}>
                    <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 12 }}>{formatTime(it.timestamp)}</Text>
                    {it.source ? (
                      <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 12 }}>{it.source}</Text>
                    ) : null}
                  </View>
                )}
              />
            ))
          )}
        </Card.Content>
        <Card.Actions>
          <Button onPress={handleClear} disabled={isEmpty} mode="text">Clear</Button>
          <Button onPress={load} mode="text">Refresh</Button>
        </Card.Actions>
      </Card>
    </ScrollView>
  );
}