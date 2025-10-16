import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { TextInput, Button, Text } from 'react-native-paper';
import { supabase } from '../../supabaseClient';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

type Props = NativeStackScreenProps<any>;

export default function ForgotPasswordScreen({ navigation }: Props) {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onReset = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    const redirectTo = process.env.EXPO_PUBLIC_SITE_URL || (globalThis as any)?.location?.origin || 'http://localhost:8082';
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });
    setLoading(false);
    if (error) setError(error.message);
    else setMessage('Reset email sent. Please check your inbox');
  };

  return (
    <View style={styles.container}>
      <Text variant="titleLarge">Reset Password</Text>
      <TextInput label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" style={styles.input} />
      {error && <Text style={{ color: 'red' }}>{error}</Text>}
      {message && <Text style={{ color: 'green' }}>{message}</Text>}
      <Button mode="contained" onPress={onReset} loading={loading} style={styles.button}>Send Reset Email</Button>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, justifyContent: 'center' },
  input: { marginVertical: 8 },
  button: { marginTop: 8 },
});