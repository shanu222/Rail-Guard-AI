import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { ZodError } from 'zod';
import { env, isProd } from './env';
import { prisma } from './db';
import { HttpError, authPlugin } from './lib/auth-plugin';
import { adminRoutes } from './routes/admin';
import { analyticsRoutes } from './routes/analytics';
import { authRoutes } from './routes/auth';
import { crossingRoutes } from './routes/crossings';
import { detectionRoutes } from './routes/detections';
import { deviceRoutes } from './routes/devices';
import { ingestRoutes } from './routes/ingest';
import { mapRoutes } from './routes/map';
import { overviewRoutes } from './routes/overview';
import { workOrderRoutes } from './routes/workorders';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: isProd ? 'info' : 'debug',
      // never log secrets, tokens or cookies
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-api-key"]',
        'res.headers["set-cookie"]',
      ],
    },
    trustProxy: true, // behind Cloudflare / Railway proxy
    bodyLimit: 1024 * 1024,
  });

  // HTTPS only in production
  if (isProd) {
    app.addHook('onRequest', async (req, reply) => {
      if (req.headers['x-forwarded-proto'] === 'http' && req.url !== '/health') {
        return reply.redirect(`https://${req.headers.host}${req.url}`, 308);
      }
    });
  }

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: env.CORS_ORIGIN.split(',').map((s) => s.trim()), // strict: only the web app origin(s)
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });
  await app.register(cookie);
  await app.register(jwt, { secret: env.JWT_ACCESS_SECRET });
  await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute' });
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'RAILGUARD AI API',
        version: '0.1.0',
        description: 'Dashboard + edge-device ingestion API. Resilience Technologies Labs.',
      },
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          deviceKey: { type: 'apiKey', in: 'header', name: 'x-api-key' },
        },
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  authPlugin(app);

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    if (err instanceof ZodError)
      return reply.code(400).send({
        error: 'VALIDATION',
        message: 'Invalid input',
        issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    if (err instanceof HttpError)
      return reply.code(err.statusCode).send({ error: err.message, message: err.message });
    if (err.code === 'P2002')
      return reply.code(409).send({ error: 'Conflict', message: 'Already exists' });
    if (err.code === 'P2025')
      return reply.code(404).send({ error: 'Not found', message: 'Not found' });
    if (err.statusCode && err.statusCode < 500)
      return reply.code(err.statusCode).send({ error: err.code ?? 'Error', message: err.message });
    req.log.error({ err: err.message }, 'unhandled error'); // message only: never dump request bodies
    return reply.code(500).send({ error: 'Internal', message: 'Internal server error', debug: String(err.message).slice(0, 300) }); // TEMP-DEBUG
  });

  app.get('/health', { schema: { hide: true } }, async (_req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { ok: true, demoMode: env.DEMO_MODE };
    } catch {
      return reply.code(503).send({ ok: false });
    }
  });
  app.get(
    '/v1/config',
    { schema: { tags: ['meta'], summary: 'Public runtime flags' } },
    async () => ({ demoMode: env.DEMO_MODE }),
  );

  await app.register(authRoutes);
  await app.register(ingestRoutes);
  await app.register(overviewRoutes);
  await app.register(mapRoutes);
  await app.register(detectionRoutes);
  await app.register(crossingRoutes);
  await app.register(workOrderRoutes);
  await app.register(deviceRoutes);
  await app.register(analyticsRoutes);
  await app.register(adminRoutes);
  return app;
}
