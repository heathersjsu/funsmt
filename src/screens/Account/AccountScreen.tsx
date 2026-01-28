import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView, Platform } from 'react-native';
import { Text, Card, List, Button } from 'react-native-paper';
import { supabase } from '../../supabaseClient';

export default function AccountScreen() {
  const [email, setEmail] = useState<string | null>(null);
  const [id, setId] = useState<string | null>(null);

  useEffect(() => {
    // 初次加载读取当前会话
    supabase.auth.getSession().then(({ data }) => {
      const u = data.session?.user;
      setEmail(u?.email || null);
      setId(u?.id || null);
    });
    // 监听登录态变化，保证刷新后也能拿到用户信息
    const { data: sub } = supabase.auth.onAuthStateChange((evt, session) => {
      const u = session?.user;
      if (evt === 'INITIAL_SESSION' || evt === 'SIGNED_IN' || evt === 'TOKEN_REFRESHED') {
        setEmail(u?.email || null);
        setId(u?.id || null);
      } else if (evt === 'SIGNED_OUT') {
        setEmail(null);
        setId(null);
      }
    });
    return () => { try { sub?.subscription?.unsubscribe(); } catch {} };
  }, []);

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
    } finally {
      // 清理本地会话，确保返回登录页
      try {
        if (typeof window !== 'undefined') {
          Object.keys(window.localStorage || {}).forEach((k) => { if (k.startsWith('sb-')) window.localStorage.removeItem(k); });
        }
      } catch {}
      try { (globalThis as any).location?.assign('/?login'); } catch {}
    }
  };

  const isWeb = Platform.OS === 'web';
  const headerFont = Platform.select({ ios: 'Arial Rounded MT Bold', android: 'sans-serif-medium', default: 'System' });

  return (
    <ScrollView 
      style={styles.container}
      contentContainerStyle={[
        { paddingBottom: 24 },
        isWeb && { width: '100%', maxWidth: 1000, alignSelf: 'center', paddingHorizontal: 32 }
      ]}
    >
      <Text variant="headlineMedium" style={[styles.title, { fontFamily: headerFont }]}>Account</Text>
      <Card style={styles.card}>
        <Card.Content>
          <List.Item title="Email" description={email || '-'} titleStyle={{ fontFamily: headerFont }} descriptionStyle={{ fontFamily: headerFont }} />
          <List.Item title="User ID" description={id || '-'} titleStyle={{ fontFamily: headerFont }} descriptionStyle={{ fontFamily: headerFont }} />
          <Button mode="contained" onPress={handleLogout} style={{ marginTop: 12, borderRadius: 14 }} labelStyle={{ fontFamily: headerFont }}>Logout</Button>
        </Card.Content>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  title: { marginBottom: 12 },
  card: { borderRadius: 18 },
});