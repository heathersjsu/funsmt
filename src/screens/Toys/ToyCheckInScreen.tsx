import React, { useState } from 'react';
import { View, StyleSheet, Image, Dimensions } from 'react-native';
import { Text, TextInput, Button, HelperText, Menu } from 'react-native-paper';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../supabaseClient';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { uploadToyPhoto } from '../../utils/storage';

type Props = NativeStackScreenProps<any>;

const CATEGORIES = ['Fluffy', 'Blocks', 'Puzzle', 'Figure', 'Vehicle', 'Instrument', 'Animal', 'Doll'];

export default function ToyCheckInScreen({ navigation }: Props) {
  const [name, setName] = useState('');
  const [rfid, setRfid] = useState('');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [category, setCategory] = useState('');
  const [source, setSource] = useState('');
  const [location, setLocation] = useState('');
  const [owner, setOwner] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [catMenuOpen, setCatMenuOpen] = useState(false);

  const pickImage = async () => {
    const { granted } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images });
    if (!result.canceled) {
      const asset = result.assets[0];
      setPhotoUrl(asset.uri);
    }
  };

  const takePhoto = async () => {
    const { granted } = await ImagePicker.requestCameraPermissionsAsync();
    if (!granted) return;
    const result = await ImagePicker.launchCameraAsync({});
    if (!result.canceled) {
      const asset = result.assets[0];
      setPhotoUrl(asset.uri);
    }
  };

  const submit = async () => {
    setError(null);
    if (!name.trim()) {
      setError('Please enter a name');
      return;
    }
    setLoading(true);
    const { data: userRes } = await supabase.auth.getUser();
    const uid = userRes?.user?.id;
    if (!uid) {
      setLoading(false);
      setError('Not logged in or session expired, please sign in');
      return;
    }
    const payload = {
      name: name.trim(),
      rfid: rfid || null,
      photo_url: photoUrl || null,
      category: category || null,
      source: source || null,
      location: location || null,
      owner: owner || null,
      status: 'in' as const,
      notes: notes || null,
      user_id: uid,
    };
    try {
      if (photoUrl && photoUrl.startsWith('file:')) {
        const publicUrl = await uploadToyPhoto(photoUrl, uid);
        payload.photo_url = publicUrl;
      }
      const { error } = await supabase.from('toys').insert(payload);
      setLoading(false);
      if (error) setError(error.message); else navigation.replace('ToyList');
    } catch (e: any) {
      setLoading(false);
      setError(e?.message || 'Upload failed');
    }
  };

  return (
    <View style={styles.container}>
      <Text variant="headlineMedium" style={styles.title}>Toy Check-In</Text>
      <HelperText type="info">Default status is in (in)</HelperText>
      <View style={styles.formRow}>
        <View style={styles.col}>
          <TextInput label="Name" value={name} onChangeText={setName} style={styles.input} />
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Menu
              visible={catMenuOpen}
              onDismiss={() => setCatMenuOpen(false)}
              anchor={<Button onPress={() => setCatMenuOpen(true)}>{category ? `Category: ${category}` : 'Select Category'}</Button>}
            >
              {CATEGORIES.map((c) => (
                <Menu.Item key={c} onPress={() => { setCategory(c); setCatMenuOpen(false); }} title={c} />
              ))}
            </Menu>
          </View>
          <TextInput label="Source (optional)" value={source} onChangeText={setSource} style={styles.input} />
          <Button onPress={takePhoto} style={{ marginBottom: 8 }}>Take Photo</Button>
          <Button onPress={pickImage}>Choose Photo</Button>
          {photoUrl && <Image source={{ uri: photoUrl }} style={{ width: '100%', height: 200, marginVertical: 8 }} />}
        </View>
        <View style={styles.col}>
          <TextInput label="RFID tag (optional)" value={rfid} onChangeText={setRfid} style={styles.input} />
          <TextInput label="Location (optional)" value={location} onChangeText={setLocation} style={styles.input} />
          <TextInput label="Owner (optional)" value={owner} onChangeText={setOwner} style={styles.input} />
          <TextInput label="Notes (optional)" value={notes} onChangeText={setNotes} style={styles.input} multiline />
        </View>
      </View>
      {error && <Text style={{ color: '#FF4D6D' }}>{error}</Text>}
      <Button mode="contained" onPress={submit} loading={loading} style={styles.button}>Check In</Button>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#FFF9E6' },
  title: { color: '#FF8C42', marginBottom: 8 },
  input: { marginVertical: 8 },
  button: { marginTop: 8, borderRadius: 14 },
  formRow: { flexDirection: 'row', justifyContent: 'space-between' },
  col: { width: '48%' },
});