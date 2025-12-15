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
// Track which reminder stages have been sent per toy to avoid duplicates
// Stages are minutes after session start: [durationMin, durationMin+10, durationMin+30]
let stagesSent: Record<string, Set<number>> = {};
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
  delete stagesSent[toyId];
}

async function notifyLongPlay(toyName: string, ownerName: string | null, minutes: number, stageMin: number) {
  // Friendly English message with toy and owner name
  const ownerLabel = ownerName ? `${ownerName}'s ` : '';
  const body = `Friendly reminder: ${ownerLabel}${toyName} has been playing for ${minutes} minutes. Take a short break, drink some water, and rest your eyes.`;
  try {
    await ensureNotificationPermissionAndChannel();
    await Notifications.scheduleNotificationAsync({
      content: { title: 'Long Play Reminder', body },
      trigger: null,
    });
    // Stamp source with toyId+stage for de-dup across runs
    await recordNotificationHistory('Long Play reminder', body, `longPlay:${toyName}:${stageMin}`);
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
        const toyName = (row.name as string) || 'Toy';
        const ownerName = (row.owner as string) || null;
        const updatedAt = (row.updated_at as string) || new Date().toISOString();
        if (!toyId) return;
        if (status === 'out') {
          const st = await fetchLastScanTime(toyId);
          // Use the last scan time; if missing fall back to the latest update time (status change)
          startTimes[toyId] = st || updatedAt;
          stagesSent[toyId] = stagesSent[toyId] || new Set<number>();
          // Check every 30 seconds and perform an immediate check
          clearTimer(toyId);
          const checkAndMaybeNotify = async () => {
            try {
              const start = startTimes[toyId];
              if (!start) return;
              const diffMs = Date.now() - new Date(start).getTime();
              const mins = Math.floor(Math.max(0, diffMs) / 60000);
              const base = settings.durationMin;
              const stages = [base, base + 10, base + 30];
              for (const s of stages) {
                if (mins >= s && !stagesSent[toyId].has(s)) {
                  stagesSent[toyId].add(s);
                  await notifyLongPlay(toyName, ownerName, mins, s);
                }
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
      // Fix: select only existing columns from toys. 'owner' column does not exist; use id & name.
      const { data: outToys } = await supabase
        .from('toys')
        .select('id,name')
        .eq('status', 'out');
      (outToys || []).forEach(async (t: any) => {
        const tid = t.id as string; const tname = (t.name as string) || 'Toy'; const ownerName = null;
        const st = await fetchLastScanTime(tid);
        startTimes[tid] = st || new Date().toISOString();
        stagesSent[tid] = stagesSent[tid] || new Set<number>();
        clearTimer(tid);
        const checkAndMaybeNotify = async () => {
          try {
            const start = startTimes[tid];
            if (!start) return;
            const diffMs = Date.now() - new Date(start).getTime();
            const mins = Math.floor(Math.max(0, diffMs) / 60000);
            const base = settings.durationMin;
            const stages = [base, base + 10, base + 30];
            for (const s of stages) {
              if (mins >= s && !stagesSent[tid].has(s)) {
                stagesSent[tid].add(s);
                await notifyLongPlay(tname, ownerName, mins, s);
              }
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