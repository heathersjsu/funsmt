import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, ScrollView, RefreshControl } from 'react-native';
import { Text, Card, List, Button, Avatar, Divider, useTheme } from 'react-native-paper';
import { supabase } from '../../supabaseClient';
import { useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { cartoonGradient } from '../../theme/tokens';
import { BouncyIconButton } from '../../components/BouncyIconButton';

 export default function MeScreen() {
   const navigation = useNavigation<any>();
   const [email, setEmail] = useState<string | null>(null);
   const [userName, setUserName] = useState<string | null>(null);
   const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
   const [toyCounts, setToyCounts] = useState<{ total: number; out: number; in: number }>({ total: 0, out: 0, in: 0 });
   const theme = useTheme();


  const applyUser = (u: any) => {
    setEmail(u?.email || null);
    setUserName(u?.user_metadata?.full_name || u?.email || 'User');
    setAvatarUrl(u?.user_metadata?.avatar_url || null);
  };

  const fetchCounts = async () => {
    const { data, error } = await supabase.from('toys').select('status');
    if (error) { setToyCounts({ total: 0, out: 0, in: 0 }); return; }
    const arr = (data || []) as any[];
    const total = arr.length;
    const out = arr.filter(t => t.status === 'out').length;
    const inCount = arr.filter(t => t.status === 'in').length;
    setToyCounts({ total, out, in: inCount });
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
    // 订阅登录态变化，刷新用户信息与计数，解决刷新后显示为空的问题
    const { data: sub } = supabase.auth.onAuthStateChange((evt, session) => {
      if (evt === 'INITIAL_SESSION' || evt === 'SIGNED_IN' || evt === 'TOKEN_REFRESHED') {
        applyUser(session?.user);
        fetchCounts();
      } else if (evt === 'SIGNED_OUT') {
        applyUser(null);
        setToyCounts({ total: 0, out: 0, in: 0 });
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
    } finally {
      try {
        // 彻底清理可能残留的会话，避免“假登录”
        if (typeof window !== 'undefined') {
          Object.keys(window.localStorage || {}).forEach((k) => { if (k.startsWith('sb-')) window.localStorage.removeItem(k); });
        }
      } catch {}
      // 通过 URL 参数强制回到登录页
      try { (globalThis as any).location?.assign('/?login'); } catch {}
    }
  };

   return (
     <LinearGradient colors={cartoonGradient} style={{ flex: 1 }}>
       <ScrollView
         style={[styles.container, { backgroundColor: 'transparent' }]}
         contentContainerStyle={{ paddingBottom: 24 }}
         refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
       >
         <Card style={[styles.card, { backgroundColor: theme.colors.surface, borderWidth: 2, borderColor: theme.colors.surfaceVariant }]}> 
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
             titleStyle={{ color: theme.colors.onSurface }}
             subtitleStyle={{ color: theme.colors.onSurfaceVariant }}
           />
           <Card.Content>
             <Text style={{ color: theme.colors.onSurfaceVariant }}>Points: {points}</Text>
             <Text style={{ color: theme.colors.onSurfaceVariant }}>Total toys: {toyCounts.total} (in {toyCounts.in} / out {toyCounts.out})</Text>
           </Card.Content>
         </Card>

         <Card style={[styles.card, { backgroundColor: theme.colors.surface, borderWidth: 2, borderColor: theme.colors.surfaceVariant }]}> 

          <List.Item title="Help" left={() => <BouncyIconButton icon="help-circle" bg={theme.colors.primary} onPress={onHelp} size="small" />} onPress={onHelp} right={() => <List.Icon icon="chevron-right" />} style={{ paddingLeft: 20 }} />
           <Divider />

         <List.Item title="Manual" left={() => <BouncyIconButton icon="book" bg={theme.colors.primary} onPress={onManual} size="small" />} onPress={onManual} right={() => <List.Icon icon="chevron-right" />} style={{ paddingLeft: 20 }} />
         <List.Item title="Environment Check" left={() => <BouncyIconButton icon="wrench" bg={theme.colors.primary} onPress={() => navigation.navigate('EnvironmentCheck')} size="small" />} onPress={() => navigation.navigate('EnvironmentCheck')} right={() => <List.Icon icon="chevron-right" />} style={{ paddingLeft: 20 }} />
         <List.Item
           title="Recovery Checklist"
           left={() => <BouncyIconButton icon="clipboard-check-outline" bg={theme.colors.primary} onPress={() => navigation.navigate('RecoveryChecklist')} size="small" />}
           onPress={() => navigation.navigate('RecoveryChecklist')}
           right={() => <List.Icon icon="chevron-right" />}
           style={{ paddingLeft: 20 }}
         />
         <List.Item
           title="Reminders"
           left={() => (
             <BouncyIconButton
               icon="bell-outline"
               bg={theme.colors.secondary}
               onPress={() => {
                 // 跨 Tab 导航：确保从 MeStack 跳转到 Home Tab 下的 ReminderStatus
                 const parent = navigation.getParent?.();
                 if (parent) {
                   parent.navigate('Home', { screen: 'ReminderStatus' });
                 } else {
                   navigation.navigate('Home', { screen: 'ReminderStatus' });
                 }
               }}
               size="small"
             />
           )}
           onPress={() => {
             const parent = navigation.getParent?.();
             if (parent) {
               parent.navigate('Home', { screen: 'ReminderStatus' });
             } else {
               navigation.navigate('Home', { screen: 'ReminderStatus' });
             }
           }}
           right={() => <List.Icon icon="chevron-right" />}
           style={{ paddingLeft: 20 }}
         />
          
          {/* Moved reminder entries into ReminderStatusScreen per request */}
         </Card>

         <Card style={[styles.card, { backgroundColor: theme.colors.surface, borderWidth: 2, borderColor: theme.colors.surfaceVariant }]}> 

          <List.Item title="Sign Out" left={() => <BouncyIconButton icon="logout" bg={theme.colors.error} onPress={onLogout} size="small" />} onPress={onLogout} style={{ paddingLeft: 20 }} />
         </Card>
       </ScrollView>
     </LinearGradient>
   );
 }

 const styles = StyleSheet.create({
   container: { flex: 1, padding: 16 /* bg moved to gradient */ },
   card: { borderRadius: 20, marginBottom: 12 },
 });