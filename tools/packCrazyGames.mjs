// Packs the CrazyGames build (dist-crazygames/) into skyward-crazygames.zip with
// index.html at the root of the archive, ready to upload in the CrazyGames
// developer portal. Run through `npm run package:crazygames`.
//
// Pure Node (zlib) so it works on any OS without a zip tool installed.

import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { deflateRawSync } from 'node:zlib';

const root = process.cwd();
const dir = join(root, process.argv[2] || 'dist-crazygames');
const out = join(root, process.argv[3] || 'skyward-crazygames.zip');

// CrazyGames limits (developer docs): keep the upload small and the file count low
const MAX_TOTAL_MB = 250;
const MAX_FILES = 1500;

if (!existsSync(join(dir, 'index.html'))) {
  console.error(`No build found in ${relative(root, dir)} — run "npm run build:crazygames" first.`);
  process.exit(1);
}

function walk(d) {
  const files = [];
  for (const name of readdirSync(d).sort()) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) files.push(...walk(p));
    else files.push(p);
  }
  return files;
}

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosTime(d) {
  return {
    time: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff,
    date: (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff,
  };
}

const files = walk(dir);
const locals = [];
const centrals = [];
let offset = 0;
let rawTotal = 0;
const { time, date } = dosTime(new Date());

for (const file of files) {
  const name = Buffer.from(relative(dir, file).split(sep).join('/'), 'utf8');
  const data = readFileSync(file);
  rawTotal += data.length;
  const crc = crc32(data);
  const deflated = deflateRawSync(data, { level: 9 });
  const useDeflate = deflated.length < data.length;
  const body = useDeflate ? deflated : data;
  const method = useDeflate ? 8 : 0;

  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0);
  lh.writeUInt16LE(20, 4); // version needed
  lh.writeUInt16LE(0x0800, 6); // UTF-8 names
  lh.writeUInt16LE(method, 8);
  lh.writeUInt16LE(time, 10);
  lh.writeUInt16LE(date, 12);
  lh.writeUInt32LE(crc, 14);
  lh.writeUInt32LE(body.length, 18);
  lh.writeUInt32LE(data.length, 22);
  lh.writeUInt16LE(name.length, 26);
  lh.writeUInt16LE(0, 28);
  locals.push(lh, name, body);

  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0);
  ch.writeUInt16LE(20, 4); // version made by
  ch.writeUInt16LE(20, 6); // version needed
  ch.writeUInt16LE(0x0800, 8);
  ch.writeUInt16LE(method, 10);
  ch.writeUInt16LE(time, 12);
  ch.writeUInt16LE(date, 14);
  ch.writeUInt32LE(crc, 16);
  ch.writeUInt32LE(body.length, 20);
  ch.writeUInt32LE(data.length, 24);
  ch.writeUInt16LE(name.length, 28);
  ch.writeUInt32LE(offset, 42);
  centrals.push(ch, name);

  offset += lh.length + name.length + body.length;
}

const central = Buffer.concat(centrals);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(central.length, 12);
end.writeUInt32LE(offset, 16);

const zip = Buffer.concat([...locals, central, end]);
writeFileSync(out, zip);

const mb = (n) => (n / 1024 / 1024).toFixed(2);
console.log(`Wrote ${relative(root, out)}: ${files.length} files, ${mb(rawTotal)} MB unpacked, ${mb(zip.length)} MB zipped.`);
if (files.length > MAX_FILES) console.warn(`Warning: more than ${MAX_FILES} files.`);
if (rawTotal > MAX_TOTAL_MB * 1024 * 1024) console.warn(`Warning: larger than ${MAX_TOTAL_MB} MB.`);
