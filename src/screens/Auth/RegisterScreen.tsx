import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, Platform } from 'react-native';
import { TextInput, Button, Text } from 'react-native-paper';
import { supabase } from '../../supabaseClient';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

type Props = NativeStackScreenProps<any>;

export default function RegisterScreen({ navigation }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headerFont = Platform.select({ ios: 'Arial Rounded MT Bold', android: 'sans-serif-medium', default: 'System' });

  const onRegister = async () => {
    setLoading(true);
    setError(null);
    const redirectTo = process.env.EXPO_PUBLIC_SITE_URL || (globalThis as any)?.location?.origin || 'http://localhost:8082';
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: redirectTo },
    });
    setLoading(false);
    if (error) setError(error.message);
    else {
      // If email confirmation is enabled, this does not auto-login
      if (!data.session) {
        // Prompt the user to complete verification via email
        navigation.replace('Login');
      } else {
        // Rely on global auth state change to switch to MainTabs
        // Avoid replace('Home') to prevent nested navigator errors on native
      }
    }
  };

  const isWeb = Platform.OS === 'web';

  return (
    <ScrollView 
      style={styles.container}
      contentContainerStyle={[
        { justifyContent: 'center', flexGrow: 1 },
        isWeb && { width: '100%', maxWidth: 1000, alignSelf: 'center', paddingHorizontal: 32 }
      ]}
    >
      <Text variant="titleLarge" style={{ fontFamily: headerFont }}>Create Account</Text>
      <TextInput label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" style={styles.input} contentStyle={{ fontFamily: headerFont }} />
      <TextInput label="Password" value={password} onChangeText={setPassword} secureTextEntry style={styles.input} contentStyle={{ fontFamily: headerFont }} />
      {error && <Text style={{ color: 'red', fontFamily: headerFont }}>{error}</Text>}
      <Button mode="contained" onPress={onRegister} loading={loading} style={styles.button} labelStyle={{ fontFamily: headerFont }}>Sign Up</Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  input: { marginVertical: 8 },
  button: { marginTop: 8 },
});