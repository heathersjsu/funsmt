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
  const [userId, setUserId] = useState<string>('');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshSignal, setRefreshSignal] = useState(0);
  useEffect(() => {
    // 初始化读取会话中的用户
    supabase.auth.getSession().then(({ data }) => {
      const user = data.session?.user;
      const name = (user?.user_metadata?.full_name as string) || (user?.email as string) || '';
      setUserName(name);
      setUserId(user?.id || '');
    });
    // 订阅登录态，保证刷新后数据能及时更新
    const { data: sub } = supabase.auth.onAuthStateChange((evt, session) => {
      const user = session?.user;
      if (evt === 'INITIAL_SESSION' || evt === 'SIGNED_IN' || evt === 'TOKEN_REFRESHED') {
        const name = (user?.user_metadata?.full_name as string) || (user?.email as string) || '';
        setUserName(name);
        setUserId(user?.id || '');
      } else if (evt === 'SIGNED_OUT') {
        setUserName('');
        setUserId('');
      }
    });
    return () => { try { sub?.subscription?.unsubscribe(); } catch {} };
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    // Refresh user profile
    const { data } = await supabase.auth.getUser();
    const user = data?.user;
    const name = (user?.user_metadata?.full_name as string) || (user?.email as string) || '';
    setUserName(name);
    setUserId(user?.id || '');
    
    // Trigger StatsScreen to re-fetch
    setRefreshSignal((v) => v + 1);
    setRefreshing(false);
  };


  const isWeb = Platform.OS === 'web';
  
  return (
    <LinearGradient colors={cartoonGradient} style={{ flex: 1, width: '100%' }}>
      <ScrollView 
        style={[styles.container, { width: '100%' }]} 
        contentContainerStyle={[
          styles.content, 
          isWeb && { width: '100%', maxWidth: 1000, alignSelf: 'center', paddingHorizontal: 32 }
        ]} 
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Quick buttons removed: bottom tab navigation is sufficient */}

        {/* Welcome back banner card - Dashed border style */}
        <LinearGradient 
          colors={['#E0F7FA', '#FFF9C4']} 
          start={{x: 0, y: 0}} 
          end={{x: 1, y: 1}} 
          style={[styles.bannerCard, { padding: 4, borderRadius: 30 }]}
        >
          <View style={{ 
            borderWidth: 2, 
            borderColor: '#FFE082', 
            borderStyle: 'dashed', 
            borderRadius: 26, 
            paddingVertical: 16,
            paddingHorizontal: 16,
            alignItems: 'center'
          }}>
            <Text style={[styles.bannerTitle, { color: '#FF4081', textAlign: 'center', marginBottom: 4, fontSize: 18 }]}>Welcome back, {userName || 'Friend'}! 🚀</Text>
            <Text style={[styles.bannerSubtitle, { color: '#546E7A', textAlign: 'center', fontSize: 14 }]}>You're doing great! Let's tidy up. 🌈</Text>
          </View>
        </LinearGradient>

        {/* Bottom tab navigation contains the bell icon; top-right icon remains in header as before */}

        {/* Home page displays complete statistical charts and analysis */}
        <View style={{ marginTop: 8 }}>
          {/* Remove large card wrapper: embed stats directly to avoid white background */}
          {/* Use key to force re-mount when userId changes, ensuring clean data fetch */}
          <StatsScreen key={userId || 'guest'} embedded refreshSignal={refreshSignal} />
      </View>
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  content: { paddingBottom: 24, paddingHorizontal: 0 },
  card: { width: '100%', borderRadius: 20, marginBottom: 12 },
  bannerCard: { borderRadius: 20, marginBottom: 12 },
  bannerTitle: { fontSize: 24, fontWeight: '700', fontFamily: Platform.select({ ios: 'Arial Rounded MT Bold', android: 'sans-serif-medium', default: 'System' }) },
  bannerSubtitle: { fontSize: 18, marginTop: 4, fontFamily: Platform.select({ ios: 'Arial Rounded MT Bold', android: 'sans-serif', default: 'System' }) },
});