import React, { useEffect, useMemo, useState, useContext } from 'react';
import { View, ScrollView, StyleSheet, Platform, ActivityIndicator } from 'react-native';
import { Text, useTheme, Button } from 'react-native-paper';
import { supabase } from '../../supabaseClient';
import { Toy } from '../../types';
import Svg, { Circle, G, Text as SvgText } from 'react-native-svg';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AuthTokenContext } from '../../context/AuthTokenContext';

type Props = { embedded?: boolean; refreshSignal?: number };

import { pushLog } from '../../utils/envDiagnostics';

export default function StatsScreen({ embedded = false, refreshSignal }: Props) {
  const ctx = useContext(AuthTokenContext);
  const userJwt = ctx?.userJwt;
  const [toys, setToys] = useState<Toy[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const theme = useTheme();
  const [loading, setLoading] = useState(true);

  const withTimeout = async <T>(p: Promise<T>, ms: number): Promise<T> => {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Request timeout')), ms)),
    ]);
  };

  const fetchToysOnce = async () => {
    return await supabase
      .from('toys')
      .select('id,name,status,category,owner,location,updated_at');
  };

  const loadCache = () => {
    if (Platform.OS !== 'web') return null;
    try {
      const raw = localStorage.getItem('pinme_stats_toys');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as Toy[];
    } catch {}
    return null;
  };

  const saveCache = (data: any[]) => {
    if (Platform.OS !== 'web') return;
    try {
      localStorage.setItem('pinme_stats_toys', JSON.stringify(data || []));
    } catch {}
  };

  const fetchData = async () => {
    setLoading(true);
    pushLog('[Stats] fetchData start');
    try {
      const offline = Platform.OS === 'web' && typeof navigator !== 'undefined' && !(navigator as any).onLine;
      if (offline) {
        pushLog('[Stats] Browser is offline');
        const cached = loadCache();
        if (cached && cached.length > 0) {
          setErrorMsg('Offline');
          setToys(cached);
        } else {
          setErrorMsg('Offline');
          setToys([]);
        }
        setLoading(false); // Fix: ensure loading is turned off
        return;
      }
      let success = false;
      let lastErr: string | null = null;
      // Increased timeout attempts: 10s, 15s, 20s
      for (let attempt = 0; attempt < 3 && !success; attempt++) {
        try {
          const timeoutMs = 10000 + attempt * 5000;
          pushLog(`[Stats] Fetching toys attempt ${attempt + 1}, timeout=${timeoutMs}ms`);
          const res = await withTimeout(fetchToysOnce(), timeoutMs);
          if ((res as any).error) {
            const err = (res as any).error;
            const msg = err?.message || '';
            pushLog(`[Stats] Supabase error: ${msg}`);
            if (/permission|auth|jwt|token/i.test(msg)) {
              pushLog('[Stats] Auth error, refreshing session...');
              try { await supabase.auth.refreshSession(); } catch (e:any) { pushLog(`[Stats] Refresh failed: ${e?.message}`); }
              continue;
            } else {
              lastErr = msg;
            }
          } else {
            const next = ((res as any).data as any[]) || [];
            pushLog(`[Stats] Success, got ${next.length} toys`);
            setToys(next);
            saveCache(next);
            setErrorMsg(null);
            success = true;
          }
        } catch (e: any) {
          lastErr = e?.message || 'Failed to load stats';
          pushLog(`[Stats] Exception: ${lastErr}`);
        }
        if (!success) await new Promise(r => setTimeout(r, 1000));
      }
      if (!success) {
        pushLog(`[Stats] All attempts failed. Last error: ${lastErr}`);
        const cached = loadCache();
        if (cached && cached.length > 0) {
          setErrorMsg(lastErr === 'Request timeout' ? 'Network timeout' : (lastErr || 'Failed to load stats'));
          setToys(cached);
        } else {
          setErrorMsg(lastErr === 'Request timeout' ? 'Network timeout' : (lastErr || 'Failed to load stats'));
          setToys([]);
        }
      }
    } finally {
      pushLog('[Stats] fetchData finally');
      setLoading(false);
    }
  };

  useEffect(() => {
    // Safety timeout to prevent infinite loading
    const safetyTimer = setTimeout(() => {
      setLoading(prev => {
        if (prev) {
          pushLog('[Stats] Safety timeout triggered - forcing loading false');
          return false;
        }
        return prev;
      });
    }, 15000);

    fetchData();
    const cached = loadCache();
    if (cached && cached.length > 0) {
      setToys(cached);
      setLoading(false);
    }
    
    // Wrap getSession with timeout
    const checkSession = async () => {
      try {
        const p = supabase.auth.getSession();
        const timeout = new Promise<{ data: { session: any } }>((_, reject) => 
          setTimeout(() => reject(new Error('Session check timeout')), 5000)
        );
        const { data } = await Promise.race([p, timeout]);
        
        if (data.session) {
          pushLog('[Stats] Session found, refreshing data');
          fetchData();
        } else {
          pushLog('[Stats] No session found');
          setLoading(false);
        }
      } catch (e: any) {
        pushLog(`[Stats] Session check error: ${e?.message}`);
        setLoading(false);
      }
    };
    
    checkSession();

    const { data: sub } = supabase.auth.onAuthStateChange((evt) => {
      pushLog(`[Stats] Auth event: ${evt}`);
      if (evt === 'INITIAL_SESSION' || evt === 'SIGNED_IN' || evt === 'TOKEN_REFRESHED') {
        fetchData();
      } else if (evt === 'SIGNED_OUT') {
        setToys([]);
        setLoading(false);
      }
    });
    return () => { 
      clearTimeout(safetyTimer);
      try { sub?.subscription?.unsubscribe(); } catch {} 
    };
  }, []);

  useEffect(() => {
    if (refreshSignal !== undefined) {
      fetchData();
    }
  }, [refreshSignal]);

  // Data processing
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

  const ownerEntries = useMemo(() => Object.entries(byOwner).sort((a,b)=>b[1]-a[1]), [byOwner]);
  const ownerTotal = useMemo(() => ownerEntries.reduce((sum, [, count]) => sum + count, 0), [ownerEntries]);
  
  const ownerColors = useMemo(() => {
    const palette = ['#FF8C42','#4CC3C3','#6A5ACD','#2E8B57','#C71585','#20B2AA','#FFD700','#FF69B4','#7FFFD4','#B8860B'];
    const map: Record<string, string> = {};
    ownerEntries.forEach(([own], idx) => { map[own] = palette[idx % palette.length]; });
    return map;
  }, [ownerEntries]);

  const sortedCategories = useMemo(() => Object.entries(byCategory).sort((a,b)=>b[1]-a[1]), [byCategory]);
  const topCategories = useMemo(() => sortedCategories.slice(0, 3).map(([k]) => k), [sortedCategories]);

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

  // Layout & Styles
  const isWeb = Platform.OS === 'web';
  const headerFont = Platform.select({ ios: 'Arial Rounded MT Bold', android: 'sans-serif-medium', default: 'System' });
  const cardBase = {
      backgroundColor: '#FFFFFF',
      borderRadius: 24,
      marginBottom: 16,
      padding: 16,
      // Soft shadow
      ...Platform.select({
        web: { boxShadow: '0px 4px 12px rgba(0,0,0,0.05)' },
        default: { elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 4 }
      })
  } as const;

  if (loading && toys.length === 0) {
    const loadingView = (
      <View style={{ padding: 32, alignItems: 'center', justifyContent: 'center', minHeight: 200 }}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text style={{ marginTop: 16, color: theme.colors.secondary, fontSize: 16, fontFamily: headerFont }}>Loading stats...</Text>
      </View>
    );
    if (embedded) return loadingView;
    return <View style={{ flex: 1 }}>{loadingView}</View>;
  }

  const innerContent = (
    <>
        {errorMsg && (
          <View style={[cardBase, { backgroundColor: '#FFEBEE' }]}>
              <Text style={{ color: '#C62828', fontFamily: headerFont }}>Error: {errorMsg}</Text>
              <View style={{ marginTop: 8, flexDirection: 'row', justifyContent: 'flex-end' }}>
                <Button mode="outlined" onPress={fetchData}>Retry</Button>
              </View>
          </View>
        )}

        {/* 1. Top Cards (In Place / Playing) */}
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
            {/* IN PLACE */}
            <View style={[cardBase, { flex: 1, backgroundColor: '#E0F2F1', alignItems: 'center', justifyContent: 'center', minHeight: 110, padding: 16, marginBottom: 0 }]}>
                <MaterialCommunityIcons name="home" size={32} color="#00695C" style={{ marginBottom: 4 }} />
                <Text style={{ color: '#00695C', fontSize: 12, fontWeight: 'bold', letterSpacing: 1, fontFamily: headerFont }}>IN PLACE</Text>
                <Text style={{ marginTop: 6, color: theme.colors.primary, fontSize: 20, fontWeight: '700', fontFamily: headerFont }}>{inCount}</Text>
            </View>
            {/* PLAYING */}
            <View style={[cardBase, { flex: 1, backgroundColor: '#F3E5F5', alignItems: 'center', justifyContent: 'center', minHeight: 110, padding: 16, marginBottom: 0 }]}>
                <MaterialCommunityIcons name="controller-classic" size={32} color="#6A1B9A" style={{ marginBottom: 4 }} />
                <Text style={{ color: '#6A1B9A', fontSize: 12, fontWeight: 'bold', letterSpacing: 1, fontFamily: headerFont }}>PLAYING</Text>
                <Text style={{ marginTop: 6, color: theme.colors.primary, fontSize: 20, fontWeight: '700', fontFamily: headerFont }}>{outCount}</Text>
            </View>
        </View>

        {/* 2. Owner Distribution */}
        <View style={cardBase}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 24, gap: 8 }}>
            <Text style={{ fontSize: 18, fontWeight: 'bold', color: theme.colors.primary, fontFamily: headerFont }}>Owner Distribution</Text>
            <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: '#F3E5F5', alignItems: 'center', justifyContent: 'center' }}>
                     <MaterialCommunityIcons name="chart-pie" size={18} color="#8E24AA" />
                </View>
            </View>
            <View style={{ flexDirection: isWeb ? 'row' : 'column', alignItems: 'center', gap: 24 }}>
                <Svg width={180} height={180}>
                     <G rotation={-90} originX={90} originY={90}>
                        {ownerEntries.map(([own, count], idx) => {
                          const radius = 70;
                          const circumference = 2 * Math.PI * radius;
                          const segLen = circumference * (count / Math.max(1, ownerTotal));
                          const offset = circumference * (ownerEntries.slice(0, idx).reduce((acc, [,c]) => acc + c, 0) / Math.max(1, ownerTotal));
                          return (
                            <Circle
                              key={own}
                              cx={90}
                              cy={90}
                              r={radius}
                              stroke={ownerColors[own]}
                              strokeWidth={25}
                              fill="none"
                              strokeDasharray={`${segLen} ${circumference}`}
                              strokeDashoffset={-offset}
                              strokeLinecap="butt"
                            />
                          );
                        })}
                     </G>
                     <SvgText x={90} y={85} textAnchor="middle" fontSize={28} fontWeight="bold" fill="#37474F" fontFamily={headerFont}>
                        {ownerTotal}
                     </SvgText>
                     <SvgText x={90} y={105} textAnchor="middle" fontSize={12} fill="#90A4AE" letterSpacing={1} fontFamily={headerFont}>
                        TOTAL
                     </SvgText>
                </Svg>
                <View style={{ flex: 1, width: '100%', gap: 10, alignItems: 'stretch' }}>
                    {ownerEntries.map(([name, count]) => {
                        return (
                            <View
                              key={name}
                              style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                width: '70%',
                                alignSelf: 'center',
                                backgroundColor: '#FFF9C4',
                                borderRadius: 20,
                                paddingVertical: 10,
                                paddingHorizontal: 12
                              }}
                            >
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: ownerColors[name] }} />
                                <Text style={{ fontWeight: '600', color: theme.colors.onSurfaceVariant, fontFamily: headerFont, textAlign: 'left' }}>{name}</Text>
                              </View>
                              <Text
                                style={{
                                  fontWeight: 'bold',
                                  color: theme.colors.primary,
                                  fontFamily: headerFont,
                                  textAlign: 'right',
                                  marginLeft: 8
                                }}
                              >
                                {count}
                              </Text>
                            </View>
                        );
                    })}
                </View>
            </View>
        </View>

        {/* 3. Popular Categories */}
        <View style={cardBase}>
             <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 24 }}>
                <Text style={{ fontSize: 18, fontWeight: 'bold', color: theme.colors.primary, marginRight: 8, fontFamily: headerFont }}>Popular Categories</Text>
                <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: '#FFF8E1', alignItems: 'center', justifyContent: 'center' }}>
                     <Text style={{ fontSize: 18 }}>🏆</Text>
                </View>
            </View>
            <View style={{ gap: 16 }}>
                {topCategories.map((cat, idx) => {
                    const pillColors = [
                        { bg: '#FCE4EC', text: '#E91E63' }, // Pink
                        { bg: '#E0F2F1', text: '#009688' }, // Teal
                        { bg: '#E1F5FE', text: '#039BE5' }  // Blue
                    ];
                    const style = pillColors[idx % 3];
                    return (
                        <View key={cat} style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: ['#FFF9C4', '#F5F5F5', '#FFE0B2'][idx], alignItems: 'center', justifyContent: 'center', marginRight: 16 }}>
                                 <MaterialCommunityIcons name={idx===0?'medal':'medal-outline'} size={24} color={['#FBC02D', '#9E9E9E', '#F57C00'][idx]} />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#263238', fontFamily: headerFont }}>{cat}</Text>
                                <Text style={{ fontSize: 12, color: '#90A4AE', fontFamily: headerFont }}>Top selection</Text>
                            </View>
                            <View style={{ backgroundColor: style.bg, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 }}>
                                <Text style={{ color: style.text, fontWeight: 'bold', fontSize: 12, fontFamily: headerFont }}>{byCategory[cat]} items</Text>
                            </View>
                        </View>
                    );
                })}
            </View>
        </View>

        {/* 4. Storage Locations */}
        <View style={cardBase}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 24 }}>
                <Text style={{ fontSize: 18, fontWeight: 'bold', color: theme.colors.primary, marginRight: 8, fontFamily: headerFont }}>Storage Locations</Text>
                <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: '#FFEBEE', alignItems: 'center', justifyContent: 'center' }}>
                     <MaterialCommunityIcons name="map-marker" size={18} color="#D32F2F" />
                </View>
            </View>
            <View style={{ gap: 24 }}>
                {Object.entries(byLocation).sort((a,b)=>b[1]-a[1]).slice(0, 4).map(([loc, count], idx) => {
                    const colors = ['#FF4081', '#00BFA5', '#7C4DFF', '#FFA000'];
                    const color = colors[idx % colors.length];
                    const percent = count / Math.max(1, total);
                    return (
                        <View key={loc}>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                    <Text style={{ marginRight: 8, fontSize: 16 }}>{['🏠','🌳','🛏️','🛋️'][idx%4]}</Text>
                                    <Text style={{ fontWeight: '600', color: '#37474F', fontSize: 15, fontFamily: headerFont }}>{loc}</Text>
                                </View>
                                <Text style={{ fontWeight: 'bold', color: '#90A4AE', fontFamily: headerFont }}>{Math.round(percent*100)}%</Text>
                            </View>
                            <View style={{ height: 12, backgroundColor: '#F5F5F5', borderRadius: 6, overflow: 'hidden' }}>
                                <View style={{ width: `${percent*100}%`, height: '100%', backgroundColor: color, borderRadius: 6 }} />
                            </View>
                        </View>
                    );
                })}
            </View>
        </View>

        {/* 5. Bottom Charts */}
        <View style={{ flexDirection: isWeb ? 'row' : 'column', gap: 16 }}>
             {/* Last 7 Days */}
             <View style={[cardBase, { flex: 1 }]}>
                 <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 24 }}>
                    <Text style={{ fontSize: 18, fontWeight: 'bold', color: theme.colors.primary, marginRight: 8, fontFamily: headerFont }}>Last 7 Days</Text>
                    <MaterialCommunityIcons name="calendar-month" size={20} color="#90A4AE" />
                 </View>
                 <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', height: 120, paddingHorizontal: 8 }}>
                     {last7Days.map((count, idx) => {
                       const maxCount = Math.max(...last7Days, 1);
                       const barHeight = (count / maxCount) * 100;
                       return (
                         <View key={idx} style={{ alignItems: 'center', flex: 1 }}>
                           <View style={{ width: 24, height: 100, backgroundColor: '#FFEBEE', borderRadius: 12, justifyContent: 'flex-end', overflow: 'hidden' }}>
                              <View style={{ width: '100%', height: `${barHeight}%`, backgroundColor: '#FF4081', borderRadius: 12 }} />
                           </View>
                           <Text style={{ marginTop: 8, color: '#90A4AE', fontWeight: 'bold', fontSize: 12, fontFamily: headerFont }}>
                             {['M', 'T', 'W', 'T', 'F', 'S', 'S'][idx]}
                           </Text>
                         </View>
                       );
                     })}
                 </View>
             </View>
             
             {/* Time Dist */}
             <View style={[cardBase, { flex: 1 }]}>
                 <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 24 }}>
                    <Text style={{ fontSize: 18, fontWeight: 'bold', color: theme.colors.primary, marginRight: 8, fontFamily: headerFont }}>Time Dist.</Text>
                    <MaterialCommunityIcons name="clock-outline" size={20} color="#90A4AE" />
                 </View>
                 <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', height: 120, paddingHorizontal: 8 }}>
                     {hourBuckets.slice(0, 5).map((count, idx) => {
                       const maxCount = Math.max(...hourBuckets, 1);
                       const barHeight = (count / maxCount) * 100;
                       const colors = ['#FFD54F', '#FF8A80', '#4DB6AC', '#4FC3F7', '#AB47BC'];
                       return (
                         <View key={idx} style={{ alignItems: 'center', flex: 1 }}>
                           <View style={{ width: 32, height: `${Math.max(10, barHeight)}%`, backgroundColor: colors[idx], borderRadius: 8 }} />
                           <Text style={{ marginTop: 8, color: '#90A4AE', fontWeight: 'bold', fontSize: 12, fontFamily: headerFont }}>
                             {['MO', 'AM', 'NO', 'PM', 'NI'][idx]}
                           </Text>
                         </View>
                       );
                     })}
                 </View>
             </View>
        </View>
    </>
  );

  if (embedded) {
    return (
      <View style={isWeb ? { width: '100%' } : undefined}>
        {innerContent}
      </View>
    );
  }

  return (
    <ScrollView 
      style={{ flex: 1 }}
      contentContainerStyle={[
        { padding: 16 }, 
        isWeb && { maxWidth: 1000, alignSelf: 'center', width: '100%', paddingHorizontal: 16 }
      ]}
    >
      {innerContent}
    </ScrollView>
  );
}

