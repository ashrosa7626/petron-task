// Verify the importer's payload builder against the known-good day.
//
// buildPayload is imported from stock-count/sales-parse.js, the module the page
// itself imports, so this tests shipped code. The 30 non-zero lines from
// 08_pos_sales_20260909.sql stand in for what the parser reads off the report;
// the assertion is that the builder turns them into the full 54-row payload
// with 24 explicit zeros.
//
// Needs the network (it reads the live product table) and the known-good SQL
// file. For the parser itself, see verify_ocr_parse.mjs, which runs offline
// against captured OCR of the real scans.
import { readFileSync } from 'node:fs';
import { buildPayload } from '../stock-count/sales-parse.js';

// The known-good target.
const TARGET = '/Users/anieqluqman/Downloads/08_pos_sales_20260909.sql';
let sql;
try {
  sql = readFileSync(TARGET, 'utf8');
} catch (e) {
  console.log(`SKIP  ${TARGET} is not here — this check needs the known-good day's SQL.`);
  process.exit(0);
}
const target = new Map();
for (const m of sql.matchAll(/\('SAFARI',\s*'([\d-]+)',\s*'(\d+)',\s*(\d+)\)/g)) {
  target.set(m[2], Number(m[3]));
}

const KEY = readFileSync(new URL('../app.js', import.meta.url), 'utf8').match(/eyJ[A-Za-z0-9_.-]+/)[0];
const res = await fetch(
  'https://vwffiuciogthfzekkkkz.supabase.co/rest/v1/product?select=product_id,short_name&active=eq.true',
  { headers: { apikey: KEY } });
const products = new Map((await res.json()).map(p => [p.product_id, p]));

// What the parser would have found: only the products that actually sold,
// plus the one Item ID that is not on the planogram.
const parsed = [...target].filter(([, q]) => q > 0)
  .map(([pid, q]) => ({ product_id: pid, description: '', qty: q }));
parsed.push({ product_id: '103735', description: 'PETER STUYVESANT REMIX PURPLE YELLOW', qty: 2 });

const { rows, known, unknown } = buildPayload(parsed, products, 'SAFARI', '2026-09-09');

const check = (ok, msg) => console.log((ok ? 'OK   ' : 'FAIL ') + msg);
console.log(`parser found ${parsed.length} lines -> payload ${rows.length} rows\n`);

check(rows.length === 54, `54 rows written (got ${rows.length})`);
check(rows.length === target.size, `matches the target row count (${target.size})`);

const zeros = rows.filter(r => r.qty_sold === 0).length;
check(zeros === 24, `24 products written as explicit zero (got ${zeros})`);

const nonzero = rows.filter(r => r.qty_sold > 0).length;
check(nonzero === 30, `30 products with sales (got ${nonzero})`);

let wrong = 0;
for (const r of rows) {
  if (!target.has(r.product_id)) { wrong++; console.log(`  EXTRA ${r.product_id}`); continue; }
  if (target.get(r.product_id) !== r.qty_sold) {
    wrong++;
    console.log(`  MISMATCH ${r.product_id}: built ${r.qty_sold}, target ${target.get(r.product_id)}`);
  }
}
for (const pid of target.keys()) {
  if (!rows.some(r => r.product_id === pid)) { wrong++; console.log(`  MISSING ${pid}`); }
}
check(wrong === 0, 'every product_id and quantity matches the target file exactly');

check(unknown.length === 1 && unknown[0].product_id === '103735',
  `the unknown Item ID is flagged, not swallowed (got ${unknown.map(u => u.product_id).join(',') || 'none'})`);
check(!rows.some(r => r.product_id === '103735'),
  'the unknown Item ID is not written');
check(known.length === 30, `30 report lines matched a product (got ${known.length})`);

check(rows.every(r => r.sale_date === '2026-09-09'), 'every row carries the business date');
check(rows.every(r => r.branch_id === 'SAFARI'), 'every row carries the branch');
check(rows.every(r => Number.isInteger(r.qty_sold) && r.qty_sold >= 0),
  'every quantity is a non-negative integer');

// The failure this exists to prevent.
const dropped = [...target].filter(([, q]) => q === 0).length;
console.log(`\nIf absent products were left out, ${dropped} of 54 would have no variance for 09/09.`);
