import { supabase } from '../supabaseClient';
import * as Notifications from 'expo-notifications';
import { recordNotificationHistory, getNotificationHistory, ensureNotificationPermissionAndChannel } from '../utils/notifications';

export type IdleToySettings = {
  enabled: boolean;
  days: number;
  smartSuggest: boolean;
};

function uniqueThresholds(custom: number): number[] {
  const set = new Set<number>([custom, 7, 30]);
  return Array.from(set).sort((a, b) => a - b);
}

async function hasSentStage(toyId: string, stageDays: number): Promise<boolean> {
  try {
    const all = await getNotificationHistory();
    return (all || []).some(i => i.source === `idleToy:${toyId}:${stageDays}`);
  } catch { return false; }
}

export async function runIdleScan(settings: IdleToySettings) {
  if (!settings.enabled) return;
  try {
    // Fix: select only existing columns from toys. 'owner' column does not exist; use id & name.
    const { data: toys } = await supabase.from('toys').select('id,name');
    const arr = (toys || []) as any[];
    for (const t of arr) {
      const tid = t.id as string;
      const name = (t.name as string) || 'Toy';
      const { data: last } = await supabase
        .from('play_sessions')
        .select('scan_time')
        .eq('toy_id', tid)
        .order('scan_time', { ascending: false })
        .limit(1);
      const lastScan = ((last || [])[0]?.scan_time as string) || null;
      const lastTime = lastScan ? new Date(lastScan).getTime() : 0;
      const daysSince = Math.floor((Date.now() - lastTime) / (24 * 60 * 60 * 1000));
      const thresholds = uniqueThresholds(settings.days);
      for (const stage of thresholds) {
        if (!lastScan) {
          // Never played: treat as exceeding all stages, but only notify once at the smallest stage
          const stageToUse = thresholds[0];
          if (!(await hasSentStage(tid, stageToUse))) {
            const suggest = settings.smartSuggest ? ' Try putting it on the play mat today.' : '';
            const body = `Friendly reminder: ${name} has not been played with yet (no play history).${suggest}`.trim();
            try {
              await ensureNotificationPermissionAndChannel();
              await Notifications.scheduleNotificationAsync({
                content: { title: 'Idle Toy Reminder', body },
                trigger: null,
              });
            } catch {}
            await recordNotificationHistory('Idle Toy Reminder', body, `idleToy:${tid}:${stageToUse}`);
          }
          break; // handled
        } else if (daysSince >= stage && !(await hasSentStage(tid, stage))) {
          const suggest = settings.smartSuggest ? ' Try playing with it on the play mat today.' : '';
          const body = `Friendly reminder: ${name} hasn\'t been played with for ${daysSince} days. It\'s waiting for you!${suggest}`.trim();
          try {
            await ensureNotificationPermissionAndChannel();
            await Notifications.scheduleNotificationAsync({
              content: { title: 'Idle Toy Reminder', body },
              trigger: null,
            });
          } catch {}
          await recordNotificationHistory('Idle Toy Reminder', body, `idleToy:${tid}:${stage}`);
        }
      }
    }
  } catch (e) {
    // swallow errors in scan
  }
}