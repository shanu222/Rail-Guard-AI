import 'dotenv/config';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().optional(),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16).optional(),
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(14),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  DEMO_MODE: bool,
  SNAPSHOT_RETENTION_DAYS: z.coerce.number().default(30),
  R2_ACCOUNT_ID: z.string().default('local'),
  R2_ACCESS_KEY_ID: z.string().default('minioadmin'),
  R2_SECRET_ACCESS_KEY: z.string().default('minioadmin'),
  R2_BUCKET: z.string().default('railguard-media'),
  R2_ENDPOINT: z.string().optional(),
  INGEST_MAX_BODY_BYTES: z.coerce.number().default(2 * 1024 * 1024),
  INGEST_RATE_PER_MIN: z.coerce.number().default(120),
});

export const env = EnvSchema.parse(process.env);
export const isProd = env.NODE_ENV === 'production';
