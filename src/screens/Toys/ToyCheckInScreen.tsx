import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Image, Dimensions, Platform, ScrollView } from 'react-native';
import { Text, TextInput, Button, HelperText, Menu, useTheme } from 'react-native-paper';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../supabaseClient';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { uploadToyPhoto, uploadToyPhotoWeb, BUCKET } from '../../utils/storage';
import { LinearGradient } from 'expo-linear-gradient';
import { cartoonGradient } from '../../theme/tokens';

// NFC reading RFID tags (available in native builds)
let NfcManager: any; let NfcTech: any;
try {
  // Dynamic import to avoid compilation failure when web/not installed
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nfc = require('react-native-nfc-manager');
  NfcManager = nfc.default || nfc;
  NfcTech = nfc.NfcTech;
} catch {}

type Props = NativeStackScreenProps<any>;

// Ensure image URIs are safe on native (iOS/Android): allow only file:// and https://
const getSafeImageUri = (uri?: string) => {
  if (!uri) return undefined;
  if (Platform.OS === 'web') return uri;
  if (uri.startsWith('file://') || uri.startsWith('https://')) return uri;
  return undefined;
};

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
  const [nfcReady, setNfcReady] = useState(false);
  const theme = useTheme();

  useEffect(() => {
    (async () => {
      try {
        if (NfcManager && Platform.OS !== 'web') {
          await NfcManager.start();
          setNfcReady(true);
        }
      } catch {}
    })();
  }, []);

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

  const readRfidViaNfc = async () => {
    if (!NfcManager || Platform.OS === 'web') return;
    try {
      setError(null);
      await NfcManager.requestTechnology(NfcTech.Ndef);
      const tag = await NfcManager.getTag();
      await NfcManager.cancelTechnologyRequest();
      const id = (tag && (tag.id || tag.tagID)) || '';
      if (id) setRfid(id);
      else setError('No NFC tag ID read');
    } catch (e: any) {
      try { await NfcManager.cancelTechnologyRequest(); } catch {}
      setError(e?.message || 'NFC read failed');
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
      } else if (Platform.OS === 'web' && photoUrl && (photoUrl.startsWith('blob:') || photoUrl.startsWith('data:'))) {
        const resp = await fetch(photoUrl);
        const blob = await resp.blob();
        const publicUrl = await uploadToyPhotoWeb(blob, uid);
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
    <LinearGradient colors={cartoonGradient} style={{ flex: 1 }}>
      <ScrollView style={[styles.container, { backgroundColor: 'transparent' }]} contentContainerStyle={{ paddingBottom: 24 }}>
        <Text variant="headlineMedium" style={[styles.title, { color: theme.colors.primary }]}>Toy Check-In</Text>
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
            {(() => { const safeUri = getSafeImageUri(photoUrl || undefined); return safeUri ? (<Image source={{ uri: safeUri }} style={{ width: '100%', height: 200, marginVertical: 8 }} />) : null; })()}
          </View>
          <View style={styles.col}>
            <TextInput label="RFID tag (optional)" value={rfid} onChangeText={setRfid} style={styles.input} />
            <Button onPress={readRfidViaNfc} disabled={!nfcReady} style={{ marginBottom: 8 }}>
              {nfcReady ? 'Read RFID via NFC' : 'NFC not available'}
            </Button>
            <TextInput label="Location (optional)" value={location} onChangeText={setLocation} style={styles.input} />
            <TextInput label="Owner (optional)" value={owner} onChangeText={setOwner} style={styles.input} />
            <TextInput label="Notes (optional)" value={notes} onChangeText={setNotes} style={styles.input} multiline />
          </View>
        </View>
        {error && <Text style={{ color: theme.colors.error }}>{error}</Text>}
        <Button mode="contained" onPress={submit} loading={loading} style={styles.button}>Check In</Button>
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20 },
  title: { color: '#FF8C42', marginBottom: 8 },
  input: { marginVertical: 8 },
  button: { marginTop: 8, borderRadius: 14 },
  formRow: { flexDirection: 'row', justifyContent: 'space-between' },
  col: { width: '48%' },
});