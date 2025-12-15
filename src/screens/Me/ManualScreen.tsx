import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Card, useTheme } from 'react-native-paper';
import { LinearGradient } from 'expo-linear-gradient';
import { cartoonGradient } from '../../theme/tokens';

export default function ManualScreen() {
  const theme = useTheme();

  return (
    <LinearGradient colors={cartoonGradient} style={{ flex: 1 }}>
    <ScrollView style={[styles.container, { backgroundColor: 'transparent' }]} contentContainerStyle={{ paddingBottom: 24 }}>
      <Card style={[styles.card, { backgroundColor: theme.colors.surface, borderWidth: 2, borderColor: theme.colors.surfaceVariant, borderRadius: 20 }]}>
        <Card.Content>
          <Text variant="headlineSmall" style={{ marginBottom: 16, color: theme.colors.onSurface }}>
            User Manual
          </Text>
          
          <Text variant="titleMedium" style={{ marginTop: 16, marginBottom: 8, color: theme.colors.onSurface }}>
            Adding Toys
          </Text>
          <Text style={{ color: theme.colors.onSurfaceVariant }}>
            1. Navigate to the Toys tab{'\n'}
            2. Tap the "+" button to add a new toy{'\n'}
            3. Fill in the toy details (name, category, owner){'\n'}
            4. Optionally add a photo{'\n'}
            5. Save the toy to your collection
          </Text>

          <Text variant="titleMedium" style={{ marginTop: 16, marginBottom: 8, color: theme.colors.onSurface }}>
            RFID Tag Management
          </Text>
          <Text style={{ color: theme.colors.onSurfaceVariant }}>
            • Each toy can be assigned an RFID tag{'\n'}
            • Use the "Scan RFID" feature to link tags{'\n'}
            • Tags enable quick check-in/check-out functionality{'\n'}
            • One tag per toy for best results
          </Text>

          <Text variant="titleMedium" style={{ marginTop: 16, marginBottom: 8, color: theme.colors.onSurface }}>
            Device Configuration
          </Text>
          <Text style={{ color: theme.colors.onSurfaceVariant }}>
            • Configure ESP32 devices for automated scanning{'\n'}
            • Set up WiFi credentials and server endpoints{'\n'}
            • Test device connectivity before deployment{'\n'}
            • Monitor device status in the Devices tab
          </Text>

          <Text variant="titleMedium" style={{ marginTop: 16, marginBottom: 8, color: theme.colors.onSurface }}>
            Statistics & Reports
          </Text>
          <Text style={{ color: theme.colors.onSurfaceVariant }}>
            • View play time statistics for each toy{'\n'}
            • Track usage patterns over time{'\n'}
            • Identify most and least popular toys{'\n'}
            • Export data for further analysis
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