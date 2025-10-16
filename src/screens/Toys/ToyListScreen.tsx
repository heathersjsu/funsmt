import React, { useEffect, useState } from 'react';
import { View, StyleSheet, FlatList, Image } from 'react-native';
import { TextInput, Button, Chip, Card, Text, FAB, Menu } from 'react-native-paper';
import { supabase } from '../../supabaseClient';
import { Toy } from '../../types';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

type Props = NativeStackScreenProps<any>;

export default function ToyListScreen({ navigation }: Props) {
  const [toys, setToys] = useState<Toy[]>([]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'recent' | 'popular'>('recent');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [ownerFilter, setOwnerFilter] = useState<string | null>(null);
  const [catMenuOpen, setCatMenuOpen] = useState(false);
  const [ownerMenuOpen, setOwnerMenuOpen] = useState(false);
  const [owners, setOwners] = useState<string[]>([]);

  const fetchToys = async () => {
    let q = supabase.from('toys').select('*');
    if (query) q = q.or(`name.ilike.%${query}%,location.ilike.%${query}%,owner.ilike.%${query}%`);
    if (categoryFilter) q = q.eq('category', categoryFilter);
    if (ownerFilter) q = q.eq('owner', ownerFilter);
    if (sort === 'recent') q = q.order('created_at', { ascending: false });
    else q = q.order('updated_at', { ascending: false });
    const { data } = await q;
    setToys(data || []);
    const uniqOwners = Array.from(new Set((data || []).map((t) => t.owner).filter(Boolean))) as string[];
    setOwners(uniqOwners);
  };

  useEffect(() => {
    fetchToys();
  }, [sort, categoryFilter, ownerFilter]);

  const tileSize = 160;

  return (
    <View style={styles.container}>
      <TextInput placeholder="Search name / location / owner" value={query} onChangeText={setQuery} style={styles.input} onSubmitEditing={fetchToys} />
      <View style={styles.chips}>
        <Chip selected={sort === 'recent'} onPress={() => setSort('recent')} style={[styles.chip, styles.chipAll]}>Recent Added</Chip>
        <Chip selected={sort === 'popular'} onPress={() => setSort('popular')} style={[styles.chip, styles.chipIn]}>Most Popular</Chip>
        <Menu
          visible={catMenuOpen}
          onDismiss={() => setCatMenuOpen(false)}
          anchor={<Button onPress={() => setCatMenuOpen(true)}>{categoryFilter ? `Category: ${categoryFilter}` : 'Category'}</Button>}
        >
          <Menu.Item onPress={() => { setCategoryFilter(null); setCatMenuOpen(false); }} title="All" />
          {['Fluffy','Blocks','Puzzle','Figure','Vehicle','Instrument','Animal','Doll'].map((c) => (
            <Menu.Item key={c} onPress={() => { setCategoryFilter(c); setCatMenuOpen(false); }} title={c} />
          ))}
        </Menu>
        <Menu
          visible={ownerMenuOpen}
          onDismiss={() => setOwnerMenuOpen(false)}
          anchor={<Button onPress={() => setOwnerMenuOpen(true)}>{ownerFilter ? `Owner: ${ownerFilter}` : 'Owner'}</Button>}
        >
          <Menu.Item onPress={() => { setOwnerFilter(null); setOwnerMenuOpen(false); }} title="All" />
          {owners.map((o) => (
            <Menu.Item key={o} onPress={() => { setOwnerFilter(o); setOwnerMenuOpen(false); }} title={o} />
          ))}
        </Menu>
      </View>
      <FlatList
        data={toys}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={{ justifyContent: 'space-between' }}
        renderItem={({ item }) => (
          <Card style={styles.tile} onPress={() => navigation.navigate('ToyForm', { toy: item })}>
            {item.photo_url ? (
              <Image source={{ uri: item.photo_url }} style={{ width: '100%', height: tileSize, borderTopLeftRadius: 14, borderTopRightRadius: 14 }} />
            ) : (
              <View style={{ width: '100%', height: tileSize, backgroundColor: '#FFE2C6', borderTopLeftRadius: 14, borderTopRightRadius: 14, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#FF8C42' }}>No Photo</Text>
              </View>
            )}
            <Card.Content>
              <Text numberOfLines={1} style={{ fontWeight: '600' }}>{item.name}</Text>
              <Text numberOfLines={1} style={{ color: '#666' }}>{item.location || '-'}</Text>
            </Card.Content>
          </Card>
        )}
      />
      <FAB style={styles.fab} icon="plus" onPress={() => navigation.navigate('ToyForm')} />
      <FAB style={styles.fabCheckin} icon="download" label="Check In" onPress={() => navigation.navigate('ToyCheckIn')} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 12, backgroundColor: '#FFF9E6' },
  input: { marginBottom: 8 },
  chips: { flexDirection: 'row', marginBottom: 8, alignItems: 'center' },
  chip: { marginRight: 8, borderRadius: 16 },
  chipAll: { backgroundColor: '#FFE2C6' },
  chipIn: { backgroundColor: '#CFF6E8' },
  tile: { width: '48%', marginVertical: 6, borderRadius: 14, overflow: 'hidden', backgroundColor: '#FFFFFF' },
  fab: { position: 'absolute', right: 16, bottom: 16 },
  fabCheckin: { position: 'absolute', right: 16, bottom: 80 },
});