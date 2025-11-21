import { supabase } from '../supabaseClient';
import { findOrCreateToy } from './toys';

// Generic handler for RFID events payloads
// Expects: { toy_id: uuid, tag_id: string, event_type/status/action: 'out'|'in', event_time/created_at }
export type RfidEventPayload = {
  toy_id?: string;
  tag_id?: string;
  event_type?: string;
  status?: string;
  action?: string;
  event_time?: string;
  created_at?: string;
  time?: string;
  [key: string]: any;
};

function parseEventType(ev: RfidEventPayload): 'out' | 'in' | undefined {
  const t = (ev.event_type || ev.status || ev.action || '').toLowerCase();
  if (t === 'out' || t === 'in') return t as 'out' | 'in';
  return undefined;
}

function parseEventTime(ev: RfidEventPayload): string {
  return (
    ev.event_time || ev.created_at || ev.time || new Date().toISOString()
  );
}

// Old start/end session functions removed; unified to use recordScan + toggleToyStatus

// Delete old start/end session functions, change to only scan recording and status toggle
// Old function call sites will not work, unified migration to recordScan + toggleToyStatus
export async function recordScan(toyId: string, scanTimeISO: string) {
  if (!toyId) return;
  await supabase
    .from('play_sessions')
    .insert({ toy_id: toyId, scan_time: scanTimeISO });
}

// Optional: toggle toys.status based on current status, ensure initial loading also reflects status
export async function setToyStatus(toyId: string, desiredStatus: 'in' | 'out') {
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user?.id) {
    throw new Error('Not logged in or session expired');
  }
  const { error: insertErr } = await supabase
    .from('play_sessions')
    .insert({ toy_id: toyId, scan_time: new Date().toISOString() });
  if (insertErr) throw insertErr;
  // Fallback: ensure status toggle (regardless of DB trigger/Realtime publishing)
  const { error: updErr } = await supabase
    .from('toys')
    .update({ status: desiredStatus })
    .eq('id', toyId);
  if (updErr) throw updErr;
}

export async function handleRfidEvent(ev: RfidEventPayload, navigation?: any) {
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user?.id) {
    // No session: ignore silently or route to login
    return;
  }
  let toyId = ev.toy_id as string | undefined;
  if (!toyId && ev.tag_id) {
    const toy = await findOrCreateToy(ev.tag_id, navigation);
    toyId = toy?.id;
  }
  const eventTime = parseEventTime(ev);
  if (!toyId) return;
  // Insert scan; database trigger is responsible for toggling toys.status
  await recordScan(toyId, eventTime);
  // Fallback: directly update toys.status based on event type, ensure visible status change
  const desired = parseEventType(ev);
  if (desired) {
    await supabase.from('toys').update({ status: desired }).eq('id', toyId);
  }
}