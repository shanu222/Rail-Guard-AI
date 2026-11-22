import { EventEmitter } from 'node:events';
import { Redis } from 'ioredis';
import { env } from '../env';

/**
 * Real-time event bus. Producers (API routes and the worker) call publish(); the API process
 * subscribes and forwards events to Socket.IO rooms. With Redis the worker and API are decoupled;
 * without it (tests, single process) events stay in-process.
 */
export type RgEvent =
  | { type: 'detection.severe'; divisionId: string; data: Record<string, unknown> }
  | { type: 'crossing.warning'; divisionId: string; data: Record<string, unknown> }
  | { type: 'device.offline'; divisionId: string; data: Record<string, unknown> }
  | { type: 'risk.updated'; divisionId: string; data: Record<string, unknown> };

const CHANNEL = 'rg:events';
const local = new EventEmitter();
let pub: Redis | null = null;

function redis() {
  if (!env.REDIS_URL) return null;
  return (pub ??= new Redis(env.REDIS_URL, { maxRetriesPerRequest: null }));
}

export async function publish(ev: RgEvent) {
  const r = redis();
  if (r) await r.publish(CHANNEL, JSON.stringify(ev));
  else local.emit('event', ev);
}

export function subscribe(handler: (ev: RgEvent) => void) {
  if (!env.REDIS_URL) {
    local.on('event', handler);
    return;
  }
  const sub = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  void sub.subscribe(CHANNEL);
  sub.on('message', (_c, msg) => handler(JSON.parse(msg) as RgEvent));
}
