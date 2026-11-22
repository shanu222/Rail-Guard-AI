import { gzipSync } from 'node:zlib';
import { syntheticTrackPng } from './png';

export interface DeviceClientOpts {
  apiUrl: string;
  serial: string;
  apiKey: string;
}

/** Talks to the real ingestion API exactly like firmware would (x-api-key, gzip, presigned uploads). */
export class DeviceClient {
  constructor(private o: DeviceClientOpts) {}
  get serial() {
    return this.o.serial;
  }

  async post<T = unknown>(
    path: string,
    body: unknown,
    gzip = true,
  ): Promise<{ status: number; body: T }> {
    const json = Buffer.from(JSON.stringify(body));
    const res = await fetch(`${this.o.apiUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.o.apiKey,
        ...(gzip ? { 'content-encoding': 'gzip' } : {}),
      },
      body: gzip ? gzipSync(json) : json,
    });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* keep text */
    }
    return { status: res.status, body: parsed as T };
  }

  /** Upload a synthetic image through a presigned PUT; returns the object key. */
  async uploadImage(
    seed: number,
  ): Promise<{ key: string; bbox: [number, number, number, number] } | undefined> {
    const { png, bbox } = syntheticTrackPng(seed);
    const r = await this.post<{ key: string; url: string }>(
      '/v1/ingest/upload-url',
      { kind: 'image', contentType: 'image/png', sizeBytes: png.length },
      false,
    );
    if (r.status !== 200) return undefined;
    const put = await fetch(r.body.url, {
      method: 'PUT',
      headers: { 'content-type': 'image/png' },
      body: png,
    });
    return put.ok ? { key: r.body.key, bbox } : undefined;
  }
}
