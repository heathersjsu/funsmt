import React, { useState } from 'react';
import { View, StyleSheet, Image } from 'react-native';
import { TextInput, Button, Text, Card, Avatar } from 'react-native-paper';
import { supabase } from '../../supabaseClient';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

type Props = NativeStackScreenProps<any>;

export default function LoginScreen({ navigation }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onLogin = async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) setError(error.message);
    else navigation.replace('Home');
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Image source={require('../../../assets/icon.png')} style={styles.logo} />
        <Text variant="headlineLarge" style={styles.title}>Pinme Family Toy Organizer</Text>
        <Text style={styles.subtitle}>Let’s tidy up toys together! 🎈</Text>
      </View>
      <Card style={styles.card}>
        <Card.Title title="Sign in to your toy world" left={(props) => <Avatar.Icon {...props} icon="emoticon-happy" style={{ backgroundColor: '#FF8C42' }} />} />
        <Card.Content>
          <TextInput label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" style={styles.input} />
          <TextInput label="Password" value={password} onChangeText={setPassword} secureTextEntry style={styles.input} />
          {error && <Text style={styles.error}>{error}</Text>}
          <Button mode="contained" onPress={onLogin} loading={loading} style={styles.button}>Sign In</Button>
          <Button onPress={() => navigation.navigate('Register')}>No account? Register</Button>
          <Button onPress={() => navigation.navigate('ForgotPassword')}>Forgot Password</Button>
        </Card.Content>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, justifyContent: 'center', backgroundColor: '#FFF9E6' },
  header: { alignItems: 'center', marginBottom: 16 },
  logo: { width: 80, height: 80, marginBottom: 8 },
  title: { color: '#FF8C42', fontWeight: 'bold' },
  subtitle: { color: '#3D405B' },
  card: { borderRadius: 18, backgroundColor: '#FFE2C6' },
  input: { marginVertical: 8 },
  button: { marginTop: 8, borderRadius: 14 },
  error: { color: '#EF476F', marginTop: 4 },
});