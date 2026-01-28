import React from 'react';
import { View, StyleSheet, ScrollView, Platform } from 'react-native';
import { Text, Card, useTheme } from 'react-native-paper';
import { LinearGradient } from 'expo-linear-gradient';
import { cartoonGradient } from '../../theme/tokens';

export default function HelpScreen() {
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
            PinMe Help Guide
          </Text>
          
          <Text variant="titleMedium" style={{ marginTop: 16, marginBottom: 8, color: theme.colors.onSurface, fontFamily: headerFont }}>
            Getting Started
          </Text>
          <Text style={{ color: theme.colors.onSurfaceVariant, fontFamily: headerFont }}>
            1) Add toys: Toys → “Add new toy”{'\n'}
            2) Set status: “Set as Playing” or “Set In Place”{'\n'}
            3) Owners: Me → Toy Owner to add profiles and photos{'\n'}
            4) See History for each toy’s sessions and durations
          </Text>

          <Text variant="titleMedium" style={{ marginTop: 16, marginBottom: 8, color: theme.colors.onSurface, fontFamily: headerFont }}>
            RFID & NFC
          </Text>
          <Text style={{ color: theme.colors.onSurfaceVariant, fontFamily: headerFont }}>
            • Native NFC requires Expo Dev Client or production build (not Expo Go){'\n'}
            • In Add/Edit toy, tap the barcode icon to scan an RFID tag{'\n'}
            • Scans add play session timestamps; History pairs out/in to compute minutes
          </Text>

          <Text variant="titleMedium" style={{ marginTop: 16, marginBottom: 8, color: theme.colors.onSurface, fontFamily: headerFont }}>
            Reminders
          </Text>
          <Text style={{ color: theme.colors.onSurfaceVariant, fontFamily: headerFont }}>
            • Long Play: detect continuous play beyond a set duration{'\n'}
            • Idle Toy: notify when toys haven’t been played for N days{'\n'}
            • Smart Tidy-up: daily schedule with repeat rules and DND checks
          </Text>

          <Text variant="titleMedium" style={{ marginTop: 16, marginBottom: 8, color: theme.colors.onSurface, fontFamily: headerFont }}>
            Common Issues
          </Text>
          <Text style={{ color: theme.colors.onSurfaceVariant, fontFamily: headerFont }}>
            • NFC scan fails: ensure NFC is enabled; use Dev Client or production build{'\n'}
            • Status doesn’t change: pull to refresh or revisit the Toys page{'\n'}
            • Web build shows old UI: hard refresh or open in incognito{'\n'}
            • Device BLE scan fails: grant location/BLE permissions and try again
          </Text>

          <Text variant="titleMedium" style={{ marginTop: 16, marginBottom: 8, color: theme.colors.onSurface, fontFamily: headerFont }}>
            Data & Privacy
          </Text>
          <Text style={{ color: theme.colors.onSurfaceVariant, fontFamily: headerFont }}>
            • Owners and toys are isolated per account via user_id{'\n'}
            • Avoid sharing secrets; do not paste keys into notes{'\n'}
            • Photos are uploaded securely; you can replace or remove them anytime
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
