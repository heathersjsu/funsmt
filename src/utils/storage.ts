import { supabase } from '../supabaseClient';
import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';

const BUCKET = 'toy-photos';

// Guard against indefinite network stalls
async function withTimeout<T>(promise: Promise<T>, ms: number, msg = 'Upload timed out'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(msg)), ms);
    promise.then((val) => { clearTimeout(timer); resolve(val); }).catch((err) => { clearTimeout(timer); reject(err); });
  });
}

async function ensureBucket(): Promise<void> {
  const { data: buckets } = await withTimeout(supabase.storage.listBuckets(), 8000, 'List buckets timed out');
  const exists = (buckets || []).some((b) => b.name === BUCKET);
  if (!exists) {
    try {
      await withTimeout(supabase.storage.createBucket(BUCKET, { public: true, fileSizeLimit: 10 * 1024 * 1024 }), 8000, 'Create bucket timed out');
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
    base64 = await withTimeout(FileSystem.readAsStringAsync(localUri, { encoding: 'base64' as any }), 12000, 'Read image timed out');
  } catch (e) {
    // Fallback: copy to cache and retry (helps with content:// URIs on Android and iOS ph://)
    try {
      const cacheDir: string = (FileSystem as any).cacheDirectory || (FileSystem as any).temporaryDirectory || (FileSystem as any).documentDirectory || '';
      const cachePath = `${cacheDir}${filename}`;
      await withTimeout(FileSystem.copyAsync({ from: localUri, to: cachePath }), 8000, 'Copy image timed out');
      base64 = await withTimeout(FileSystem.readAsStringAsync(cachePath, { encoding: 'base64' as any }), 12000, 'Read image (cache) timed out');
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

// Prefer ArrayBuffer for React Native: supabase-js accepts ArrayBuffer and this avoids Blob constructor limitations
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  try {
    const binaryStr = typeof atob === 'function' ? atob(base64) : (global as any).atob(base64);
    const len = binaryStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binaryStr.charCodeAt(i);
    return bytes.buffer;
  } catch (e) {
    try {
      const BufferCtor = (global as any).Buffer || undefined;
      if (!BufferCtor) throw e;
      const buf = BufferCtor.from(base64, 'base64');
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    } catch (e2) {
      throw new Error(`Failed to convert base64 to ArrayBuffer: ${String((e2 as any)?.message || e2)}`);
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
      base64 = await withTimeout(FileSystem.readAsStringAsync(localUri, { encoding: 'base64' as any }), 12000, 'Read image timed out');
    } catch (e) {
      // Fallback: copy to cache and retry (helps with content:// URIs on Android and iOS ph://)
      const cacheDir: string = (FileSystem as any).cacheDirectory || (FileSystem as any).temporaryDirectory || (FileSystem as any).documentDirectory || '';
      const cachePath = `${cacheDir}${Date.now()}.${ext}`;
      await withTimeout(FileSystem.copyAsync({ from: localUri, to: cachePath }), 8000, 'Copy image timed out');
      base64 = await withTimeout(FileSystem.readAsStringAsync(cachePath, { encoding: 'base64' as any }), 12000, 'Read image (cache) timed out');
    }
    if (!base64) throw new Error('Failed to read image as base64');
    // Use ArrayBuffer instead of Blob to avoid RN Blob constructor limitations
    const ab = base64ToArrayBuffer(base64);

    const { data: signed, error: signErr } = await withTimeout(supabase.storage.from(BUCKET).createSignedUploadUrl(path), 10000);
    if (signErr) throw signErr;
    const token = (signed as any)?.token as string;
    const { error: upErr } = await withTimeout(supabase.storage.from(BUCKET).uploadToSignedUrl(path, token, ab, { contentType }), 10000);
    if (upErr) {
      // Fallback: on RN devices where ArrayBuffer path still fails, PUT the signed URL via FileSystem.uploadAsync
      if (Platform.OS !== 'web') {
        try {
          // Ensure we have a usable signed URL
          const signedUrl: string | undefined = (signed as any)?.signedUrl || (signed as any)?.signedURL;
          if (!signedUrl) throw upErr;
          const cacheDir: string = (FileSystem as any).cacheDirectory || (FileSystem as any).temporaryDirectory || (FileSystem as any).documentDirectory || '';
          const tmpPath = `${cacheDir}${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
          // Write base64 to temp file
          await FileSystem.writeAsStringAsync(tmpPath, base64!, { encoding: 'base64' as any });
          const res = await FileSystem.uploadAsync(signedUrl, tmpPath, {
            httpMethod: 'PUT',
            headers: { 'Content-Type': contentType },
          });
          if (res.status >= 200 && res.status < 300) {
            try { await FileSystem.deleteAsync(tmpPath, { idempotent: true }); } catch {}
          } else {
            try { await FileSystem.deleteAsync(tmpPath, { idempotent: true }); } catch {}
            throw new Error(`PUT upload failed with status ${res.status}`);
          }
        } catch (putErr: any) {
          throw putErr;
        }
      } else {
        throw upErr;
      }
    }
    const { data: pub } = await supabase.storage.from(BUCKET).getPublicUrl(path);
    return pub.publicUrl;
  } catch (e: any) {
    // 改为客户端直传：不再回退到 Edge Function，直接抛错以便上层处理与重试压缩
    throw new Error(`uploadToyPhotoDirect failed: ${e?.message || e}`);
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
    const { error: upErr } = await withTimeout(supabase.storage.from(BUCKET).uploadToSignedUrl(path, token, blob, { contentType: blob.type }), 10000);
    if (upErr) throw upErr;
    const { data: pub } = await supabase.storage.from(BUCKET).getPublicUrl(path);
    return pub.publicUrl;
  } catch (e: any) {
    // 改为客户端直传：不再回退到 Edge Function
    throw new Error(`uploadToyPhotoWebDirect failed: ${e?.message || e}`);
  }
}

export async function uploadBase64PhotoDirect(base64: string, userId: string, contentType: string = 'image/jpeg', filename?: string): Promise<string> {
  await ensureBucket();
  const ext = contentType.includes('png') ? 'png' : 'jpg';
  const custom = filename || `${Date.now()}.${ext}`;
  const path = `${userId}/${custom}`;
  try {
    const ab = base64ToArrayBuffer(base64);
    const { data: signed, error: signErr } = await withTimeout(supabase.storage.from(BUCKET).createSignedUploadUrl(path), 10000);
    if (signErr) throw signErr;
    const token = (signed as any)?.token as string;
    const { error: upErr } = await withTimeout(supabase.storage.from(BUCKET).uploadToSignedUrl(path, token, ab, { contentType }), 10000);
    if (upErr) {
      // RN fallback: PUT to signed URL via FileSystem.uploadAsync
      if (Platform.OS !== 'web') {
        try {
          const signedUrl: string | undefined = (signed as any)?.signedUrl || (signed as any)?.signedURL;
          if (!signedUrl) throw upErr;
          const ext = contentType.includes('png') ? 'png' : 'jpg';
          const cacheDir: string = (FileSystem as any).cacheDirectory || (FileSystem as any).temporaryDirectory || (FileSystem as any).documentDirectory || '';
          const tmpPath = `${cacheDir}${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
          await FileSystem.writeAsStringAsync(tmpPath, base64, { encoding: 'base64' as any });
          const res = await FileSystem.uploadAsync(signedUrl, tmpPath, {
            httpMethod: 'PUT',
            headers: { 'Content-Type': contentType },
          });
          if (res.status >= 200 && res.status < 300) {
            try { await FileSystem.deleteAsync(tmpPath, { idempotent: true }); } catch {}
          } else {
            try { await FileSystem.deleteAsync(tmpPath, { idempotent: true }); } catch {}
            throw new Error(`PUT upload failed with status ${res.status}`);
          }
        } catch (putErr: any) {
          throw putErr;
        }
      } else {
        throw upErr;
      }
    }
    const { data: pub } = await supabase.storage.from(BUCKET).getPublicUrl(path);
    return pub.publicUrl;
  } catch (e: any) {
    // 改为客户端直传：不再回退到 Edge Function
    throw new Error(`uploadBase64PhotoDirect failed: ${e?.message || e}`);
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
  // 改为只走直传：不再回退到 Edge Function
  return uploadBase64PhotoDirect(base64, userId, contentType, name);
}

export async function uploadToyPhotoBestEffort(localUri: string, userId: string): Promise<string> {
  await ensureBucket();
  const isPng = localUri.toLowerCase().endsWith('.png');
  const ext = isPng ? 'png' : 'jpg';
  const name = `${Date.now()}.${ext}`;
  // 改为只走直传：不再回退到 Edge Function
  return uploadToyPhotoDirect(localUri, userId, name);
}

export async function uploadToyPhotoWebBestEffort(blob: Blob, userId: string): Promise<string> {
  await ensureBucket();
  const ext = blob.type.includes('png') ? 'png' : 'jpg';
  const name = `${Date.now()}.${ext}`;
  // 改为只使用直传 Supabase Storage
  return uploadToyPhotoWebDirect(blob, userId, name);
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