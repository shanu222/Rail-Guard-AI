import { deflateSync } from 'node:zlib';

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf: Buffer) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

/**
 * Tiny synthetic "track photo": grey ballast noise, two rails, sleepers and a red bounding box.
 * Clearly artificial - it only exists so the demo has an image to draw a box over.
 */
export function syntheticTrackPng(
  seed: number,
  w = 320,
  h = 240,
): { png: Buffer; bbox: [number, number, number, number] } {
  let s = seed >>> 0 || 1;
  const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  const box = { x0: 110 + Math.floor(rnd() * 40), y0: 80 + Math.floor(rnd() * 40), w: 60, h: 46 };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const v = 95 + Math.floor(rnd() * 50); // ballast
      let r = v,
        g = v,
        b = v;
      const cx = Math.abs(x - w / 2);
      if (Math.abs(cx - 55) < 5) {
        r = 170;
        g = 172;
        b = 178;
      } // rails
      else if (cx < 70 && y % 28 < 9) {
        r = 92;
        g = 74;
        b = 58;
      } // sleepers
      // a darker "defect" patch where the detector box will be drawn by the dashboard
      if (x >= box.x0 && x < box.x0 + box.w && y >= box.y0 && y < box.y0 + box.h) {
        r = Math.floor(r * 0.55);
        g = Math.floor(g * 0.5);
        b = Math.floor(b * 0.5);
      }
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // 8-bit RGB
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return { png, bbox: [box.x0 / w, box.y0 / h, box.w / w, box.h / h] };
}
