// Derive blocks for the lubes and Iluma grids straight from the workbook,
// BEFORE any of it reaches the database.
//
// The point is to find a layout the count screen cannot draw while it is still
// a spreadsheet: a region that is not a solid rectangle gets split into row
// runs, two blocks overlapping means one product's input sits on another's
// facing, and a split product that loses its "n of m" marker means somebody
// counts one piece and moves on.
//
// Offline. Reads the workbook, runs the SHIPPED deriveBlocks.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { deriveBlocks } from '../stock-count/planogram.js';

const PASS = [], FAIL = [];
const check = (ok, msg, extra) => {
  (ok ? PASS : FAIL).push(msg);
  console.log((ok ? 'OK   ' : 'FAIL ') + msg + (ok || extra === undefined ? '' : `  -> ${extra}`));
};

// Read the workbook with the Python reader — the same one diff_xlsx_vs_db.py
// and the generator use, so all three see identical cells.
const here = fileURLToPath(new URL('.', import.meta.url));
const sheets = JSON.parse(execFileSync('python3', ['-c', `
import json, sys
sys.path.insert(0, ${JSON.stringify(here)})
from read_xlsx import load
print(json.dumps(load(${JSON.stringify(here + '../excel/Lubes planogram.xlsx')})))
`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));

function gridOf(rows) {
  let numRow = -1, firstCol = -1;
  for (let r = 0; r < rows.length && numRow < 0; r++) {
    for (let c = 0; c + 1 < rows[r].length; c++) {
      if (String(rows[r][c]).trim() === '1' && String(rows[r][c + 1]).trim() === '2') {
        numRow = r; firstCol = c; break;
      }
    }
  }
  const posAt = new Map();
  rows[numRow].forEach((v, c) => {
    const n = Number(String(v).trim());
    if (c >= firstCol && Number.isInteger(n) && n > 0) posAt.set(c, n);
  });
  const facings = [];
  for (let r = numRow + 1; r < rows.length; r++) {
    const row = rows[r];
    let shelf = '';
    for (let c = 0; c < firstCol; c++) {
      const v = String(row[c] || '').trim().toUpperCase();
      if (/^[A-Z]$/.test(v)) { shelf = v; break; }
    }
    if (!shelf) continue;
    for (const [c, p] of posAt) {
      const label = String(row[c] || '').trim();
      if (label) facings.push({ shelf, position: p, product_id: label });
    }
  }
  return facings;
}

// product_id is the grid LABEL here, which is fine: deriveBlocks only ever
// groups by it, and this is checking geometry, not identity.
for (const [label, sheet, wantProducts, wantFacings, wantSplit] of [
  ['LUBES', 'Lubes Planogram', 34, 50, 4],
  ['ILUMA', 'Iluma Planogram', 21, 34, 0],
]) {
  console.log(`\n${label}\n`);
  const facings = gridOf(sheets[sheet]);
  const shelves = [...new Set(facings.map(f => f.shelf))].sort();
  const { blocks, nonRect, productCount } = deriveBlocks(facings, shelves);

  check(facings.length === wantFacings, `${wantFacings} facings on the grid`, facings.length);
  check(productCount === wantProducts, `${wantProducts} distinct products`, productCount);

  const drawn = blocks.reduce((n, b) => n + b.facings, 0);
  check(drawn === facings.length, 'every facing is drawn exactly once', `${drawn} vs ${facings.length}`);
  // A non-rectangular region is legitimate, not a failure: lubes Blaze Multi
  // 20W50 4L is an L across C7, C8 and D8. What matters is that it is drawn as
  // separate rectangles that cover only its own cells — checked by the overlap
  // test below — and that it still carries an "n of m" marker, checked after.
  if (nonRect.length) {
    console.log(`     L-shaped, drawn as row runs: ` +
      nonRect.map(n => `${n.productId} (${n.cells} cells in a ${n.box} box)`).join(', '));
  }

  const occupied = new Map();
  let overlaps = 0;
  for (const b of blocks) {
    for (let r = b.row; r < b.row + b.h; r++) {
      for (let c = b.col; c < b.col + b.w; c++) {
        const k = r + ':' + c;
        if (occupied.has(k)) overlaps++;
        occupied.set(k, b.productId);
      }
    }
  }
  check(overlaps === 0, 'no two blocks occupy the same cell', overlaps);

  const split = [...new Set(blocks.filter(b => b.regionTotal > 1).map(b => b.productId))];
  check(split.length === wantSplit,
    `${wantSplit} product(s) split across separated blocks`, `${split.length}: ${split}`);
  for (const pid of split) {
    const parts = blocks.filter(b => b.productId === pid).sort((a, b) => a.regionIndex - b.regionIndex);
    const marks = parts.map(p => `${p.regionIndex + 1} of ${p.regionTotal}`);
    const ok = parts.every((p, i) => p.regionIndex === i && p.regionTotal === parts.length);
    check(ok, `  ${pid} — ${parts.map(p => p.label).join(' | ')} [${marks.join(', ')}]`);
  }

  // Ragged shelves are the new thing here: cigarettes is a uniform 6x27, lubes
  // is 17/17/8/8. The grid renders maxPos columns for every shelf, so short
  // shelves simply have empty cells on the right — nothing to fix, but worth
  // pinning so a future change does not start drawing phantom facings.
  const widths = {};
  for (const f of facings) widths[f.shelf] = Math.max(widths[f.shelf] || 0, f.position);
  console.log(`     shelf widths: ${Object.entries(widths).map(([s, w]) => s + '=' + w).join(' ')}`);
}

console.log(`\n${PASS.length} passed, ${FAIL.length} failed`);
process.exit(FAIL.length ? 1 : 0);
