import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Card, Text, Checkbox, Button, ProgressBar, useTheme, Avatar } from 'react-native-paper';
import { supabase } from '../../supabaseClient';

interface ChecklistItem {
  id: string;
  name: string;
  photo_url?: string;
  checked: boolean;
}

export default function RecoveryChecklistScreen() {
  const theme = useTheme();
  const [items, setItems] = useState<ChecklistItem[]>([]);

  const progress = useMemo(() => {
    const total = items.length || 1;
    const done = items.filter(i => i.checked).length;
    return done / total;
  }, [items]);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.from('toys').select('id,name,photo_url,status');
        const arr = (data || []) as any[];
        const outToys = arr.filter(t => t.status === 'out');
        setItems(outToys.map(t => ({ id: t.id, name: t.name || 'Toy', photo_url: t.photo_url || undefined, checked: false })));
      } catch {}
    })();
  }, []);

  const toggle = (id: string) => setItems(prev => prev.map(i => i.id === id ? { ...i, checked: !i.checked } : i));

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.colors.background }]} contentContainerStyle={{ paddingBottom: 24 }}>
      <Text variant="headlineMedium" style={{ marginBottom: 8 }}>Help toys go home! 🚀</Text>

      <Card style={[styles.card, { backgroundColor: theme.colors.surface }]}> 
        <Card.Content>
          <Text style={{ marginBottom: 8 }}>Completed {items.filter(i => i.checked).length}/{items.length}</Text>
          <ProgressBar progress={progress} color={theme.colors.primary} style={{ height: 8, borderRadius: 4 }} />
        </Card.Content>
      </Card>

      {items.map(item => (
        <Card key={item.id} style={[styles.card, { backgroundColor: theme.colors.surface }]}> 
          <Card.Content>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {item.photo_url ? (
                <Avatar.Image source={{ uri: item.photo_url }} size={48} style={{ marginRight: 12 }} />
              ) : (
                <Avatar.Icon icon="cube-outline" size={48} style={{ marginRight: 12, backgroundColor: theme.colors.secondaryContainer }} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={[item.checked ? styles.checkedText : undefined]}>{item.name}</Text>
              </View>
              <Checkbox status={item.checked ? 'checked' : 'unchecked'} onPress={() => toggle(item.id)} />
            </View>
          </Card.Content>
        </Card>
      ))}

      {items.length > 0 && items.every(i => i.checked) ? (
        <Card style={[styles.card, { backgroundColor: theme.colors.primaryContainer }]}> 
          <Card.Content>
            <Text style={{ color: theme.colors.onPrimaryContainer }}>Awesome! All toys are safely home! 🎉</Text>
          </Card.Content>
        </Card>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  card: { borderRadius: 18, marginBottom: 12 },
  checkedText: { textDecorationLine: 'line-through', color: '#888' },
});