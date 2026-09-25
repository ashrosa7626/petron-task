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
const get = async q => (await fetch(
  'https://vwffiuciogthfzekkkkz.supabase.co/rest/v1/' + q, { headers: { apikey: KEY } })).json();

// SCOPED to cigarettes, exactly as the import page scopes it. This is the
// whole point of the last section of this file.
//
// The category column arrives with 15_categories.sql. Until that is run
// PostgREST answers with an error object rather than rows, so fall back to the
// unscoped list — which is correct while cigarettes are the only products
// there are — and say so rather than failing for the wrong reason.
let all = await get('product?select=product_id,short_name,category&active=eq.true');
let categorised = Array.isArray(all);
if (!categorised) {
  console.log('NOTE  product.category does not exist yet — run 15_categories.sql. ' +
    'The scoping checks at the end of this file are skipped.');
  all = await get('product?select=product_id,short_name&active=eq.true');
  all.forEach(p => { p.category = 'CIGARETTES'; });
}
const products = new Map(all.filter(p => p.category === 'CIGARETTES').map(p => [p.product_id, p]));

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


// ---------------------------------------------------------------------------
// Scoping. buildPayload writes "sold nothing today" for every product it is
// handed, which is only true inside the report being read — and cigarettes,
// heated tobacco and lubes print as SEPARATE POS reports.
//
// Hand it everything and a cigarette import writes a zero-sales row for every
// lube and every TEREA as well, every day, with no error anywhere. Those rows
// land in vw_daily_reconciliation and read as if the whole shelf sold nothing,
// so the variance becomes the entire stock holding. It would look like a
// catastrophic shrinkage event and be a scoping bug.
// ---------------------------------------------------------------------------
console.log('\nthe zero-fill must not reach across shelves\n');

const byCat = {};
for (const p of all) (byCat[p.category] = byCat[p.category] || []).push(p);
const cats = Object.keys(byCat).sort();
console.log(`  active products by category: ${cats.map(c => `${c} ${byCat[c].length}`).join(', ')}`);

if (!categorised || cats.length < 2) {
  console.log('  SKIP  more than one category is needed — run 15_categories.sql then ' +
    '16_seed_lubes_iluma.sql, then re-run this.');
} else {
  const cig = new Map(byCat.CIGARETTES.map(p => [p.product_id, p]));
  const scoped = buildPayload(parsed, cig, 'SAFARI', '2026-09-09');
  check(scoped.rows.length === cig.size,
    `a cigarette report writes ${cig.size} rows — one per cigarette, and no more`,
    scoped.rows.length);

  const otherIds = new Set(all.filter(p => p.category !== 'CIGARETTES').map(p => p.product_id));
  const leaked = scoped.rows.filter(r => otherIds.has(r.product_id));
  check(leaked.length === 0,
    'and NOT ONE row for a lube or a TEREA, which would read as a whole shelf ' +
    'selling nothing that day',
    leaked.slice(0, 3).map(r => r.product_id).join(','));

  // The other direction: a lubes report must not zero-fill cigarettes.
  if (byCat.LUBES) {
    const lub = new Map(byCat.LUBES.map(p => [p.product_id, p]));
    const one = [...lub.keys()][0];
    const lubPayload = buildPayload([{ product_id: one, description: '', qty: 3 }],
      lub, 'SAFARI', '2026-09-09');
    check(lubPayload.rows.length === lub.size,
      `a lubes report writes ${lub.size} rows`, lubPayload.rows.length);
    check(!lubPayload.rows.some(r => cig.has(r.product_id)),
      'and touches no cigarette');
    check(lubPayload.rows.filter(r => r.qty_sold === 0).length === lub.size - 1,
      'with every lube that did not sell written as an explicit 0');
  }
}
