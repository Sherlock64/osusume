import { crc32, deflateSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';

function chunk(type: string, data: Buffer): Buffer {
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

/** A square RGB PNG of noise, stored uncompressed, so `edge` sets the file size: edge^2 * 3 bytes. */
export function noisePng(edge: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(edge, 0);
  header.writeUInt32BE(edge, 4);
  header[8] = 8; // bits per channel
  header[9] = 2; // RGB
  const rows = randomBytes((edge * 3 + 1) * edge);
  for (let row = 0; row < edge; row += 1) rows[row * (edge * 3 + 1)] = 0; // no row filter
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 0 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
