import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, View, Platform } from 'react-native';
import { Text, Button, useTheme, ActivityIndicator } from 'react-native-paper';
import { LinearGradient } from 'expo-linear-gradient';
import { cartoonGradient } from '../../theme/tokens';
import { clearNotificationHistory, getNotificationHistory, NotificationHistoryItem, clearUnreadCount } from '../../utils/notifications';
import { useFocusEffect } from '@react-navigation/native';
import { useNotifications } from '../../context/NotificationsContext';

function formatTime(ts: number) {
  try {
    const d = new Date(ts);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
  } catch {
    return String(ts);
  }
}

function parseOwnerAndToy(body?: string): { owner?: string; toy?: string } {
  if (!body) return {};
  const s = body.trim();
  let m = s.match(/^Friendly reminder:\s+(?:(.+?)'s\s+)?(.+?)\s+(?:has|hasn't|hasn’t)\b/i);
  if (m) {
    const owner = m[1] ? m[1].trim() : undefined;
    const toy = m[2] ? m[2].trim() : undefined;
    return { owner, toy };
  }
  m = s.replace(/^温馨提示：/, '').match(/^(?:(.+?)的)?(.+?)(?:已|还|已经)/);
  if (m) {
    const owner = m[1] ? m[1].trim() : undefined;
    const toy = m[2] ? m[2].trim() : undefined;
    return { owner, toy };
  }
  return {};
}

export default function NotificationHistoryScreen() {
  const theme = useTheme();
  const { setUnreadCount } = useNotifications();
  const [items, setItems] = useState<NotificationHistoryItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const headerFont = Platform.select({ ios: 'Arial Rounded MT Bold', android: 'sans-serif-medium', default: 'System' });

  const load = useCallback(async () => {
    setLoading(true);
    const arr = await getNotificationHistory();
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const filtered = (arr || []).filter((i) => i.timestamp >= cutoff);
    setItems(filtered.slice().sort((a, b) => b.timestamp - a.timestamp));
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => {
    (async () => {
      await load();
      // Visiting history marks notifications as read
      await clearUnreadCount();
      setUnreadCount(0);
    })();
  }, [load, setUnreadCount]));

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
    const baseSource = (it.source || '').split(':')[0] || 'unknown';
    const meta = sourceMeta[baseSource] || sourceMeta.unknown;
    const { owner, toy } = parseOwnerAndToy(it.body);
    const cleanedBody = String(it.body || '')
      .replace(/^Friendly reminder:\s*/i, '')
      .replace(/^温馨提示：\s*/i, '')
      .replace(/\bLong Play\b/gi, '')
      .replace(/\bIdle Toy Reminder\b/gi, '')
      ;
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
          <Text style={{ color: theme.colors.onSurface, fontSize: 14, lineHeight: 20, fontFamily: headerFont }}>
            <Text style={{ fontWeight: '600', fontFamily: headerFont }}>{it.title}</Text>
            <Text> · </Text>
            <Text style={{ fontFamily: headerFont }}>{cleanedBody}</Text>
          </Text>
          <View style={{ flexDirection: 'row', marginTop: 6, alignItems: 'center' }}>
            <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 11, fontFamily: headerFont }}>{formatTime(it.timestamp)}</Text>
            <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 11, fontFamily: headerFont }}>{'  ·  '}</Text>
            <Text style={{ color: meta.color, fontSize: 11, fontFamily: headerFont }}>{meta.label}</Text>
            {(toy || owner) && <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 11, fontFamily: headerFont }}>{'  ·  '}</Text>}
            {toy && <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 11, fontFamily: headerFont }}>{toy}</Text>}
            {owner && <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 11, fontFamily: headerFont }}>{'  ·  '}{owner}</Text>}
          </View>
        </View>
      </View>
    );
  };

  return (
    <LinearGradient colors={cartoonGradient} style={{ flex: 1 }}>
      <ScrollView 
        contentContainerStyle={[
          { padding: 16, paddingBottom: 48 },
          Platform.OS === 'web' && { width: '100%', maxWidth: 1000, alignSelf: 'center', paddingHorizontal: 32 }
        ]}
      >
        {/* 顶部操作栏：Clear all / Refresh */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <Button onPress={handleClear} disabled={isEmpty} mode="text" labelStyle={{ fontFamily: headerFont }}>Clear all</Button>
          <Button onPress={load} mode="text" labelStyle={{ fontFamily: headerFont }}>Refresh</Button>
        </View>
        {/* 顶部提示文案移除 per request */}

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
