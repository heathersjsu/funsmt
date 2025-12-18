import { supabase } from '../supabaseClient';
import * as Notifications from 'expo-notifications';
import { recordNotificationHistory, getNotificationHistory, ensureNotificationPermissionAndChannel } from '../utils/notifications';

export type IdleToySettings = {
  enabled: boolean;
  days: number;
  smartSuggest: boolean;
};

function monthIndexSince(daysSince: number): number {
  return Math.floor(daysSince / 30); // 0 for <30d, 1 for 30-59d, etc.
}

async function hasSentStageLabel(toyId: string, label: string): Promise<boolean> {
  try {
    const all = await getNotificationHistory();
    return (all || []).some(i => i.source === `idleToy:${toyId}:${label}`);
  } catch { return false; }
}

export async function runIdleScan(settings: IdleToySettings) {
  if (!settings.enabled) return;
  try {
    const { data: toys } = await supabase.from('toys').select('id,name,owner');
    const arr = (toys || []) as any[];
    for (const t of arr) {
      const tid = t.id as string;
      const name = (t.name as string) || 'Toy';
      const ownerName = (t.owner as string) || null;
      const { data: last } = await supabase
        .from('play_sessions')
        .select('scan_time')
        .eq('toy_id', tid)
        .order('scan_time', { ascending: false })
        .limit(1);
      const lastScan = ((last || [])[0]?.scan_time as string) || null;
      const lastTime = lastScan ? new Date(lastScan).getTime() : 0;
      const daysSince = Math.floor((Date.now() - lastTime) / (24 * 60 * 60 * 1000));
      const ownerLabel = ownerName ? `${ownerName}'s ` : '';
      const suggest = settings.smartSuggest ? ' Try playing with it on the play mat today.' : '';
      if (!lastScan) {
        // No play history: notify once
        if (!(await hasSentStageLabel(tid, 'never'))) {
          const body = `Friendly reminder: ${ownerLabel}${name} has not been played with yet (no play history).`.trim();
          try {
            await ensureNotificationPermissionAndChannel();
            await Notifications.scheduleNotificationAsync({ content: { title: 'Idle Toy Reminder', body }, trigger: null });
          } catch {}
          await recordNotificationHistory('Idle Toy Reminder', body, `idleToy:${tid}:never`);
        }
        continue;
      }
      // 1) Threshold day (settings.days)
      if (daysSince >= settings.days && !(await hasSentStageLabel(tid, String(settings.days)))) {
        const body = `Friendly reminder: ${ownerLabel}${name} hasn't been played with for ${daysSince} days. It's waiting for you!${suggest}`.trim();
        try {
          await ensureNotificationPermissionAndChannel();
          await Notifications.scheduleNotificationAsync({ content: { title: 'Idle Toy Reminder', body }, trigger: null });
        } catch {}
        await recordNotificationHistory('Idle Toy Reminder', body, `idleToy:${tid}:${settings.days}`);
      }
      // 2) 7 days stage
      if (daysSince >= 7 && !(await hasSentStageLabel(tid, '7'))) {
        const body = `Friendly reminder: ${ownerLabel}${name} hasn't been played with for ${daysSince} days. It's waiting for you!${suggest}`.trim();
        try {
          await ensureNotificationPermissionAndChannel();
          await Notifications.scheduleNotificationAsync({ content: { title: 'Idle Toy Reminder', body }, trigger: null });
        } catch {}
        await recordNotificationHistory('Idle Toy Reminder', body, `idleToy:${tid}:7`);
      }
      // 3) Monthly reminders after threshold
      const mIdx = monthIndexSince(daysSince);
      if (mIdx >= 1) {
        const stamp = `month:${mIdx}`;
        if (!(await hasSentStageLabel(tid, stamp))) {
          const body = `Friendly reminder: ${ownerLabel}${name} hasn't been played with for ${daysSince} days. It's waiting for you!${suggest}`.trim();
          try {
            await ensureNotificationPermissionAndChannel();
            await Notifications.scheduleNotificationAsync({ content: { title: 'Idle Toy Reminder', body }, trigger: null });
          } catch {}
          await recordNotificationHistory('Idle Toy Reminder', body, `idleToy:${tid}:${stamp}`);
        }
      }
    }
  } catch (e) {
    // swallow errors in scan
  }
}
