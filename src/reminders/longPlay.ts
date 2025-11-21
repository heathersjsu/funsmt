import { supabase } from '../supabaseClient';
import * as Notifications from 'expo-notifications';
import { recordNotificationHistory, ensureNotificationPermissionAndChannel } from '../utils/notifications';

export type LongPlaySettings = {
  enabled: boolean;
  durationMin: number; // threshold in minutes
  methods: { push: boolean; inApp: boolean };
};

let subscribed = false;
let timers: Record<string, any> = {};
let startTimes: Record<string, string> = {};
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

function clearTimer(toyId: string) {
  const t = timers[toyId];
  if (t) { try { clearInterval(t); } catch {} }
  delete timers[toyId];
  delete startTimes[toyId];
}

async function notifyLongPlay(toyName: string, minutes: number) {
  const body = `${toyName} has been playing for ${minutes} minutes. Please take an eye break 👀`;
  try {
    await ensureNotificationPermissionAndChannel();
    await Notifications.scheduleNotificationAsync({
      content: { title: 'Time to take a break', body },
      trigger: null,
    });
    await recordNotificationHistory('Long Play reminder', body, 'longPlay');
  } catch {}
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
        const toyName = row.name as string || 'Toy';
        const updatedAt = (row.updated_at as string) || new Date().toISOString();
        if (!toyId) return;
        if (status === 'out') {
          const st = await fetchLastScanTime(toyId);
          // Use the last scan time; if missing fall back to the latest update time (status change)
          startTimes[toyId] = st || updatedAt;
          // Check every 30 seconds and perform an immediate check
          clearTimer(toyId);
          const checkAndMaybeNotify = async () => {
            try {
              const start = startTimes[toyId];
              if (!start) return;
              const diffMs = Date.now() - new Date(start).getTime();
              const mins = Math.floor(Math.max(0, diffMs) / 60000);
              if (mins >= settings.durationMin) {
                clearTimer(toyId);
                await notifyLongPlay(toyName, mins);
              }
            } catch {}
          };
          await checkAndMaybeNotify();
          timers[toyId] = setInterval(checkAndMaybeNotify, 30000);
        } else {
          clearTimer(toyId);
        }
      })
      .subscribe();
    subscribed = true;
    // Initialize timers for toys that are already playing (status === 'out') when monitor starts
    try {
      const { data: outToys } = await supabase
        .from('toys')
        .select('id,name,status')
        .eq('status', 'out');
      (outToys || []).forEach(async (t: any) => {
        const tid = t.id as string; const tname = (t.name as string) || 'Toy';
        const st = await fetchLastScanTime(tid);
        startTimes[tid] = st || new Date().toISOString();
        clearTimer(tid);
        const checkAndMaybeNotify = async () => {
          try {
            const start = startTimes[tid];
            if (!start) return;
            const diffMs = Date.now() - new Date(start).getTime();
            const mins = Math.floor(Math.max(0, diffMs) / 60000);
            if (mins >= settings.durationMin) {
              clearTimer(tid);
              await notifyLongPlay(tname, mins);
            }
          } catch {}
        };
        await checkAndMaybeNotify();
        timers[tid] = setInterval(checkAndMaybeNotify, 30000);
      });
    } catch {}
  } catch (e) {
    subscribed = false;
  }
}

export function stopLongPlayMonitor() {
  try { if (channel) supabase.removeChannel(channel); } catch {}
  channel = null;
  subscribed = false;
  Object.keys(timers).forEach(clearTimer);
}