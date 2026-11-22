import { del, get, keys, set } from 'idb-keyval';
import { api, putToPresigned } from './api';

/**
 * Offline review queue (IndexedDB). An inspector's decision - plus any field photos - is stored
 * locally when the network is down and replayed in order once it is back.
 */
export interface QueuedReview {
  qid: string;
  detectionId: string;
  status: 'CONFIRMED' | 'REJECTED' | 'NEEDS_INFO';
  note?: string;
  photos: { blob: Blob; contentType: 'image/jpeg' | 'image/png' }[];
  queuedAt: number;
}
const PREFIX = 'review:';
const listeners = new Set<() => void>();
export const onQueueChange = (fn: () => void) => (
  listeners.add(fn),
  () => void listeners.delete(fn)
);
const notify = () => listeners.forEach((f) => f());

export async function queueReview(r: Omit<QueuedReview, 'qid' | 'queuedAt'>) {
  const item: QueuedReview = { ...r, qid: crypto.randomUUID(), queuedAt: Date.now() };
  await set(PREFIX + item.qid, item);
  notify();
  return item;
}

export async function pendingReviews(): Promise<QueuedReview[]> {
  const ks = (await keys()).filter((k) => String(k).startsWith(PREFIX));
  const items = await Promise.all(ks.map((k) => get<QueuedReview>(k)));
  return items.filter((i): i is QueuedReview => !!i).sort((a, b) => a.queuedAt - b.queuedAt);
}

/** Send one review (uploading photos first). Throws on failure so the caller can keep it queued. */
export async function submitReview(
  r: Pick<QueuedReview, 'detectionId' | 'status' | 'note' | 'photos'>,
) {
  const evidenceKeys: string[] = [];
  for (const p of r.photos) {
    const { key, url } = await api<{ key: string; url: string }>(
      `/v1/detections/${r.detectionId}/evidence-url`,
      { method: 'POST', body: { contentType: p.contentType } },
    );
    await putToPresigned(url, p.blob, p.contentType);
    evidenceKeys.push(key);
  }
  await api(`/v1/detections/${r.detectionId}/review`, {
    method: 'POST',
    body: { status: r.status, note: r.note, evidenceKeys },
  });
}

let syncing = false;
/** Replay queued reviews. A 4xx (e.g. already reviewed / not found) drops the item; network errors keep it. */
export async function syncQueue(): Promise<{ sent: number; left: number }> {
  if (syncing) return { sent: 0, left: (await pendingReviews()).length };
  syncing = true;
  let sent = 0;
  try {
    for (const item of await pendingReviews()) {
      try {
        await submitReview(item);
        await del(PREFIX + item.qid);
        sent++;
      } catch (e: any) {
        if (
          typeof e?.status === 'number' &&
          e.status >= 400 &&
          e.status < 500 &&
          e.status !== 401 &&
          e.status !== 408 &&
          e.status !== 429
        )
          await del(PREFIX + item.qid);
        else break; // offline or server trouble: stop and retry later, preserving order
      }
    }
  } finally {
    syncing = false;
    notify();
  }
  return { sent, left: (await pendingReviews()).length };
}
