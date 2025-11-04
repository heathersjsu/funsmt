import React, { useState } from 'react';
import { View, StyleSheet, Image } from 'react-native';
import { TextInput, Button, Text, Card, useTheme } from 'react-native-paper';
import { supabase } from '../../supabaseClient';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

type Props = NativeStackScreenProps<any>;

export default function LoginScreen({ navigation }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logoUrl = process.env.EXPO_PUBLIC_LOGO_URL || '';
  const theme = useTheme();

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

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }] }>
      <View style={styles.header}>
        <Image source={logoUrl ? { uri: logoUrl } : require('../../../assets/icon.png')} style={styles.logo} />
        <Text variant="headlineLarge" style={[styles.title, { color: theme.colors.primary }]}>Pinme Family Toy Organizer</Text>
      </View>
      <Card style={[styles.card, { backgroundColor: theme.colors.secondaryContainer }]}>
        <Card.Content>
          <TextInput label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" style={styles.input} />
          <TextInput label="Password" value={password} onChangeText={setPassword} secureTextEntry style={styles.input} />
          {error && <Text style={[styles.error, { color: theme.colors.error }]}>{error}</Text>}
          <Button mode="contained" onPress={onLogin} loading={loading} style={styles.button}>Sign In</Button>
          <Button onPress={() => navigation.navigate('Register')}>No account? Register</Button>
          <Button onPress={() => navigation.navigate('ForgotPassword')}>Forgot Password</Button>
        </Card.Content>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, justifyContent: 'center', alignItems: 'center' /* bg moved to theme */ },
  header: { alignItems: 'center', marginBottom: 16 },
  logo: { width: 120, height: 120, marginBottom: 12 },
  title: { fontWeight: 'bold', textAlign: 'center' /* color moved to theme */ },
  card: { borderRadius: 18, width: '100%', maxWidth: 420 /* bg moved to theme */ },
  input: { marginVertical: 8 },
  button: { marginTop: 8, borderRadius: 14 },
  error: { marginTop: 4 /* color moved to theme */ },
});