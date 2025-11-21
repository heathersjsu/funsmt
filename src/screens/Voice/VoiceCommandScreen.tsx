import React, { useEffect, useRef, useState } from 'react';
import { Platform, View, Text, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Button, Card, Snackbar, useTheme } from 'react-native-paper';
import Constants from 'expo-constants';

export default function VoiceCommandScreen() {
  const navigation = useNavigation<any>();
  const theme = useTheme();
  const [snackVisible, setSnackVisible] = useState(false);
  const [snackMsg, setSnackMsg] = useState('');
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  let webRecog: any = useRef(null).current;
  let nativeVoice: any = useRef(null).current;
  let transcriptCache = '';
  const showSnack = (msg: string) => { setSnackMsg(msg); setSnackVisible(true); };

  const supportsNativeVoice = Platform.OS !== 'web' && (Constants.appOwnership !== 'expo');

  const initWebRecognition = () => {
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setError('Browser does not support speech recognition'); return null; }
    const recog = new SR();
    recog.lang = (navigator.language || '').includes('zh') ? 'zh-CN' : 'en-US';
    recog.continuous = false;
    recog.interimResults = false;
    recog.onresult = (evt: any) => {
      const text = Array.from(evt.results).map((r: any) => r[0]?.transcript || '').join(' ').trim();
      transcriptCache = text;
    };
    recog.onerror = () => { setError('Speech recognition failed'); };
    return recog;
  };

  const ensureNativeVoice = async () => {
    if (!supportsNativeVoice) { setError('Expo Go does not support native voice module. Please use Expo Dev Client or a production build.'); return null; }
    if (nativeVoice) return nativeVoice;
    try {
      const mod: any = await import('@react-native-voice/voice');
      nativeVoice = mod?.default || mod;
      nativeVoice.onSpeechResults = (e: any) => { const text = (e?.value?.[0] || '').trim(); if (text) transcriptCache = text; };
      nativeVoice.onSpeechError = () => { setError('Speech recognition failed'); };
      return nativeVoice;
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
  };

  const startListening = async () => {
    setError(null);
    transcriptCache = '';
    setListening(true);
    if (Platform.OS === 'web') {
      webRecog = initWebRecognition();
      try { webRecog?.start?.(); } catch { setError('Unable to start speech recognition'); }
    } else {
      if (!supportsNativeVoice) { setError('Expo Go does not support speech recognition'); setListening(false); return; }
      const Voice = await ensureNativeVoice();
      if (!Voice) { setListening(false); return; }
      const lang = (navigator.language || '').includes('zh') ? 'zh-CN' : 'en-US';
      try { await Voice.start(lang); } catch { setError('Unable to start speech recognition'); }
    }
  };

  const stopListening = async () => {
    const hadText = !!transcriptCache;
    if (Platform.OS === 'web') {
      try { webRecog?.stop?.(); } catch {}
    } else {
      const Voice = await ensureNativeVoice();
      try { await Voice?.stop?.(); } catch {}
    }
    if (hadText) { executeCommand(transcriptCache); }
    transcriptCache = '';
    setListening(false);
  };

  useEffect(() => {
    if (Platform.OS !== 'web' && !supportsNativeVoice) {
      setError('Running in Expo Go; native speech recognition is unavailable');
    }
  }, []);

  return (
    <View style={{ padding: 16, backgroundColor: theme.colors.background }}>
      {Platform.OS !== 'web' && !supportsNativeVoice && (
        <Card style={{ marginBottom: 12 }}>
          <Card.Content>
            <Text style={{ color: theme.colors.error }}>
              Running in Expo Go; native speech recognition module is unavailable. Please use Expo Dev Client or a production build to test.
            </Text>
          </Card.Content>
        </Card>
      )}

      <Card>
        <Card.Content>
          <Text style={{ marginBottom: 8 }}>Hold the button below to speak; release to execute the command.</Text>
          {!!error && <Text style={{ color: theme.colors.error, marginBottom: 8 }}>{error}</Text>}
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <TouchableOpacity
              onPressIn={startListening}
              onPressOut={stopListening}
              style={{ backgroundColor: listening ? theme.colors.error : theme.colors.primary, paddingVertical: 12, paddingHorizontal: 20, borderRadius: 8 }}
            >
              <Text style={{ color: theme.colors.onPrimary, fontWeight: '600' }}>{listening ? 'Listening...' : 'Hold to talk'}</Text>
            </TouchableOpacity>
          </View>
        </Card.Content>
      </Card>
      <Snackbar visible={snackVisible} onDismiss={() => setSnackVisible(false)} duration={1600}>
        <Text>{snackMsg}</Text>
      </Snackbar>
    </View>
  );
}