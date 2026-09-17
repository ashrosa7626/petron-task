// Check the browser's .xlsx reader and writer against each other, and against
// the Python reader that has been parsing this workbook since August.
//
// Three things are pinned:
//   1. readXlsx() agrees with read_xlsx.py cell for cell on the REAL workbook
//   2. write -> read returns exactly what went in
//   3. read -> write -> read is stable, so a download/upload with no edits
//      produces an EMPTY diff. That is the property the editor page depends on:
//      if a round trip silently changed a cell, every upload would look like a
//      change and nobody could tell a real edit from noise.
//
// Offline. No network, no browser.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
// The repo path contains a space, so URL.pathname is percent-encoded and
// Python gets a directory that does not exist. fileURLToPath decodes it.
import { fileURLToPath } from 'node:url';

// Node ships DecompressionStream and CompressionStream; DOMParser is the only
// gap, and it is filled below so xlsx.js runs unmodified rather than being
// reimplemented here — a copy would pass while the shipped code was broken.

const PASS = [], FAIL = [];
const check = (ok, msg, extra) => {
  (ok ? PASS : FAIL).push(msg);
  console.log((ok ? 'OK   ' : 'FAIL ') + msg + (ok || extra === undefined ? '' : `  -> ${extra}`));
};

await import('./xlsx_dom_shim.mjs');


const { readXlsx, writeXlsx, colToIndex, indexToCol } =
  await import('../stock-count/xlsx.js');

// ---------------------------------------------------------------------------
console.log('\ncolumn references\n');
// ---------------------------------------------------------------------------
check(colToIndex('A1') === 0 && colToIndex('B2') === 1 && colToIndex('Z9') === 25,
  'A/B/Z map to 0/1/25');
check(colToIndex('AA1') === 26 && colToIndex('AB1') === 27,
  'AA and AB carry past Z', [colToIndex('AA1'), colToIndex('AB1')]);
check(indexToCol(0) === 'A' && indexToCol(25) === 'Z' && indexToCol(26) === 'AA',
  'and the inverse agrees', [indexToCol(0), indexToCol(25), indexToCol(26)]);
let rtCols = true;
for (let i = 0; i < 200; i++) if (colToIndex(indexToCol(i) + '1') !== i) rtCols = false;
check(rtCols, 'every column 0..199 survives a round trip');

// ---------------------------------------------------------------------------
console.log('\nreading the real workbook\n');
// ---------------------------------------------------------------------------
const WB = new URL('./CIGARETTES PLANOGRAM.xlsx', import.meta.url);
const buf = readFileSync(WB);
const sheets = await readXlsx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

check(Object.keys(sheets).includes('Planogram') &&
      Object.keys(sheets).includes('Full Stock List'),
  'both sheets are found', Object.keys(sheets));

// The Python reader has parsed this file since August. If the two disagree,
// one of them is wrong and the diff that drives the editor cannot be trusted.
const py = JSON.parse(execFileSync('python3', ['-c', `
import json, sys
sys.path.insert(0, ${JSON.stringify(fileURLToPath(new URL('.', import.meta.url)))})
from read_xlsx import load
print(json.dumps(load(${JSON.stringify(fileURLToPath(WB))})))
`], { encoding: 'utf8' }));

let same = true, firstDiff = '';
for (const name of Object.keys(py)) {
  const a = py[name], b = sheets[name] || [];
  if (a.length !== b.length) {
    same = false; firstDiff = `${name}: ${a.length} rows in python, ${b.length} here`; break;
  }
  for (let r = 0; r < a.length && same; r++) {
    const ra = a[r], rb = b[r] || [];
    if (ra.length !== rb.length) {
      same = false; firstDiff = `${name} row ${r + 1}: width ${ra.length} vs ${rb.length}`; break;
    }
    for (let c = 0; c < ra.length; c++) {
      if (ra[c] !== rb[c]) {
        same = false;
        firstDiff = `${name} row ${r + 1} col ${c + 1}: "${ra[c]}" vs "${rb[c]}"`;
        break;
      }
    }
  }
}
check(same, 'agrees with read_xlsx.py cell for cell on the real workbook', firstDiff);

const stock = sheets['Full Stock List'];
check(stock.length === 55, '55 rows on Full Stock List — header plus 54 products', stock.length);
check(stock[1][2] === '103732' && stock[1][3] === '9556109106958',
  'Dunhill Classic keeps its Item ID and its full-length PLU', stock[1].slice(1, 4).join(' | '));

// ---------------------------------------------------------------------------
console.log('\nwriting, and reading back what was written\n');
// ---------------------------------------------------------------------------
const tricky = [
  ['POS Description', 'POS Item ID', 'PLU', 'Active'],
  // A leading zero on the PLU is the whole reason cells are written as text:
  // the POS export prints the same PLU with and without one, and Excel eating
  // it is what makes PLU unusable as a key.
  ['LEADING ZERO', '100740', '0123456789012', 'TRUE'],
  ['AMPERSAND & ANGLE <>', '100626', '9556109106958', 'FALSE'],
  ['QUOTE " AND APOSTROPHE \'', '103732', '76164217', 'TRUE'],
  ['  SPACED  ', '104922', '88823393', 'TRUE'],
  ['', '', '', '']
];
const blob = await writeXlsx([{ name: 'Full Stock List', rows: tricky }]);
const back = await readXlsx(await blob.arrayBuffer());
const got = back['Full Stock List'];

check(!!got, 'the written file reads back');
check(got[1][2] === '0123456789012',
  'a PLU with a leading zero survives the round trip as text',
  got && got[1] && got[1][2]);
check(got[2][0] === 'AMPERSAND & ANGLE <>', 'ampersands and angle brackets survive', got[2][0]);
check(got[3][0] === 'QUOTE " AND APOSTROPHE \'', 'quotes and apostrophes survive', got[3][0]);
check(got[4][0] === 'SPACED', 'surrounding whitespace is trimmed, matching the Python reader', got[4][0]);
check(got.length === 5, 'the trailing blank row is dropped, as read_xlsx.py does', got.length);

// ---------------------------------------------------------------------------
console.log('\nthe property the editor depends on: an untouched round trip is a no-op\n');
// ---------------------------------------------------------------------------
const again = await readXlsx(await (await writeXlsx(
  Object.entries(sheets).map(([name, rows]) => ({ name, rows })))).arrayBuffer());

let stable = true, where = '';
for (const name of Object.keys(sheets)) {
  const a = sheets[name], b = again[name] || [];
  if (a.length !== b.length) { stable = false; where = `${name}: ${a.length} -> ${b.length} rows`; break; }
  for (let r = 0; r < a.length && stable; r++) {
    for (let c = 0; c < a[r].length; c++) {
      if (a[r][c] !== (b[r] || [])[c]) {
        stable = false; where = `${name} r${r + 1}c${c + 1}: "${a[r][c]}" -> "${(b[r] || [])[c]}"`;
        break;
      }
    }
  }
}
check(stable,
  'download then upload with no edits changes NOTHING — so any diff the editor shows is a real edit',
  where);

console.log(`\n${PASS.length} passed, ${FAIL.length} failed`);
process.exit(FAIL.length ? 1 : 0);
