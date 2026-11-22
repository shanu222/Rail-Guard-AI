'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, HelpCircle, X } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { MiniMap } from '@/components/map-lazy';
import { AudioWithSpectrogram } from '@/components/spectrogram';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ErrorState,
  PageTitle,
  Skeleton,
  Textarea,
  severityTone,
  statusTone,
} from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CHAINAGE, dt, pct, pretty } from '@/lib/format';

type Decision = 'CONFIRMED' | 'REJECTED' | 'NEEDS_INFO';

export default function DetectionDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { can } = useAuth();
  const [note, setNote] = useState('');
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const img = useRef<HTMLImageElement>(null);

  const q = useQuery({
    queryKey: ['detection', id],
    queryFn: () => api<any>(`/v1/detections/${id}`),
  });
  const review = useMutation({
    mutationFn: (status: Decision) =>
      api(`/v1/detections/${id}/review`, {
        method: 'POST',
        body: { status, note: note || undefined },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['detection', id] });
      void qc.invalidateQueries({ queryKey: ['detections'] });
      void qc.invalidateQueries({ queryKey: ['overview'] });
    },
  });

  // keyboard shortcuts for fast review: C confirm, R reject, N needs info
  useEffect(() => {
    if (!can('detections:review')) return;
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.tagName === 'SELECT') return;
      const map: Record<string, Decision> = { c: 'CONFIRMED', r: 'REJECTED', n: 'NEEDS_INFO' };
      const d = map[e.key.toLowerCase()];
      if (d && !review.isPending) review.mutate(d);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [can, review]);

  if (q.isLoading)
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-80" />
      </div>
    );
  if (q.error)
    return (
      <Card>
        <ErrorState error={q.error} retry={() => void q.refetch()} />
      </Card>
    );
  const d = q.data;
  const bbox: number[] | null = d.bbox ?? null;

  return (
    <>
      <PageTitle
        title={pretty(d.defectClass)}
        sub={`${dt(d.detectedAt)} · ${d.deviceName}${d.isDemo ? ' · DEMO DATA' : ''}`}
        actions={
          <Button variant="ghost" size="sm" onClick={() => router.back()}>
            ← Back
          </Button>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="Evidence image" sub="Detector bounding box shown in orange" />
            {d.imageUrl ? (
              <div className="relative inline-block max-w-full bg-black">
                <img
                  ref={img}
                  src={d.imageUrl}
                  alt={`Detected ${pretty(d.defectClass)}`}
                  className="block max-h-[480px] w-auto max-w-full"
                  onLoad={(e) =>
                    setBox({ w: e.currentTarget.clientWidth, h: e.currentTarget.clientHeight })
                  }
                />
                {bbox && box && (
                  <div
                    className="pointer-events-none absolute rounded-sm border-2 border-accent"
                    style={{
                      left: bbox[0]! * box.w,
                      top: bbox[1]! * box.h,
                      width: bbox[2]! * box.w,
                      height: bbox[3]! * box.h,
                    }}
                    aria-label="Detection bounding box"
                  />
                )}
              </div>
            ) : (
              <p className="p-6 text-sm text-ink-soft">No image was uploaded for this detection.</p>
            )}
          </Card>
          {d.audioUrl && (
            <Card>
              <CardHeader title="Acoustic clip" />
              <div className="p-4">
                <AudioWithSpectrogram url={d.audioUrl} />
              </div>
            </Card>
          )}
          {d.evidenceUrls?.length > 0 && (
            <Card>
              <CardHeader title="Inspector field evidence" />
              <div className="flex flex-wrap gap-2 p-3">
                {d.evidenceUrls.map((u: string) => (
                  <img
                    key={u}
                    src={u}
                    alt="Field evidence"
                    className="h-32 rounded border border-line"
                  />
                ))}
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Details" />
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 p-4 text-sm">
              <dt className="text-ink-soft">Severity</dt>
              <dd>
                <Badge tone={severityTone(d.severity)}>{d.severity}</Badge>
              </dd>
              <dt className="text-ink-soft">Confidence</dt>
              <dd className="tabular-nums">{pct(d.confidence, 1)}</dd>
              <dt className="text-ink-soft">Fusion</dt>
              <dd>{d.fusionLevel === 'HIGH' ? 'High confidence' : 'Needs review'}</dd>
              <dt className="text-ink-soft">Sources</dt>
              <dd>{d.sources.map(pretty).join(', ')}</dd>
              <dt className="text-ink-soft">Location</dt>
              <dd>
                {d.sectionName ?? '—'} · {CHAINAGE(d.chainageM)}
              </dd>
              <dt className="text-ink-soft">Status</dt>
              <dd>
                <Badge tone={statusTone(d.reviewStatus)}>{d.reviewStatus}</Badge>
              </dd>
              {d.reviewedAt && (
                <>
                  <dt className="text-ink-soft">Reviewed</dt>
                  <dd>
                    {d.reviewer} · {dt(d.reviewedAt)}
                  </dd>
                </>
              )}
              {d.reviewNote && (
                <>
                  <dt className="text-ink-soft">Note</dt>
                  <dd>{d.reviewNote}</dd>
                </>
              )}
            </dl>
            {d.segmentId && (
              <p className="border-t border-line px-4 py-2 text-xs">
                <Link href="/risk-map" className="text-accent underline">
                  View on risk map
                </Link>
              </p>
            )}
          </Card>
          <Card className="overflow-hidden">
            <CardHeader title="Location" />
            <MiniMap lon={d.lon} lat={d.lat} className="h-52 w-full" />
          </Card>
          {can('detections:review') && (
            <Card>
              <CardHeader title="Review" sub="Shortcuts: C confirm · R reject · N needs info" />
              <div className="space-y-3 p-4">
                <Textarea
                  aria-label="Review note"
                  rows={2}
                  placeholder="Optional note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <div className="grid grid-cols-3 gap-2">
                  <Button
                    variant="teal"
                    disabled={review.isPending}
                    onClick={() => review.mutate('CONFIRMED')}
                  >
                    <Check className="h-4 w-4" /> Confirm
                  </Button>
                  <Button
                    variant="danger"
                    disabled={review.isPending}
                    onClick={() => review.mutate('REJECTED')}
                  >
                    <X className="h-4 w-4" /> Reject
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={review.isPending}
                    onClick={() => review.mutate('NEEDS_INFO')}
                  >
                    <HelpCircle className="h-4 w-4" /> Info
                  </Button>
                </div>
                {review.error && (
                  <p role="alert" className="text-sm text-risk-5">
                    {(review.error as Error).message}
                  </p>
                )}
                {review.isSuccess && (
                  <p role="status" className="text-sm text-teal-dark">
                    Saved.
                  </p>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
