import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { Card, useTheme } from 'react-native-paper';

interface TagCardProps {
  variant: 'total' | 'in' | 'out' | 'owners';
  value: string | number;
}

const TagCard: React.FC<TagCardProps> = ({ variant, value }) => {
  const theme = useTheme();

  const config = {
    total: { 
      icon: '🎯', 
      label: 'Total Toys', 
      color: '#FF6B9D',
      bgColor: '#FFE5F1' 
    },
    in: { 
      icon: '🏠', 
      label: 'In Place', 
      color: '#4ECDC4',
      bgColor: '#E8F8F5' 
    },
    out: { 
      icon: '🎮', 
      label: 'Playing', 
      color: '#45B7D1',
      bgColor: '#E3F2FD' 
    },
    owners: { 
      icon: '👥', 
      label: 'Owners', 
      color: '#96CEB4',
      bgColor: '#F0F8F0' 
    },
  }[variant];

  return (
    <Card 
      style={[
        styles.card, 
        { 
          backgroundColor: config.bgColor,
          borderRadius: 20,
          elevation: 6,
          shadowColor: config.color,
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.3,
          shadowRadius: 8,
        }
      ]}
    >
      <Card.Content style={styles.content}>
        <View style={styles.iconContainer}>
          <Text style={styles.icon}>{config.icon}</Text>
        </View>
        <Text 
          style={[styles.label, { color: config.color }]} 
          numberOfLines={1}
          adjustsFontSizeToFit={Platform.OS === 'ios'}
        >
          {config.label}
        </Text>
        <Text 
          style={[styles.value, { color: theme.colors.onSurface }]}
          adjustsFontSizeToFit={Platform.OS === 'ios'}
        >
          {value}
        </Text>
      </Card.Content>
    </Card>
  );
};

const styles = StyleSheet.create({
  card: {
    flex: 1,
    margin: 6,
    minHeight: Platform.select({
      web: 100,  // Web more compact
      default: 120,
    }),
    maxWidth: Platform.select({
      web: 140,  // Web max width limit
      default: undefined,
    }),
  },
  content: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: Platform.select({
      web: 12,  // Web reduced padding
      default: 16,
    }),
    minHeight: Platform.select({
      web: 80,
      default: 100,
    }),
  },
  iconContainer: {
    marginBottom: 8,
  },
  icon: {
    fontSize: Platform.select({
      web: 24,  // Web slightly smaller icon
      default: 28,
    }),
    textAlign: 'center',
  },
  label: {
    fontSize: Platform.select({
      web: 11,  // Web smaller label font
      ios: 12,  // iOS slightly larger
      default: 12,
    }),
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 4,
    lineHeight: Platform.select({
      web: 14,
      ios: 16,
      default: 16,
    }),
  },
  value: {
    fontSize: Platform.select({
      web: 20,  // Web slightly smaller value font
      ios: 24,  // iOS larger value font
      default: 22,
    }),
    fontWeight: 'bold',
    textAlign: 'center',
    lineHeight: Platform.select({
      web: 24,
      ios: 28,
      default: 26,
    }),
  },
});

export default TagCard;