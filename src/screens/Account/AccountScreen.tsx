import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Card, List } from 'react-native-paper';
import { supabase } from '../../supabaseClient';

export default function AccountScreen() {
  const [email, setEmail] = useState<string | null>(null);
  const [id, setId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email || null);
      setId(data.user?.id || null);
    });
  }, []);

  return (
    <View style={styles.container}>
      <Text variant="headlineMedium" style={styles.title}>Account</Text>
      <Card style={styles.card}>
        <Card.Content>
          <List.Item title="Email" description={email || '-'} />
          <List.Item title="User ID" description={id || '-'} />
        </Card.Content>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  title: { marginBottom: 12 },
  card: { borderRadius: 18 },
});