import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Platform, ScrollView } from 'react-native';
import { Text, TextInput, Button, Card } from 'react-native-paper';
import { buildKidTheme } from '../../theme';
import { useThemeUpdate } from '../../theme/ThemeContext';

export default function PreferencesScreen() {
  const { setTheme } = useThemeUpdate();
  const [roundness, setRoundness] = useState<string>('18');
  
  const headerFont = Platform.select({ ios: 'Arial Rounded MT Bold', android: 'sans-serif-medium', default: 'System' });

  const applyRoundness = () => {
    const r = parseInt(roundness, 10);
    if (!isNaN(r)) setTheme(buildKidTheme({ roundness: r } as any));
  };

  // Figma-related operations removed: website does not display or expose any Figma controls.

  const isWeb = Platform.OS === 'web';

  return (
    <ScrollView 
      style={styles.container}
      contentContainerStyle={[
        { paddingBottom: 24 },
        isWeb && { width: '100%', maxWidth: 1000, alignSelf: 'center', paddingHorizontal: 32 }
      ]}
    >
      <Text variant="headlineMedium" style={[styles.title, { fontFamily: headerFont }]}>Preferences</Text>

      <Card style={styles.card}>
        <Card.Title title="Theme Roundness" subtitle="Adjust corner radius" titleStyle={{ fontFamily: headerFont }} />
        <Card.Content>
          <TextInput label="Roundness" value={roundness} onChangeText={setRoundness} keyboardType="numeric" style={{ marginBottom: 8 }} contentStyle={{ fontFamily: headerFont }} />
          <Button mode="contained" onPress={applyRoundness} labelStyle={{ fontFamily: headerFont }}>Apply</Button>
        </Card.Content>
      </Card>

      {/* Figma theme override buttons and display removed as requested */}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  title: { marginBottom: 12 },
  card: { marginBottom: 12, borderRadius: 18 },
});