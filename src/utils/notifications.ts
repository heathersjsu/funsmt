import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { supabase } from '../supabaseClient';

export type NotificationHistoryItem = {
  id: string;
  title: string;
  body?: string;
  timestamp: number; // epoch ms
  source?: string; // e.g., longPlay | idleToy | smartTidying | localDaily
};

const HISTORY_KEY = 'notification_history';

async function loadHistory(): Promise<NotificationHistoryItem[]> {
  try {
    const raw = await SecureStore.getItemAsync(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr as NotificationHistoryItem[];
    return [];
  } catch { return []; }
}

async function saveHistory(items: NotificationHistoryItem[]) {
  try { await SecureStore.setItemAsync(HISTORY_KEY, JSON.stringify(items.slice(-200))); } catch {}
}

export async function recordNotificationHistory(title: string, body: string | undefined, source?: string) {
  const items = await loadHistory();
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  items.push({ id, title, body, timestamp: Date.now(), source });
  await saveHistory(items);
}

export async function getNotificationHistory(): Promise<NotificationHistoryItem[]> {
  return await loadHistory();
}

export async function clearNotificationHistory() {
  try { await SecureStore.deleteItemAsync(HISTORY_KEY); } catch {}
}

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
  await recordNotificationHistory('Scheduled daily tidy-up', 'Every day at 20:00', 'localDaily');
}

// New utility: schedule a daily local notification at specific hour/minute
export async function scheduleDailyReminder(title: string, body: string, hour: number, minute: number) {
  // Does not clear all schedules globally; caller should cancel as needed
  await Notifications.scheduleNotificationAsync({
    content: { title, body },
    trigger: { hour, minute, repeats: true },
  });
  await recordNotificationHistory('Scheduled reminder', `${title} · ${body}`, 'localDaily');
}

export async function cancelAllReminders() {
  await Notifications.cancelAllScheduledNotificationsAsync();
}