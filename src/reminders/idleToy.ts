import { supabase } from '../supabaseClient';
import * as Notifications from 'expo-notifications';
import { recordNotificationHistory } from '../utils/notifications';

export type IdleToySettings = {
  enabled: boolean;
  days: number;
  smartSuggest: boolean;
};

export async function runIdleScan(settings: IdleToySettings) {
  if (!settings.enabled) return;
  try {
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
      if (!lastScan || daysSince >= settings.days) {
        const suggest = settings.smartSuggest ? " How about placing it on the play mat today?" : '';
        const body = `${name} hasn't played with you for ${settings.days} days. It misses you! ${suggest}`.trim();
        await Notifications.scheduleNotificationAsync({
          content: { title: 'Toy misses you 💖', body },
          trigger: null,
        });
        await recordNotificationHistory('Toy misses you 💖', body, 'idleToy');
      }
    }
  } catch (e) {
    // swallow errors in scan
  }
}