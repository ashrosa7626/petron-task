// Run the page's own block derivation against the layout the spreadsheet
// describes — i.e. the state of the database after 04_sync_to_spreadsheet.sql.
// Proves the page renders the corrected planogram without a code change.
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../stock-count/index.html', import.meta.url), 'utf8');
const start = html.indexOf('function deriveBlocks');
const end = html.indexOf('function brandColour');
if (start < 0 || end < 0) throw new Error('could not locate the derivation functions');
const { deriveBlocks } = await import(
  'data:text/javascript,' + encodeURIComponent(html.slice(start, end) + '\nexport { deriveBlocks };')
);

const data = JSON.parse(readFileSync(new URL('./expected_facings.json', import.meta.url), 'utf8'));
const products = new Map(data.products.map(p => [p.product_id, p]));
const facings = data.facings;
const shelves = [...new Set(facings.map(f => f.shelf))].sort();

const { blocks, nonRect, productCount } = deriveBlocks(facings, shelves);

const drawn = blocks.reduce((n, b) => n + b.facings, 0);
console.log(`products ${productCount} · facings ${facings.length} · blocks ${blocks.length} · drawn ${drawn}`);

const check = (ok, msg) => console.log((ok ? 'OK   ' : 'FAIL ') + msg);
check(productCount === 54, `54 products (got ${productCount})`);
check(facings.length === 162, `162 facings (got ${facings.length})`);
check(drawn === facings.length, 'facings reconcile');
check(nonRect.length === 0, `every region is a solid rectangle${nonRect.length ? ' — ' + JSON.stringify(nonRect) : ''}`);

const occupied = new Map();
let overlaps = 0;
const rowOf = Object.fromEntries(shelves.map((s, i) => [s, i]));
for (const b of blocks) {
  for (let r = b.row; r < b.row + b.h; r++) {
    for (let c = b.col; c < b.col + b.w; c++) {
      const k = r + ':' + c;
      if (occupied.has(k)) { overlaps++; console.log(`  OVERLAP ${shelves[r]}${c}`); }
      occupied.set(k, b.productId);
    }
  }
}
check(overlaps === 0, 'no block overlaps another');

let wrong = 0;
for (const f of facings) if (occupied.get(rowOf[f.shelf] + ':' + f.position) !== f.product_id) wrong++;
check(wrong === 0, 'every drawn cell matches its facing');

const byProd = new Map();
for (const b of blocks) byProd.set(b.productId, (byProd.get(b.productId) || 0) + 1);
const split = [...byProd].filter(([, n]) => n > 1);
check(split.length === 3, `3 split products (got ${split.length})`);

console.log('\nsplit products — these share one input and one progress slot:');
for (const [pid] of split) {
  const parts = blocks.filter(b => b.productId === pid).sort((a, b) => a.regionIndex - b.regionIndex);
  console.log(`  ${(products.get(pid)?.short_name || pid).padEnd(16)} ${parts.length} blocks: ` +
    parts.map(b => `${b.label} [${b.regionIndex + 1} of ${b.regionTotal}]`).join('  '));
}

// Every piece of a split product must carry a distinct, correctly-numbered badge.
let badBadge = 0;
for (const [pid, n] of byProd) {
  const parts = blocks.filter(b => b.productId === pid);
  const idx = new Set(parts.map(b => b.regionIndex));
  if (idx.size !== n || parts.some(b => b.regionTotal !== n)) badBadge++;
}
check(badBadge === 0, 'every block carries a correct "n of m" marker');

console.log('\nsingle-facing blocks (the 76px layout case):', blocks.filter(b => b.w === 1 && b.h === 1).length);
const longNames = blocks.filter(b => (products.get(b.productId)?.short_name || '').length > 18 && b.w === 1);
console.log('single-facing blocks whose short_name exceeds 18 chars:', longNames.length);
for (const b of longNames) console.log(`  ${b.label}  ${products.get(b.productId).short_name}`);
