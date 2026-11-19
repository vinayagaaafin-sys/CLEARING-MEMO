import { isSupabaseConfigured, supabase } from './supabaseClient';

const DB_NAME = 'clearledger_customer_docs_v1';
const DB_VERSION = 1;
const STORE_NAME = 'document_blobs';

interface StoredBlobRecord {
  id: string;
  fileName: string;
  mimeType: string;
  data: ArrayBuffer;
  savedAt: string;
}

interface SupabaseBlobRow {
  id: string;
  file_name: string;
  mime_type: string;
  data_base64: string;
  file_size: number;
  saved_at: string;
}

const memoryFallback = new Map<string, Blob>();

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    parts.push(String.fromCharCode(...slice));
  }
  return btoa(parts.join(''));
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType || 'application/octet-stream' });
}

function openDocsDatabase(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function cacheBlobLocally(
  docId: string,
  buffer: ArrayBuffer,
  fileName: string,
  mimeType: string
): Promise<void> {
  const db = await openDocsDatabase();
  if (!db) return;

  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const record: StoredBlobRecord = {
        id: docId,
        fileName,
        mimeType,
        data: buffer,
        savedAt: new Date().toISOString(),
      };
      store.put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Fallback already cached in memory
  } finally {
    db.close();
  }
}

export async function saveDocumentBlob(
  docId: string,
  blob: Blob,
  fileName: string,
  mimeType: string
): Promise<void> {
  memoryFallback.set(docId, blob);
  const buffer = await blob.arrayBuffer();
  await cacheBlobLocally(docId, buffer, fileName, mimeType);

  if (supabase && isSupabaseConfigured) {
    try {
      const dataBase64 = arrayBufferToBase64(buffer);
      const { error } = await supabase.from('treasury_document_blobs').upsert(
        {
          id: docId,
          file_name: fileName,
          mime_type: mimeType || 'application/octet-stream',
          data_base64: dataBase64,
          file_size: buffer.byteLength,
          saved_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      );
      if (error) {
        console.warn('[ClearLedger] Document blob Supabase sync error:', error.message);
      }
    } catch (err) {
      console.warn('[ClearLedger] Document blob Supabase upload error:', err);
    }
  }
}

export async function getDocumentBlob(docId: string): Promise<Blob | null> {
  const mem = memoryFallback.get(docId);
  if (mem) return mem;

  const db = await openDocsDatabase();
  if (db) {
    try {
      const localBlob = await new Promise<Blob | null>((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(docId);
        req.onsuccess = () => {
          const rec = req.result as StoredBlobRecord | undefined;
          if (!rec || !rec.data) {
            resolve(null);
            return;
          }
          const blob = new Blob([rec.data], {
            type: rec.mimeType || 'application/octet-stream',
          });
          memoryFallback.set(docId, blob);
          resolve(blob);
        };
        req.onerror = () => resolve(null);
      });
      if (localBlob) return localBlob;
    } catch {
      // Continue to Supabase fallback
    } finally {
      db.close();
    }
  }

  if (supabase && isSupabaseConfigured) {
    try {
      const { data, error } = await supabase
        .from('treasury_document_blobs')
        .select('*')
        .eq('id', docId)
        .maybeSingle();

      if (!error && data) {
        const row = data as SupabaseBlobRow;
        const remoteBlob = base64ToBlob(row.data_base64, row.mime_type);
        memoryFallback.set(docId, remoteBlob);
        const buffer = await remoteBlob.arrayBuffer();
        await cacheBlobLocally(docId, buffer, row.file_name, row.mime_type);
        return remoteBlob;
      }
    } catch {
      // Ignore network fetch failures
    }
  }

  return null;
}

export async function deleteDocumentBlob(docId: string): Promise<void> {
  memoryFallback.delete(docId);
  const db = await openDocsDatabase();
  if (db) {
    try {
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(docId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch {
      // Ignore cleanup failures
    } finally {
      db.close();
    }
  }

  if (supabase && isSupabaseConfigured) {
    try {
      await supabase.from('treasury_document_blobs').delete().eq('id', docId);
    } catch {
      // Ignore cleanup failures
    }
  }
}

export async function downloadDocumentBlob(
  docId: string,
  fileName: string
): Promise<boolean> {
  const blob = await getDocumentBlob(docId);
  if (!blob) return false;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  return true;
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
