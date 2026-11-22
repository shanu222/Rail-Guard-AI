export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? API_URL;
export const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

let accessToken: string | null = null;
export const getToken = () => accessToken;
export const setToken = (t: string | null) => {
  accessToken = t;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: any,
  ) {
    super(message);
  }
}

let refreshing: Promise<boolean> | null = null;
/** Exchange the httpOnly refresh cookie for a new access token (single-flight). */
export function refreshSession(): Promise<{ accessToken: string; user: any } | null> {
  return (async () => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) return null;
      const data = await res.json();
      setToken(data.accessToken);
      return data;
    } catch {
      return null;
    }
  })();
}

type Opts = {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
};

export async function api<T = any>(path: string, opts: Opts = {}, retried = false): Promise<T> {
  const qs = opts.query
    ? '?' +
      new URLSearchParams(
        Object.entries(opts.query)
          .filter(([, v]) => v !== undefined && v !== null && v !== '')
          .map(([k, v]) => [k, String(v)]),
      ).toString()
    : '';
  const res = await fetch(`${API_URL}${path}${qs === '?' ? '' : qs}`, {
    method: opts.method ?? 'GET',
    credentials: 'include',
    headers: {
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401 && !retried && path !== '/auth/login' && path !== '/auth/refresh') {
    refreshing ??= refreshSession()
      .then((r) => !!r)
      .finally(() => (refreshing = null));
    if (await refreshing) return api<T>(path, opts, true);
  }
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.message ?? data?.error ?? res.statusText, data);
  return data as T;
}

const safeJson = (t: string) => {
  try {
    return JSON.parse(t);
  } catch {
    return { message: t };
  }
};

/** Download a CSV through the authenticated API. */
export async function downloadFile(path: string, filename: string, query?: Opts['query']) {
  const qs = query
    ? '?' +
      new URLSearchParams(
        Object.entries(query)
          .filter(([, v]) => v)
          .map(([k, v]) => [k, String(v)]),
      )
    : '';
  const res = await fetch(`${API_URL}${path}${qs}`, {
    credentials: 'include',
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
  });
  if (!res.ok) throw new ApiError(res.status, 'Download failed');
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

/** POST JSON and save the binary (PDF) response as a file. Returns whether it was archived server-side. */
export async function postDownload(
  path: string,
  body: unknown,
  fallbackName: string,
  retried = false,
): Promise<{ archived: boolean }> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (res.status === 401 && !retried && (await refreshSession()))
    return postDownload(path, body, fallbackName, true);
  if (!res.ok) {
    const t = await res.text();
    const d = t ? safeJson(t) : null;
    throw new ApiError(res.status, d?.message ?? res.statusText, d);
  }
  const cd = res.headers.get('content-disposition') ?? '';
  const name = /filename="?([^";]+)"?/.exec(cd)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return { archived: res.headers.get('x-report-archived') !== 'false' };
}

/** PUT a file to a presigned URL, returning when stored. */
export async function putToPresigned(url: string, file: Blob, contentType: string) {
  const r = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': contentType },
    body: file,
  });
  if (!r.ok) throw new Error(`Upload failed (${r.status})`);
}
