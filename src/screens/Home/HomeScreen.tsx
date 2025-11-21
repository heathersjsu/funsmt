import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView, Animated, Pressable, Platform, RefreshControl } from 'react-native';
import { Card, Text, useTheme } from 'react-native-paper';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { supabase } from '../../supabaseClient';
import StatsScreen from '../Stats/StatsScreen';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { cartoonGradient } from '../../theme/tokens';
import { BouncyIconButton } from '../../components/BouncyIconButton';

type Props = NativeStackScreenProps<any>;

export default function HomeScreen({ navigation }: Props) {
  const theme = useTheme();
  const [userName, setUserName] = useState<string>('');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshSignal, setRefreshSignal] = useState(0);
  useEffect(() => {
    // 初始化读取会话中的用户
    supabase.auth.getSession().then(({ data }) => {
      const user = data.session?.user;
      const name = (user?.user_metadata?.full_name as string) || (user?.email as string) || '';
      setUserName(name);
    });
    // 订阅登录态，保证刷新后数据能及时更新
    const { data: sub } = supabase.auth.onAuthStateChange((evt, session) => {
      const user = session?.user;
      if (evt === 'INITIAL_SESSION' || evt === 'SIGNED_IN' || evt === 'TOKEN_REFRESHED') {
        const name = (user?.user_metadata?.full_name as string) || (user?.email as string) || '';
        setUserName(name);
      } else if (evt === 'SIGNED_OUT') {
        setUserName('');
      }
    });
    return () => { try { sub?.subscription?.unsubscribe(); } catch {} };
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    // Trigger StatsScreen to re-fetch
    setRefreshSignal((v) => v + 1);
    // Simulate brief delay; StatsScreen will fetch immediately
    setTimeout(() => setRefreshing(false), 400);
  };


  return (
    <LinearGradient colors={cartoonGradient} style={{ flex: 1 }}>
      <ScrollView style={[styles.container]} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        {/* Quick buttons removed: bottom tab navigation is sufficient */}

        {/* Welcome back banner card in English - align with Me card style */}
        <Card style={[styles.bannerCard, { backgroundColor: theme.colors.surface, borderWidth: 2, borderColor: theme.colors.surfaceVariant }]}> 
          <Card.Content>
            <Text style={[styles.bannerTitle, { color: '#FF6B9D', textAlign: 'center' }]}>Welcome back, {userName || 'Friend'} 👋</Text>
            <Text style={[styles.bannerSubtitle, { color: '#FF6B9D', textAlign: 'center' }]}>Let's tidy up toys together! 🌈⭐️</Text>
          </Card.Content>
        </Card>

        {/* Bottom tab navigation contains the bell icon; top-right icon remains in header as before */}

        {/* Home page displays complete statistical charts and analysis */}
        <View style={{ marginTop: 8 }}>
          {/* Remove large card wrapper: embed stats directly to avoid white background */}
          <StatsScreen embedded refreshSignal={refreshSignal} />
      </View>
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  content: { paddingBottom: 24 },
  card: { width: '100%', borderRadius: 20, marginBottom: 12 },
  bannerCard: { borderRadius: 20, marginBottom: 12 },
  bannerTitle: { fontSize: 24, fontWeight: '700', fontFamily: Platform.select({ ios: 'Arial Rounded MT Bold', android: 'sans-serif-medium', default: 'System' }) },
  bannerSubtitle: { fontSize: 18, marginTop: 4, fontFamily: Platform.select({ ios: 'Arial Rounded MT Bold', android: 'sans-serif', default: 'System' }) },
});