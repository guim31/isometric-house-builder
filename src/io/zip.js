/**
 * A ZIP archive, written by hand: stored entries, no compression.
 *
 * Several images exported at once used to leave as several downloads in a
 * burst, and browsers block a burst of downloads, or ask about each one. One
 * archive is one download. PNG files are compressed already, so storing them
 * as they are costs nothing worth a library — and the tool has none.
 *
 * The layout is the one every unzipper reads (APPNOTE 6.3): for each file a
 * local header and its bytes, then the central directory, then its end
 * record. Names are UTF-8, said so by bit 11 of the flags, so « façade »
 * survives the trip.
 */

import { t } from '../i18n/index.js';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (IEEE 802.3), as ZIP and PNG use it. */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Date and time in the two 16-bit MS-DOS words ZIP stores them as. */
export function dosDateTime(date) {
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

const FLAG_UTF8 = 0x0800;
const LIMIT = 0xffffffff;

/**
 * The archive of `files`, each `{ name, data }` with `data` a Uint8Array, as a
 * Uint8Array. `date` stamps every entry; tests pass a fixed one.
 */
export function zipStore(files, date = new Date()) {
  const enc = new TextEncoder();
  const { time, date: day } = dosDateTime(date);
  const entries = files.map((f) => {
    const name = enc.encode(f.name);
    const data = f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data);
    if (data.length >= LIMIT) throw new Error(t('export.zipFileTooBig', { name: f.name }));
    return { name, data, crc: crc32(data) };
  });
  const localSize = entries.reduce((n, e) => n + 30 + e.name.length + e.data.length, 0);
  const centralSize = entries.reduce((n, e) => n + 46 + e.name.length, 0);
  if (entries.length > 0xffff || localSize + centralSize >= LIMIT) throw new Error(t('export.zipTooBig'));
  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);
  let at = 0;
  const u16 = (v) => { view.setUint16(at, v, true); at += 2; };
  const u32 = (v) => { view.setUint32(at, v >>> 0, true); at += 4; };
  const bytes = (b) => { out.set(b, at); at += b.length; };

  const offsets = [];
  for (const e of entries) {
    offsets.push(at);
    u32(0x04034b50); // local file header
    u16(20); // version needed: 2.0
    u16(FLAG_UTF8);
    u16(0); // method: stored
    u16(time); u16(day);
    u32(e.crc); u32(e.data.length); u32(e.data.length);
    u16(e.name.length); u16(0);
    bytes(e.name);
    bytes(e.data);
  }
  const central = at;
  entries.forEach((e, k) => {
    u32(0x02014b50); // central directory header
    u16(20); // made by: 2.0, MS-DOS attributes
    u16(20);
    u16(FLAG_UTF8);
    u16(0);
    u16(time); u16(day);
    u32(e.crc); u32(e.data.length); u32(e.data.length);
    u16(e.name.length); u16(0); u16(0);
    u16(0); // disk number
    u16(0); // internal attributes
    u32(0); // external attributes
    u32(offsets[k]);
    bytes(e.name);
  });
  const centralLen = at - central;
  u32(0x06054b50); // end of central directory
  u16(0); u16(0);
  u16(entries.length); u16(entries.length);
  u32(centralLen); u32(central);
  u16(0); // no comment
  return out;
}

/**
 * Names made unique within an archive: two saved views both called « Jardin »
 * would otherwise overwrite each other on extraction.
 */
export function uniqueNames(names) {
  const taken = new Set();
  return names.map((n) => {
    let name = n;
    const dot = n.lastIndexOf('.');
    for (let k = 2; taken.has(name); k++) {
      name = dot > 0 ? `${n.slice(0, dot)}-${k}${n.slice(dot)}` : `${n}-${k}`;
    }
    taken.add(name);
    return name;
  });
}
