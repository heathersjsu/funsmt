import { supabase } from '../supabaseClient';
import * as SecureStore from 'expo-secure-store';
import type { LongPlaySettings as LPSettings } from '../reminders/longPlay';

export type LongPlaySettings = LPSettings;

// Placeholder implementation to prevent runtime errors when settings are not yet implemented.
export async function syncLocalFromRemote(): Promise<void> {
  try {
    // In real implementation, pull user settings from Supabase and persist locally.
    // This is a no-op placeholder.
    return;
  } catch {
    return;
  }
}

const KEY = 'reminder_longplay_settings';

export async function loadLongPlaySettings(): Promise<LongPlaySettings> {
  try {
    // Prefer local setting stored via LongPlaySettingsScreen
    const raw = await SecureStore.getItemAsync(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Fallbacks to ensure shape
      return {
        enabled: !!parsed.enabled,
        durationMin: typeof parsed.durationMin === 'number' ? parsed.durationMin : parseInt(String(parsed.durationMin || 45), 10) || 45,
        methods: parsed.methods && typeof parsed.methods === 'object' ? parsed.methods : { push: true, inApp: true },
      } as LongPlaySettings;
    }
  } catch {}
  return { enabled: false, durationMin: 45, methods: { push: true, inApp: true } } as LongPlaySettings;
}