import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts', 'src/worker.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  sourcemap: true,
  // the shared package ships TypeScript source, so bundle it
  noExternal: ['@railguard/shared'],
});
