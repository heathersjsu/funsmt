import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Card, Text, Button, Avatar } from 'react-native-paper';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

type Props = NativeStackScreenProps<any>;

export default function HomeScreen({ navigation }: Props) {
  return (
    <View style={styles.container}>
      <Text variant="headlineLarge" style={styles.title}>Welcome back! 🎉</Text>
      <Text style={styles.subtitle}>Pick a feature to manage toys</Text>

      <View style={styles.grid}>
        <Card style={[styles.card, { backgroundColor: '#FFE2C6' }]}>
          <Card.Title title="Toy Check-In" subtitle="Add and register toys" left={(props) => <Avatar.Icon {...props} icon="download" style={{ backgroundColor: '#FF8C42' }} />} />
          <Card.Actions>
            <Button mode="contained" onPress={() => navigation.navigate('ToyCheckIn')}>Check In</Button>
          </Card.Actions>
        </Card>

        <Card style={[styles.card, { backgroundColor: '#D5E5FF' }]}>
          <Card.Title title="Toy List" subtitle="Browse and edit toys" left={(props) => <Avatar.Icon {...props} icon="view-list" style={{ backgroundColor: '#6C63FF' }} />} />
          <Card.Actions>
            <Button mode="contained" onPress={() => navigation.navigate('ToyList')}>Open List</Button>
          </Card.Actions>
        </Card>

        <Card style={[styles.card, { backgroundColor: '#CFF6E8' }]}>
          <Card.Title title="Statistics" subtitle="Total / In / Out / By Category" left={(props) => <Avatar.Icon {...props} icon="chart-bar" style={{ backgroundColor: '#06D6A0' }} />} />
          <Card.Actions>
            <Button mode="contained" onPress={() => navigation.navigate('Stats')}>View Stats</Button>
          </Card.Actions>
        </Card>

        <Card style={[styles.card, { backgroundColor: '#FFE5EC' }]}>
          <Card.Title title="Reminders" subtitle="Push tokens and reminder settings" left={(props) => <Avatar.Icon {...props} icon="bell" style={{ backgroundColor: '#FF4D6D' }} />} />
          <Card.Actions>
            <Button mode="contained" onPress={() => navigation.navigate('ReminderStatus')}>Open Reminders</Button>
          </Card.Actions>
        </Card>

        {/* Design Sync entry removed */}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#FFF9E6' },
  title: { marginBottom: 4, color: '#FF8C42' },
  subtitle: { marginBottom: 16, color: '#3D405B' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  card: { width: '48%', marginBottom: 12, borderRadius: 18 },
});