import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Image } from 'react-native';
import { TextInput, Button, Text, HelperText } from 'react-native-paper';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../supabaseClient';
import { Toy } from '../../types';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { uploadToyPhoto } from '../../utils/storage';

type Props = NativeStackScreenProps<any>;

export default function ToyFormScreen({ route, navigation }: Props) {
  const toy: Toy | undefined = route.params?.toy;
  const [name, setName] = useState(toy?.name || '');
  const [rfid, setRfid] = useState(toy?.rfid || '');
  const [photoUrl, setPhotoUrl] = useState<string | null>(toy?.photo_url || null);
  const [category, setCategory] = useState(toy?.category || '');
  const [source, setSource] = useState(toy?.source || '');
  const [location, setLocation] = useState(toy?.location || '');
  const [owner, setOwner] = useState(toy?.owner || '');
  const [status, setStatus] = useState<Toy['status']>(toy?.status || 'in');
  const [notes, setNotes] = useState(toy?.notes || '');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const pickImage = async () => {
    const { granted } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images });
    if (!result.canceled) {
      const asset = result.assets[0];
      setPhotoUrl(asset.uri);
    }
  };

  const save = async () => {
    setLoading(true);
    setError(null);
    const payload = {
      name,
      rfid: rfid || null,
      photo_url: photoUrl || null,
      category: category || null,
      source: source || null,
      location: location || null,
      owner: owner || null,
      status,
      notes: notes || null,
    };
    if (toy) {
      try {
        if (photoUrl && photoUrl.startsWith('file:')) {
          const { data: userRes } = await supabase.auth.getUser();
          const uid = userRes?.user?.id;
          if (!uid) throw new Error('Not logged in');
          const publicUrl = await uploadToyPhoto(photoUrl, uid);
          payload.photo_url = publicUrl;
        }
        const { error } = await supabase.from('toys').update(payload).eq('id', toy.id);
        setLoading(false);
        if (error) setError(error.message); else navigation.goBack();
      } catch (e: any) {
        setLoading(false);
        setError(e?.message || 'Upload failed');
      }
    } else {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes?.user?.id;
      if (!uid) {
        setLoading(false);
        setError('Not logged in or session expired, please sign in');
        return;
      }
      try {
        if (photoUrl && photoUrl.startsWith('file:')) {
          const publicUrl = await uploadToyPhoto(photoUrl, uid);
          payload.photo_url = publicUrl;
        }
        const { error } = await supabase.from('toys').insert({ ...payload, user_id: uid });
        setLoading(false);
        if (error) setError(error.message); else navigation.goBack();
      } catch (e: any) {
        setLoading(false);
        setError(e?.message || 'Upload failed');
      }
    }
  };

  return (
    <View style={styles.container}>
      <Text variant="titleLarge">Toy Details</Text>
      <TextInput label="Name" value={name} onChangeText={setName} style={styles.input} />
      <TextInput label="RFID tag" value={rfid} onChangeText={setRfid} style={styles.input} />
      <Button onPress={pickImage}>Choose Photo</Button>
      {photoUrl && <Image source={{ uri: photoUrl }} style={{ width: '100%', height: 200, marginVertical: 8 }} />}
      <TextInput label="Category" value={category} onChangeText={setCategory} style={styles.input} />
      <TextInput label="Source" value={source} onChangeText={setSource} style={styles.input} />
      <TextInput label="Location" value={location} onChangeText={setLocation} style={styles.input} />
      <TextInput label="Owner" value={owner} onChangeText={setOwner} style={styles.input} />
      <TextInput label="Current status (in/out)" value={status} onChangeText={(t) => setStatus(t === 'out' ? 'out' : 'in')} style={styles.input} />
      <HelperText type="info">Only supports in / out</HelperText>
      <TextInput label="Notes" value={notes} onChangeText={setNotes} style={styles.input} multiline />
      {error && <Text style={{ color: 'red' }}>{error}</Text>}
      <Button mode="contained" onPress={save} loading={loading} style={styles.button}>Save</Button>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  input: { marginVertical: 8 },
  button: { marginTop: 8 },
});