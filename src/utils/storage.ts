import { supabase } from '../supabaseClient';
import * as FileSystem from 'expo-file-system';

const BUCKET = 'toy-photos';

async function ensureBucket(): Promise<void> {
  const { data: buckets } = await supabase.storage.listBuckets();
  const exists = (buckets || []).some((b) => b.name === BUCKET);
  if (!exists) {
    try {
      await supabase.storage.createBucket(BUCKET, { public: true, fileSizeLimit: 10 * 1024 * 1024 });
    } catch {
      // Ignore: creating buckets requires service role; we ensure via migration.
    }
  }
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = globalThis.atob ? globalThis.atob(base64) : Buffer.from(base64, 'base64').toString('binary');
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
}

export async function uploadToyPhoto(localUri: string, userId: string): Promise<string> {
  await ensureBucket();
  const ext = localUri.toLowerCase().endsWith('.png') ? 'png' : 'jpg';
  const path = `${userId}/${Date.now()}.${ext}`;

  // Try reading as base64 then convert
  const base64 = await FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });
  const bytes = base64ToUint8Array(base64);
  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
    contentType: ext === 'png' ? 'image/png' : 'image/jpeg',
    upsert: true,
  });
  if (error) throw error;

  const { data } = await supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export { BUCKET };