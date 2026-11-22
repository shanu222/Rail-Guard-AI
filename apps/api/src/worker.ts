import { Worker } from 'bullmq';
import { env } from './env';
import { deviceWatch, riskAll, snapshotPurge } from './jobs';
import { QUEUE_NAME, redisConnection, registerSchedules, type JobData } from './queue';
import { recalculateDivision } from './risk/run';

if (!env.REDIS_URL) throw new Error('REDIS_URL is required to run the worker');

const worker = new Worker<JobData>(
  QUEUE_NAME,
  async (job) => {
    switch (job.data.kind) {
      case 'risk':
        return recalculateDivision(job.data.divisionId, { force: job.data.force });
      case 'risk-all':
        return riskAll();
      case 'device-watch':
        return deviceWatch();
      case 'snapshot-purge':
        return snapshotPurge();
    }
  },
  { connection: redisConnection(), concurrency: 2 },
);

worker.on('failed', (job, err) => console.error(`job ${job?.name} failed:`, err.message));
await registerSchedules();
console.log('RAILGUARD worker started');
