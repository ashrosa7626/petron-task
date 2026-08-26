// Extract deriveBlocks/rowRuns/makeBlock straight out of the page and run them
// against the live data, so the test exercises the shipped code, not a copy.
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../stock-count/index.html', import.meta.url), 'utf8');
const start = html.indexOf('function deriveBlocks');
const end = html.indexOf('/* Stable colour per brand');
if (start < 0 || end < 0) throw new Error('could not locate the derivation functions');
const src = html.slice(start, end);
const { deriveBlocks } = await import(
  'data:text/javascript,' + encodeURIComponent(src + '\nexport { deriveBlocks };')
);

const KEY = readFileSync(new URL('../app.js', import.meta.url), 'utf8').match(/eyJ[A-Za-z0-9_.-]+/)[0];
const get = async p => {
  const r = await fetch('https://vwffiuciogthfzekkkkz.supabase.co/rest/v1/' + p, { headers: { apikey: KEY } });
  if (!r.ok) throw new Error(p + ' -> ' + r.status);
  return r.json();
};

const facings = await get('planogram_facing?select=shelf,position,product_id&version_id=eq.1');
const products = new Map((await get('product?select=product_id,short_name,plu,brand')).map(p => [p.product_id, p]));
const shelves = [...new Set(facings.map(f => f.shelf))].sort();

const { blocks, nonRect, productCount } = deriveBlocks(facings, shelves);

const drawn = blocks.reduce((n, b) => n + b.facings, 0);
console.log(`products ${productCount} · facings ${facings.length} · blocks ${blocks.length} · drawn ${drawn}`);
console.log(drawn === facings.length ? 'OK  facings reconcile' : 'FAIL facings do not reconcile');
console.log(nonRect.length ? `WARN non-rectangular: ${JSON.stringify(nonRect)}` : 'OK  every region is a solid rectangle');

// No two blocks may occupy the same cell.
const occupied = new Map();
let overlaps = 0;
for (const b of blocks) {
  for (let r = b.row; r < b.row + b.h; r++) {
    for (let c = b.col; c < b.col + b.w; c++) {
      const k = r + ':' + c;
      if (occupied.has(k)) { overlaps++; console.log(`  OVERLAP ${shelves[r]}${c}: ${occupied.get(k)} vs ${b.productId}`); }
      occupied.set(k, b.productId);
    }
  }
}
console.log(overlaps ? `FAIL ${overlaps} overlapping cells` : 'OK  no block overlaps another');

// Every drawn cell must match the facing that is actually in the database.
let wrong = 0;
const rowOf = Object.fromEntries(shelves.map((s, i) => [s, i]));
for (const f of facings) {
  const got = occupied.get(rowOf[f.shelf] + ':' + f.position);
  if (got !== f.product_id) { wrong++; console.log(`  MISMATCH ${f.shelf}${f.position}: drew ${got}, db has ${f.product_id}`); }
}
console.log(wrong ? `FAIL ${wrong} cells disagree with the database` : 'OK  every cell matches its facing row');

console.log('\nsplit products:');
const byProd = new Map();
for (const b of blocks) byProd.set(b.productId, (byProd.get(b.productId) || 0) + 1);
for (const [pid, n] of byProd) {
  if (n > 1) console.log(`  ${products.get(pid)?.short_name || pid}: ${blocks.filter(b => b.productId === pid).map(b => b.label).join(' | ')}`);
}

console.log('\nwidest blocks:');
for (const b of [...blocks].sort((a, b2) => b2.w - a.w).slice(0, 3)) {
  console.log(`  ${products.get(b.productId)?.short_name}: ${b.label} (${b.w}x${b.h})`);
}
