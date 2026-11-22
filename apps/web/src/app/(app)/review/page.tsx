'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, set } from 'idb-keyval';
import { Camera, Check, CloudOff, HelpCircle, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  SkeletonRows,
  Textarea,
  severityTone,
} from '@/components/ui';
import { api } from '@/lib/api';
import { CHAINAGE, dt, pct, pretty } from '@/lib/format';
import { onQueueChange, pendingReviews, queueReview, submitReview, syncQueue } from '@/lib/offline';

interface Item {
  id: string;
  detectedAt: string;
  defectClass: string;
  severity: string;
  confidence: number;
  chainageM: number | null;
  sectionName: string | null;
  distanceM: number | null;
  lat: number;
  lon: number;
}
type Decision = 'CONFIRMED' | 'REJECTED' | 'NEEDS_INFO';
const CACHE = 'queue-cache';

/** Mobile-first swipeable queue. Works offline: the queue is cached and decisions are stored in IndexedDB until sync. */
export default function InspectorReview() {
  const qc = useQueryClient();
  const [online, setOnline] = useState(true);
  const [pos, setPos] = useState<{ lat: number; lon: number } | null>(null);
  const [queued, setQueued] = useState(0);
  const [items, setItems] = useState<Item[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [fromCache, setFromCache] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const refreshCount = useCallback(async () => setQueued((await pendingReviews()).length), []);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const r = await api<{ items: Item[] }>('/v1/detections/queue', {
        query: { lat: pos?.lat, lon: pos?.lon, limit: 30 },
      });
      setItems(r.items);
      setFromCache(false);
      void set(CACHE, r.items).catch(() => undefined);
    } catch (e) {
      const cached = await get<Item[]>(CACHE).catch(() => undefined);
      if (cached) {
        setItems(cached);
        setFromCache(true);
      } else setLoadError(e);
    }
  }, [pos]);

  const doSync = useCallback(async () => {
    const r = await syncQueue();
    if (r.sent) setSyncMsg(`Synced ${r.sent} review${r.sent > 1 ? 's' : ''}.`);
    void refreshCount();
    if (r.sent) {
      void qc.invalidateQueries({ queryKey: ['overview'] });
      void load();
    }
  }, [refreshCount, qc, load]);

  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => {
      setOnline(true);
      void doSync();
    };
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    const unsub = onQueueChange(() => void refreshCount());
    void refreshCount();
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      unsub();
    };
  }, [doSync, refreshCount]);

  useEffect(() => {
    navigator.geolocation?.getCurrentPosition(
      (p) => setPos({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => undefined,
      { timeout: 6000, maximumAge: 120000 },
    );
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void doSync();
  }, []);

  const remove = (id: string) =>
    setItems((l) => {
      const n = (l ?? []).filter((x) => x.id !== id);
      void set(CACHE, n).catch(() => undefined);
      return n;
    });

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Inspector review</h1>
          <p className="text-xs text-ink-soft">
            {pos ? 'Sorted by distance from you' : 'Newest severe first (location off)'} ·{' '}
            {items?.length ?? 0} waiting
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            void doSync();
            void load();
          }}
          aria-label="Refresh"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {!online && (
        <div
          role="status"
          className="mb-3 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          <CloudOff className="h-4 w-4" /> You are offline. Decisions are saved on this phone and
          sent automatically when the network returns.
        </div>
      )}
      {queued > 0 && (
        <div
          role="status"
          className="mb-3 flex items-center justify-between rounded-lg bg-navy px-3 py-2 text-sm text-white"
        >
          <span>
            {queued} decision{queued > 1 ? 's' : ''} waiting to sync
          </span>
          <Button size="sm" variant="primary" onClick={() => void doSync()} disabled={!online}>
            Sync now
          </Button>
        </div>
      )}
      {syncMsg && (
        <p role="status" className="mb-3 rounded-lg bg-teal/15 px-3 py-2 text-sm text-teal-dark">
          {syncMsg}
        </p>
      )}
      {fromCache && (
        <p className="mb-3 text-xs text-ink-soft">Showing the queue saved on this device.</p>
      )}

      {items === null && !loadError && (
        <Card>
          <SkeletonRows n={4} />
        </Card>
      )}
      {loadError != null && (
        <Card>
          <ErrorState error={loadError} retry={() => void load()} />
        </Card>
      )}
      {items && items.length === 0 && (
        <Card>
          <EmptyState title="All caught up" hint="No pending detections in your sections." />
        </Card>
      )}

      {items && items.length > 0 && (
        <div
          className="snap-x-cards -mx-4 flex gap-3 overflow-x-auto px-4 pb-4"
          aria-label="Detections to review. Swipe sideways to move between them."
        >
          {items.map((it) => (
            <ReviewCard
              key={it.id}
              item={it}
              online={online}
              onDone={() => {
                remove(it.id);
                void refreshCount();
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewCard({ item, online, onDone }: { item: Item; online: boolean; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<
    { blob: Blob; contentType: 'image/jpeg' | 'image/png'; url: string }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [bbox, setBbox] = useState<number[] | null>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const q = useQuery({
    queryKey: ['detection', item.id],
    queryFn: () => api<any>(`/v1/detections/${item.id}`),
    enabled: online,
    staleTime: 240_000,
  });
  useEffect(() => {
    if (q.data) {
      setImageUrl(q.data.imageUrl);
      setBbox(q.data.bbox ?? null);
    }
  }, [q.data]);

  async function decide(status: Decision) {
    setBusy(true);
    setErr(null);
    const payload = {
      detectionId: item.id,
      status,
      note: note || undefined,
      photos: photos.map(({ blob, contentType }) => ({ blob, contentType })),
    };
    try {
      if (!navigator.onLine) throw Object.assign(new Error('offline'), { offline: true });
      await submitReview(payload);
      onDone();
    } catch (e: any) {
      const network = e?.offline || !(typeof e?.status === 'number'); // fetch failure => no status
      if (network) {
        await queueReview(payload); // keep the decision + photos locally; synced automatically later
        onDone();
      } else setErr(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      className="w-[88%] shrink-0 sm:w-full"
      role="group"
      aria-label={`${pretty(item.defectClass)} detection`}
    >
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">{pretty(item.defectClass)}</h2>
            <p className="text-xs text-ink-soft">
              {item.sectionName ?? '—'} · chainage {CHAINAGE(item.chainageM)} ·{' '}
              {dt(item.detectedAt)}
            </p>
          </div>
          <Badge tone={severityTone(item.severity)}>{item.severity}</Badge>
        </div>
        <div className="mt-1 text-xs text-ink-soft">
          Confidence {pct(item.confidence, 0)}
          {item.distanceM != null &&
            ` · ${item.distanceM < 1000 ? Math.round(item.distanceM) + ' m' : (item.distanceM / 1000).toFixed(1) + ' km'} away`}
        </div>

        <div className="relative mt-3 flex min-h-32 items-center justify-center overflow-hidden rounded-lg bg-slate-100">
          {imageUrl ? (
            <div className="relative">
              <img
                src={imageUrl}
                alt={`Detected ${pretty(item.defectClass)}`}
                className="block max-h-64 w-auto max-w-full"
                onLoad={(e) =>
                  setBox({ w: e.currentTarget.clientWidth, h: e.currentTarget.clientHeight })
                }
              />
              {bbox && box && (
                <div
                  className="absolute rounded-sm border-2 border-accent"
                  style={{
                    left: bbox[0]! * box.w,
                    top: bbox[1]! * box.h,
                    width: bbox[2]! * box.w,
                    height: bbox[3]! * box.h,
                  }}
                />
              )}
            </div>
          ) : (
            <p className="px-3 py-6 text-center text-xs text-ink-soft">
              {online
                ? q.isLoading
                  ? 'Loading image…'
                  : 'No image for this detection'
                : 'Image unavailable offline'}
            </p>
          )}
        </div>

        <div className="mt-3 space-y-2">
          <Textarea
            aria-label="Note"
            rows={2}
            placeholder="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <input
            ref={file}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            aria-label="Add field photo"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f)
                setPhotos((p) =>
                  [
                    ...p,
                    {
                      blob: f,
                      contentType: (f.type === 'image/png' ? 'image/png' : 'image/jpeg') as
                        'image/png' | 'image/jpeg',
                      url: URL.createObjectURL(f),
                    },
                  ].slice(0, 4),
                );
              e.target.value = '';
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" onClick={() => file.current?.click()} className="min-h-12">
              <Camera className="h-5 w-5" /> Add photo
            </Button>
            {photos.map((p) => (
              <img
                key={p.url}
                src={p.url}
                alt="Field photo"
                className="h-12 w-12 rounded object-cover"
              />
            ))}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2">
          <Button size="lg" variant="teal" disabled={busy} onClick={() => void decide('CONFIRMED')}>
            <Check className="h-5 w-5" /> Confirm defect
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button
              size="lg"
              variant="danger"
              disabled={busy}
              onClick={() => void decide('REJECTED')}
            >
              <X className="h-5 w-5" /> Reject
            </Button>
            <Button
              size="lg"
              variant="ghost"
              disabled={busy}
              onClick={() => void decide('NEEDS_INFO')}
            >
              <HelpCircle className="h-5 w-5" /> Need info
            </Button>
          </div>
        </div>
        {err && (
          <p role="alert" className="mt-2 text-sm text-risk-5">
            {err}
          </p>
        )}
      </div>
    </Card>
  );
}
