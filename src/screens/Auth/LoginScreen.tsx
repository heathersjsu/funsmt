import React, { useState } from 'react';
import { View, StyleSheet, Image, ScrollView, Platform } from 'react-native';
import { TextInput, Button, Text, Card, useTheme } from 'react-native-paper';
import { supabase } from '../../supabaseClient';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

type Props = NativeStackScreenProps<any>;

export default function LoginScreen({ navigation }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logoUrl = process.env.EXPO_PUBLIC_LOGO_URL || '';
  const theme = useTheme();
  const headerFont = Platform.select({ ios: 'Arial Rounded MT Bold', android: 'sans-serif-medium', default: 'System' });

  const onLogin = async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) setError(error.message);
    else {
      // Rely on global auth state change to switch to MainTabs
      // Avoid replace('Home') to prevent nested navigator errors on native
    }
  };

  const isWeb = Platform.OS === 'web';

  return (
    <ScrollView 
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      contentContainerStyle={[
        { paddingBottom: 24, flexGrow: 1, justifyContent: 'center', alignItems: 'center' },
        isWeb && { width: '100%', maxWidth: 1000, alignSelf: 'center', paddingHorizontal: 32 }
      ]}
    >
      <View style={styles.header}>
        <Image source={logoUrl ? { uri: logoUrl } : require('../../../assets/icon.png')} style={styles.logo} />
        {/* 标题缩小一倍并改为两行：ToyTidy 换行 Makes clean up fun! */}
        <Text variant="titleMedium" style={[styles.titleMain, { color: theme.colors.primary, fontFamily: headerFont }]}>ToyTidy</Text>
        <Text variant="bodyMedium" style={[styles.titleSub, { color: theme.colors.primary, fontFamily: headerFont }]}>Makes clean up fun!</Text>
      </View>
      <Card style={[styles.card, { backgroundColor: theme.colors.secondaryContainer }]}>
        <Card.Content>
          <TextInput label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" style={styles.input} contentStyle={{ fontFamily: headerFont }} />
          <TextInput
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            style={styles.input}
            contentStyle={{ fontFamily: headerFont }}
            right={<TextInput.Icon icon={showPassword ? 'eye-off' : 'eye'} onPress={() => setShowPassword(!showPassword)} />}
          />
          {error && <Text style={[styles.error, { color: theme.colors.error, fontFamily: headerFont }]}>{error}</Text>}
          <Button mode="contained" onPress={onLogin} loading={loading} style={styles.button} labelStyle={{ fontFamily: headerFont }}>Sign In</Button>
          <Button onPress={() => navigation.navigate('Register')} labelStyle={{ fontFamily: headerFont }}>No account? Register</Button>
          <Button onPress={() => navigation.navigate('ForgotPassword')} labelStyle={{ fontFamily: headerFont }}>Forgot Password</Button>
        </Card.Content>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // 整体上移：顶部对齐并减少顶部留白
  // 整体下移，paddingTop 80
  container: { flex: 1, paddingHorizontal: 16 /* bg moved to theme */ },
  header: { alignItems: 'center', marginBottom: 8, marginTop: 4 },
  // 略缩小 Logo，让内容更靠上
  logo: { width: 96, height: 96, marginBottom: 8 },
  titleMain: { fontWeight: 'bold', textAlign: 'center', fontSize: 18 /* 缩小一倍近似值 */ },
  titleSub: { textAlign: 'center', fontSize: 14, marginTop: 4 },
  // 卡片紧随其后，减少与标题的间距
  card: { borderRadius: 18, width: '100%', maxWidth: 420 /* bg moved to theme */, marginTop: 8 },
  input: { marginVertical: 6 },
  button: { marginTop: 6, borderRadius: 14 },
  error: { marginTop: 4 /* color moved to theme */ },
});