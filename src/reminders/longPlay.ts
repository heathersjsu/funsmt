import { supabase } from '../supabaseClient';
import * as Notifications from 'expo-notifications';
import { recordNotificationHistory, ensureNotificationPermissionAndChannel, cancelNotificationsWithDataMatch } from '../utils/notifications';
import { loadIdleToySettings } from '../utils/reminderSettings';
import { scheduleIdleRemindersForToy } from './idleToy';

export type LongPlaySettings = {
  enabled: boolean;
  durationMin: number; // threshold in minutes
  methods: { push: boolean; inApp: boolean };
};

let subscribed = false;
let channel: any = null;
let currentSettings: LongPlaySettings | null = null;

async function fetchLastScanTime(toyId: string): Promise<string | null> {
  try {
    const { data } = await supabase
      .from('play_sessions')
      .select('scan_time')
      .eq('toy_id', toyId)
      .order('scan_time', { ascending: false })
      .limit(1);
    return ((data || [])[0]?.scan_time as string) || null;
  } catch {
    return null;
  }
}

async function scheduleLongPlayReminders(toyId: string, toyName: string, ownerName: string | null, startTimeStr: string, settings: LongPlaySettings) {
  // Cancel existing LP reminders first
  await cancelNotificationsWithDataMatch(d => d?.type === 'longPlay' && d?.toyId === toyId);

  const start = new Date(startTimeStr).getTime();
  const now = Date.now();
  const ownerLabel = ownerName ? `${ownerName}'s ` : '';

  const schedule = async (minFromStart: number, isDay = false) => {
    const triggerTime = start + minFromStart * 60000;
    const delay = (triggerTime - now) / 1000;
    // If passed, do not schedule. We avoid spamming "catch-up" notifications.
    if (delay <= 0) return;
    
    const seconds = delay;
    let body = '';
    let stage = '';
    if (isDay) {
       const days = Math.floor(minFromStart / (24 * 60));
       body = `${ownerLabel}${toyName} has been playing for ${days} days. Take a short break, drink some water, and rest your eyes.`;
       stage = `day:${days}`;
    } else {
       body = `${ownerLabel}${toyName} has been playing for ${minFromStart} minutes. Take a short break, drink some water, and rest your eyes.`;
       stage = String(minFromStart);
    }

    try {
      await ensureNotificationPermissionAndChannel();
      await Notifications.scheduleNotificationAsync({
        content: { title: 'Long Play Reminder', body, data: { type: 'longPlay', toyId, stage } },
        trigger: { seconds, repeats: false },
      });
    } catch {}
  };

  const base = settings.durationMin;
  await schedule(base);
  await schedule(base + 5);
  await schedule(base + 15);
  // Schedule for day 1 (1440 mins)
  await schedule(24 * 60, true);
}

export async function startLongPlayMonitor(settings: LongPlaySettings) {
  currentSettings = settings;
  if (!settings.enabled) return;
  if (subscribed) return; // already running
  
  try {
    channel = supabase
      .channel('long-play-monitor')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'toys' }, async (payload: any) => {
        const row = (payload as any).new || {};
        const toyId = row.id as string;
        const status = row.status as 'in' | 'out';
        const toyName = (row.name as string) || 'Toy';
        const ownerName = (row.owner as string) || null;
        const updatedAt = (row.updated_at as string) || new Date().toISOString();
        
        if (!toyId) return;

        if (status === 'out') {
          // Toy started playing: Schedule LP reminders, cancel Idle reminders
          const st = await fetchLastScanTime(toyId);
          
          // Heuristic: If status JUST changed (updatedAt is very recent) but the last scan is old,
          // it means this is a manual status change without a corresponding scan record (or scan is lagging).
          // In this case, use updatedAt as the start time to avoid false positives from previous sessions.
          let startTime = st || updatedAt;
          const now = Date.now();
          const upTime = new Date(updatedAt).getTime();
          const stTime = st ? new Date(st).getTime() : 0;
          
          // If updatedAt is within last 1 minute, and st is older than 10 minutes (or null)
          if (Math.abs(now - upTime) < 60000 && (now - stTime) > 600000) {
             startTime = updatedAt;
          }

          await scheduleLongPlayReminders(toyId, toyName, ownerName, startTime, settings);
          await cancelNotificationsWithDataMatch(d => d?.type === 'idleToy' && d?.toyId === toyId);
        } else {
          // Toy stopped: Cancel LP reminders, schedule Idle reminders
          await cancelNotificationsWithDataMatch(d => d?.type === 'longPlay' && d?.toyId === toyId);
          try {
            const idleSettings = await loadIdleToySettings();
            await scheduleIdleRemindersForToy(toyId, toyName, ownerName, idleSettings);
          } catch {}
        }
      })
      .subscribe();
    subscribed = true;

    // Initialize logic for toys already out
    try {
      const { data: outToys } = await supabase
        .from('toys')
        .select('id,name') // owner not in toys table in some schemas, fetch carefully or ignore
        .eq('status', 'out');
        
      for (const t of (outToys || [])) {
        const tid = t.id as string;
        const tname = (t.name as string) || 'Toy';
        const ownerName = null; // If needed, fetch from separate query or join, but schema seems to lack it in toys directly?
        // Actually payload had it, but initial scan might not. Assuming 'toys' has no owner column based on previous errors?
        // The payload code used (row.owner as string). If the table has it, great.
        // Let's assume it might not be in the initial select if we don't select it.
        // I'll stick to 'id,name' to be safe as per previous fix.
        
        const st = await fetchLastScanTime(tid);
        // Force reschedule to ensure they exist even if app was killed
        await scheduleLongPlayReminders(tid, tname, ownerName, st || new Date().toISOString(), settings);
      }
    } catch {}

  } catch (e) {
    subscribed = false;
  }
}

export function stopLongPlayMonitor() {
  try { if (channel) supabase.removeChannel(channel); } catch {}
  channel = null;
  subscribed = false;
  // We do NOT clear scheduled notifications here automatically, 
  // because we want them to fire even if the app is closed/killed (which calls stop monitor).
  // However, if the user explicitly disables the feature, they should be cleared.
  // The caller (App.tsx) handles enabling/disabling.
  // If settings.enabled becomes false, we should probably clear them?
  // But stopLongPlayMonitor is called on unmount too.
  // Let's leave them scheduled. If the user logs out, we might want to clear them.
  // For now, persistence is the goal.
}
