'use client';
import { useEffect, useRef, useState } from 'react';

/** In-place radix-2 FFT (magnitudes only needed). */
function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [re[i], re[j]] = [re[j]!, re[i]!];
    if (i < j) [im[i], im[j]] = [im[j]!, im[i]!];
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b]! * cr - im[b]! * ci;
        const ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
}

/** Audio player plus a spectrogram rendered client-side from the decoded clip. */
export function AudioWithSpectrogram({ url }: { url: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const buf = await (await fetch(url)).arrayBuffer();
        const ctx = new AudioContext();
        const audio = await ctx.decodeAudioData(buf);
        void ctx.close();
        if (dead || !canvas.current) return;
        const data = audio.getChannelData(0);
        const N = 512;
        const hop = Math.max(N / 2, Math.floor(data.length / 400));
        const cols = Math.floor((data.length - N) / hop);
        const c = canvas.current;
        c.width = Math.max(1, cols);
        c.height = N / 4;
        const g = c.getContext('2d')!;
        const img = g.createImageData(c.width, c.height);
        const win = Float32Array.from(
          { length: N },
          (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)),
        );
        for (let x = 0; x < cols; x++) {
          const re = new Float32Array(N);
          const im = new Float32Array(N);
          for (let i = 0; i < N; i++) re[i] = (data[x * hop + i] ?? 0) * win[i]!;
          fft(re, im);
          for (let y = 0; y < c.height; y++) {
            const bin = y * 1; // lowest N/4 bins (0 .. fs/8)
            const db = 20 * Math.log10(Math.hypot(re[bin]!, im[bin]!) + 1e-6);
            const v = Math.max(0, Math.min(1, (db + 20) / 70));
            const o = ((c.height - 1 - y) * c.width + x) * 4;
            img.data[o] = 15 + v * 217;
            img.data[o + 1] = 27 + v * 73;
            img.data[o + 2] = 45 + v * 13;
            img.data[o + 3] = 255; // navy -> accent orange
          }
        }
        g.putImageData(img, 0, 0);
      } catch {
        setErr('Spectrogram unavailable for this clip.');
      }
    })();
    return () => {
      dead = true;
    };
  }, [url]);

  return (
    <div className="space-y-2">
      <audio controls src={url} className="w-full" preload="metadata" />
      <canvas
        ref={canvas}
        className="h-24 w-full rounded border border-line"
        role="img"
        aria-label="Spectrogram of the acoustic clip (frequency vs time)"
      />
      {err && <p className="text-xs text-ink-soft">{err}</p>}
    </div>
  );
}
