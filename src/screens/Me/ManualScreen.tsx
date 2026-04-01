import React from 'react';
import { View, StyleSheet, ScrollView, Platform } from 'react-native';
import { Text, Card, useTheme } from 'react-native-paper';
import { LinearGradient } from 'expo-linear-gradient';
import { cartoonGradient } from '../../theme/tokens';

export default function ManualScreen() {
  const theme = useTheme();
  const isWeb = Platform.OS === 'web';
  const headerFont = Platform.select({ ios: 'Arial Rounded MT Bold', android: 'sans-serif-medium', default: 'System' });

  return (
    <LinearGradient colors={cartoonGradient} style={{ flex: 1 }}>
    <ScrollView 
      style={[styles.container, { backgroundColor: 'transparent' }]} 
      contentContainerStyle={[
        { paddingBottom: 24 },
        isWeb && { width: '100%', maxWidth: 1000, alignSelf: 'center', paddingHorizontal: 32 }
      ]}
    >
      <Card style={[styles.card, { backgroundColor: theme.colors.surface, borderWidth: 0, borderRadius: 20 }]}>
        <Card.Content>
          <Text variant="headlineSmall" style={{ marginBottom: 16, color: theme.colors.primary, fontFamily: headerFont }}>
            PinMe User Manual
          </Text>
          
          <Text variant="titleMedium" style={{ marginTop: 12, marginBottom: 8, color: theme.colors.onSurface, fontFamily: headerFont }}>
            Overview
          </Text>
          <Text style={{ color: theme.colors.onSurfaceVariant, fontFamily: headerFont }}>
            • PinMe helps families track toy usage and locations{'\n'}
            • Use RFID or manual status to mark toys as Playing or In Place{'\n'}
            • View history, reminders, and statistics to build healthy play habits
          </Text>

          <Text variant="titleMedium" style={{ marginTop: 16, marginBottom: 8, color: theme.colors.onSurface, fontFamily: headerFont }}>
            Quick Start
          </Text>
          <Text style={{ color: theme.colors.onSurfaceVariant, fontFamily: headerFont }}>
            1) Open the Toys tab and tap “Add new toy”{'\n'}
            2) Enter name, choose category and location, select an owner{'\n'}
            3) Add a photo (optional){'\n'}
            4) Save and set status with “Set as Playing” or “Set In Place”{'\n'}
            5) Use Play History to review sessions
          </Text>

          <Text variant="titleMedium" style={{ marginTop: 16, marginBottom: 8, color: theme.colors.onSurface, fontFamily: headerFont }}>
            Owners
          </Text>
          <Text style={{ color: theme.colors.onSurfaceVariant, fontFamily: headerFont }}>
            • Manage owners in Me → Toy Owner{'\n'}
            • Add name, photo, age, birthday, and bio{'\n'}
            • Owners are private per account and selectable in Add/Edit toy
          </Text>

          <Text variant="titleMedium" style={{ marginTop: 16, marginBottom: 8, color: theme.colors.onSurface, fontFamily: headerFont }}>
            RFID Tags
          </Text>
          <Text style={{ color: theme.colors.onSurfaceVariant, fontFamily: headerFont }}>
            • Link a toy to an RFID tag via “Scan RFID” in Add/Edit toy{'\n'}
            • Native NFC requires Dev Client or production build (Expo Go not supported){'\n'}
            • Scans insert into play sessions; History pairs out/in times for durations
          </Text>

          <Text variant="titleMedium" style={{ marginTop: 16, marginBottom: 8, color: theme.colors.onSurface, fontFamily: headerFont }}>
            Reminders
          </Text>
          <Text style={{ color: theme.colors.onSurfaceVariant, fontFamily: headerFont }}>
            • Long Play: remind if continuous play exceeds a threshold{'\n'}
            • Idle Toy: remind when a toy hasn’t been played for days{'\n'}
            • Smart Tidy-up: schedule daily tidy-up time with repeat options
          </Text>

          <Text variant="titleMedium" style={{ marginTop: 16, marginBottom: 8, color: theme.colors.onSurface, fontFamily: headerFont }}>
            Devices (Optional)
          </Text>
          <Text style={{ color: theme.colors.onSurfaceVariant, fontFamily: headerFont }}>
            • Use Add Device to set up ESP32{'\n'}
            • Scan Bluetooth, provide WiFi, and send Supabase config/JWT{'\n'}
            • Monitor Online/Offline status in Devices list
          </Text>

          <Text variant="titleMedium" style={{ marginTop: 16, marginBottom: 8, color: theme.colors.onSurface, fontFamily: headerFont }}>
            Statistics & History
          </Text>
          <Text style={{ color: theme.colors.onSurfaceVariant, fontFamily: headerFont }}>
            • Stats: see popular toys, categories, owners, and storage locations{'\n'}
            • History: per toy list of play sessions with monthly count and total hours
          </Text>
        </Card.Content>
      </Card>
    </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  card: {
    marginBottom: 16,
  },
});
