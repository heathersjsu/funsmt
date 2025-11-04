import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Card, useTheme } from 'react-native-paper';

export default function HelpScreen() {
  const theme = useTheme();

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.colors.background }]} contentContainerStyle={{ paddingBottom: 24 }}>
      <Card style={[styles.card, { backgroundColor: theme.colors.surface }]}>
        <Card.Content>
          <Text variant="headlineSmall" style={{ marginBottom: 16, color: theme.colors.onSurface }}>
            How to Use PinMe
          </Text>
          
          <Text variant="titleMedium" style={{ marginTop: 16, marginBottom: 8, color: theme.colors.onSurface }}>
            Getting Started
          </Text>
          <Text style={{ color: theme.colors.onSurfaceVariant }}>
            1. Add your toys using the "Add Toy" button{'\n'}
            2. Scan RFID tags to track toy usage{'\n'}
            3. View statistics and play history{'\n'}
            4. Manage device settings as needed
          </Text>

          <Text variant="titleMedium" style={{ marginTop: 16, marginBottom: 8, color: theme.colors.onSurface }}>
            RFID Scanning
          </Text>
          <Text style={{ color: theme.colors.onSurfaceVariant }}>
            • Hold the RFID tag near your device's NFC sensor{'\n'}
            • The app will automatically detect and process the scan{'\n'}
            • Toy status will update from "In Place" to "Playing" or vice versa
          </Text>

          <Text variant="titleMedium" style={{ marginTop: 16, marginBottom: 8, color: theme.colors.onSurface }}>
            Troubleshooting
          </Text>
          <Text style={{ color: theme.colors.onSurfaceVariant }}>
            • If scanning doesn't work, check NFC is enabled{'\n'}
            • Ensure the RFID tag is properly registered{'\n'}
            • Try restarting the app if issues persist
          </Text>
        </Card.Content>
      </Card>
    </ScrollView>
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