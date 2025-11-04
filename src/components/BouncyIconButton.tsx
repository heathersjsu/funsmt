// Code-Generator | Generated with react-native-paper@5.x dependency
import React, { useState } from 'react';
import { Animated, Pressable, StyleSheet, Platform } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';

interface BouncyIconButtonProps {
  icon: any;
  label?: string;
  onPress: () => void;
  bg: string;
  size?: 'large' | 'small';
  iconSize?: number;
  iconColor?: string;
}

export const BouncyIconButton: React.FC<BouncyIconButtonProps> = ({ 
  icon, 
  label, 
  onPress, 
  bg, 
  size = 'large',
  iconSize,
  iconColor = '#fff'
}) => {
  const theme = useTheme();
  const scale = useState(new Animated.Value(1))[0];
  
  const bounce = (to: number) => 
    Animated.spring(scale, { 
      toValue: to, 
      useNativeDriver: true, 
      friction: 5, 
      tension: 120 
    }).start();

  const isLarge = size === 'large';
  const circleSize = isLarge ? 80 : 44;
  const defaultIconSize = isLarge ? 36 : 20;
  const finalIconSize = iconSize || defaultIconSize;

  return (
    <Pressable 
      onPress={onPress} 
      onPressIn={() => bounce(0.94)} 
      onPressOut={() => bounce(1)} 
      style={[styles.actionItem, { width: isLarge ? 80 : undefined }]}
    >
      <Animated.View 
        style={[
          styles.actionCircle, 
          { 
            backgroundColor: bg, 
            transform: [{ scale }],
            width: circleSize,
            height: circleSize,
            borderRadius: circleSize / 2,
          }
        ]}
      >
        <MaterialCommunityIcons name={icon} size={finalIconSize} color={iconColor} />
      </Animated.View>
      {label && (
        <Text style={[styles.actionLabel, { color: theme.colors.onSurface }]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  actionItem: { 
    alignItems: 'center' 
  },
  actionCircle: { 
    alignItems: 'center', 
    justifyContent: 'center', 
    shadowColor: '#000', 
    shadowOpacity: 0.1, 
    shadowRadius: 6 
  },
  actionLabel: { 
    marginTop: 6, 
    fontSize: 14, 
    fontWeight: '600', 
    fontFamily: Platform.select({ 
      ios: 'Arial Rounded MT Bold', 
      android: 'sans-serif', 
      default: 'System' 
    }) 
  },
});

/* Code-Generator delivery complete, awaiting @ar review & @unit test completion */