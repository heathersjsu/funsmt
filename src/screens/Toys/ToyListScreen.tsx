import React, { useEffect, useState, useCallback } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, ScrollView, Pressable, RefreshControl } from 'react-native';
import { Image } from 'expo-image';
import { Button, Chip, Card, Text, Menu, Searchbar, Banner, useTheme, List } from 'react-native-paper';
import { supabase } from '../../supabaseClient';
import { Toy } from '../../types';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { calculateDuration } from '../../utils/toys';
import { formatRfidDisplay } from '../../utils/rfid';
import { LinearGradient } from 'expo-linear-gradient'
import { getSemanticsFromTheme, statusColors, cartoonGradient } from '../../theme/tokens';
import { MaterialCommunityIcons } from '@expo/vector-icons';

type Props = NativeStackScreenProps<any>;

export default function ToyListScreen({ navigation }: Props) {
  const theme = useTheme();
  const semantics = getSemanticsFromTheme(theme);
  
  const [toys, setToys] = useState<Toy[]>([]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'alpha' | 'recent' | 'popular'>('alpha');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [ownerFilter, setOwnerFilter] = useState<string | null>(null);
  const [ownerMenuOpen, setOwnerMenuOpen] = useState(false);
  const [owners, setOwners] = useState<string[]>([]);
  const [showEmptyBanner, setShowEmptyBanner] = useState(false);
  const [showFilters, setShowFilters] = useState(true);
  const [viewMode, setViewMode] = useState<'status' | 'category' | 'owner' | 'all'>('status');
  const [eventsByToy, setEventsByToy] = useState<Record<string, string[]>>({});
  const [activeSessions, setActiveSessions] = useState<Record<string, string>>({});
  const [lastPlayedTimes, setLastPlayedTimes] = useState<Record<string, string>>({});
  const [nowTick, setNowTick] = useState<number>(Date.now());
  const [pageError, setPageError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  // Ensure list refreshes when login state changes (fix: native first render may have no session)
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((evt, session) => {
      if (evt === 'INITIAL_SESSION' || evt === 'SIGNED_IN' || evt === 'TOKEN_REFRESHED') {
        // Re-fetch toys once the session becomes available so RLS can return user-owned rows
        fetchToys();
      }
      if (evt === 'SIGNED_OUT') {
        // Clear data on sign out
        setToys([]);
        setOwners([]);
        setShowEmptyBanner(true);
      }
    });
    return () => { try { sub?.subscription?.unsubscribe(); } catch {} };
  }, []);

  const fetchPlayEvents = async () => {
    try {
      const ids = (toys || []).map((t) => t.id);
      if (!ids.length) { setEventsByToy({}); return; }
      const { data, error } = await supabase
        .from('toy_events')
        .select('toy_id,event_time,event_type')
        .in('toy_id', ids)
        .eq('event_type', 'played')
        .order('event_time', { ascending: false });
      if (error) { /* table may not exist yet; fallback */ return; }
      const map: Record<string, string[]> = {};
      (data || []).forEach((ev: any) => {
        const day = new Date(ev.event_time).toLocaleDateString();
        const arr = map[ev.toy_id] || [];
        arr.push(day);
        map[ev.toy_id] = arr;
      });
      setEventsByToy(map);
    } catch (e: any) {
      console.error('fetchPlayEvents error:', e?.message || e);
    }
  };

  // Fetch active (unfinished) sessions for real-time duration display
  const fetchActiveSessions = async () => {
    try {
      const ids = (toys || []).map((t) => t.id);
      if (!ids.length) { setActiveSessions({}); return; }
      // New model: each scan inserts a record without end_time. Use the latest scan_time as the "start playing" point, only display duration when toys.status==='out'.
      const { data } = await supabase
        .from('play_sessions')
        .select('toy_id,scan_time')
        .in('toy_id', ids)
        .order('scan_time', { ascending: false });
      const latestByToy: Record<string, string> = {};
      (data || []).forEach((row: any) => {
        const tid = row?.toy_id; const st = row?.scan_time;
        if (!tid || !st) return;
        if (!latestByToy[tid]) latestByToy[tid] = st; // First encounter is the latest scan for this toy
      });
      const map: Record<string, string> = {};
      (toys || []).forEach((t) => {
        if (t.status === 'out' && latestByToy[t.id]) {
          map[t.id] = latestByToy[t.id];
        }
      });
      setActiveSessions(map);
      // Initial sync: display out/in directly based on toys.status
      // Only rely on server-side toys.status, don't force override locally to avoid list display inconsistency with real status.
    } catch (e: any) {
      console.error('fetchActiveSessions error:', e?.message || e);
    }
  };

  const fetchLastPlayedTimes = async () => {
    try {
      const ids = (toys || []).map((t) => t.id);
      if (!ids.length) { setLastPlayedTimes({}); return; }
      
      const { data } = await supabase
        .from('play_sessions')
        .select('toy_id,scan_time')
        .in('toy_id', ids)
        .order('scan_time', { ascending: false });
      
      const lastPlayedMap: Record<string, string> = {};
      (data || []).forEach((session: any) => {
        const toyId = session.toy_id;
        const scanTime = session.scan_time;
        if (toyId && scanTime && !lastPlayedMap[toyId]) {
          lastPlayedMap[toyId] = scanTime;
        }
      });
      
      setLastPlayedTimes(lastPlayedMap);
    } catch (e: any) {
      console.error('fetchLastPlayedTimes error:', e?.message || e);
    }
  };

  const getLastPlayedText = (toyId: string): string => {
    const lastPlayed = lastPlayedTimes[toyId];
    return formatLastPlayed(lastPlayed);
  };

  useEffect(() => {
    if (toys.length) {
      fetchPlayEvents();
      fetchActiveSessions();
      fetchLastPlayedTimes();
    } else {
      setActiveSessions({});
    }
  }, [toys]);

  // Subscribe to status changes: add try-catch to avoid exceptions in Web environment/missing environment variables causing white screen
  useEffect(() => {
    try {
      const channel = supabase
        .channel('toys-status')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'toys' }, async (payload) => {
          const row = (payload as any).new || {};
          const tid = row.id; const status = row.status;
          if (!tid) return;
          setToys((prev) => prev.map((t) => (t.id === tid ? { ...t, status } : t)));
          if (status === 'out') {
            try {
              const { data } = await supabase
                .from('play_sessions')
                .select('scan_time')
                .eq('toy_id', tid)
                .order('scan_time', { ascending: false })
                .limit(1);
              const st = (data || [])[0]?.scan_time as string | undefined;
              if (st) setActiveSessions((prev) => ({ ...prev, [tid]: st }));
            } catch (e: any) {
              console.error('realtime fetch scan_time error:', e?.message || e);
            }
          } else {
            setActiveSessions((prev) => { const { [tid]: _, ...rest } = prev; return rest; });
          }
        })
        .subscribe();

      // New subscription: listen to play_sessions INSERT events, toggle toys.status after receiving scan
      const sessionsChannel = supabase
        .channel('sessions-insert')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'play_sessions' }, async (payload) => {
          const row = (payload as any).new || {};
          const tid = row.toy_id as string | undefined;
          const st = row.scan_time as string | undefined;
          if (!tid) return;
          try {
            // Ensure authenticated user for updates under RLS
            const { data: userRes } = await supabase.auth.getUser();
            if (!userRes?.user?.id) return;
            // Read current status and toggle
            const { data } = await supabase.from('toys').select('status').eq('id', tid).maybeSingle();
            const prev = (data as any)?.status as 'in' | 'out' | null;
            const next = prev === 'out' ? 'in' : 'out';
            await supabase.from('toys').update({ status: next }).eq('id', tid);
            // Update UI duration start point first (will eventually be synced by toys UPDATE event)
            if (next === 'out' && st) {
              setActiveSessions((prev) => ({ ...prev, [tid]: st }));
            } else {
              setActiveSessions((prev) => { const { [tid]: _, ...rest } = prev; return rest; });
            }
            // Update last played map immediately so "Last Played" text stays fresh
            if (st) {
              setLastPlayedTimes((prev) => ({ ...prev, [tid]: st }));
            }
          } catch (e: any) {
            console.error('sessions-insert handler error:', e?.message || e);
          }
        })
        .subscribe();

      return () => { try { supabase.removeChannel(channel); supabase.removeChannel(sessionsChannel); } catch {} };
    } catch (e: any) {
      console.error('supabase realtime subscribe error:', e?.message || e);
      setPageError('Realtime subscribe failed. Please check network/env and reload.');
    }
  }, []);

  const fetchToys = async () => {
    try {
      console.log('fetchToys called with sort:', sort);
      let q = supabase.from('toys').select('*');
      if (query) q = q.or(`name.ilike.%${query}%,location.ilike.%${query}%,owner.ilike.%${query}%`);
      if (categoryFilter) q = q.eq('category', categoryFilter);
      if (ownerFilter) q = q.eq('owner', ownerFilter);

      const { data, error } = await q;
      if (error) throw error;

      let sortedData = data || [];
      console.log('Raw data length:', sortedData.length);

      if (sort === 'alpha') {
        console.log('Applying alpha sort (name A–Z)');
        sortedData = sortedData.slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));
      } else if (sort === 'recent') {
        console.log('Applying recent sort (created_at descending)');
        sortedData = sortedData.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      } else if (sort === 'popular') {
        console.log('Applying popular sort (play count descending, last 30 days)');
        if (sortedData.length > 0) {
          const toyIds = sortedData.map(toy => toy.id);
          const cutoffISO = new Date(Date.now() - 30*24*60*60*1000).toISOString();
          const { data: sessionCounts, error: countErr } = await supabase
            .from('play_sessions')
            .select('toy_id,scan_time')
            .in('toy_id', toyIds)
            .gte('scan_time', cutoffISO);
          if (countErr) throw countErr;
          const playCountMap: Record<string, number> = {};
          (sessionCounts || []).forEach(session => {
            const toyId = session.toy_id as string;
            playCountMap[toyId] = (playCountMap[toyId] || 0) + 1;
          });
          sortedData = sortedData.sort((a, b) => {
            const countA = playCountMap[a.id] || 0;
            const countB = playCountMap[b.id] || 0;
            if (countB !== countA) return countB - countA;
            return (a.name || '').localeCompare(b.name || '');
          });
        }
      } else {
        console.log('Applying default sort (updated_at descending)');
        sortedData = sortedData.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
      }

      console.log('Final sorted data length:', sortedData.length);
      setToys(sortedData);
      const uniqOwners = Array.from(new Set(sortedData.map((t) => t.owner).filter(Boolean))) as string[];
      setOwners(uniqOwners);
      setShowEmptyBanner(!(sortedData && sortedData.length));
      setPageError(null);
    } catch (e: any) {
      console.error('fetchToys error:', e?.message || e);
      setToys([]);
      setOwners([]);
      setShowEmptyBanner(true);
      setPageError(e?.message || 'Failed to load toys. Please check network settings and env variables.');
    }
  };

  const onRefresh = useCallback(async () => {
    try {
      setRefreshing(true);
      await fetchToys();
    } finally {
      setRefreshing(false);
    }
  }, [sort, categoryFilter, ownerFilter, query]);

  useEffect(() => {
    fetchToys();
  }, [sort, categoryFilter, ownerFilter, query]);

  // Also refresh when the screen gains focus (e.g., after navigating from Login)
  useFocusEffect(
    useCallback(() => {
      fetchToys();
      return () => {};
    }, [sort, categoryFilter, ownerFilter, query])
  );

  const formatLastPlayed = (dateStr: string) => {
    if (!dateStr) return 'Never';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    return `${Math.floor(diffDays / 30)} months ago`;
  };

  const groupedByCategory = React.useMemo(() => {
    const map = new Map<string, Toy[]>();
    (toys || []).forEach((t) => {
      const key = t.category || 'Uncategorized';
      const arr = map.get(key) || [];
      arr.push(t);
      map.set(key, arr);
    });
    return Array.from(map.entries());
  }, [toys]);

  const groupedByOwner = React.useMemo(() => {
    const map = new Map<string, Toy[]>();
    (toys || []).forEach((t) => {
      const key = t.owner || 'Unknown';
      const arr = map.get(key) || [];
      arr.push(t);
      map.set(key, arr);
    });
    return Array.from(map.entries());
  }, [toys]);

  const tileSize = 180;

  const renderTile = (item: Toy) => {
    const onOpen = () => navigation.navigate('ToyForm', { toy: item, readOnly: true });
  
    return (
      <Pressable onPress={onOpen} style={({ pressed }) => ({ borderRadius: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })} hitSlop={8}>
        <Card style={[styles.tile, { backgroundColor: theme.colors.surface, borderWidth: 2, borderColor: theme.colors.surfaceVariant }]}>
          {item.photo_url ? (
            <View>
              <Image
                source={{ uri: item.photo_url }}
                style={{ width: '100%', aspectRatio: 16/9, height: undefined, borderTopLeftRadius: 14, borderTopRightRadius: 14, backgroundColor: theme.colors.surfaceVariant }}
                contentFit="cover"
                cachePolicy="disk"
              />
            </View>
          ) : (
            <View style={{ width: '100%', aspectRatio: 16/9, height: undefined, backgroundColor: theme.colors.secondaryContainer, borderTopLeftRadius: 14, borderTopRightRadius: 14, alignItems: 'center', justifyContent: 'center' }}>
              {/* Default gray logo when photo is missing */}
              <Image
                // Use app icon and tint it to darker black‑gray
                source={require('../../../assets/icon.png')}
                style={{ width: '50%', height: '70%', tintColor: '#333333' }}
                contentFit="contain"
                cachePolicy="none"
              />
            </View>
          )}
          <View style={[styles.statusTag, { backgroundColor: item.status === 'in' ? statusColors.online : statusColors.danger }]}>
            <Text style={[styles.textSmall, { color: '#fff' }]}>{item.status === 'in' ? 'In Place' : 'Playing'}</Text>
          </View>
          <Card.Content style={{ flex: 1, paddingHorizontal: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text numberOfLines={1} style={[styles.textTitle, { color: theme.colors.onSurface, flex: 1, marginRight: 8 }]}>{item.name}</Text>
              <Text numberOfLines={1} style={[styles.textBody, { color: theme.colors.onSurfaceVariant, textAlign: 'right' }]}>{item.owner || '-'}</Text>
            </View>
            <Text numberOfLines={1} style={[styles.textBody, { color: theme.colors.onSurfaceVariant, marginTop: 2 }]}>Last Played: {getLastPlayedText(item.id)}</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 8, width: '100%' }}>
              <Button
                mode="contained-tonal"
                onPress={() => navigation.navigate('ToyForm', { toy: item })}
                style={{ borderRadius: 10 }}
                contentStyle={{ height: 40, width: 80, paddingHorizontal: 6, justifyContent: 'center' }}
                labelStyle={[styles.textSmall, { marginLeft: 15, textAlign: 'center' }]}
              >
                Edit
              </Button>
              <Button
                mode="contained-tonal"
                onPress={() => navigation.navigate('ToyForm', { toy: item, readOnly: true, showHistory: true })}
                style={{ marginLeft: 10, borderRadius: 10 }}
                contentStyle={{ height: 40, width: 80, paddingHorizontal: 6, justifyContent: 'center' }}
                labelStyle={[styles.textSmall, { marginLeft: 1, textAlign: 'center' }]}
              >
                History
              </Button>
            </View>
          </Card.Content>
        </Card>
      </Pressable>
    );
  };

  return (
    <LinearGradient colors={cartoonGradient} style={{ flex: 1 }}>
      <ScrollView
        style={[styles.container, { backgroundColor: 'transparent' }]}
        contentContainerStyle={{ paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
      {pageError && (
        <Banner visible icon="alert" style={{ marginBottom: 8, backgroundColor: theme.colors.errorContainer, borderRadius: 16 }}>
          <Text style={[styles.textBody, { color: theme.colors.onErrorContainer, fontWeight: '600' }]}>{pageError}</Text>
        </Banner>
      )}
      <Banner visible={showEmptyBanner} actions={[{ label: 'Add Toy', onPress: () => navigation.navigate('ToyForm') }]} icon="emoticon-happy-outline" style={{ marginBottom: 8, backgroundColor: theme.colors.secondaryContainer, borderRadius: 16 }}>
        <Text style={styles.textBody}>No toys found. Try adjusting filters or add a new toy.</Text>
      </Banner>
      <View style={styles.filterBar}>
        <Searchbar
          placeholder="Search name / location / owner"
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={fetchToys}
          style={[styles.search, { flex: 1, borderRadius: 16, backgroundColor: theme.colors.surface, height: 48, minHeight: 48, paddingVertical: 0 }]}
          inputStyle={[styles.textSmall, { paddingVertical: 0 }]}
        />
        <Button
          mode="contained-tonal"
          icon="filter-variant"
          onPress={() => setShowFilters((v) => !v)}
          style={{ marginLeft: 8, borderRadius: 16, height: 48 }}
          contentStyle={{ height: 48, paddingHorizontal: 10, justifyContent: 'center' }}
          labelStyle={styles.textSmall}
        >
          Filter
        </Button>
      </View>
      {showFilters && (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginBottom: 8 }}
            contentContainerStyle={[styles.chips, { columnGap: 8, paddingHorizontal: 4 }]}
          >            
            {/* sort chips */}
            <Chip onPress={() => {
              console.log('All (A–Z) clicked, current sort:', sort);
              setSort('alpha');
              setCategoryFilter(null);
              setOwnerFilter(null);
              setViewMode('all');
            }} style={[styles.chip, sort === 'alpha' ? { backgroundColor: theme.colors.secondaryContainer } : undefined]}>All (A–Z)</Chip>
            <Chip onPress={() => {
              console.log('Recently Added clicked, current sort:', sort);
              setSort('recent');
              setCategoryFilter(null);
              setOwnerFilter(null);
              setViewMode('all');
            }} style={[styles.chip, sort === 'recent' ? { backgroundColor: theme.colors.secondaryContainer } : undefined]}>Recently Added</Chip>
            <Chip onPress={() => {
              console.log('Most Popular clicked, current sort:', sort);
              setSort('popular');
              setCategoryFilter(null);
              setOwnerFilter(null);
              setViewMode('all');
            }} style={[styles.chip, sort === 'popular' ? { backgroundColor: theme.colors.secondaryContainer } : undefined]}>Most Popular</Chip>
            {/* view mode chips remain unchanged */}
            <Chip onPress={() => setViewMode('category')} style={[styles.chip, viewMode === 'category' ? { backgroundColor: theme.colors.secondaryContainer } : undefined]}>View by Category</Chip>
            <Chip onPress={() => setViewMode('owner')} style={[styles.chip, viewMode === 'owner' ? { backgroundColor: theme.colors.secondaryContainer } : undefined]}>View by Owner</Chip>
            <Chip onPress={() => setViewMode('status')} style={[styles.chip, viewMode === 'status' ? { backgroundColor: theme.colors.secondaryContainer } : undefined]}>Status</Chip>
            {categoryFilter && <Chip onClose={() => setCategoryFilter(null)} style={[styles.chip, { backgroundColor: theme.colors.secondaryContainer }]}>Category: {categoryFilter}</Chip>}
          </ScrollView>
          {/* Owner filter chips removed per request */}
        </>
      )}

      {viewMode === 'status' ? (
        <View>
          {/* Playing and In Place groups */}
          <View style={{ marginBottom: 12 }}>
            <List.Subheader style={styles.subheader}>Playing</List.Subheader>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
              {toys.filter((t) => t.status === 'out').map((it) => (
                <View key={it.id} style={{ width: '48%', marginVertical: 6 }}>
                  {renderTile(it)}
                </View>
              ))}
            </View>
          </View>
          <View style={{ marginBottom: 12 }}>
            <List.Subheader style={styles.subheader}>In Place</List.Subheader>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
              {toys.filter((t) => t.status === 'in').map((it) => (
                <View key={it.id} style={{ width: '48%', marginVertical: 6 }}>
                  {renderTile(it)}
                </View>
              ))}
            </View>
          </View>
        </View>
      ) : viewMode === 'category' ? (
        <View>
          {groupedByCategory.map(([cat, items]) => (
            <View key={cat} style={{ marginBottom: 12 }}>
              <List.Subheader style={styles.subheader}>{cat}</List.Subheader>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
                {items.map((it) => (
                  <View key={it.id} style={{ width: '48%', marginVertical: 6 }}>
                    {renderTile(it)}
                  </View>
                ))}
              </View>
            </View>
          ))}
        </View>
      ) : viewMode === 'owner' ? (
        <View>
          {groupedByOwner.map(([own, items]) => (
            <View key={own} style={{ marginBottom: 12 }}>
              <List.Subheader style={styles.subheader}>{own}</List.Subheader>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
                {items.map((it) => (
                  <View key={it.id} style={{ width: '48%', marginVertical: 6 }}>
                    {renderTile(it)}
                  </View>
                ))}
              </View>
            </View>
          ))}
        </View>
      ) : (
        <View>
          {/* remove grouped views: replace conditional with unified list */}
          <View>
            <List.Subheader style={styles.subheader}>All</List.Subheader>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
              {toys.map((it) => (
                <View key={it.id} style={{ width: '48%', marginVertical: 6 }}>
                  {renderTile(it)}
                </View>
              ))}
            </View>
          </View>
        </View>
      )}
    </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 12 },
  search: { marginBottom: 8 },
  filterBar: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  chips: { flexDirection: 'row', marginBottom: 8, alignItems: 'center' },
  chip: { marginRight: 8, borderRadius: 20 },
  tile: { width: '100%', borderRadius: 16, overflow: 'hidden' },
  statusTag: { position: 'absolute', top: 8, left: 8, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, opacity: 0.92 },
  // Unified typography
  textTitle: { fontSize: 16, fontWeight: '700' },
  textBody: { fontSize: 13, lineHeight: 18 },
  textSmall: { fontSize: 12, lineHeight: 16 },
  subheader: { fontSize: 14, fontWeight: '700' },
});