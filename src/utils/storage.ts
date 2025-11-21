import { supabase } from '../supabaseClient';
import * as FileSystem from 'expo-file-system';

const BUCKET = 'toy-photos';

// Guard against indefinite network stalls
async function withTimeout<T>(promise: Promise<T>, ms: number, msg = 'Upload timed out'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(msg)), ms);
    promise.then((val) => { clearTimeout(timer); resolve(val); }).catch((err) => { clearTimeout(timer); reject(err); });
  });
}

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

export async function uploadToyPhoto(localUri: string, userId: string, filenameOverride?: string): Promise<string> {
  await ensureBucket();
  const isPng = localUri.toLowerCase().endsWith('.png');
  const ext = isPng ? 'png' : 'jpg';
  const filename = filenameOverride || `${Date.now()}.${ext}`;
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

  const { data, error } = await withTimeout(supabase.functions.invoke('upload-toy-photo', {
    headers: { 'Content-Type': 'application/json' },
    body: { filename, base64, dataUrl, contentType, userId },
  }), 20000);
  if (error) throw error;
  return (data as any)?.publicUrl;
}

export async function uploadBase64Photo(base64: string, userId: string, contentType: string = 'image/jpeg', filename?: string): Promise<string> {
  await ensureBucket();
  const ext = contentType.includes('png') ? 'png' : 'jpg';
  const name = filename || `${Date.now()}.${ext}`;
  const dataUrl = `data:${contentType};base64,${base64}`;
  const { data, error } = await withTimeout(supabase.functions.invoke('upload-toy-photo', {
    headers: { 'Content-Type': 'application/json' },
    body: { filename: name, base64, dataUrl, contentType, userId },
  }), 20000);
  if (error) throw error;
  return (data as any)?.publicUrl;
}

export async function uploadToyPhotoWeb(blob: Blob, userId: string, filenameOverride?: string): Promise<string> {
  await ensureBucket();
  const ext = blob.type.includes('png') ? 'png' : 'jpg';
  const filename = filenameOverride || `${Date.now()}.${ext}`;
  const contentType = blob.type || (ext === 'png' ? 'image/png' : 'image/jpeg');

  const ab = await blob.arrayBuffer();
  const bytes = new Uint8Array(ab);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const base64 = btoa(binary);

  const { data, error } = await withTimeout(supabase.functions.invoke('upload-toy-photo', {
    headers: { 'Content-Type': 'application/json' },
    body: { filename, base64, contentType, dataUrl: `data:${contentType};base64,${base64}`, userId },
  }), 20000);
  if (error) throw error;
  return (data as any)?.publicUrl;
}

export { BUCKET };

// --- Direct upload path using Supabase Storage v2 ---
// Prefer these where session + RLS allow direct signed uploads; fallback to Edge Function on failure.

function makeFilename(userId: string, ext: string): { path: string; filename: string } {
  const filename = `${Date.now()}.${ext}`;
  // keep a per-user folder for easy cleanup
  const path = `${userId}/${filename}`;
  return { path, filename };
}

function base64ToBlob(base64: string, contentType: string): Blob {
  // Try browser atob first
  try {
    const binaryStr = typeof atob === 'function' ? atob(base64) : (global as any).atob(base64);
    const len = binaryStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binaryStr.charCodeAt(i);
    return new Blob([bytes], { type: contentType });
  } catch (e) {
    // React Native may not have atob; try Buffer if available
    try {
      const BufferCtor = (global as any).Buffer || undefined;
      if (!BufferCtor) throw e;
      const buf = BufferCtor.from(base64, 'base64');
      return new Blob([buf], { type: contentType });
    } catch (e2) {
      throw new Error(`Failed to convert base64 to Blob: ${String((e2 as any)?.message || e2)}`);
    }
  }
}

export async function uploadToyPhotoDirect(localUri: string, userId: string, filenameOverride?: string): Promise<string> {
  await ensureBucket();
  const isPng = localUri.toLowerCase().endsWith('.png');
  const ext = isPng ? 'png' : 'jpg';
  const contentType = isPng ? 'image/png' : 'image/jpeg';
  const { path } = filenameOverride ? { path: `${userId}/${filenameOverride}` } : makeFilename(userId, ext);

  try {
    let base64: string | undefined;
    try {
      base64 = await FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });
    } catch (e) {
      // Fallback: copy to cache and retry (helps with content:// URIs on Android and iOS ph://)
      const cachePath = `${FileSystem.cacheDirectory}${Date.now()}.${ext}`;
      await FileSystem.copyAsync({ from: localUri, to: cachePath });
      base64 = await FileSystem.readAsStringAsync(cachePath, { encoding: FileSystem.EncodingType.Base64 });
    }
    if (!base64) throw new Error('Failed to read image as base64');
    const blob = base64ToBlob(base64, contentType);

    const { data: signed, error: signErr } = await withTimeout(supabase.storage.from(BUCKET).createSignedUploadUrl(path), 10000);
    if (signErr) throw signErr;
    const token = (signed as any)?.token as string;
    const { error: upErr } = await withTimeout(supabase.storage.from(BUCKET).uploadToSignedUrl(path, token, blob), 10000);
    if (upErr) throw upErr;
    const { data: pub } = await supabase.storage.from(BUCKET).getPublicUrl(path);
    return pub.publicUrl;
  } catch (e: any) {
    console.warn('uploadToyPhotoDirect failed, falling back:', e?.message || e);
    return uploadToyPhoto(localUri, userId, filenameOverride);
  }
}

export async function uploadToyPhotoWebDirect(blob: Blob, userId: string, filenameOverride?: string): Promise<string> {
  await ensureBucket();
  const ext = blob.type.includes('png') ? 'png' : 'jpg';
  const { path } = filenameOverride ? { path: `${userId}/${filenameOverride}` } : makeFilename(userId, ext);
  try {
    const { data: signed, error: signErr } = await withTimeout(supabase.storage.from(BUCKET).createSignedUploadUrl(path), 10000);
    if (signErr) throw signErr;
    const token = (signed as any)?.token as string;
    const { error: upErr } = await withTimeout(supabase.storage.from(BUCKET).uploadToSignedUrl(path, token, blob), 10000);
    if (upErr) throw upErr;
    const { data: pub } = await supabase.storage.from(BUCKET).getPublicUrl(path);
    return pub.publicUrl;
  } catch (e: any) {
    console.warn('uploadToyPhotoWebDirect failed, falling back:', e?.message || e);
    return uploadToyPhotoWeb(blob, userId, filenameOverride);
  }
}

export async function uploadBase64PhotoDirect(base64: string, userId: string, contentType: string = 'image/jpeg', filename?: string): Promise<string> {
  await ensureBucket();
  const ext = contentType.includes('png') ? 'png' : 'jpg';
  const custom = filename || `${Date.now()}.${ext}`;
  const path = `${userId}/${custom}`;
  try {
    const blob = base64ToBlob(base64, contentType);
    const { data: signed, error: signErr } = await withTimeout(supabase.storage.from(BUCKET).createSignedUploadUrl(path), 10000);
    if (signErr) throw signErr;
    const token = (signed as any)?.token as string;
    const { error: upErr } = await withTimeout(supabase.storage.from(BUCKET).uploadToSignedUrl(path, token, blob), 10000);
    if (upErr) throw upErr;
    const { data: pub } = await supabase.storage.from(BUCKET).getPublicUrl(path);
    return pub.publicUrl;
  } catch (e: any) {
    console.warn('uploadBase64PhotoDirect failed, falling back:', e?.message || e);
    return uploadBase64Photo(base64, userId, contentType, filename);
  }
}

// --- Best-effort concurrent uploads: start Edge Function and Direct signed upload simultaneously ---

function firstSuccessful<T>(promises: Array<Promise<T>>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let rejectedCount = 0;
    const total = promises.length;
    const maybeReject = (err: any) => {
      rejectedCount += 1;
      if (rejectedCount === total) reject(err);
    };
    promises.forEach((p) => {
      p.then((val) => resolve(val)).catch((err) => maybeReject(err));
    });
  });
}

export async function uploadBase64PhotoBestEffort(base64: string, userId: string, contentType: string = 'image/jpeg', filename?: string): Promise<string> {
  await ensureBucket();
  const ext = contentType.includes('png') ? 'png' : 'jpg';
  const name = filename || `${Date.now()}.${ext}`;
  // Hedged request: start Direct first, then Edge Function after a short delay to avoid doubling bandwidth on poor networks
  return hedgedFirstSuccessful<string>(
    () => uploadBase64PhotoDirect(base64, userId, contentType, name),
    () => uploadBase64Photo(base64, userId, contentType, name),
    1500,
  );
}

export async function uploadToyPhotoBestEffort(localUri: string, userId: string): Promise<string> {
  await ensureBucket();
  const isPng = localUri.toLowerCase().endsWith('.png');
  const ext = isPng ? 'png' : 'jpg';
  const name = `${Date.now()}.${ext}`;
  return hedgedFirstSuccessful<string>(
    () => uploadToyPhotoDirect(localUri, userId, name),
    () => uploadToyPhoto(localUri, userId, name),
    1500,
  );
}

export async function uploadToyPhotoWebBestEffort(blob: Blob, userId: string): Promise<string> {
  await ensureBucket();
  const ext = blob.type.includes('png') ? 'png' : 'jpg';
  const name = `${Date.now()}.${ext}`;
  return hedgedFirstSuccessful<string>(
    () => uploadToyPhotoWebDirect(blob, userId, name),
    () => uploadToyPhotoWeb(blob, userId, name),
    1500,
  );
}

// Hedged concurrency helper: start the first path, and if it doesn't settle quickly, start the second path.
// This reduces bandwidth spikes on poor networks compared to fully parallel racing, while still improving tail latency.
function hedgedFirstSuccessful<T>(first: () => Promise<T>, second: () => Promise<T>, hedgeDelayMs = 1500): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let rejects = 0;
    const tryResolve = (val: T) => { if (!settled) { settled = true; resolve(val); } };
    const tryReject = (err: any) => { rejects += 1; if (!settled && rejects >= 2) { settled = true; reject(err); } };
    // kick off the first path immediately
    first().then(tryResolve).catch(tryReject);
    // start the second path after a small hedge delay
    const timer = setTimeout(() => {
      if (settled) return; // already done
      second().then(tryResolve).catch(tryReject);
    }, hedgeDelayMs);
    // If already settled before timer fires, clear it to avoid unnecessary work
    const clearIfSettled = () => { if (settled) clearTimeout(timer); };
    // crude: check periodically; avoids adding cancellation tokens
    const poll = setInterval(() => { clearIfSettled(); if (settled) clearInterval(poll); }, 200);
  });
}