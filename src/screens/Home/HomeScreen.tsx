import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView, Animated, Pressable, Platform } from 'react-native';
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
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const user = data.user;
      const name = (user?.user_metadata?.full_name as string) || (user?.email as string) || '';
      setUserName(name);
    });
  }, []);



  return (
    <LinearGradient colors={cartoonGradient} style={{ flex: 1 }}>
      <ScrollView style={[styles.container]} contentContainerStyle={styles.content}>
        {/* Quick buttons removed: bottom tab navigation is sufficient */}

        {/* Welcome back banner card in English */}
        <Card style={[styles.bannerCard, { backgroundColor: theme.colors.primaryContainer }]}> 
          <Card.Content>
            <Text style={[styles.bannerTitle, { color: theme.colors.onPrimaryContainer }]}>Welcome back, {userName || 'Friend'} 👋</Text>
            <Text style={[styles.bannerSubtitle, { color: theme.colors.onPrimaryContainer }]}>Let's tidy up toys together! 🌈⭐️</Text>
          </Card.Content>
        </Card>

        {/* Bottom tab navigation contains the bell icon; top-right icon remains in header as before */}

        {/* Home page displays complete statistical charts and analysis */}
        <View style={{ marginTop: 8 }}>
          <Card style={[styles.card, { backgroundColor: theme.colors.surface }]}>
            <Card.Content>
              <StatsScreen />
            </Card.Content>
          </Card>
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