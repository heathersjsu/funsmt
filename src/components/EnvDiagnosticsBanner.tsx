import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Banner, Button, Text, useTheme } from 'react-native-paper';
import { runEnvDiagnostics } from '../utils/envDiagnostics';
import { supabase } from '../supabaseClient';

export default function EnvDiagnosticsBanner() {
  const theme = useTheme();
  const [visible, setVisible] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    const res = await runEnvDiagnostics();
    const parts: string[] = [];
    const url = res.supabaseUrl || '未配置';
    const ref = res.projectRef || '未知';
    parts.push(`Supabase: ${url}`);
    parts.push(`Project: ${ref}`);
    parts.push(res.sessionPresent ? `User: ${res.sessionUserId || ''}` : '未登录');
    if (res.sessionEmail) parts.push(`Email: ${res.sessionEmail}`);
    if (typeof res.toyCount === 'number') parts.push(`Toys: ${res.toyCount}`);
    if (res.problems.length > 0) {
      parts.push(`问题: ${res.problems.join('；')}`);
      setMsg(parts.join(' | '));
      setVisible(true);
    } else {
      if (res.sessionPresent && (res.toyCount === 0)) {
        setMsg(parts.join(' | '));
        setVisible(true);
      } else {
        setVisible(false);
      }
    }
  };
  useEffect(() => {
    let mounted = true;
    refresh();
    const { data: sub } = supabase.auth.onAuthStateChange(() => { if (mounted) refresh(); });
    return () => { mounted = false; try { sub?.subscription?.unsubscribe(); } catch {} };
  }, []);
  const onLogout = async () => {
    setBusy(true);
    try {
      await supabase.auth.signOut();
      try {
        if (typeof window !== 'undefined') {
          Object.keys(window.localStorage || {}).forEach((k) => { if (k.startsWith('sb-')) window.localStorage.removeItem(k); });
        }
      } catch {}
      try { (globalThis as any).location?.assign('/?login'); } catch {}
    } finally {
      setBusy(false);
    }
  };
  if (!visible) return null;
  return (
    <View style={{ paddingHorizontal: 12, paddingTop: 8, backgroundColor: theme.colors.background }}>
      <Banner
        visible={visible}
        actions={[
          { label: 'Refresh', onPress: refresh, disabled: busy },
          { label: 'Logout', onPress: onLogout, disabled: busy },
        ]}
      >
        <Text>{msg}</Text>
      </Banner>
    </View>
  );
}
