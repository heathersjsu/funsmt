import React, { useEffect, useState } from 'react';
import { View, ScrollView, Platform, RefreshControl } from 'react-native';
import { Text, useTheme, Card, List, Divider } from 'react-native-paper';
import { supabase } from '../../supabaseClient';
import { LinearGradient } from 'expo-linear-gradient';
import { cartoonGradient } from '../../theme/tokens';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
 
type Props = NativeStackScreenProps<any>;
 
export default function ToyHistoryScreen({ route }: Props) {
  const theme = useTheme();
  const headerFont = Platform.select({ ios: 'Arial Rounded MT Bold', android: 'sans-serif-medium', default: 'System' });
  const toyId: string = route.params?.toyId;
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [toyStatus, setToyStatus] = useState<'in' | 'out' | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Array<{ start: string; end?: string | null; minutes?: number | null }>>([]);
  const [monthStats, setMonthStats] = useState<{ plays: number; hours: number }>({ plays: 0, hours: 0 });
  const [totalHours, setTotalHours] = useState<number>(0);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = async () => {
    try {
      const { data: toyRow } = await supabase.from('toys').select('created_at,status,updated_at,rfid').eq('id', toyId).maybeSingle();
      setCreatedAt((toyRow as any)?.created_at || null);
      setToyStatus((toyRow as any)?.status || null);
      setUpdatedAt((toyRow as any)?.updated_at || null);

      if ((toyRow as any)?.rfid) {
        const { data } = await supabase
          .from('play_sessions')
          .select('start_time, end_time, duration')
          .eq('rfid', (toyRow as any).rfid)
          .order('start_time', { ascending: true });

        const items: Array<{ start: string; end?: string | null; minutes?: number | null }> = (data || []).map((r: any) => {
          // Handle start_time/end_time as Unix timestamp (number) or ISO string
          const start = typeof r.start_time === 'number' ? new Date(r.start_time * 1000).toISOString() : r.start_time;
          const end = r.end_time ? (typeof r.end_time === 'number' ? new Date(r.end_time * 1000).toISOString() : r.end_time) : null;
          const minutes = r.duration ? Math.round(r.duration / 60) : 
                          (start && end ? Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000) : 0);
          return { start, end, minutes };
        });

        setSessions(items);

        const now = new Date();
        const playsThisMonth = items.filter((s) => {
          const d = new Date(s.start);
          return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
        }).length;
        const hoursThisMonth = items
          .filter((s) => {
            const d = new Date(s.start);
            return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
          })
          .reduce((sum, s) => sum + Math.max(0, s.minutes || 0) / 60, 0);
        setMonthStats({ plays: playsThisMonth, hours: parseFloat(hoursThisMonth.toFixed(1)) });
        const totalH = items.reduce((sum, s) => sum + Math.max(0, s.minutes || 0) / 60, 0);
        setTotalHours(parseFloat(totalH.toFixed(1)));
      } else {
        setSessions([]);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => { loadData(); }, [toyId]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };
 
  return (
    <LinearGradient colors={cartoonGradient} style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          { padding: 16, paddingBottom: 40 },
          Platform.OS === 'web' && { width: '100%', maxWidth: 1000, alignSelf: 'center', paddingHorizontal: 16 }
        ]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        alwaysBounceVertical
      >
        <View style={{ marginBottom: 12 }}>
          <View style={{ paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#FFF8E1', borderRadius: 20, alignSelf: 'flex-start' }}>
            <Text style={{ fontSize: 14, color: theme.colors.primary, fontFamily: headerFont }}>
              This month: {monthStats.plays} plays
            </Text>
          </View>
          <View style={{ paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#E1F5FE', borderRadius: 20, alignSelf: 'flex-start', marginTop: 8 }}>
            <Text style={{ fontSize: 14, color: theme.colors.primary, fontFamily: headerFont }}>
              Total duration: {totalHours} hours
            </Text>
          </View>
        </View>
        <Card style={{ backgroundColor: theme.colors.surface, borderRadius: 16, paddingHorizontal: 8, paddingVertical: 8 }}>
          <View style={{ paddingLeft: 4, paddingRight: 4 }}>
            {(() => {
              const events: Array<{ ts: string; type: 'out' | 'in'; minutes?: number | null }> = [];
              sessions.forEach((s) => {
                events.push({ ts: s.start, type: 'out' });
                if (s.end) events.push({ ts: s.end, type: 'in', minutes: s.minutes });
              });
              if (toyStatus === 'in' || toyStatus === 'out') {
                const latestType = events.length
                  ? events.reduce((acc, e) => (new Date(e.ts).getTime() > new Date(acc.ts).getTime() ? e : acc), events[0]).type
                  : null;
                if (latestType !== toyStatus) {
                  if (toyStatus === 'in') {
                    let inferredMinutes: number | null = null;
                    const lastOut = events
                      .filter((e) => e.type === 'out')
                      .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())[0];
                    if (lastOut) {
                      const endTs = Date.now();
                      inferredMinutes = Math.max(0, Math.round((endTs - new Date(lastOut.ts).getTime()) / 60000));
                    }
                    const tsToUse = new Date().toISOString();
                    events.push({ ts: tsToUse, type: 'in', minutes: inferredMinutes });
                  } else {
                    const tsToUse = new Date().toISOString();
                    events.push({ ts: tsToUse, type: 'out' });
                  }
                }
              }
              if (events.length === 0) {
                return <Text style={{ color: '#999', fontStyle: 'italic', fontFamily: headerFont }}>No history yet</Text>;
              }
              return events
                .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
                .map((e, idx) => {
                  const title = `${new Date(e.ts).toLocaleDateString()} ${new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} — ${e.type}`;
                  const desc = e.type === 'in' && typeof e.minutes === 'number' ? `played for ${e.minutes} min` : undefined;
                  return (
                    <React.Fragment key={`${e.ts}_${e.type}_${idx}`}>
                      <List.Item
                        title={title}
                        description={desc}
                        left={(p) => <List.Icon {...p} icon={e.type === 'in' ? 'checkbox-marked-circle-outline' : 'history'} color={e.type === 'in' ? theme.colors.primary : theme.colors.onSurfaceVariant} />}
                        titleStyle={{ fontSize: 14, fontFamily: headerFont }}
                        descriptionStyle={{ fontFamily: headerFont }}
                        style={{ paddingVertical: 4 }}
                      />
                      {idx < events.length - 1 && <Divider style={{ opacity: 0.2 }} />}
                    </React.Fragment>
                  );
                });
            })()}
            {createdAt ? (
              <>
                <Divider style={{ opacity: 0.15, marginTop: 8 }} />
                <List.Item
                  title={`${new Date(createdAt).toLocaleDateString()} ${new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} — Added`}
                  left={(p) => <List.Icon {...p} icon="plus-circle-outline" color={theme.colors.onSurfaceVariant} />}
                  titleStyle={{ fontSize: 14, fontFamily: headerFont, color: theme.colors.onSurfaceVariant }}
                  style={{ paddingVertical: 4 }}
                />
              </>
            ) : null}
          </View>
        </Card>
      </ScrollView>
    </LinearGradient>
  );
}
