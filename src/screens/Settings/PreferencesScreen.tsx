import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, TextInput, Button, Card } from 'react-native-paper';
import { buildKidTheme } from '../../theme';
import { useThemeUpdate } from '../../theme/ThemeContext';

export default function PreferencesScreen() {
  const { setTheme } = useThemeUpdate();
  const [roundness, setRoundness] = useState<string>('18');

  const applyRoundness = () => {
    const r = parseInt(roundness, 10);
    if (!isNaN(r)) setTheme(buildKidTheme({ roundness: r } as any));
  };

  // Figma-related operations removed: website does not display or expose any Figma controls.

  return (
    <View style={styles.container}>
      <Text variant="headlineMedium" style={styles.title}>Preferences</Text>

      <Card style={styles.card}>
        <Card.Title title="Theme Roundness" subtitle="Adjust corner radius" />
        <Card.Content>
          <TextInput label="Roundness" value={roundness} onChangeText={setRoundness} keyboardType="numeric" style={{ marginBottom: 8 }} />
          <Button mode="contained" onPress={applyRoundness}>Apply</Button>
        </Card.Content>
      </Card>

      {/* Figma theme override buttons and display removed as requested */}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  title: { marginBottom: 12 },
  card: { marginBottom: 12, borderRadius: 18 },
});