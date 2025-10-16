import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Card, List } from 'react-native-paper';
import { supabase } from '../../supabaseClient';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Toy } from '../../types';

type Props = NativeStackScreenProps<any>;

export default function StatsScreen({}: Props) {
  const [toys, setToys] = useState<Toy[]>([]);

  const fetchData = async () => {
    const { data } = await supabase.from('toys').select('id,name,status,category,owner');
    setToys(data || []);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const total = toys.length;
  const inCount = toys.filter(t => t.status === 'in').length;
  const outCount = toys.filter(t => t.status === 'out').length;
  const byCategory: Record<string, number> = {};
  const byOwner: Record<string, number> = {};
  toys.forEach(t => {
    const key = t.category || 'Uncategorized';
    byCategory[key] = (byCategory[key] || 0) + 1;
    const own = t.owner || 'Unknown';
    byOwner[own] = (byOwner[own] || 0) + 1;
  });

  return (
    <View style={styles.container}>
      <Text variant="headlineMedium" style={styles.title}>Statistics</Text>
      <View style={styles.row}>
        <Card style={[styles.card, { backgroundColor: '#FFE2C6' }]}><Card.Content><Text>Total: {total}</Text></Card.Content></Card>
        <Card style={[styles.card, { backgroundColor: '#CFF6E8' }]}><Card.Content><Text>In: {inCount}</Text></Card.Content></Card>
        <Card style={[styles.card, { backgroundColor: '#FFE5EC' }]}><Card.Content><Text>Out: {outCount}</Text></Card.Content></Card>
      </View>

      <Card style={[styles.fullCard, { backgroundColor: '#D5E5FF', borderRadius: 18 }]}>
        <Card.Title title="By Category (share %)" />
        <Card.Content>
          {Object.entries(byCategory).map(([cat, count]) => (
            <List.Item key={cat} title={`${cat}`} right={() => <Text>{count}  ·  {(count / (total || 1) * 100).toFixed(1)}%</Text>} />
          ))}
        </Card.Content>
      </Card>

      <Card style={[styles.fullCard, { backgroundColor: '#EDE7FF', borderRadius: 18 }]}>
        <Card.Title title="By Owner (share %)" />
        <Card.Content>
          {Object.entries(byOwner).map(([own, count]) => (
            <List.Item key={own} title={`${own}`} right={() => <Text>{count}  ·  {(count / (total || 1) * 100).toFixed(1)}%</Text>} />
          ))}
        </Card.Content>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#FFF9E6' },
  title: { color: '#6C63FF' },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 8 },
  card: { width: '32%', borderRadius: 18 },
  fullCard: { marginTop: 12 },
});