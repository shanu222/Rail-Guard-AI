import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from './env';

export const QUEUE_NAME = 'railguard';

export type JobData =
  | { kind: 'risk'; divisionId: string; force?: boolean }
  | { kind: 'risk-all' }
  | { kind: 'device-watch' }
  | { kind: 'snapshot-purge' };

let queue: Queue<JobData> | null = null;
export function redisConnection() {
  return new Redis(env.REDIS_URL!, { maxRetriesPerRequest: null });
}

function getQueue() {
  if (!env.REDIS_URL) return null;
  return (queue ??= new Queue<JobData>(QUEUE_NAME, { connection: redisConnection() }));
}

/**
 * Enqueue a risk recalculation. The jobId de-duplicates bursts of ingestion: while a job for the
 * division is still waiting, further requests are no-ops. Without Redis (dev/tests) it runs inline.
 */
export async function enqueueRisk(
  divisionId: string,
  opts: { force?: boolean; delayMs?: number } = {},
) {
  const q = getQueue();
  if (!q) {
    const { recalculateDivision } = await import('./risk/run');
    setImmediate(
      () => void recalculateDivision(divisionId, { force: opts.force }).catch(() => undefined),
    );
    return;
  }
  await q.add(
    'risk',
    { kind: 'risk', divisionId, force: opts.force },
    {
      jobId: opts.force ? undefined : `risk-${divisionId}`,
      delay: opts.delayMs ?? 15_000,
      removeOnComplete: 50,
      removeOnFail: 200,
    },
  );
}

/** Repeatable jobs, registered by the worker on start. */
export async function registerSchedules() {
  const q = getQueue();
  if (!q) return;
  await q.upsertJobScheduler(
    'nightly-risk',
    { pattern: '0 2 * * *' },
    { name: 'risk-all', data: { kind: 'risk-all' } },
  );
  await q.upsertJobScheduler(
    'device-watch',
    { every: 60_000 },
    { name: 'device-watch', data: { kind: 'device-watch' } },
  );
  await q.upsertJobScheduler(
    'snapshot-purge',
    { pattern: '30 3 * * *' },
    { name: 'snapshot-purge', data: { kind: 'snapshot-purge' } },
  );
}
