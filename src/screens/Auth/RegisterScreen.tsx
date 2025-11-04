import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { TextInput, Button, Text } from 'react-native-paper';
import { supabase } from '../../supabaseClient';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

type Props = NativeStackScreenProps<any>;

export default function RegisterScreen({ navigation }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <View style={styles.container}>
      <Text variant="titleLarge">Create Account</Text>
      <TextInput label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" style={styles.input} />
      <TextInput label="Password" value={password} onChangeText={setPassword} secureTextEntry style={styles.input} />
      {error && <Text style={{ color: 'red' }}>{error}</Text>}
      <Button mode="contained" onPress={onRegister} loading={loading} style={styles.button}>Sign Up</Button>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, justifyContent: 'center' },
  input: { marginVertical: 8 },
  button: { marginTop: 8 },
});