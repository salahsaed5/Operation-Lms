import { AttendanceRecordItem, OfflineSyncState } from '../types/database';

export interface OfflineAttendanceDraft {
  lectureId: string;
  campId: string;
  instructorId: string;
  idempotencyKey: string;
  syncState: OfflineSyncState;
  records: AttendanceRecordItem[];
  updatedAt: string;
}

const DB_NAME = 'cits_camp_offline_db';
const DB_VERSION = 1;
const STORE_NAME = 'attendance_drafts';

function openDraftDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this environment'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'lectureId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveOfflineAttendanceDraft(
  draft: OfflineAttendanceDraft
): Promise<void> {
  try {
    const db = await openDraftDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(draft);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Fallback to localStorage if IndexedDB is blocked in private frame
    localStorage.setItem(`cits_draft_${draft.lectureId}`, JSON.stringify(draft));
  }
}

export async function getOfflineAttendanceDraft(
  lectureId: string
): Promise<OfflineAttendanceDraft | null> {
  try {
    const db = await openDraftDatabase();
    const result = await new Promise<OfflineAttendanceDraft | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(lectureId);
      req.onsuccess = () => resolve((req.result as OfflineAttendanceDraft) || null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return result;
  } catch {
    const raw = localStorage.getItem(`cits_draft_${lectureId}`);
    return raw ? (JSON.parse(raw) as OfflineAttendanceDraft) : null;
  }
}

export async function deleteOfflineAttendanceDraft(lectureId: string): Promise<void> {
  try {
    const db = await openDraftDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(lectureId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    localStorage.removeItem(`cits_draft_${lectureId}`);
  }
}
