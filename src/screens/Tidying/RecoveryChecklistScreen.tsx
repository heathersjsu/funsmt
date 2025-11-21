import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Card, Text, Checkbox, Button, ProgressBar, useTheme, Avatar, HelperText } from 'react-native-paper';
import { supabase } from '../../supabaseClient';
import { LinearGradient } from 'expo-linear-gradient';
import { cartoonGradient } from '../../theme/tokens';

interface ChecklistItem {
  id: string;
  name: string;
  photo_url?: string;
  checked: boolean;
}

export default function RecoveryChecklistScreen() {
  const theme = useTheme();
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [info, setInfo] = useState('');

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

  const onSave = async () => {
    const checked = items.filter(i => i.checked);
    if (checked.length === 0) { setInfo('Please select toys you have tidied up first'); return; }
    setSaving(true);
    try {
      for (const it of checked) {
        await supabase.from('toys').update({ status: 'in' }).eq('id', it.id);
      }
      setItems(prev => prev.filter(i => !i.checked));
      setInfo('Selected toys have been marked as in-stock');
    } catch (e: any) {
      setInfo('Save failed: ' + (e?.message || 'unknown error'));
    }
    setSaving(false);
  };

  return (
    <LinearGradient colors={cartoonGradient} style={{ flex: 1 }}>
    <ScrollView style={[styles.container, { backgroundColor: 'transparent' }]} contentContainerStyle={{ paddingBottom: 24 }}>
      <Text variant="headlineMedium" style={{ marginBottom: 8 }}>Help toys go home! 🚀</Text>

      <Card style={[styles.card, { backgroundColor: theme.colors.surface, borderWidth: 2, borderColor: theme.colors.surfaceVariant, borderRadius: 20 }]}> 
        <Card.Content>
          <Text style={{ marginBottom: 8 }}>Completed {items.filter(i => i.checked).length}/{items.length}</Text>
          <ProgressBar progress={progress} color={theme.colors.primary} style={{ height: 8, borderRadius: 4 }} />
        </Card.Content>
      </Card>

      {items.map(item => (
        <Card key={item.id} style={[styles.card, { backgroundColor: theme.colors.surface, borderWidth: 2, borderColor: theme.colors.surfaceVariant, borderRadius: 20 }]}> 
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
        <Card style={[styles.card, { backgroundColor: theme.colors.primaryContainer, borderWidth: 2, borderColor: theme.colors.surfaceVariant, borderRadius: 20 }]}> 
          <Card.Content>
            <Text style={{ color: theme.colors.onPrimaryContainer }}>Awesome! All toys are safely home! 🎉</Text>
          </Card.Content>
        </Card>
      ) : null}

      <View style={{ paddingVertical: 8 }}>
        {info ? <HelperText type="info">{info}</HelperText> : null}
        <Button mode="contained" onPress={onSave} disabled={saving || items.filter(i => i.checked).length === 0}>Save</Button>
      </View>
    </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  card: { marginBottom: 12 },
  checkedText: { textDecorationLine: 'line-through', color: '#888' },
});