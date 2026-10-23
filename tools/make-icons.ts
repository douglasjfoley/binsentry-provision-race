// Writes placeholder PWA icons (public/icons/icon-192.png, icon-512.png). Phase 3 replaces them with brand art.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function icon(n: number): Buffer {
  const navy = [0x1f, 0x2a, 0x44];
  const teal = [0x00, 0xa3, 0xad];
  const white = [0xff, 0xff, 0xff];
  const rows: Buffer[] = [];
  for (let y = 0; y < n; y++) {
    const row = Buffer.alloc(1 + n * 3);
    for (let x = 0; x < n; x++) {
      const u = x / n - 0.5;
      const v = y / n - 0.5;
      const r = Math.hypot(u, v);
      // A road loop (ring) with the mill (square) in the middle.
      let c = navy;
      if (r > 0.26 && r < 0.34) c = teal;
      if (Math.abs(u) < 0.09 && Math.abs(v) < 0.09) c = white;
      row.set(c, 1 + x * 3);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0);
  ihdr.writeUInt32BE(n, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

for (const n of [192, 512]) writeFileSync(`public/icons/icon-${n}.png`, icon(n));
console.log('wrote public/icons/icon-192.png, icon-512.png');
