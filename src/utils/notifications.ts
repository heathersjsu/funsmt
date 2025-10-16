import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { supabase } from '../supabaseClient';

export async function registerDevicePushToken(userId: string) {
  // Skip push registration on web to avoid permission and service worker issues
  if (Platform.OS === 'web') return;
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return;

  if (!Device.isDevice) return;

  const tokenData = await Notifications.getExpoPushTokenAsync();
  const token = tokenData.data;

  if (!token) return;

  await supabase
    .from('device_tokens')
    .upsert({ user_id: userId, token }, { onConflict: 'token' });
}

export async function scheduleLocalDailyCheck() {
  await Notifications.cancelAllScheduledNotificationsAsync();
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Time to tidy up toys!',
      body: 'Pinme daily reminder',
    },
    trigger: { hour: 20, minute: 0, repeats: true },
  });
}