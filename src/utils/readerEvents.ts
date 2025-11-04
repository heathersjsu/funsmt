import { supabase } from '../supabaseClient';

export type ReaderEvent = {
  id: string;
  reader_id?: string | null;
  device_id: string;
  user_id?: string | null;
  event_type: string;
  payload?: any;
  created_at: string;
};

export async function listReaderEvents(device_id: string, limit = 50): Promise<{ data: ReaderEvent[]; error: string | null }> {
  const { data, error } = await supabase
    .from('reader_events')
    .select('*')
    .eq('device_id', device_id)
    .order('created_at', { ascending: false })
    .limit(limit);
  return { data: (data as ReaderEvent[]) || [], error: error ? error.message : null };
}

export function subscribeReaderEvents(onEvent: (evt: ReaderEvent) => void) {
  const ch = supabase
    .channel('reader-events')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'reader_events' }, (payload: any) => {
      const evt = (payload.new || payload.old) as ReaderEvent;
      if (evt?.device_id) onEvent(evt);
    })
    .subscribe();
  return () => supabase.removeChannel(ch);
}

export async function insertReaderEvent(evt: Partial<ReaderEvent> & { device_id: string; event_type: string }): Promise<{ error: string | null }> {
  const { data: userRes } = await supabase.auth.getUser();
  const uid = userRes?.user?.id || null;
  const payload = { ...evt, user_id: uid };
  const { error } = await supabase.from('reader_events').insert(payload);
  return { error: error ? error.message : null };
}