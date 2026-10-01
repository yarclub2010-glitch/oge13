// ZIP-архивы: .ods и .xlsx — это zip с XML-файлами внутри.
// Сжатие и распаковка deflate — встроенными в браузер CompressionStream / DecompressionStream.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const utf8 = new TextEncoder();

async function deflateRaw(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null; // старый браузер — запишем без сжатия
  }
}

// files: [{ name, data: string | Uint8Array, store?: true }] → Promise<Uint8Array>
export async function makeZip(files) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = utf8.encode(f.name);
    const data = typeof f.data === 'string' ? utf8.encode(f.data) : f.data;
    const crc = crc32(data);
    const packed = f.store ? null : await deflateRaw(data);
    const body = packed ?? data;
    const method = packed ? 8 : 0;

    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true);
    head.setUint16(4, 20, true);
    head.setUint16(6, 0x0800, true); // имена в UTF-8
    head.setUint16(8, method, true);
    head.setUint32(14, crc, true);
    head.setUint32(18, body.length, true);
    head.setUint32(22, data.length, true);
    head.setUint16(26, name.length, true);
    local.push(new Uint8Array(head.buffer), name, body);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(8, 0x0800, true);
    dir.setUint16(10, method, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, body.length, true);
    dir.setUint32(24, data.length, true);
    dir.setUint16(28, name.length, true);
    dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), name);

    offset += 30 + name.length + body.length;
  }
  const dirSize = central.reduce((s, a) => s + a.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, dirSize, true);
  end.setUint32(16, offset, true);

  const parts = [...local, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((s, a) => s + a.length, 0));
  let p = 0;
  for (const a of parts) {
    out.set(a, p);
    p += a.length;
  }
  return out;
}

const MAX_UNPACKED = 100 * 1024 * 1024; // настоящие файлы задания — единицы мегабайт

async function inflateRaw(bytes) {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const parts = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_UNPACKED) {
      await reader.cancel();
      throw new Error('zip-too-big'); // zip-бомба: распаковка разрастается до гигабайт
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let p = 0;
  for (const a of parts) {
    out.set(a, p);
    p += a.length;
  }
  return out;
}

// Uint8Array → Map(имя файла → { read(): Promise<Uint8Array>, text(): Promise<string> })
export function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('not-zip');

  const count = view.getUint16(end + 10, true);
  let p = view.getUint32(end + 16, true);
  const entries = new Map();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('bad-zip');
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;

    const read = async () => {
      const lNameLen = view.getUint16(localOffset + 26, true);
      const lExtraLen = view.getUint16(localOffset + 28, true);
      const start = localOffset + 30 + lNameLen + lExtraLen;
      const raw = bytes.subarray(start, start + size);
      if (method === 0) return raw;
      if (method === 8) return inflateRaw(raw);
      throw new Error('zip-method');
    };
    entries.set(name, { read, text: async () => dec.decode(await read()) });
  }
  return entries;
}
