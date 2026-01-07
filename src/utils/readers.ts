import { supabase } from '../supabaseClient';
import type { Reader } from '../types';

export const getSessionUserId = async (): Promise<string | null> => {
  try {
    const { data, error } = await supabase.auth.getUser()
    if (error) return null
    return data?.user?.id ?? null
  } catch {
    return null
  }
}

export async function createReader(payload: { name: string; location?: string | null; device_id: string; org_id?: string | null }): Promise<{ data?: Reader | null; error?: string | null }> {
  const uid = await getSessionUserId()
  if (!uid) return { data: null, error: 'No session user, please login' }

  const insertData: Partial<Reader> = {
    name: payload.name,
    location: payload.location ?? null,
    device_id: payload.device_id,
    user_id: uid,
  }
  if (payload.org_id) insertData.org_id = payload.org_id

  const { data, error } = await supabase
    .from('readers')
    .insert([insertData])
    .select()
    .single()

  return { data: data as Reader, error: error?.message ?? null }
}

export async function listReaders(): Promise<{ data: Reader[] | null; error: string | null }> {
  const { data, error } = await supabase
    .from('readers')
    .select('*')
    .order('last_seen_at', { ascending: false });
  return { data: data || [], error: error ? error.message : null };
}

export async function updateReader(device_id: string, patch: Partial<Reader>): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('readers')
    .update({
      name: patch.name ?? undefined,
      location: patch.location ?? undefined,
      is_online: patch.is_online ?? undefined,
      last_seen_at: patch.last_seen_at ?? undefined,
      config: patch.config ?? undefined,
    })
    .eq('device_id', device_id);
  return { error: error ? error.message : null };
}

export async function deleteReader(device_id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('readers').delete().eq('device_id', device_id);
  return { error: error ? error.message : null };
}

export function formatAgo(iso?: string | null): string {
  if (!iso) return '-';
  const dt = new Date(iso);
  const diff = Math.floor((Date.now() - dt.getTime()) / 60000);
  if (diff < -1) return 'future clock'; // Timestamp is in the future (>1m)
  if (diff < 1) return 'just now';
  if (diff < 60) return `${diff} min ago`;
  const h = Math.floor(diff / 60);
  return `${h} h ago`;
}