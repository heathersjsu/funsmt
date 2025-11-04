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

export async function uploadToyPhoto(localUri: string, userId: string): Promise<string> {
  await ensureBucket();
  const isPng = localUri.toLowerCase().endsWith('.png');
  const ext = isPng ? 'png' : 'jpg';
  const filename = `${Date.now()}.${ext}`;
  const contentType = isPng ? 'image/png' : 'image/jpeg';

  let base64: string | undefined;
  try {
    base64 = await FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });
  } catch (e) {
    // Fallback: copy to cache and retry (helps with content:// URIs on Android and iOS ph://)
    try {
      const cachePath = `${FileSystem.cacheDirectory}${filename}`;
      await FileSystem.copyAsync({ from: localUri, to: cachePath });
      base64 = await FileSystem.readAsStringAsync(cachePath, { encoding: FileSystem.EncodingType.Base64 });
    } catch (e2) {
      throw new Error(`Failed to read image as base64: ${String((e2 as any)?.message || e2)}`);
    }
  }
  if (!base64) throw new Error('Failed to read image as base64');
  const dataUrl = `data:${contentType};base64,${base64}`;

  const { data, error } = await supabase.functions.invoke('upload-toy-photo', {
    headers: { 'Content-Type': 'application/json' },
    body: { filename, base64, dataUrl, contentType, userId },
  });
  if (error) throw error;
  return (data as any)?.publicUrl;
}

export async function uploadBase64Photo(base64: string, userId: string, contentType: string = 'image/jpeg', filename?: string): Promise<string> {
  await ensureBucket();
  const ext = contentType.includes('png') ? 'png' : 'jpg';
  const name = filename || `${Date.now()}.${ext}`;
  const dataUrl = `data:${contentType};base64,${base64}`;
  const { data, error } = await supabase.functions.invoke('upload-toy-photo', {
    headers: { 'Content-Type': 'application/json' },
    body: { filename: name, base64, dataUrl, contentType, userId },
  });
  if (error) throw error;
  return (data as any)?.publicUrl;
}

export async function uploadToyPhotoWeb(blob: Blob, userId: string): Promise<string> {
  await ensureBucket();
  const ext = blob.type.includes('png') ? 'png' : 'jpg';
  const filename = `${Date.now()}.${ext}`;
  const contentType = blob.type || (ext === 'png' ? 'image/png' : 'image/jpeg');

  const ab = await blob.arrayBuffer();
  const bytes = new Uint8Array(ab);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const base64 = btoa(binary);

  const { data, error } = await supabase.functions.invoke('upload-toy-photo', {
    headers: { 'Content-Type': 'application/json' },
    body: { filename, base64, contentType, dataUrl: `data:${contentType};base64,${base64}`, userId },
  });
  if (error) throw error;
  return (data as any)?.publicUrl;
}

export { BUCKET };