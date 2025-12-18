import React, { useEffect, useState, useRef } from 'react';
import { View, StyleSheet, Platform, Pressable, ScrollView, KeyboardAvoidingView, Alert } from 'react-native';
import { Text, TextInput, Button, useTheme, Portal, Dialog, List, Snackbar, Menu } from 'react-native-paper';
import { LinearGradient } from 'expo-linear-gradient';
import { cartoonGradient } from '../../theme/tokens';
import { supabase } from '../../supabaseClient';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

type Props = NativeStackScreenProps<any>;

export default function DeviceEditScreen({ navigation, route }: Props) {
  const theme = useTheme();
  const headerFont = Platform.select({ ios: 'Arial Rounded MT Bold', android: 'sans-serif-medium', default: 'System' });
  const device = route.params?.device || {};
  
  const [name, setName] = useState(device.name || '');
  const [location, setLocation] = useState(device.location || '');
  const [deviceId] = useState(device.device_id || '');
  
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Location suggestions (consistent with AddDeviceUIScreen)
  const DEFAULT_LOCATIONS = ['Living room','Bedroom','Toy house','others'];
  const [locSuggestions, setLocSuggestions] = useState<string[]>([]);
  const [locMenuOpen, setLocMenuOpen] = useState(false);
  
  useEffect(() => {
    const loadLocs = async () => {
      try {
        const { data } = await supabase.from('devices').select('location').limit(100);
        const locs = Array.from(new Set((data || []).map((t: any) => t.location).filter(Boolean)));
        setLocSuggestions(locs.length > 0 ? locs : DEFAULT_LOCATIONS);
      } catch {}
    };
    loadLocs();
  }, []);

  const onSave = async () => {
    setIsSaving(true);
    setError(null);
    setMessage(null);
    try {
      const { error: err } = await supabase
        .from('devices')
        .update({ name, location })
        .eq('device_id', deviceId);
      
      if (err) throw err;
      
      setMessage('Device updated successfully');
      setTimeout(() => navigation.goBack(), 1000);
    } catch (e: any) {
      setError(e.message || 'Failed to update device');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <LinearGradient colors={cartoonGradient} style={{ flex: 1 }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          
          {/* Header */}
          <View style={styles.headerContainer}>
            <Text style={[styles.headerSubtitle, { color: theme.colors.secondary }]}>
              Update device details
            </Text>
          </View>

          {/* Form Fields */}
          <View style={styles.formContainer}>
            
            {/* Device ID (Read Only) */}
            <Text style={[styles.label, { color: theme.colors.onSurfaceVariant }]}>Device ID</Text>
            <TextInput
              mode="outlined"
              value={deviceId}
              editable={false}
              style={[styles.input, { backgroundColor: theme.colors.surfaceDisabled }]}
              outlineStyle={{ borderRadius: 12 }}
              theme={{ roundness: 12 }}
            />

            {/* Device Name */}
            <Text style={[styles.label, { color: theme.colors.onSurfaceVariant, marginTop: 16 }]}>Device Name</Text>
            <TextInput
              mode="outlined"
              value={name}
              onChangeText={setName}
              placeholder="e.g. Living Room Camera"
              style={styles.input}
              outlineStyle={{ borderRadius: 12 }}
              theme={{ roundness: 12 }}
            />

            {/* Location with Menu */}
            <Text style={[styles.label, { color: theme.colors.onSurfaceVariant, marginTop: 16 }]}>Location</Text>
            <Menu
              visible={locMenuOpen}
              onDismiss={() => setLocMenuOpen(false)}
              anchor={
                <Pressable onPress={() => setLocMenuOpen(true)}>
                  <View pointerEvents="none">
                    <TextInput
                      mode="outlined"
                      value={location}
                      placeholder="Select or type location"
                      right={<TextInput.Icon icon="menu-down" />}
                      style={styles.input}
                      outlineStyle={{ borderRadius: 12 }}
                      theme={{ roundness: 12 }}
                    />
                  </View>
                </Pressable>
              }
              contentStyle={{ backgroundColor: theme.colors.surface, borderRadius: 12 }}
            >
              {[...new Set([...DEFAULT_LOCATIONS, ...locSuggestions])].map((loc) => (
                <Menu.Item 
                  key={loc} 
                  onPress={() => { setLocation(loc); setLocMenuOpen(false); }} 
                  title={loc} 
                />
              ))}
            </Menu>

            {/* Save Button */}
            <Button
              mode="contained"
              onPress={onSave}
              loading={isSaving}
              disabled={isSaving}
              style={styles.saveButton}
              contentStyle={{ height: 48 }}
              labelStyle={{ fontFamily: headerFont, fontSize: 16 }}
            >
              Save
            </Button>

          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Snackbar for feedback */}
      <Snackbar
        visible={!!message || !!error}
        onDismiss={() => { setMessage(null); setError(null); }}
        duration={3000}
        style={{ backgroundColor: error ? theme.colors.error : theme.colors.inverseSurface }}
      >
        {message || error}
      </Snackbar>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    padding: 24,
    paddingTop: 60,
  },
  headerContainer: {
    marginBottom: 32,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  headerSubtitle: {
    fontSize: 16,
    opacity: 0.8,
  },
  formContainer: {
    width: '100%',
    maxWidth: 500,
    alignSelf: 'center',
  },
  label: {
    marginBottom: 6,
    marginLeft: 4,
    fontWeight: '500',
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.8)',
  },
  saveButton: {
    marginTop: 32,
    borderRadius: 24,
    alignSelf: 'center',
    width: '50%',
    minWidth: 120,
  },
});
