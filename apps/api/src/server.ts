import { Server } from 'socket.io';
import { buildApp } from './app';
import { env } from './env';
import { prisma } from './db';
import { deviceWatch, snapshotPurge } from './jobs';
import { subscribe } from './lib/events';
import type { JwtUser } from './lib/auth-plugin';

const app = await buildApp();
await app.ready();

// ---- real-time: SEVERE detections, crossing warnings, devices going offline ----
const io = new Server(app.server, {
  cors: { origin: env.CORS_ORIGIN.split(',').map((s) => s.trim()), credentials: true },
  path: '/socket.io',
});
io.use((socket, next) => {
  try {
    const token = (socket.handshake.auth as { token?: string }).token;
    const user = app.jwt.verify<JwtUser>(token ?? '');
    socket.data.user = user;
    next();
  } catch {
    next(new Error('unauthorized'));
  }
});
io.on('connection', (socket) => {
  const u = socket.data.user as JwtUser;
  void socket.join(u.div ? `div:${u.div}` : 'all');
});
subscribe((ev) => {
  io.to(`div:${ev.divisionId}`).to('all').emit(ev.type, ev.data);
});

// Without Redis there is no worker process, so run the periodic jobs in-process (dev only).
if (!env.REDIS_URL) {
  setInterval(() => void deviceWatch().catch(() => undefined), 60_000).unref();
  setInterval(() => void snapshotPurge().catch(() => undefined), 6 * 3_600_000).unref();
}

await app.listen({ port: env.PORT, host: '0.0.0.0' });
app.log.info(`RAILGUARD API ready${env.DEMO_MODE ? ' (DEMO_MODE)' : ''} - docs at /docs`);

const shutdown = async () => {
  io.close();
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
