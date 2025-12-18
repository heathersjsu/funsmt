import { supabase } from '../supabaseClient';
import * as Notifications from 'expo-notifications';
import { recordNotificationHistory, getNotificationHistory, ensureNotificationPermissionAndChannel, cancelNotificationsWithDataMatch } from '../utils/notifications';

export type IdleToySettings = {
  enabled: boolean;
  days: number;
  smartSuggest: boolean;
};

export async function scheduleIdleRemindersForToy(toyId: string, toyName: string, ownerName: string | null, settings: IdleToySettings) {
  if (!settings.enabled) return;
  
  // Cancel existing scheduled idle reminders for this toy
  await cancelNotificationsWithDataMatch(d => d?.type === 'idleToy' && d?.toyId === toyId);

  const ownerLabel = ownerName ? `${ownerName}'s ` : '';
  const suggest = settings.smartSuggest ? ' Try playing with it on the play mat today.' : '';

  // Helper to schedule
  const schedule = async (days: number, stage: string) => {
    const seconds = days * 24 * 60 * 60;
    const body = `${ownerLabel}${toyName} hasn't been played with for ${days} days. It's waiting for you!${suggest}`.trim();
    try {
      await Notifications.scheduleNotificationAsync({
        content: { title: 'Idle Toy Reminder', body, data: { type: 'idleToy', toyId, stage } },
        trigger: { seconds, repeats: false }
      });
    } catch {}
  };

  // 1) Threshold day
  if (settings.days > 0) await schedule(settings.days, String(settings.days));

  // 2) 7 days (if distinct)
  if (settings.days !== 7) await schedule(7, '7');

  // 3) Monthly (30 days)
  await schedule(30, 'month:1');
}

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
    const { data: toys } = await supabase.from('toys').select('id,name,owner,created_at');
    const arr = (toys || []) as any[];
    for (const t of arr) {
      const tid = t.id as string;
      const name = (t.name as string) || 'Toy';
      const ownerName = (t.owner as string) || null;
      // Use created_at as fallback for "last play time" if no sessions exist,
      // to prevents "30 days idle" alert for a toy added just now.
      const createdAtTime = t.created_at ? new Date(t.created_at).getTime() : Date.now();

      const { data: last } = await supabase
        .from('play_sessions')
        .select('scan_time')
        .eq('toy_id', tid)
        .order('scan_time', { ascending: false })
        .limit(1);
      const lastScan = ((last || [])[0]?.scan_time as string) || null;
      const lastTime = lastScan ? new Date(lastScan).getTime() : createdAtTime;
      const daysSince = Math.floor((Date.now() - lastTime) / (24 * 60 * 60 * 1000));
      const ownerLabel = ownerName ? `${ownerName}'s ` : '';
      const suggest = settings.smartSuggest ? ' Try playing with it on the play mat today.' : '';

      // Case 1: No play history ever
      if (!lastScan) {
        // Only notify "never played" if it has been idle since creation for a meaningful time.
        // We use settings.days (default 14) or at least 3 days to avoid spamming new users.
        const neverThreshold = settings.days > 0 ? settings.days : 7;
        
        if (daysSince >= neverThreshold) {
          if (!(await hasSentStageLabel(tid, 'never'))) {
            const body = `Friendly reminder: ${ownerLabel}${name} has not been played with yet (no play history).`.trim();
            try {
              await ensureNotificationPermissionAndChannel();
              await Notifications.scheduleNotificationAsync({ content: { title: 'Idle Toy Reminder', body }, trigger: null });
            } catch {}
            await recordNotificationHistory('Idle Toy Reminder', body, `idleToy:${tid}:never`);
          }
        }
        continue;
      }

      // Case 2: Has play history -> Check thresholds
      // We gather all applicable triggers and only send the highest priority one (longest duration)
      // to avoid sending "30 days", "14 days", and "7 days" all at once.
      
      const triggers: Array<{ threshold: number; label: string }> = [];

      // A. Monthly (every 30 days)
      const mIdx = Math.floor(daysSince / 30);
      if (mIdx >= 1) {
        triggers.push({ threshold: mIdx * 30, label: `month:${mIdx}` });
      }

      // B. User Setting (e.g. 14 days)
      if (settings.days > 0) {
        triggers.push({ threshold: settings.days, label: String(settings.days) });
      }

      // C. Fixed 7 days (if not same as user setting)
      if (settings.days !== 7) {
        triggers.push({ threshold: 7, label: '7' });
      }

      // Sort triggers by threshold descending (longest time first)
      triggers.sort((a, b) => b.threshold - a.threshold);

      for (const trig of triggers) {
        if (daysSince >= trig.threshold) {
          // Check if this specific stage has been sent
          if (!(await hasSentStageLabel(tid, trig.label))) {
             const body = `${ownerLabel}${name} hasn't been played with for ${daysSince} days. It's waiting for you!${suggest}`.trim();
             try {
               await ensureNotificationPermissionAndChannel();
               await Notifications.scheduleNotificationAsync({ content: { title: 'Idle Toy Reminder', body }, trigger: null });
             } catch {}
             await recordNotificationHistory('Idle Toy Reminder', body, `idleToy:${tid}:${trig.label}`);
             // Stop processing lower thresholds for this toy
             break;
          } else {
             // If the highest applicable threshold was already sent, we assume
             // we don't need to send lower/older ones (e.g. if 30-day is sent, don't send 7-day).
             break;
          }
        }
      }
    }
  } catch (e) {
    // swallow errors in scan
  }
}
