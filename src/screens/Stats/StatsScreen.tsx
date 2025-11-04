import React, { useEffect, useMemo, useState } from 'react';
import { View, ScrollView, StyleSheet, Platform } from 'react-native';
import { Text, Card, List, Divider, useTheme } from 'react-native-paper';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '../../supabaseClient';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Toy } from '../../types';
import Svg, { Circle, G, Text as SvgText } from 'react-native-svg';
import TagCard from '../../components/TagCard';
import { cartoonGradient } from '../../theme/tokens';
// const appJson = require('../../../app.json'); // Version no longer displayed

type Props = NativeStackScreenProps<any>;

export default function StatsScreen({}: Props) {
  const [toys, setToys] = useState<Toy[]>([]);
  // const appVersion = (appJson?.expo?.extra?.displayVersion) || (appJson?.expo?.version) || 'dev';
  const theme = useTheme();

  const fetchData = async () => {
    const { data } = await supabase.from('toys').select('id,name,status,category,owner,location,updated_at');
    setToys((data as any[]) || []);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const total = toys.length;
  const inCount = useMemo(() => toys.filter(t => t.status === 'in').length, [toys]);
  const outCount = useMemo(() => toys.filter(t => t.status === 'out').length, [toys]);

  const byCategory = useMemo(() => {
    const map: Record<string, number> = {};
    toys.forEach(t => { const key = (t as any).category || 'Uncategorized'; map[key] = (map[key] || 0) + 1; });
    return map;
  }, [toys]);

  const byOwner = useMemo(() => {
    const map: Record<string, number> = {};
    toys.forEach(t => { const own = (t as any).owner || 'Unknown'; map[own] = (map[own] || 0) + 1; });
    return map;
  }, [toys]);

  const byLocation = useMemo(() => {
    const map: Record<string, number> = {};
    toys.forEach(t => { const loc = (t as any).location || 'Unknown'; map[loc] = (map[loc] || 0) + 1; });
    return map;
  }, [toys]);

  const ownersCount = useMemo(() => Object.keys(byOwner).length, [byOwner]);
  const ownerEntries = useMemo(() => Object.entries(byOwner).sort((a,b)=>b[1]-a[1]), [byOwner]);
  
  // Fix donut chart data calculation - use actual owner data sum
  const ownerTotal = useMemo(() => ownerEntries.reduce((sum, [, count]) => sum + count, 0), [ownerEntries]);
  
  const ownerColors = useMemo(() => {
    const palette = ['#FF8C42','#4CC3C3','#6A5ACD','#2E8B57','#C71585','#20B2AA','#FFD700','#FF69B4','#7FFFD4','#B8860B'];
    const map: Record<string, string> = {};
    ownerEntries.forEach(([own], idx) => { map[own] = palette[idx % palette.length]; });
    return map;
  }, [ownerEntries]);

  const sortedCategories = useMemo(() => Object.entries(byCategory).sort((a,b)=>b[1]-a[1]), [byCategory]);
  const TOP_N = 3;
  const topCategories = useMemo(() => sortedCategories.slice(0, TOP_N).map(([k]) => k), [sortedCategories]);

  const last7Days = useMemo(() => {
    const days: number[] = Array.from({ length: 7 }, () => 0);
    const now = new Date();
    toys.forEach(t => {
      const iso = (t as any).updated_at as string | undefined;
      if (!iso) return;
      const dt = new Date(iso);
      const diff = Math.floor((now.getTime() - dt.getTime()) / (1000*60*60*24));
      if (diff >=0 && diff < 7) days[6-diff] += 1;
    });
    return days;
  }, [toys]);

  const hourBuckets = useMemo(() => {
    const buckets: number[] = Array.from({ length: 6 }, () => 0);
    toys.forEach(t => {
      const iso = (t as any).updated_at as string | undefined;
      if (!iso) return;
      const h = new Date(iso).getHours();
      const idx = Math.min(5, Math.floor(h / 4));
      buckets[idx] += 1;
    });
    return buckets;
  }, [toys]);

  return (
    <LinearGradient colors={cartoonGradient} style={{ flex: 1 }}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text variant="headlineMedium" style={[styles.title, { color: theme.colors.onSurface }]}>
          Live Dashboard 🎮
        </Text>

        {/* Statistics card grid - more cartoon-like style */}
        <View style={styles.grid}>
          <TagCard variant="total" value={total} />
          <TagCard variant="in" value={inCount} />
          <TagCard variant="out" value={outCount} />
          <TagCard variant="owners" value={ownersCount} />
        </View>

        {/* Donut chart - fix data calculation */}
        <Card style={[styles.fullCard, { backgroundColor: theme.colors.surface, borderRadius: 24, elevation: 8 }]}>
          <Card.Content style={{ alignItems: 'center', padding: 24 }}>
            <Text variant="titleLarge" style={{ marginBottom: 16, fontWeight: 'bold' }}>
              Toy Owner Distribution 👥
            </Text>
            <Svg width={220} height={220}>
              {/* Background circle to avoid visual gaps */}
              <Circle cx={110} cy={110} r={100} stroke={theme.colors.surfaceVariant} strokeWidth={20} fill="none" />
              <G rotation={-90} originX={110} originY={110}>
                {ownerEntries.map(([own, count], idx) => {
                  const radius = 100;
                  const circumference = 2 * Math.PI * radius;
                  // Use ownerTotal instead of total
                  const segLen = circumference * (count / Math.max(1, ownerTotal));
                  const offset = circumference * (ownerEntries.slice(0, idx).reduce((acc, [,c]) => acc + c, 0) / Math.max(1, ownerTotal));
                  return (
                    <Circle
                      key={own}
                      cx={110}
                      cy={110}
                      r={radius}
                      stroke={ownerColors[own]}
                      strokeWidth={20}
                      fill="none"
                      strokeDasharray={`${segLen} ${circumference}`}
                      strokeDashoffset={-offset}
                      strokeLinecap="round"
                    />
                  );
                })}
              </G>
              {/* Center text */}
              <SvgText x={110} y={105} textAnchor="middle" fontSize={24} fontWeight="bold" fill={theme.colors.onSurface}>
                {ownerTotal}
              </SvgText>
              <SvgText x={110} y={125} textAnchor="middle" fontSize={14} fill={theme.colors.onSurfaceVariant}>
                Total
              </SvgText>
            </Svg>
            <View style={styles.legend}>
              {ownerEntries.map(([own]) => (
                <View style={styles.legendItem} key={own}>
                  <View style={[styles.legendSwatch, { backgroundColor: ownerColors[own] }]} />
                  <Text style={[styles.legendLabel, { color: theme.colors.onSurface }]}>{own} ({byOwner[own]})</Text>
                </View>
              ))}
            </View>
        </Card.Content>
      </Card>

      {/* Statistics by category */}
      <Card style={[styles.fullCard, { backgroundColor: theme.colors.secondaryContainer, borderRadius: 24, elevation: 6 }]}>
        <Card.Content style={{ padding: 20 }}>
          <Text variant="titleLarge" style={{ marginBottom: 16, fontWeight: 'bold' }}>
            Top 3 Popular Categories 🏆
          </Text>
          {sortedCategories.slice(0, 3).map(([cat, count], idx) => {
            const colors = ['#FF6B9D', '#4ECDC4', '#45B7D1'];
            const medals = ['🥇', '🥈', '🥉'];
            return (
              <View key={cat} style={[styles.rowBetween, { marginBottom: 12, padding: 12, backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 16 }]}>
                <View style={styles.rowCenter}>
                  <Text style={{ fontSize: 20, marginRight: 8 }}>{medals[idx]}</Text>
                  <Text variant="bodyLarge" style={{ fontWeight: '600' }}>{cat}</Text>
                </View>
                <View style={[styles.badge, { backgroundColor: colors[idx] }]}>
                  <Text variant="labelMedium" style={{ color: 'white', fontWeight: 'bold' }}>{count}</Text>
                </View>
              </View>
            );
          })}
        </Card.Content>
      </Card>

      {/* Statistics by location */}
      <Card style={[styles.fullCard, { backgroundColor: theme.colors.tertiaryContainer, borderRadius: 24, elevation: 6 }]}>
        <Card.Content style={{ padding: 20 }}>
          <Text variant="titleLarge" style={{ marginBottom: 16, fontWeight: 'bold' }}>
            Location Distribution 📍
          </Text>
          {Object.entries(byLocation).sort((a,b)=>b[1]-a[1]).slice(0, 5).map(([loc, count]) => (
            <View key={loc} style={[styles.rowBetween, { marginBottom: 12, padding: 12, backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 16 }]}>
              <Text variant="bodyLarge" style={{ fontWeight: '600' }}>📍 {loc}</Text>
              <View style={[styles.badge, { backgroundColor: '#96CEB4' }]}>
                <Text variant="labelMedium" style={{ color: 'white', fontWeight: 'bold' }}>{count}</Text>
              </View>
            </View>
          ))}
        </Card.Content>
      </Card>

      {/* Bar Chart */}
      <Card style={[styles.fullCard, { backgroundColor: theme.colors.surface, borderRadius: 24, elevation: 6 }]}>
        <Card.Content style={{ padding: 20 }}>
          <Text variant="titleLarge" style={{ marginBottom: 16, fontWeight: 'bold' }}>
            Last 7 Days Activity 📊
          </Text>
          <View style={styles.rowCenter}>
            {last7Days.map((count, idx) => {
              const maxCount = Math.max(...last7Days, 1);
              const height = Math.max(8, (count / maxCount) * 80);
              return (
                <View key={idx} style={{ alignItems: 'center', flex: 1 }}>
                  <View style={[styles.bar, { height, backgroundColor: '#FF6B9D', borderRadius: 8 }]} />
                  <Text variant="labelSmall" style={{ marginTop: 4, fontWeight: '600' }}>
                    {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][idx]}
                  </Text>
                </View>
              );
            })}
          </View>
        </Card.Content>
      </Card>

      {/* Progress Bars */}
      <Card style={[styles.fullCard, { backgroundColor: theme.colors.surface, borderRadius: 24, elevation: 6 }]}>
        <Card.Content style={{ padding: 20 }}>
          <Text variant="titleLarge" style={{ marginBottom: 16, fontWeight: 'bold' }}>
            Category Progress 🎯
          </Text>
          {topCategories.map((cat) => {
            const count = byCategory[cat] || 0;
            const progress = count / Math.max(1, total);
            return (
              <View key={cat} style={{ marginBottom: 16 }}>
                <View style={styles.rowBetween}>
                  <Text variant="bodyMedium" style={{ fontWeight: '600' }}>{cat}</Text>
                  <Text variant="bodySmall" style={{ fontWeight: '600', color: '#FF6B9D' }}>{count}/{total}</Text>
                </View>
                <View style={[styles.progressBarBg, { borderRadius: 12, marginTop: 8 }]}>
                  <View style={[styles.progressBarFill, { width: `${progress * 100}%`, borderRadius: 12, backgroundColor: '#FF6B9D' }]} />
                </View>
              </View>
            );
          })}
        </Card.Content>
      </Card>

      {/* Time Distribution */}
      <Card style={[styles.fullCard, { backgroundColor: theme.colors.surface, borderRadius: 24, elevation: 6 }]}>
        <Card.Content style={{ padding: 20 }}>
          <Text variant="titleLarge" style={{ marginBottom: 16, fontWeight: 'bold' }}>
            Time Distribution ⏰
          </Text>
          <View style={styles.rowCenter}>
            {hourBuckets.map((count, idx) => {
              const labels = ['🌅Morning', '🌞AM', '☀️Noon', '🌤️PM', '🌆Evening', '🌙Night'];
              const maxCount = Math.max(...hourBuckets, 1);
              const height = Math.max(8, (count / maxCount) * 60);
              const colors = ['#FFEAA7', '#FF6B9D', '#4ECDC4', '#45B7D1', '#96CEB4', '#DDA0DD'];
              return (
                <View key={idx} style={{ alignItems: 'center', flex: 1, marginHorizontal: 2 }}>
                  <View style={[styles.barAlt, { height, backgroundColor: colors[idx], borderRadius: 8 }]} />
                  <Text variant="labelSmall" style={{ marginTop: 4, textAlign: 'center', fontWeight: '600' }}>
                    {labels[idx]}
                  </Text>
                </View>
              );
            })}
          </View>
        </Card.Content>
      </Card>

      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16 },
  title: { textAlign: 'center', marginBottom: 16, fontWeight: 'bold' },
  grid: { 
    flexDirection: 'row', 
    flexWrap: 'wrap', 
    marginBottom: 16,
    justifyContent: Platform.select({
      web: 'center',  // Web center alignment
      default: 'space-between',
    }),
  },
  card: { 
    flex: Platform.select({
      web: 0,  // Web no flex
      default: 1,
    }),
    marginHorizontal: 4, 
    borderRadius: 20,
    width: Platform.select({
      web: 140,  // Web fixed width
      default: undefined,
    }),
  },
  fullCard: { marginBottom: 16, elevation: 6 },
  rowCenter: { flexDirection: 'row', alignItems: 'center' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: { 
    paddingHorizontal: 12, 
    paddingVertical: 6, 
    borderRadius: 16, 
    minWidth: 32,
    alignItems: 'center',
    justifyContent: 'center'
  },
  bar: { width: 24, backgroundColor: '#FF6B9D', borderRadius: 8 },
  barAlt: { width: 24, backgroundColor: '#4ECDC4', borderRadius: 8 },
  progressRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  progressLabel: { flex: 1, fontSize: 14, fontWeight: '600' },
  progressValue: { marginLeft: 8, fontSize: 12, fontWeight: '600' },
  progressBarBg: { flex: 1, height: 8, backgroundColor: '#EEE', borderRadius: 12, marginHorizontal: 8 },
  progressBarFill: { height: 8, backgroundColor: '#FF6B9D', borderRadius: 12 },
  progressBarFillOwner: { height: 8, backgroundColor: '#6A5ACD', borderRadius: 12 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginTop: 16 },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginRight: 16, marginBottom: 8 },
  legendSwatch: { width: 16, height: 16, borderRadius: 8, marginRight: 8 },
});