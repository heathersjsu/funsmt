import fs from 'node:fs';
import path from 'node:path';

function loadLocalEnv() {
  const envPath = path.resolve(__dirname, '.env.local');
  const result: Record<string, string> = {};
  try {
    const text = fs.readFileSync(envPath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
      if (m) result[m[1]] = m[2];
    }
  } catch {}
  return result;
}

export default ({ config }: { config: any }) => {
  const local = loadLocalEnv();
  const SUPABASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || local.EXPO_PUBLIC_SUPABASE_URL || local.SUPABASE_URL || '').trim();
  const SUPABASE_ANON_KEY = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || local.EXPO_PUBLIC_SUPABASE_ANON_KEY || local.SUPABASE_ANON_KEY || '').trim();
  const SITE_URL = (process.env.EXPO_PUBLIC_SITE_URL || process.env.SITE_URL || local.EXPO_PUBLIC_SITE_URL || local.SITE_URL || '').trim();
  return {
    ...config,
    android: {
      ...(config.android || {}),
      permissions: Array.from(new Set([...(config.android?.permissions || []), 'RECORD_AUDIO'])),
    },
    ios: {
      ...(config.ios || {}),
      infoPlist: {
        ...(config.ios?.infoPlist || {}),
        NSMicrophoneUsageDescription: (config.ios?.infoPlist?.NSMicrophoneUsageDescription || 'Voice commands need microphone access'),
      },
    },
    extra: {
      ...(config.extra || {}),
      SUPABASE_URL,
      SUPABASE_ANON_KEY,
      SITE_URL,
    },
  };
};
