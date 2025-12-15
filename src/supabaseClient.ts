import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

// Prefer EXPO_PUBLIC_* (bundled to web), fall back to app config extra for native/web
const SUPABASE_URL_RAW = (process.env.EXPO_PUBLIC_SUPABASE_URL as string | undefined)
  || (Constants?.expoConfig?.extra as any)?.SUPABASE_URL
  || ((Constants as any)?.manifest?.extra)?.SUPABASE_URL;
const SUPABASE_ANON_KEY_RAW = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string | undefined)
  || (Constants?.expoConfig?.extra as any)?.SUPABASE_ANON_KEY
  || ((Constants as any)?.manifest?.extra)?.SUPABASE_ANON_KEY;
const hasEnv = !!(SUPABASE_URL_RAW && SUPABASE_ANON_KEY_RAW);
// 防止因环境变量缺失而在模块加载阶段抛错导致白屏：
// 若缺失，则使用占位地址创建客户端，以便应用能显示登录页和错误提示。
const SUPABASE_URL = (SUPABASE_URL_RAW || 'https://kjitkkeerytijbcgkqjj.supabase.co').trim();
const SUPABASE_ANON_KEY = (SUPABASE_ANON_KEY_RAW || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtqaXRra2Vlcnl0aWpiY2drcWpqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA1MzgxMjUsImV4cCI6MjA3NjExNDEyNX0.isMJIUbp7pDTxs3RBA1-paGVvQUl-TQS6t1GcwtD1Vc').trim();
if (!hasEnv && typeof window !== 'undefined') {
  try { console.error('[Supabase] Missing environment variables: EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY'); } catch {}
}

// 统一模式（满足你的要求）：
// - 首次在新标签页输入网址，进入登录页（因为每个标签页独立会话，未登录就不会有会话）。
// - 登录后刷新同一标签页，不会退出登录（启用持久化，并使用 sessionStorage 只在该标签页保存）。
// - 不再区分 8081/8082 端口，也不跨标签同步，避免标签之间相互影响。
// 显式启用 Web 本地存储适配器，并固定 storageKey，避免不同环境下 key 不一致导致刷新后无法恢复会话
let PROJECT_REF = '';
try {
  const host = new URL(SUPABASE_URL).hostname; // e.g. kjitkkeerytijbcgkqjj.supabase.co
  PROJECT_REF = (host.split('.')[0] || '').trim();
} catch {}
const STORAGE_KEY = `sb-${PROJECT_REF || 'local'}-auth-token`;

const webLocalStorageAdapter = typeof window !== 'undefined' ? {
  getItem: (key: string) => {
    try { return window.localStorage.getItem(key); } catch { return null; }
  },
  setItem: (key: string, value: string) => {
    try { window.localStorage.setItem(key, value); } catch {}
  },
  removeItem: (key: string) => {
    try { window.localStorage.removeItem(key); } catch {}
  },
} : undefined as any;

// Native 平台使用 SecureStore 持久化会话，避免登录后丢失
const nativeSecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // 刷新保持登录
    persistSession: true,
    autoRefreshToken: true,
    // 不从 URL 解析会话（我们不使用 magic link 回传）
    detectSessionInUrl: false,
    // 明确指定存储适配器与 Key（Web/Native）
    storage: Platform.OS === 'web' ? webLocalStorageAdapter : nativeSecureStoreAdapter,
    storageKey: STORAGE_KEY,
  },
});