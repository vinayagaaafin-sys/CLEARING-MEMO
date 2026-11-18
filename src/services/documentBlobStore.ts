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

const memoryFallback = new Map<string, Blob>();

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

export async function saveDocumentBlob(
  docId: string,
  blob: Blob,
  fileName: string,
  mimeType: string
): Promise<void> {
  memoryFallback.set(docId, blob);
  const db = await openDocsDatabase();
  if (!db) return;

  try {
    const buffer = await blob.arrayBuffer();
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

export async function getDocumentBlob(docId: string): Promise<Blob | null> {
  const mem = memoryFallback.get(docId);
  if (mem) return mem;

  const db = await openDocsDatabase();
  if (!db) return null;

  try {
    return await new Promise<Blob | null>((resolve) => {
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
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export async function deleteDocumentBlob(docId: string): Promise<void> {
  memoryFallback.delete(docId);
  const db = await openDocsDatabase();
  if (!db) return;

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
