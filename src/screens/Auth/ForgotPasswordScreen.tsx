import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, Platform } from 'react-native';
import { TextInput, Button, Text } from 'react-native-paper';
import { supabase } from '../../supabaseClient';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

type Props = NativeStackScreenProps<any>;

export default function ForgotPasswordScreen({ navigation }: Props) {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const headerFont = Platform.select({ ios: 'Arial Rounded MT Bold', android: 'sans-serif-medium', default: 'System' });

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

  const isWeb = Platform.OS === 'web';

  return (
    <ScrollView 
      style={styles.container}
      contentContainerStyle={[
        { justifyContent: 'center', flexGrow: 1 },
        isWeb && { width: '100%', maxWidth: 1000, alignSelf: 'center', paddingHorizontal: 32 }
      ]}
    >
      <Text variant="titleLarge" style={{ fontFamily: headerFont }}>Reset Password</Text>
      <TextInput label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" style={styles.input} contentStyle={{ fontFamily: headerFont }} />
      {error && <Text style={{ color: 'red', fontFamily: headerFont }}>{error}</Text>}
      {message && <Text style={{ color: 'green', fontFamily: headerFont }}>{message}</Text>}
      <Button mode="contained" onPress={onReset} loading={loading} style={styles.button} labelStyle={{ fontFamily: headerFont }}>Send Reset Email</Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  input: { marginVertical: 8 },
  button: { marginTop: 8 },
});