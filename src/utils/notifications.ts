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
const UNREAD_KEY = 'notification_unread_count';

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

// Simple mutex for history access to prevent race conditions
let historyLock = Promise.resolve();

async function withHistoryLock<T>(fn: () => Promise<T>): Promise<T> {
  let release: () => void;
  const newLock = new Promise<void>((resolve) => { release = resolve; });
  // Wait for previous lock
  const prevLock = historyLock;
  historyLock = newLock;
  await prevLock;
  try {
    return await fn();
  } finally {
    release!();
  }
}

async function loadHistory(): Promise<NotificationHistoryItem[]> {
  try {
    const raw = await storage.getItemAsync(HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveHistory(items: NotificationHistoryItem[]) {
  try {
    await storage.setItemAsync(HISTORY_KEY, JSON.stringify(items));
  } catch {}
}

async function getUnreadCountInternal(): Promise<number> {
  try {
    const raw = await storage.getItemAsync(UNREAD_KEY);
    const n = parseInt(String(raw ?? '0'), 10);
    return isNaN(n) ? 0 : Math.max(0, n);
  } catch { return 0; }
}

async function setUnreadCountInternal(n: number) {
  try { await storage.setItemAsync(UNREAD_KEY, String(Math.max(0, n | 0))); } catch {}
}

export function parseOwnerAndToy(body?: string): { owner?: string; toy?: string } {
  if (!body) return {};
  const s = body.trim();
  let m = s.match(/^Friendly reminder:\s+(?:(.+?)'s\s+)?(.+?)\s+(?:has|hasn't|hasn’t)\b/i);
  if (m) {
    const owner = m[1] ? m[1].trim() : undefined;
    const toy = m[2] ? m[2].trim() : undefined;
    return { owner, toy };
  }
  m = s.replace(/^温馨提示：/, '').match(/^(?:(.+?)的)?(.+?)(?:已|还|已经)/);
  if (m) {
    const owner = m[1] ? m[1].trim() : undefined;
    const toy = m[2] ? m[2].trim() : undefined;
    return { owner, toy };
  }
  return {};
}

export async function recordNotificationHistory(title: string, body: string | undefined, source?: string, timestamp?: number) {
  await withHistoryLock(async () => {
    let items = await loadHistory();
    // Filter invalid items before appending new one (clean up storage)
    items = items.filter(it => {
       const { owner, toy } = parseOwnerAndToy(it.body);
       return !!(owner && toy);
    });

    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    // Check for exact duplicates within last 3 minutes to avoid double recording
    const now = timestamp || Date.now();
    const dup = items.some(h => h.title === title && h.body === body && Math.abs(now - (h.timestamp || 0)) < 180000);
    if (dup) {
       // Even if duplicate, we should save if we filtered out some items
       await saveHistory(items);
       return;
    }

    // Only add the new item if it is valid (has owner and toy)
    // Exception: If the user specifically wants to enforce this rule for ALL notifications including new ones.
    // The requirement says "Only keep notifications that contain ...".
    // So if the new notification doesn't have owner/toy, we should NOT record it?
    // "notification里 删除 ... 只保留 ... 都包含的通知"
    // Yes, effectively we should not record it if it doesn't match.
    // However, recordNotificationHistory is called for 'localDaily' which we know fails this check.
    // If I block it here, localDaily notifications will never appear.
    // Is that intended?
    // "notification里 删除 最底下只有两个项目 时间.类型 的通知" -> "In notification [list/history], delete the ones at the bottom that only have Time.Type".
    // "只保留 时间.类型.玩具名. owner 都包含的通知" -> "Only keep notifications that contain Time, Type, ToyName, Owner".
    // This implies that notifications WITHOUT toy/owner are unwanted.
    // So yes, I should prevent adding them too.
    const { owner, toy } = parseOwnerAndToy(body);
    if (owner && toy) {
      items.push({ id, title, body, timestamp: now, source });
    }

    await saveHistory(items);
    
    // Update unread count
    try {
      const c = await getUnreadCountInternal();
      await setUnreadCountInternal(c + 1);
    } catch {}

    // Sync to Supabase if logged in
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes?.user?.id;
      if (uid) {
        // Also check validity before syncing to Supabase?
        // User asked to delete "actual stored data". Supabase is also storage.
        // But maybe they meant local storage shown in the app.
        // I will sync only if valid to be consistent.
        if (owner && toy) {
          await supabase.from('notification_history').insert({
            user_id: uid,
            title,
            body,
            source,
            created_at: new Date(now).toISOString(),
          });
        }
      }
    } catch {}
  });
}

export async function getNotificationHistory(): Promise<NotificationHistoryItem[]> {
  return await withHistoryLock(async () => {
    let items = await loadHistory();
    const originalCount = items.length;
    items = items.filter(it => {
       const { owner, toy } = parseOwnerAndToy(it.body);
       return !!(owner && toy);
    });
    if (items.length !== originalCount) {
      await saveHistory(items);
    }
    return items;
  });
}

export async function clearNotificationHistory() {
  try { await storage.deleteItemAsync(HISTORY_KEY); } catch {}
}

// Unread counter helpers for UI badge
export async function getUnreadCount(): Promise<number> { return await getUnreadCountInternal(); }
export async function clearUnreadCount(): Promise<void> { await setUnreadCountInternal(0); }
export async function setUnreadCount(n: number): Promise<void> { await setUnreadCountInternal(n); }

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
    trigger: { type: Notifications.SchedulableTriggerInputTypes.CALENDAR, hour: 20, minute: 0, repeats: true },
  });
  await recordNotificationHistory('Scheduled daily tidy-up', 'Every day at 20:00', 'localDaily');
}

// New utility: schedule a daily local notification at specific hour/minute
export async function scheduleDailyReminder(title: string, body: string, hour: number, minute: number) {
  // Does not clear all schedules globally; caller should cancel as needed
  await Notifications.scheduleNotificationAsync({
    content: { title, body },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.CALENDAR, hour, minute, repeats: true },
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
    triggers.push({ type: Notifications.SchedulableTriggerInputTypes.CALENDAR, hour, minute, repeats: true } as Notifications.CalendarTriggerInput);
  } else if (repeat === 'weekends') {
    // Expo CalendarTrigger weekday: 1=Sunday ... 7=Saturday
    triggers.push({ type: Notifications.SchedulableTriggerInputTypes.CALENDAR, weekday: 1, hour, minute, repeats: true } as Notifications.CalendarTriggerInput);
    triggers.push({ type: Notifications.SchedulableTriggerInputTypes.CALENDAR, weekday: 7, hour, minute, repeats: true } as Notifications.CalendarTriggerInput);
  } else if (repeat === 'weekdays') {
    for (let w = 2; w <= 6; w++) triggers.push({ type: Notifications.SchedulableTriggerInputTypes.CALENDAR, weekday: w, hour, minute, repeats: true } as Notifications.CalendarTriggerInput);
  }
  for (const trigger of triggers) {
    await Notifications.scheduleNotificationAsync({ content: { title, body }, trigger });
  }
  const repeatLabel = repeat === 'daily' ? 'daily' : repeat === 'weekends' ? 'weekends' : 'weekdays';
  await recordNotificationHistory('Scheduled smart tidy-up', `At ${hour.toString().padStart(2,'0')}:${minute.toString().padStart(2,'0')} · ${repeatLabel}`, 'smartTidying');
}

export async function cancelNotificationsWithDataMatch(matcher: (data: any) => boolean) {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const notif of scheduled) {
      if (matcher(notif.content.data)) {
        await Notifications.cancelScheduledNotificationAsync(notif.identifier);
      }
    }
  } catch {}
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
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        vibrationPattern: [200, 100, 200],
        sound: 'default',
      });
    }
  } catch {}
}