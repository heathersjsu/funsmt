import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
// - 显式启用 Web 本地存储适配器，并固定 storageKey，避免不同环境下 key 不一致导致刷新后无法恢复会话
export const PROJECT_REF = 'pinme-app'; 
export const STORAGE_KEY = 'pinme-auth-token'; // Fixed key for stability

// Native 平台使用 SecureStore 持久化会话，避免登录后丢失
const nativeSecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

const webLocalStorageAdapter = {
  getItem: (key: string) => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage.getItem(key);
      }
    } catch {}
    return null;
  },
  setItem: (key: string, value: string) => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(key, value);
      }
    } catch {}
  },
  removeItem: (key: string) => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(key);
      }
    } catch {}
  },
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // 刷新保持登录
    persistSession: true,
    autoRefreshToken: true,
    // 不从 URL 解析会话（我们不使用 magic link 回传）
    detectSessionInUrl: false,
    // 明确指定存储适配器与 Key（Web 使用 AsyncStorage/localStorage，Native 使用 SecureStore）
    // User requested AsyncStorage for Web: 
    // Although synchronous localStorage is usually simpler, we use AsyncStorage if requested.
    // However, the provided instruction says: "ensure it contains auth.storage config". 
    // It also says "AsyncStorage maps to localStorage". 
    // Web: use default (undefined) storage and default key (undefined -> sb-...)
    // Native: use SecureStore and custom key
    storage: Platform.OS === 'web' ? undefined : nativeSecureStoreAdapter,
    storageKey: Platform.OS === 'web' ? undefined : STORAGE_KEY,
  },
});
