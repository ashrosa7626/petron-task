/* ===========================================================================
   Reading and writing .xlsx in the browser, with no library.

   An .xlsx is a zip of XML. The browser can do both halves natively —
   DecompressionStream/CompressionStream('deflate-raw') for the zip, DOMParser
   for the XML — so this is a few hundred lines rather than a dependency.

   Scope on purpose: only what this project's workbook uses. Strings and
   numbers, one row of cells per row, no styles, no formulas, no dates. If a
   future sheet needs more, add it here rather than reaching for a CDN — the
   artifact CSP and the offline tests both prefer it this way.

   cigarette stock/read_xlsx.py is the reference implementation for reading and
   the two are checked against each other: verify_xlsx.mjs parses the real
   CIGARETTES PLANOGRAM.xlsx with this code and compares cell for cell.
   =========================================================================== */

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const RELNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/* ============================== zip: read ============================== */
/* Central directory only — the local file headers repeat the same data and
   lie about sizes when bit 3 of the flags is set. */
async function unzip(buf) {
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);

  // End of central directory: scan back for the signature. The comment field
  // is almost always empty, but it is allowed to be up to 64KB.
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= 0 && i > buf.byteLength - 22 - 65536; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a .xlsx file (no zip directory found).');

  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);

  const out = new Map();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Damaged zip directory.');
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const cmtLen = dv.getUint16(p + 32, true);
    const localAt = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen));

    // The local header's own name/extra lengths decide where the bytes start.
    const lNameLen = dv.getUint16(localAt + 26, true);
    const lExtraLen = dv.getUint16(localAt + 28, true);
    const start = localAt + 30 + lNameLen + lExtraLen;
    const bytes = u8.subarray(start, start + compSize);

    out.set(name, method === 0 ? bytes : await inflate(bytes));
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
}

async function inflate(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
async function deflate(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

/* ============================== zip: write ============================== */
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/* Everything is stored deflated with a fixed timestamp. A fixed timestamp is
   deliberate: it makes the same content produce the same bytes, so a
   round-trip test can compare files rather than only parsed content. */
async function zip(files) {
  const enc = new TextEncoder();
  const parts = [], dir = [];
  let offset = 0;

  for (const [name, text] of files) {
    const raw = typeof text === 'string' ? enc.encode(text) : text;
    const comp = await deflate(raw);
    const nameBytes = enc.encode(name);
    const crc = crc32(raw);

    const local = new Uint8Array(30 + nameBytes.length);
    const ldv = new DataView(local.buffer);
    ldv.setUint32(0, 0x04034b50, true);
    ldv.setUint16(4, 20, true);          // version needed
    ldv.setUint16(6, 0, true);           // flags
    ldv.setUint16(8, 8, true);           // deflate
    ldv.setUint16(10, 0, true);          // time
    ldv.setUint16(12, 0x21, true);       // date: 1980-01-01
    ldv.setUint32(14, crc, true);
    ldv.setUint32(18, comp.length, true);
    ldv.setUint32(22, raw.length, true);
    ldv.setUint16(26, nameBytes.length, true);
    ldv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    parts.push(local, comp);

    const central = new Uint8Array(46 + nameBytes.length);
    const cdv = new DataView(central.buffer);
    cdv.setUint32(0, 0x02014b50, true);
    cdv.setUint16(4, 20, true);
    cdv.setUint16(6, 20, true);
    cdv.setUint16(8, 0, true);
    cdv.setUint16(10, 8, true);
    cdv.setUint16(12, 0, true);
    cdv.setUint16(14, 0x21, true);
    cdv.setUint32(16, crc, true);
    cdv.setUint32(20, comp.length, true);
    cdv.setUint32(24, raw.length, true);
    cdv.setUint16(28, nameBytes.length, true);
    cdv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    dir.push(central);

    offset += local.length + comp.length;
  }

  const dirSize = dir.reduce((n, d) => n + d.length, 0);
  const end = new Uint8Array(22);
  const edv = new DataView(end.buffer);
  edv.setUint32(0, 0x06054b50, true);
  edv.setUint16(8, dir.length, true);
  edv.setUint16(10, dir.length, true);
  edv.setUint32(12, dirSize, true);
  edv.setUint32(16, offset, true);

  return new Blob([...parts, ...dir, end],
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/* ============================== cells ============================== */
export function colToIndex(ref) {
  const letters = /^[A-Z]+/.exec(ref)[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
export function indexToCol(i) {
  let s = '';
  for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s;
  return s;
}

const escapeXml = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  // Excel rejects the whole file on a stray control character, and OCR'd or
  // pasted text carries them more often than you would think.
  .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

/* ============================== read ============================== */
/* Returns { sheetName: rows }, each row an array of trimmed strings, blanks
   preserved by cell reference so the grid does not collapse. Mirrors
   read_sheet() in read_xlsx.py exactly — including dropping trailing empty
   rows, which the diff depends on. */
export async function readXlsx(buf) {
  const files = await unzip(buf);
  const text = name => {
    const b = files.get(name);
    return b ? new TextDecoder().decode(b) : null;
  };
  const parse = xml => new DOMParser().parseFromString(xml, 'application/xml');

  const shared = [];
  const ss = text('xl/sharedStrings.xml');
  if (ss) {
    for (const si of parse(ss).getElementsByTagNameNS(MAIN, 'si')) {
      let s = '';
      for (const t of si.getElementsByTagNameNS(MAIN, 't')) s += t.textContent || '';
      shared.push(s);
    }
  }

  const wbXml = text('xl/workbook.xml');
  if (!wbXml) throw new Error('Not a .xlsx file (no workbook).');
  const relsXml = text('xl/_rels/workbook.xml.rels') || '';
  const target = new Map();
  for (const r of parse(relsXml).getElementsByTagName('Relationship')) {
    target.set(r.getAttribute('Id'), r.getAttribute('Target'));
  }

  const sheets = {};
  for (const sh of parse(wbXml).getElementsByTagNameNS(MAIN, 'sheet')) {
    const name = sh.getAttribute('name');
    let path = (target.get(sh.getAttributeNS(RELNS, 'id')) || '').replace(/^\//, '');
    if (!path.startsWith('xl/')) path = 'xl/' + path;
    const xml = text(path);
    sheets[name] = xml ? readSheet(parse(xml), shared) : [];
  }
  return sheets;
}

function readSheet(doc, shared) {
  const rows = [];
  for (const row of doc.getElementsByTagNameNS(MAIN, 'row')) {
    const cells = new Map();
    for (const c of row.getElementsByTagNameNS(MAIN, 'c')) {
      const t = c.getAttribute('t');
      let val = '';
      if (t === 'inlineStr') {
        for (const x of c.getElementsByTagNameNS(MAIN, 't')) val += x.textContent || '';
      } else {
        const v = c.getElementsByTagNameNS(MAIN, 'v')[0];
        const raw = v && v.textContent;
        if (raw == null || raw === '') val = '';
        else if (t === 's') val = shared[Number(raw)] ?? '';
        else val = raw;
      }
      val = val.trim();
      if (val) cells.set(colToIndex(c.getAttribute('r')), val);
    }
    const width = cells.size ? Math.max(...cells.keys()) + 1 : 0;
    const out = [];
    for (let i = 0; i < width; i++) out.push(cells.get(i) || '');
    rows.push(out);
  }
  while (rows.length && !rows[rows.length - 1].some(Boolean)) rows.pop();
  return rows;
}

/* ============================== write ============================== */
/* sheets: [{ name, rows }] where rows is an array of arrays of strings.
   Everything is written as an inline string — no shared string table and no
   number typing. Excel shows an inline numeric string right-aligned-looking
   enough for this workbook, and it keeps leading zeros, which matters: PLU and
   the POS Item ID are text, and Excel eating a leading zero is exactly the
   failure that makes PLU unusable as a key. */
export async function writeXlsx(sheets) {
  const files = [];

  files.push(['[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    sheets.map((_, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    ).join('') +
    `</Types>`]);

  files.push(['_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`]);

  files.push(['xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="${MAIN}" xmlns:r="${RELNS}"><sheets>` +
    sheets.map((s, i) =>
      `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
    `</sheets></workbook>`]);

  files.push(['xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    sheets.map((_, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
    ).join('') +
    `</Relationships>`]);

  sheets.forEach((s, i) => {
    const rows = s.rows.map((row, r) => {
      const cells = row.map((v, c) => {
        if (v === null || v === undefined || v === '') return '';
        return `<c r="${indexToCol(c)}${r + 1}" t="inlineStr"><is><t xml:space="preserve">` +
               `${escapeXml(v)}</t></is></c>`;
      }).join('');
      return cells ? `<row r="${r + 1}">${cells}</row>` : '';
    }).join('');
    files.push([`xl/worksheets/sheet${i + 1}.xml`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<worksheet xmlns="${MAIN}"><sheetData>${rows}</sheetData></worksheet>`]);
  });

  return zip(files);
}
