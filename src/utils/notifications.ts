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

// Storage abstraction: Expo SecureStore is not supported on web.
// Fall back to localStorage on web so NotificationHistory works in browser.
type StorageLike = {
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
  deleteItemAsync: (key: string) => Promise<void>;
};

const webStorage: StorageLike = {
  async getItemAsync(key: string) {
    try { return typeof window !== 'undefined' ? window.localStorage.getItem(key) : null; } catch { return null; }
  },
  async setItemAsync(key: string, value: string) {
    try { if (typeof window !== 'undefined') window.localStorage.setItem(key, value); } catch {}
  },
  async deleteItemAsync(key: string) {
    try { if (typeof window !== 'undefined') window.localStorage.removeItem(key); } catch {}
  },
};

const storage: StorageLike = Platform.OS === 'web' ? webStorage : SecureStore as unknown as StorageLike;

async function loadHistory(): Promise<NotificationHistoryItem[]> {
  try {
    const raw = await storage.getItemAsync(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr as NotificationHistoryItem[];
    return [];
  } catch { return []; }
}

async function saveHistory(items: NotificationHistoryItem[]) {
  try { await storage.setItemAsync(HISTORY_KEY, JSON.stringify(items.slice(-200))); } catch {}
}

export async function recordNotificationHistory(title: string, body: string | undefined, source?: string) {
  const items = await loadHistory();
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  items.push({ id, title, body, timestamp: Date.now(), source });
  await saveHistory(items);
  // Also persist to Supabase when user is logged in and backend is configured
  try {
    const { data: userRes } = await supabase.auth.getUser();
    const uid = userRes?.user?.id;
    if (uid) {
      await supabase.from('notification_history').insert({
        user_id: uid,
        title,
        body,
        source,
        created_at: new Date().toISOString(),
      });
    }
  } catch {}
}

export async function getNotificationHistory(): Promise<NotificationHistoryItem[]> {
  return await loadHistory();
}

export async function clearNotificationHistory() {
  try { await storage.deleteItemAsync(HISTORY_KEY); } catch {}
}

export async function registerDevicePushToken(userId?: string) {
  // Skip push registration on web to avoid permission and service worker issues
  if (Platform.OS === 'web') return;
  // Always request notification permission/channel even未登录，这样本地提醒可正常显示
  await ensureNotificationPermissionAndChannel();
  // Resolve current user id if not provided，若无用户则仅申请权限不注册 token
  try {
    if (!userId) {
      const { data } = await supabase.auth.getUser();
      userId = data?.user?.id || undefined;
    }
  } catch {}
  if (!userId) return; // 未登录时不注册 token，但本地提醒已可用
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

// Smart tidy-up: schedule according to repeat mode (daily | weekends | weekdays)
export type RepeatMode = 'daily' | 'weekends' | 'weekdays';

export async function scheduleSmartTidying(title: string, body: string, hour: number, minute: number, repeat: RepeatMode) {
  const triggers: Notifications.NotificationTriggerInput[] = [];
  if (repeat === 'daily') {
    triggers.push({ hour, minute, repeats: true } as Notifications.CalendarTriggerInput);
  } else if (repeat === 'weekends') {
    // Expo CalendarTrigger weekday: 1=Sunday ... 7=Saturday
    triggers.push({ weekday: 1, hour, minute, repeats: true } as Notifications.CalendarTriggerInput);
    triggers.push({ weekday: 7, hour, minute, repeats: true } as Notifications.CalendarTriggerInput);
  } else if (repeat === 'weekdays') {
    for (let w = 2; w <= 6; w++) triggers.push({ weekday: w, hour, minute, repeats: true } as Notifications.CalendarTriggerInput);
  }
  for (const trigger of triggers) {
    await Notifications.scheduleNotificationAsync({ content: { title, body }, trigger });
  }
  const repeatLabel = repeat === 'daily' ? 'daily' : repeat === 'weekends' ? 'weekends' : 'weekdays';
  await recordNotificationHistory('Scheduled smart tidy-up', `At ${hour.toString().padStart(2,'0')}:${minute.toString().padStart(2,'0')} · ${repeatLabel}`, 'smartTidying');
}

// Ensure notification permission and Android channel (for Android 8+)
export async function ensureNotificationPermissionAndChannel() {
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    if (existingStatus !== 'granted') {
      await Notifications.requestPermissionsAsync();
    }
    if (Platform.OS === 'android') {
      // Create a default channel to ensure notifications are visible
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Reminders',
        importance: Notifications.AndroidImportance.DEFAULT,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.Public,
        vibrationPattern: [200, 100, 200],
        sound: 'default',
      });
    }
  } catch {}
}