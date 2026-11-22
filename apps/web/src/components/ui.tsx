'use client';
import clsx from 'clsx';
import { AlertTriangle, Inbox, X } from 'lucide-react';
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { RISK_COLORS, RISK_LABELS } from '@railguard/shared';

export const cn = clsx;

const BTN = {
  primary: 'bg-accent text-white hover:bg-accent-dark',
  teal: 'bg-teal text-white hover:bg-teal-dark',
  navy: 'bg-navy text-white hover:bg-navy-700',
  ghost: 'bg-white text-ink border border-line hover:bg-slate-50',
  danger: 'bg-risk-5 text-white hover:opacity-90',
} as const;

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof BTN;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <button
      {...p}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
        BTN[variant],
        size === 'sm'
          ? 'px-2.5 py-1.5 text-xs'
          : size === 'lg'
            ? 'min-h-14 px-5 py-3 text-base'
            : 'px-3.5 py-2 text-sm',
        className,
      )}
    />
  );
}

export const Card = ({
  className,
  children,
  ...p
}: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) => (
  <div {...p} className={cn('rounded-xl border border-line bg-white shadow-sm', className)}>
    {children}
  </div>
);
export const CardHeader = ({
  title,
  action,
  sub,
}: {
  title: ReactNode;
  action?: ReactNode;
  sub?: ReactNode;
}) => (
  <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
    <div>
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {sub && <p className="mt-0.5 text-xs text-ink-soft">{sub}</p>}
    </div>
    {action}
  </div>
);

export const PageTitle = ({
  title,
  sub,
  actions,
}: {
  title: string;
  sub?: string;
  actions?: ReactNode;
}) => (
  <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
    <div>
      <h1 className="text-xl font-semibold text-ink">{title}</h1>
      {sub && <p className="text-sm text-ink-soft">{sub}</p>}
    </div>
    <div className="flex flex-wrap gap-2">{actions}</div>
  </div>
);

export const Skeleton = ({ className }: { className?: string }) => (
  <div className={cn('skeleton', className)} aria-hidden />
);
export const SkeletonRows = ({ n = 5 }: { n?: number }) => (
  <div className="space-y-2 p-4" role="status" aria-label="Loading">
    {Array.from({ length: n }, (_, i) => (
      <Skeleton key={i} className="h-9 w-full" />
    ))}
  </div>
);

export const EmptyState = ({ title, hint }: { title: string; hint?: string }) => (
  <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
    <Inbox className="h-8 w-8 text-slate-400" aria-hidden />
    <p className="text-sm font-medium text-ink">{title}</p>
    {hint && <p className="max-w-sm text-xs text-ink-soft">{hint}</p>}
  </div>
);

export const ErrorState = ({ error, retry }: { error: unknown; retry?: () => void }) => (
  <div role="alert" className="flex flex-col items-center gap-2 px-4 py-8 text-center">
    <AlertTriangle className="h-7 w-7 text-accent" aria-hidden />
    <p className="text-sm font-medium">Something went wrong</p>
    <p className="max-w-md text-xs text-ink-soft">
      {error instanceof Error ? error.message : 'Unknown error'}
    </p>
    {retry && (
      <Button variant="ghost" size="sm" onClick={retry}>
        Try again
      </Button>
    )}
  </div>
);

/** Shows skeleton / error / empty / content for a react-query result. */
export function Async<T>({
  q,
  empty,
  children,
  rows,
}: {
  q: { isLoading: boolean; error: unknown; data: T | undefined; refetch: () => unknown };
  empty?: (d: T) => boolean;
  children: (d: T) => ReactNode;
  rows?: number;
}) {
  if (q.isLoading) return <SkeletonRows n={rows} />;
  if (q.error) return <ErrorState error={q.error} retry={() => void q.refetch()} />;
  if (q.data === undefined || (empty && empty(q.data)))
    return (
      <EmptyState
        title="Nothing here yet"
        hint="Data will appear once devices report or you adjust the filters."
      />
    );
  return <>{children(q.data)}</>;
}

export const inputCls =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-slate-400 focus:border-accent';
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => (
  <input {...p} className={cn(inputCls, p.className)} />
);
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea {...p} className={cn(inputCls, p.className)} />
);
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select {...p} className={cn(inputCls, 'pe-8', p.className)} />
);
export const Field = ({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) => (
  <label className="block text-sm">
    <span className="mb-1 block text-xs font-medium text-ink-soft">{label}</span>
    {children}
    {hint && <span className="mt-1 block text-xs text-ink-soft">{hint}</span>}
  </label>
);

const TONES = {
  slate: 'bg-slate-100 text-slate-700',
  teal: 'bg-teal/15 text-teal-dark',
  accent: 'bg-accent/15 text-accent-dark',
  red: 'bg-risk-5/15 text-risk-5',
  amber: 'bg-risk-3/20 text-amber-800',
  navy: 'bg-navy text-white',
} as const;
export const Badge = ({
  tone = 'slate',
  children,
  className,
}: {
  tone?: keyof typeof TONES;
  children: ReactNode;
  className?: string;
}) => (
  <span
    className={cn(
      'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
      TONES[tone],
      className,
    )}
  >
    {children}
  </span>
);

export const severityTone = (s: string) =>
  s === 'SEVERE' ? 'red' : s === 'MODERATE' ? 'amber' : 'slate';
export const statusTone = (s: string) =>
  (s === 'CONFIRMED' || s === 'ONLINE' || s === 'DONE' || s === 'ACTIVE'
    ? 'teal'
    : s === 'REJECTED' || s === 'OFFLINE' || s === 'CANCELLED'
      ? 'red'
      : s === 'PENDING' || s === 'DEGRADED' || s === 'NEEDS_INFO' || s === 'OPEN'
        ? 'amber'
        : 'slate') as keyof typeof TONES;

/** Risk score chip. Always shows the number AND a text label (never colour alone). */
export function RiskChip({ score }: { score: number | null | undefined }) {
  if (!score) return <Badge>Not scored</Badge>;
  const s = score as 1 | 2 | 3 | 4 | 5;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-2 py-0.5 text-xs font-medium">
      <span
        className="h-2.5 w-2.5 rounded-full"
        style={{ background: RISK_COLORS[s] }}
        aria-hidden
      />
      {s} · {RISK_LABELS[s]}
    </span>
  );
}

export const Disclaimer = () => (
  <p className="text-xs font-medium text-ink-soft">Decision aid — confirm on site</p>
);

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-navy/60 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div className="max-h-[92vh] w-full overflow-auto rounded-t-2xl bg-white shadow-xl sm:max-w-lg sm:rounded-2xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-line bg-white px-4 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export const Stat = ({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'accent' | 'teal';
}) => (
  <Card className="p-4">
    <p className="text-xs font-medium text-ink-soft">{label}</p>
    <p
      className={cn(
        'mt-1 text-2xl font-semibold tabular-nums',
        tone === 'accent' && 'text-accent',
        tone === 'teal' && 'text-teal-dark',
      )}
    >
      {value}
    </p>
    {sub && <p className="mt-0.5 text-xs text-ink-soft">{sub}</p>}
  </Card>
);

export const Table = ({ children }: { children: ReactNode }) => (
  <div className="overflow-x-auto">
    <table className="w-full min-w-[640px] text-sm">{children}</table>
  </div>
);
export const Th = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <th
    className={cn(
      'border-b border-line bg-slate-50 px-3 py-2 text-start text-xs font-semibold text-ink-soft',
      className,
    )}
  >
    {children}
  </th>
);
export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <td className={cn('border-b border-line px-3 py-2 align-middle', className)}>{children}</td>
);
