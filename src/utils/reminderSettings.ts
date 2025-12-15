import { supabase } from '../supabaseClient';
import * as SecureStore from 'expo-secure-store';
import type { LongPlaySettings as LPSettings } from '../reminders/longPlay';
import type { IdleToySettings as ITSettings } from '../reminders/idleToy';

export type LongPlaySettings = LPSettings;
export type IdleToySettings = ITSettings;
export type Repeat = 'daily' | 'weekends' | 'weekdays';
export type TidyingSettings = { enabled: boolean; time: string; repeat: Repeat; dndStart?: string; dndEnd?: string };

const LP_KEY = 'reminder_longplay_settings';
const IT_KEY = 'reminder_idletoy_settings';
const ST_KEY = 'smart_tidying_settings';

async function getUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getUser();
    return data?.user?.id || null;
  } catch {
    return null;
  }
}

function ensureLPShape(parsed: any): LongPlaySettings {
  return {
    enabled: !!parsed?.enabled,
    durationMin: typeof parsed?.durationMin === 'number' ? parsed.durationMin : parseInt(String(parsed?.durationMin ?? 45), 10) || 45,
    methods: parsed?.methods && typeof parsed.methods === 'object' ? { push: !!parsed.methods.push, inApp: !!parsed.methods.inApp } : { push: true, inApp: true },
  };
}
function ensureITShape(parsed: any): IdleToySettings {
  return {
    enabled: !!parsed?.enabled,
    days: typeof parsed?.days === 'number' ? parsed.days : parseInt(String(parsed?.days ?? 14), 10) || 14,
    smartSuggest: parsed?.smartSuggest !== undefined ? !!parsed.smartSuggest : true,
  };
}
function ensureSTShape(parsed: any): TidyingSettings {
  const time = typeof parsed?.time === 'string' ? parsed.time : '20:00';
  const repeat: Repeat = parsed?.repeat === 'weekends' || parsed?.repeat === 'weekdays' ? parsed.repeat : 'daily';
  return {
    enabled: !!parsed?.enabled,
    time,
    repeat,
    dndStart: typeof parsed?.dndStart === 'string' ? parsed.dndStart : '22:00',
    dndEnd: typeof parsed?.dndEnd === 'string' ? parsed.dndEnd : '07:00',
  };
}

export async function syncLocalFromRemote(): Promise<void> {
  const uid = await getUserId();
  if (!uid) return; // 未登录则跳过
  const { data, error } = await supabase
    .from('reminder_settings')
    .select('*')
    .eq('user_id', uid)
    .maybeSingle();
  if (error) return;
  if (!data) return;
  // 兼容两套字段命名：
  // 长时玩耍：longplay_methods(jsonb) 或 longplay_push/longplay_inapp
  const lpMethods = (data as any).longplay_methods
    ? { push: !!(data as any).longplay_methods?.push, inApp: !!(data as any).longplay_methods?.inApp }
    : { push: !!(data as any).longplay_push, inApp: !!(data as any).longplay_inapp };
  try { await SecureStore.setItemAsync(LP_KEY, JSON.stringify({ enabled: !!(data as any).longplay_enabled, durationMin: (data as any).longplay_duration_min ?? 45, methods: lpMethods })); } catch {}
  // 闲置玩具：idle_smart 或 idle_smart_suggest
  const idleSmart = (data as any).idle_smart ?? (data as any).idle_smart_suggest;
  try { await SecureStore.setItemAsync(IT_KEY, JSON.stringify({ enabled: !!(data as any).idle_enabled, days: (data as any).idle_days ?? 14, smartSuggest: idleSmart ?? true })); } catch {}
  // 智能整理：tidy_* 或 tidying_*
  const tidyEnabled = (data as any).tidy_enabled ?? (data as any).tidying_enabled;
  const tidyTime = (data as any).tidy_time ?? (data as any).tidying_time;
  const tidyRepeat = (data as any).tidy_repeat ?? (data as any).tidying_repeat;
  const tidyDndStart = (data as any).tidy_dnd_start ?? (data as any).tidying_dnd_start;
  const tidyDndEnd = (data as any).tidy_dnd_end ?? (data as any).tidying_dnd_end;
  try { await SecureStore.setItemAsync(ST_KEY, JSON.stringify({ enabled: !!tidyEnabled, time: tidyTime || '20:00', repeat: tidyRepeat || 'daily', dndStart: tidyDndStart || '22:00', dndEnd: tidyDndEnd || '07:00' })); } catch {}
}

export async function loadLongPlaySettings(): Promise<LongPlaySettings> {
  // 先读本地（更快），再尝试远端覆盖
  let local: LongPlaySettings | null = null;
  try { const raw = await SecureStore.getItemAsync(LP_KEY); if (raw) local = ensureLPShape(JSON.parse(raw)); } catch {}
  const uid = await getUserId();
  if (!uid) return local || { enabled: false, durationMin: 45, methods: { push: true, inApp: true } };
  const { data } = await supabase.from('reminder_settings').select('*').eq('user_id', uid).maybeSingle();
  if (data) {
    const methods = (data as any).longplay_methods
      ? { push: !!(data as any).longplay_methods?.push, inApp: !!(data as any).longplay_methods?.inApp }
      : { push: !!(data as any).longplay_push, inApp: !!(data as any).longplay_inapp };
    const remote: LongPlaySettings = { enabled: !!(data as any).longplay_enabled, durationMin: (data as any).longplay_duration_min ?? 45, methods };
    try { await SecureStore.setItemAsync(LP_KEY, JSON.stringify(remote)); } catch {}
    return remote;
  }
  return local || { enabled: false, durationMin: 45, methods: { push: true, inApp: true } };
}

export async function saveLongPlaySettings(s: LongPlaySettings): Promise<{ remoteSaved: boolean; uid?: string; error?: string }> {
  try { await SecureStore.setItemAsync(LP_KEY, JSON.stringify(s)); } catch {}
  const uid = await getUserId();
  if (!uid) return { remoteSaved: false, uid: null as any, error: 'not_logged_in' };
  // 仅保存到新字段（longplay_push/longplay_inapp）。旧字段 longplay_methods 已在统一迁移中删除，不再回退写入。
  let saved = false;
  let lastErr: any = null;
  try {
    const { error } = await supabase.from('reminder_settings').upsert({
      user_id: uid,
      longplay_enabled: s.enabled,
      longplay_duration_min: s.durationMin,
      longplay_push: s.methods.push,
      longplay_inapp: s.methods.inApp,
    }, { onConflict: 'user_id' });
    if (!error) saved = true; else lastErr = error;
  } catch (e: any) {
    lastErr = e;
  }
  if (!saved && lastErr) console.error('saveLongPlaySettings upsert error:', lastErr?.message || String(lastErr));
  return { remoteSaved: saved, uid, error: saved ? undefined : (lastErr?.message || 'unknown error') };
}

export async function loadIdleToySettings(): Promise<IdleToySettings> {
  let local: IdleToySettings | null = null;
  try { const raw = await SecureStore.getItemAsync(IT_KEY); if (raw) local = ensureITShape(JSON.parse(raw)); } catch {}
  const uid = await getUserId();
  if (!uid) return local || { enabled: false, days: 14, smartSuggest: true };
  const { data } = await supabase.from('reminder_settings').select('*').eq('user_id', uid).maybeSingle();
  if (data) {
    const smart = (data as any).idle_smart ?? (data as any).idle_smart_suggest;
    const remote: IdleToySettings = { enabled: !!(data as any).idle_enabled, days: (data as any).idle_days ?? 14, smartSuggest: smart ?? true };
    try { await SecureStore.setItemAsync(IT_KEY, JSON.stringify(remote)); } catch {}
    return remote;
  }
  return local || { enabled: false, days: 14, smartSuggest: true };
}

export async function saveIdleToySettings(s: IdleToySettings): Promise<{ remoteSaved: boolean; uid?: string; error?: string }> {
  try { await SecureStore.setItemAsync(IT_KEY, JSON.stringify(s)); } catch {}
  const uid = await getUserId();
  if (!uid) return { remoteSaved: false, uid: null as any, error: 'not_logged_in' };
  let saved = false; let lastErr: any = null;
  try {
    const { error } = await supabase.from('reminder_settings').upsert({
      user_id: uid,
      idle_enabled: s.enabled,
      idle_days: s.days,
      idle_smart: s.smartSuggest,
    }, { onConflict: 'user_id' });
    if (!error) saved = true; else lastErr = error;
  } catch (e: any) { lastErr = e; }
  if (!saved && lastErr) console.error('saveIdleToySettings upsert error:', lastErr?.message || String(lastErr));
  return { remoteSaved: saved, uid, error: saved ? undefined : (lastErr?.message || 'unknown error') };
}

export async function loadTidyingSettings(): Promise<TidyingSettings> {
  let local: TidyingSettings | null = null;
  try { const raw = await SecureStore.getItemAsync(ST_KEY); if (raw) local = ensureSTShape(JSON.parse(raw)); } catch {}
  const uid = await getUserId();
  if (!uid) return local || { enabled: false, time: '20:00', repeat: 'daily', dndStart: '22:00', dndEnd: '07:00' };
  const { data } = await supabase.from('reminder_settings').select('*').eq('user_id', uid).maybeSingle();
  if (data) {
    const enabled = (data as any).tidy_enabled ?? (data as any).tidying_enabled;
    const time = (data as any).tidy_time ?? (data as any).tidying_time;
    const repeatRaw = (data as any).tidy_repeat ?? (data as any).tidying_repeat;
    const repeat: Repeat = (repeatRaw === 'weekends' || repeatRaw === 'weekdays') ? repeatRaw : 'daily';
    const dndStart = (data as any).tidy_dnd_start ?? (data as any).tidying_dnd_start;
    const dndEnd = (data as any).tidy_dnd_end ?? (data as any).tidying_dnd_end;
    const remote: TidyingSettings = {
      enabled: !!enabled,
      time: time || '20:00',
      repeat,
      dndStart: dndStart || '22:00',
      dndEnd: dndEnd || '07:00',
    };
    try { await SecureStore.setItemAsync(ST_KEY, JSON.stringify(remote)); } catch {}
    return remote;
  }
  return local || { enabled: false, time: '20:00', repeat: 'daily', dndStart: '22:00', dndEnd: '07:00' };
}

export async function saveTidyingSettings(s: TidyingSettings): Promise<{ remoteSaved: boolean; uid?: string; error?: string }> {
  try { await SecureStore.setItemAsync(ST_KEY, JSON.stringify(s)); } catch {}
  const uid = await getUserId();
  if (!uid) return { remoteSaved: false, uid: null as any, error: 'not_logged_in' };
  let saved = false; let lastErr: any = null;
  try {
    const { error } = await supabase.from('reminder_settings').upsert({
      user_id: uid,
      tidy_enabled: s.enabled,
      tidy_time: s.time,
      tidy_repeat: s.repeat,
      tidy_dnd_start: s.dndStart,
      tidy_dnd_end: s.dndEnd,
    }, { onConflict: 'user_id' });
    if (!error) saved = true; else lastErr = error;
  } catch (e: any) { lastErr = e; }
  if (!saved && lastErr) console.error('saveTidyingSettings upsert error:', lastErr?.message || String(lastErr));
  return { remoteSaved: saved, uid, error: saved ? undefined : (lastErr?.message || 'unknown error') };
}