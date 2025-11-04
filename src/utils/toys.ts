import { Alert, Platform } from 'react-native';
import { supabase } from '../supabaseClient';
import type { Toy } from '../types';
import { normalizeRfid } from './rfid';

export async function findOrCreateToy(tagId: string, navigation?: any): Promise<Toy | null> {
  const norm = normalizeRfid(tagId);
  // Find existing toy (by RFID tag)
  const { data, error } = await supabase
    .from('toys')
    .select('*')
    .eq('rfid', norm)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('findOrCreateToy query error:', error.message);
    return null;
  }

  if (data) {
    return data as Toy;
  }

  // Not found: prompt whether to register now
  const promptMessage = `No toy is associated with RFID tag (${norm}). Would you like to register it now?`;
  let shouldCreate = false;

  if (Platform.OS === 'web') {
    // Simple sync confirmation dialog
    // eslint-disable-next-line no-alert
    shouldCreate = window.confirm(promptMessage);
  } else {
    // Alert is async; wrap in Promise to get a boolean
    shouldCreate = await new Promise<boolean>((resolve) => {
      Alert.alert('Toy not registered', promptMessage, [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Register now', style: 'default', onPress: () => resolve(true) },
      ]);
    });
  }

  if (!shouldCreate) return null;

  // If navigation reference is provided, navigate to toy creation page and prefill tagId
  if (navigation && typeof navigation.navigate === 'function') {
    try {
      navigation.navigate('ToyForm', { rfid: norm });
    } catch (navErr) {
      console.warn('Navigation to ToyForm failed:', navErr);
    }
  }

  return null;
}

export async function findActiveSession(toyId: string) {
  // New model: when toys.status==='out', the latest scan_time is considered the current session start point
  const { data: toyRow, error: toyErr } = await supabase
    .from('toys')
    .select('status')
    .eq('id', toyId)
    .limit(1)
    .maybeSingle();
  if (toyErr) {
    console.error('findActiveSession toy query error:', toyErr.message);
    return null;
  }
  const isOut = (toyRow as any)?.status === 'out';
  if (!isOut) return null;

  const { data, error } = await supabase
    .from('play_sessions')
    .select('toy_id,scan_time')
    .eq('toy_id', toyId)
    .order('scan_time', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('findActiveSession error:', error.message);
    return null;
  }

  return data || null;
}

export function calculateDuration(start: string | Date, end: string | Date): number {
  const startMs = typeof start === 'string' ? new Date(start).getTime() : start.getTime();
  const endMs = typeof end === 'string' ? new Date(end).getTime() : end.getTime();

  if (isNaN(startMs) || isNaN(endMs)) return 0;
  const diffMs = Math.max(0, endMs - startMs);
  // In minutes, rounded down
  return Math.floor(diffMs / 60000);
}