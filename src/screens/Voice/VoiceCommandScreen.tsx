import React, { useEffect, useRef, useState } from 'react';
import { Platform, View, Text, TouchableOpacity, ScrollView, PermissionsAndroid } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Button, Card, Snackbar, useTheme } from 'react-native-paper';
import Constants from 'expo-constants';

export default function VoiceCommandScreen() {
  const navigation = useNavigation<any>();
  const theme = useTheme();
  const headerFont = Platform.select({ ios: 'Arial Rounded MT Bold', android: 'sans-serif-medium', default: 'System' });
  const [snackVisible, setSnackVisible] = useState(false);
  const [snackMsg, setSnackMsg] = useState('');
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const webRecogRef = useRef<any>(null);
  const nativeVoiceRef = useRef<any>(null);
  const transcriptRef = useRef<string>('');
  const pendingErrorRef = useRef<string | null>(null);
  const showSnack = (msg: string) => { setSnackMsg(msg); setSnackVisible(true); };

  const supportsNativeVoice = Platform.OS !== 'web' && (Constants.appOwnership !== 'expo');
  const getLang = (): string => {
    try {
      if (Platform.OS === 'web') {
        // eslint-disable-next-line no-restricted-globals
        return ((navigator as any)?.language || 'en-US');
      }
      try {
        const Localization = require('expo-localization');
        const locale = Localization?.locale || Localization?.locales?.[0] || 'en-US';
        return typeof locale === 'string' ? locale : 'en-US';
      } catch {
        return 'en-US';
      }
    } catch {
      return 'en-US';
    }
  };

  const ensureMicPermission = async (): Promise<boolean> => {
    try {
      if (Platform.OS === 'web') {
        // eslint-disable-next-line no-restricted-globals
        const md = (navigator as any)?.mediaDevices;
        if (md?.getUserMedia) {
          try { await md.getUserMedia({ audio: true }); } catch { return false; }
        }
        return true;
      }
      if (Platform.OS === 'android') {
        const perm = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
        const has = await PermissionsAndroid.check(perm);
        if (has) return true;
        const res = await PermissionsAndroid.request(perm);
        return res === PermissionsAndroid.RESULTS.GRANTED;
      }
      return true;
    } catch {
      return false;
    }
  };

  const initWebRecognition = () => {
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setError('Browser does not support speech recognition'); return null; }
    const recog = new SR();
    recog.lang = (navigator.language || '').includes('zh') ? 'zh-CN' : 'en-US';
    recog.continuous = false;
    recog.interimResults = false;
    recog.onresult = (evt: any) => {
      const text = Array.from(evt.results).map((r: any) => r[0]?.transcript || '').join(' ').trim();
      transcriptRef.current = text;
    };
    recog.onerror = (evt: any) => {
      try {
        const err = (evt?.error || '').toString();
        if (err === 'aborted') { return; }
        const msg =
          (err === 'no-speech' || err === 'no-match') ? 'No speech detected' :
          (err === 'not-allowed' || err === 'service-not-allowed') ? 'Microphone permission denied' :
          (err === 'audio-capture') ? 'Microphone not available' :
          'Speech recognition failed';
        if (listening) { pendingErrorRef.current = msg; return; }
        showSnack(msg);
      } catch {
        if (listening) { pendingErrorRef.current = 'Speech recognition failed'; return; }
        showSnack('Speech recognition failed');
      }
    };
    return recog;
  };

  const ensureNativeVoice = async () => {
    if (!supportsNativeVoice) { setError('Expo Go does not support native voice module. Please use Expo Dev Client or a production build.'); return null; }
    if (nativeVoiceRef.current) return nativeVoiceRef.current;
    try {
      const mod: any = await import('@react-native-voice/voice');
      nativeVoiceRef.current = mod?.default || mod;
      nativeVoiceRef.current.onSpeechResults = (e: any) => { const text = (e?.value?.[0] || '').trim(); if (text) transcriptRef.current = text; };
      nativeVoiceRef.current.onSpeechError = (e: any) => {
        try {
          const code = e?.error?.code ?? e?.error?.message ?? e?.error;
          const cstr = String(code ?? '').toLowerCase();
          if (cstr.includes('cancel') || cstr.includes('aborted')) { return; }
          const msg =
            (cstr.includes('no match') || cstr === '7' || cstr.includes('no-speech')) ? 'No speech detected' :
            (cstr.includes('permission') || cstr === '5') ? 'Microphone permission denied' :
            (cstr.includes('audio') || cstr === '9') ? 'Microphone not available' :
            'Speech recognition failed';
          if (listening) { pendingErrorRef.current = msg; return; }
          showSnack(msg);
        } catch {
          if (listening) { pendingErrorRef.current = 'Speech recognition failed'; return; }
          showSnack('Speech recognition failed');
        }
      };
      nativeVoiceRef.current.onSpeechPartialResults = (e: any) => {
        const text = (e?.value?.[0] || '').trim();
        if (text) transcriptRef.current = text;
      };
      return nativeVoiceRef.current;
    } catch (e) {
      setError('Unable to load native voice module');
      return null;
    }
  };

  const executeCommand = (text: string) => {
    const t = (text || '').trim();
    if (!t) return;
    const enMatch = t.match(/add\s+toy\s*(?:named|name|called)?\s*["'“”]?([^"'“”]+)?/i) || t.match(/create\s+toy\s*["'“”]?([^"'“”]+)?/i);
    const zhMatch = t.match(/(?:add|create|new)\s+toy\s*(?:named|name|called)?\s*["'""]?([^"'""]+)?/);
    const name = (enMatch?.[1] || zhMatch?.[1] || '').trim();
    if (/add\s+toy/i.test(t) || /(?:add|create|new)\s+toy/.test(t)) {
      navigation.navigate('Toys', { screen: 'ToyForm', params: { name } });
      return;
    }
    if (/open\s+devices/i.test(t) || /open\s+device/.test(t)) { navigation.navigate('Devices'); return; }
    if (/open\s+toys/i.test(t) || /open\s+toy/.test(t)) { navigation.navigate('Toys'); return; }
    if (/open\s+reminders?/i.test(t) || /打开提醒/.test(t)) { navigation.navigate('Me', { screen: 'ReminderStatusAlias' }); return; }
    if (/(add|create|new)\s+device/i.test(t)) { navigation.navigate('Devices', { screen: 'AddDeviceUI' }); return; }
  };

  const startListening = async () => {
    setError(null);
    transcriptRef.current = '';
    const permitted = await ensureMicPermission();
    if (!permitted) {
      showSnack('Microphone permission denied');
      return;
    }
    if (Platform.OS === 'web') {
      webRecogRef.current = initWebRecognition();
      try {
        webRecogRef.current?.start?.();
        setListening(true);
        showSnack('Listening...');
      } catch {
        showSnack('Speech recognition failed');
      }
    } else {
      if (!supportsNativeVoice) { showSnack('Expo Go does not support speech recognition'); return; }
      const Voice = await ensureNativeVoice();
      if (!Voice) { return; }
      const lang = (() => { try { const l = getLang(); return String(l).toLowerCase().includes('zh') ? 'zh-CN' : 'en-US'; } catch { return 'en-US'; } })();
      try {
        await Voice.start(lang);
        setListening(true);
        showSnack('Listening...');
      } catch {
        showSnack('Speech recognition failed');
      }
    }
  };

  const stopListening = async () => {
    const hadText = !!transcriptRef.current;
    if (Platform.OS === 'web') {
      try { webRecogRef.current?.stop?.(); } catch {}
    } else {
      const Voice = await ensureNativeVoice();
      try { await Voice?.stop?.(); } catch {}
    }
    if (hadText) {
      showSnack(`Heard: "${transcriptRef.current}"`);
      executeCommand(transcriptRef.current);
    } else {
      const msg = pendingErrorRef.current || 'No speech detected';
      showSnack(msg);
    }
    pendingErrorRef.current = null;
    transcriptRef.current = '';
    setListening(false);
  };

  useEffect(() => {
    if (Platform.OS !== 'web' && !supportsNativeVoice) {
      setError('Running in Expo Go; native speech recognition is unavailable');
    }
  }, []);
  useEffect(() => {
    if (snackVisible && snackMsg !== 'Listening...') {
      const t = setTimeout(() => setSnackVisible(false), 2000);
      return () => clearTimeout(t);
    }
    return;
  }, [snackVisible, snackMsg]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={[
        { padding: 16 },
        Platform.OS === 'web' && { width: '100%', maxWidth: 1000, alignSelf: 'center', paddingHorizontal: 32 }
      ]}
    >
      {Platform.OS !== 'web' && !supportsNativeVoice && (
        <Card style={{ marginBottom: 12 }}>
          <Card.Content>
            <Text style={{ color: theme.colors.error, fontFamily: headerFont }}>
              Running in Expo Go; native speech recognition module is unavailable. Please use Expo Dev Client or a production build to test.
            </Text>
          </Card.Content>
        </Card>
      )}

      <Card>
        <Card.Content>
          <Text style={{ marginBottom: 8, fontFamily: headerFont }}>Hold the button below to speak; release to execute the command.</Text>
          {!!error && <Text style={{ color: theme.colors.error, marginBottom: 8, fontFamily: headerFont }}>{error}</Text>}
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <TouchableOpacity
              onPressIn={startListening}
              onPressOut={stopListening}
              style={{ backgroundColor: listening ? theme.colors.error : theme.colors.primary, paddingVertical: 12, paddingHorizontal: 20, borderRadius: 8 }}
            >
              <Text style={{ color: theme.colors.onPrimary, fontWeight: '600', fontFamily: headerFont }}>{listening ? 'Listening...' : 'Hold to talk'}</Text>
            </TouchableOpacity>
          </View>
        </Card.Content>
      </Card>
      <Snackbar visible={snackVisible} onDismiss={() => setSnackVisible(false)} duration={snackMsg === 'Listening...' ? 600000 : 2000} style={{ backgroundColor: theme.colors.secondaryContainer, alignSelf: 'center' }} wrapperStyle={{ position: 'absolute', top: '45%', left: 0, right: 0 }}>
        <Text style={{ fontFamily: headerFont, color: theme.colors.onSecondaryContainer, textAlign: 'center' }}>{snackMsg}</Text>
      </Snackbar>
    </ScrollView>
  );
}
