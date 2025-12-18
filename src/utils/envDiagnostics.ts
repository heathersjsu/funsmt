import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from '../supabaseClient';

export type EnvDiagResult = {
  supabaseUrl: string;
  anonKeyPresent: boolean;
  alwaysLoginFlag: boolean;
  projectRef: string;
  storageKeyFound: boolean;
  sessionPresent: boolean;
  sessionUserId: string | null;
  sessionEmail: string | null;
  toyCount: number | null;
  toysAccessible: boolean | null;
  problems: string[];
};

function resolveSupabaseUrl(): string {
  const u = (process.env.EXPO_PUBLIC_SUPABASE_URL as string | undefined)
    || (Constants?.expoConfig?.extra as any)?.SUPABASE_URL
    || ((Constants as any)?.manifest?.extra)?.SUPABASE_URL
    || '';
  return String(u || '').trim();
}

function resolveAnon(): string {
  const k = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string | undefined)
    || (Constants?.expoConfig?.extra as any)?.SUPABASE_ANON_KEY
    || ((Constants as any)?.manifest?.extra)?.SUPABASE_ANON_KEY
    || '';
  return String(k || '').trim();
}

function getProjectRef(url: string): string {
  try {
    const host = new URL(url).hostname;
    return (host.split('.')[0] || '').trim();
  } catch {
    return '';
  }
}

function findStorageKey(ref: string): boolean {
  if (Platform.OS !== 'web') return true;
  try {
    const keys = Object.keys((window as any)?.localStorage || {});
    const key = keys.find((k) => /sb-.*-auth-token$/.test(k));
    if (!key) return false;
    if (ref && !key.startsWith(`sb-${ref}-`)) return false;
    const raw = (window as any).localStorage.getItem(key) || '';
    return raw.length > 0;
  } catch {
    return false;
  }
}

export async function runEnvDiagnostics(): Promise<EnvDiagResult> {
  const url = resolveSupabaseUrl();
  const anon = resolveAnon();
  const ref = getProjectRef(url);
  const alwaysLogin = process.env.EXPO_PUBLIC_ALWAYS_LOGIN_ON_WEB === 'true';
  const storageOk = findStorageKey(ref);
  let sessionPresent = false;
  let sessionUserId: string | null = null;
  let sessionEmail: string | null = null;
  let toyCount: number | null = null;
  let toysAccessible: boolean | null = null;
  try {
    const { data } = await supabase.auth.getSession();
    sessionPresent = !!data.session;
    sessionUserId = (data.session?.user?.id as string | undefined) || null;
    sessionEmail = (data.session?.user?.email as string | undefined) || null;
  } catch {}
  try {
    const { error } = await supabase.from('toys').select('id').limit(1);
    toysAccessible = !error;
  } catch {
    toysAccessible = false;
  }
  try {
    const { count } = await supabase.from('toys').select('id', { count: 'exact', head: true });
    toyCount = typeof count === 'number' ? count : null;
  } catch {}
  const problems: string[] = [];
  if (!url) problems.push('缺少 EXPO_PUBLIC_SUPABASE_URL');
  if (!anon) problems.push('缺少 EXPO_PUBLIC_SUPABASE_ANON_KEY');
  if (alwaysLogin) problems.push('EXPO_PUBLIC_ALWAYS_LOGIN_ON_WEB 为 true');
  if (!storageOk) problems.push('未发现会话存储或项目标识不匹配');
  if (!sessionPresent) problems.push('无有效登录会话');
  if (sessionPresent && toysAccessible === false) problems.push('数据库访问失败或权限异常');
  if (sessionPresent && (toyCount === 0)) problems.push('当前账户没有任何玩具数据');
  return {
    supabaseUrl: url,
    anonKeyPresent: !!anon,
    alwaysLoginFlag: alwaysLogin,
    projectRef: ref,
    storageKeyFound: storageOk,
    sessionPresent,
    sessionUserId,
    sessionEmail,
    toyCount,
    toysAccessible,
    problems,
  };
}
