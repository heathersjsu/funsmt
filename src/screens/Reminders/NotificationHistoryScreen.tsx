import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Text, Button, useTheme, ActivityIndicator } from 'react-native-paper';
import { LinearGradient } from 'expo-linear-gradient';
import { cartoonGradient } from '../../theme/tokens';
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

  // 每种来源对应不同的颜色与标签
  const sourceMeta = useMemo(() => ({
    longPlay: { label: 'Long Play', color: '#FF6B9D' },
    idleToy: { label: 'Idle Toy', color: '#4ECDC4' },
    smartTidying: { label: 'Smart Tidy-up', color: '#6A5ACD' },
    localDaily: { label: 'Daily', color: '#FFD700' },
    unknown: { label: 'Other', color: theme.colors.secondary },
  } as Record<string, { label: string; color: string }>), [theme.colors.secondary]);

  const ItemRow = ({ it }: { it: NotificationHistoryItem }) => {
    const meta = sourceMeta[it.source || 'unknown'] || sourceMeta.unknown;
    return (
      <View style={{
        flexDirection: 'row',
        paddingVertical: 12,
        paddingHorizontal: 12,
        marginBottom: 8,
        backgroundColor: 'rgba(255,255,255,0.65)',
        borderRadius: 8,
      }}>
        <View style={{ width: 4, backgroundColor: meta.color, borderRadius: 4, marginRight: 12 }} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.colors.onSurface, fontSize: 16, lineHeight: 22 }}>
            <Text style={{ fontWeight: '600' }}>{it.title}</Text>
            <Text> · </Text>
            <Text>{it.body}</Text>
          </Text>
          <View style={{ flexDirection: 'row', marginTop: 6, alignItems: 'center' }}>
            <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 12 }}>{formatTime(it.timestamp)}</Text>
            <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 12 }}>{'  ·  '}</Text>
            <Text style={{ color: meta.color, fontSize: 12 }}>{meta.label}</Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <LinearGradient colors={cartoonGradient} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        {/* 顶部操作栏：Clear all / Refresh */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <Button onPress={handleClear} disabled={isEmpty} mode="text">Clear all</Button>
          <Button onPress={load} mode="text">Refresh</Button>
        </View>
        {/* 顶部提示文案 */}
        <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 12, marginBottom: 12 }}>
          Showing latest 20 reminders
        </Text>

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
            <ItemRow key={it.id} it={it} />
          ))
        )}
      </ScrollView>
    </LinearGradient>
  );
}