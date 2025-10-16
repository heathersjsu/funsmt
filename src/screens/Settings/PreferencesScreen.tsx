import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, TextInput, Button, Card } from 'react-native-paper';
import type { MD3LightTheme } from 'react-native-paper';
import { buildKidTheme } from '../../theme';
import { useThemeUpdate } from '../../theme/ThemeContext';

export default function PreferencesScreen() {
  const { setTheme } = useThemeUpdate();
  const [roundness, setRoundness] = useState<string>('18');

  const applyRoundness = () => {
    const r = parseInt(roundness, 10);
    if (!isNaN(r)) setTheme(buildKidTheme({ roundness: r } as any));
  };

  // Figma 相关操作移除：网站不显示或暴露任何 Figma 控件。

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

      {/* 已按要求移除 Figma 主题覆盖的按钮与展示 */}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  title: { marginBottom: 12 },
  card: { marginBottom: 12, borderRadius: 18 },
});