import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, ScrollView, RefreshControl, Platform } from 'react-native';
import { Text, Card, List, Button, Avatar, Divider, useTheme } from 'react-native-paper';
import { supabase, STORAGE_KEY } from '../../supabaseClient';
import { pushLog } from '../../utils/envDiagnostics';
import * as SecureStore from 'expo-secure-store';
import { useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { cartoonGradient } from '../../theme/tokens';
import { BouncyIconButton } from '../../components/BouncyIconButton';
import { Chip } from 'react-native-paper';

 export default function MeScreen() {
  const navigation = useNavigation<any>();
  const [email, setEmail] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [toyCounts, setToyCounts] = useState<{ total: number; out: number; in: number }>({ total: 0, out: 0, in: 0 });
  const [ownerSuggestions, setOwnerSuggestions] = useState<string[]>([]);
  const theme = useTheme();
  const headerFont = Platform.select({ ios: 'Arial Rounded MT Bold', android: 'sans-serif-medium', default: 'System' });


  const applyUser = (u: any) => {
    setEmail(u?.email || null);
    setUserName(u?.user_metadata?.full_name || u?.email || 'User');
    setAvatarUrl(u?.user_metadata?.avatar_url || null);
    try {
      if (!u?.id) pushLog('Me: getUser returned no user (web session missing)');
      else pushLog(`Me: user id=${u.id} email=${u.email || 'n/a'}`);
    } catch {}
  };

  const fetchCounts = async () => {
    try {
      const { data, error } = await supabase.from('toys').select('status');
      if (error) throw error;
      const arr = (data || []) as any[];
      const total = arr.length;
      const out = arr.filter(t => t.status === 'out').length;
      const inCount = arr.filter(t => t.status === 'in').length;
      setToyCounts({ total, out, in: inCount });
      try { pushLog(`Me: counts total=${total} out=${out}`); } catch {}
    } catch (e: any) {
      const msg = e?.message || 'Failed to load counts';
      try { pushLog(`Me: fetchCounts error ${msg}`); } catch {}
      
      // Fallback to cache
      if (Platform.OS === 'web') {
        try {
          const raw = localStorage.getItem('pinme_stats_toys');
          if (raw) {
            const cached = JSON.parse(raw);
            if (Array.isArray(cached) && cached.length > 0) {
              const total = cached.length;
              const out = cached.filter((t: any) => t.status === 'out').length;
              const inCount = cached.filter((t: any) => t.status === 'in').length;
              setToyCounts({ total, out, in: inCount });
              try { pushLog(`Me: using cached counts total=${total}`); } catch {}
              return;
            }
          }
        } catch {}
      }
      setToyCounts({ total: 0, out: 0, in: 0 });
    }
  };

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    try {
      setRefreshing(true);
      const { data } = await supabase.auth.getUser();
      applyUser(data.user);
      await fetchCounts();
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => { applyUser(data.user); });
    fetchCounts();
    (async () => {
      try {
        const { data } = await supabase.from('toys').select('owner').limit(100);
        const owners = Array.from(new Set((data || []).map((t: any) => t.owner).filter(Boolean)));
        setOwnerSuggestions(owners);
      } catch {}
    })();
    // 订阅登录态变化，刷新用户信息与计数，解决刷新后显示为空的问题
    const { data: sub } = supabase.auth.onAuthStateChange((evt, session) => {
      try { pushLog(`Me: auth state change ${evt} session=${session ? 'yes' : 'no'}`); } catch {}
      if (evt === 'INITIAL_SESSION' || evt === 'SIGNED_IN' || evt === 'TOKEN_REFRESHED') {
        applyUser(session?.user);
        fetchCounts();
        (async () => {
          try {
            const { data } = await supabase.from('toys').select('owner').limit(100);
            const owners = Array.from(new Set((data || []).map((t: any) => t.owner).filter(Boolean)));
            setOwnerSuggestions(owners);
          } catch {}
        })();
      } else if (evt === 'SIGNED_OUT') {
        applyUser(null);
        setToyCounts({ total: 0, out: 0, in: 0 });
        setOwnerSuggestions([]);
      }
    });
    return () => { try { sub?.subscription?.unsubscribe(); } catch {} };
  }, []);

   const points = useMemo(() => {
     // Simple points: 10 for each check-out, 5 for each check-in
     return toyCounts.out * 10 + toyCounts.in * 5;
   }, [toyCounts]);

   const onHelp = () => {
     navigation.navigate('Help');
   };
   const onManual = () => {
     navigation.navigate('Manual');
   };
  const onLogout = async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      // ignore network errors during signout
    } finally {
      // Force clear local storage to ensure UI updates
      if (Platform.OS === 'web') {
        try {
          if (typeof window !== 'undefined') {
             window.localStorage.removeItem(STORAGE_KEY);
             Object.keys(window.localStorage).forEach((k) => { 
               if (k.startsWith('sb-') || k.includes('auth-token')) window.localStorage.removeItem(k); 
             });
             // Reload to clear memory state completely and force clean start
             window.location.href = '/';
          }
        } catch {}
      } else {
        // Native: clear SecureStore and rely on App.tsx onAuthStateChange
        try {
          await SecureStore.deleteItemAsync(STORAGE_KEY);
        } catch {}
      }
    }
  };

   const isWeb = Platform.OS === 'web';
   
   return (
     <LinearGradient colors={cartoonGradient} style={{ flex: 1 }}>
       <ScrollView
         refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
         style={{ flex: 1 }}
         contentContainerStyle={[
          { paddingBottom: 40, paddingHorizontal: 16, paddingTop: 8 },
          isWeb && { width: '100%', maxWidth: 1000, alignSelf: 'center', paddingHorizontal: 16 }
        ]}
       >
         {/* Header Profile Card */}
         <Card style={[styles.card, { backgroundColor: theme.colors.surface, borderWidth: 0 }]}> 
           <Card.Title
             title={userName || 'Me'}
             subtitle={email || ''}
             left={(props) => (
               <TouchableOpacity onPress={() => navigation.navigate('EditProfile')}>
                 {avatarUrl ? (
                   <Avatar.Image {...props} source={{ uri: avatarUrl }} style={{ backgroundColor: theme.colors.secondaryContainer }} />
                 ) : (
                   <Avatar.Icon {...props} icon="account" style={{ backgroundColor: theme.colors.secondaryContainer }} />
                 )}
               </TouchableOpacity>
             )}
             titleStyle={{ color: theme.colors.onSurface, fontFamily: headerFont }}
             subtitleStyle={{ color: theme.colors.onSurfaceVariant }}
           />
           <Card.Content>
             <Text style={{ color: theme.colors.onSurfaceVariant }}>Points: {points}</Text>
             <Text style={{ color: theme.colors.onSurfaceVariant }}>Total toys: {toyCounts.total} (in {toyCounts.in} / out {toyCounts.out})</Text>
           </Card.Content>
         </Card>

        <Card style={[styles.card, { backgroundColor: theme.colors.surface, borderWidth: 0 }]}> 
          <List.Item title="Toy Owner" titleStyle={{ fontFamily: headerFont }} left={() => <BouncyIconButton icon="account-group" bg={theme.colors.primary} onPress={() => navigation.navigate('OwnerManagement')} size="small" />} onPress={() => navigation.navigate('OwnerManagement')} right={() => <List.Icon icon="chevron-right" />} style={{ paddingLeft: 20 }} />
          <List.Item
            title="Reminders"
            titleStyle={{ fontFamily: headerFont }}
            left={() => (
              <BouncyIconButton
                icon="bell-outline"
                bg={theme.colors.secondary}
                onPress={() => navigation.navigate('ReminderStatusAlias')}
                size="small"
              />
            )}
            onPress={() => navigation.navigate('ReminderStatusAlias')}
            right={() => <List.Icon icon="chevron-right" />}
            style={{ paddingLeft: 20 }}
          />
          <List.Item
            title="Checklist"
            titleStyle={{ fontFamily: headerFont }}
            left={() => <BouncyIconButton icon="clipboard-check-outline" bg={theme.colors.primary} onPress={() => navigation.navigate('RecoveryChecklist')} size="small" />}
            onPress={() => navigation.navigate('RecoveryChecklist')}
            right={() => <List.Icon icon="chevron-right" />}
            style={{ paddingLeft: 20 }}
          />
          <List.Item title="Manual" titleStyle={{ fontFamily: headerFont }} left={() => <BouncyIconButton icon="book" bg={theme.colors.primary} onPress={onManual} size="small" />} onPress={onManual} right={() => <List.Icon icon="chevron-right" />} style={{ paddingLeft: 20 }} />
          <List.Item title="Help" titleStyle={{ fontFamily: headerFont }} left={() => <BouncyIconButton icon="help-circle" bg={theme.colors.primary} onPress={onHelp} size="small" />} onPress={onHelp} right={() => <List.Icon icon="chevron-right" />} style={{ paddingLeft: 20 }} />
          <List.Item title="Environment Check" titleStyle={{ fontFamily: headerFont }} left={() => <BouncyIconButton icon="wrench" bg={theme.colors.primary} onPress={() => navigation.navigate('EnvironmentCheck')} size="small" />} onPress={() => navigation.navigate('EnvironmentCheck')} right={() => <List.Icon icon="chevron-right" />} style={{ paddingLeft: 20 }} />
        </Card>

         <Card style={[styles.card, { backgroundColor: theme.colors.surface, borderWidth: 0 }]}> 

          <List.Item title="Sign Out" titleStyle={{ fontFamily: headerFont }} left={() => <BouncyIconButton icon="logout" bg={theme.colors.error} onPress={onLogout} size="small" />} onPress={onLogout} style={{ paddingLeft: 20 }} />
         </Card>
       </ScrollView>
     </LinearGradient>
   );
 }

 const styles = StyleSheet.create({
   container: { flex: 1, padding: 16 /* bg moved to gradient */ },
   card: { borderRadius: 20, marginBottom: 12 },
 });
