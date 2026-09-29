// Which shelves a sales import writes, and which it must leave alone.
//
// Offline, no network, no PDFs. scopeByCoverage is imported from
// stock-count/sales-parse.js — the module import-sales.html itself imports — so
// this exercises the shipped decision rather than a description of it.
//
// The thing being pinned: a POS report may now be declared as covering several
// categories at once, which is a WIDER claim than the old single-category
// picker made, and the zero-fill is what makes a wrong claim expensive.
// buildPayload writes "sold nothing today" for every product it is handed, so a
// shelf wrongly ticked is a shelf recorded as having sold its entire holding
// nothing — reported as variance equal to the whole stock, with no error
// anywhere. The guard is that a ticked category with no matched line in the file
// is left out unless somebody says otherwise on purpose.
import { scopeByCoverage, buildPayload } from '../stock-count/sales-parse.js';

let pass = 0, fail = 0;
const check = (ok, msg, extra) => {
  (ok ? pass++ : fail++);
  console.log((ok ? 'OK   ' : 'FAIL ') + msg + (ok || extra === undefined ? '' : `  -> ${extra}`));
};

// A stand-in shelf set: 3 cigarettes, 2 lubes, 2 Iluma.
const PRODUCTS = new Map([
  ['100001', { product_id: '100001', short_name: 'Cig A', category: 'CIGARETTES' }],
  ['100002', { product_id: '100002', short_name: 'Cig B', category: 'CIGARETTES' }],
  ['100003', { product_id: '100003', short_name: 'Cig C', category: 'CIGARETTES' }],
  ['200001', { product_id: '200001', short_name: 'Lube A', category: 'LUBES' }],
  ['200002', { product_id: '200002', short_name: 'Lube B', category: 'LUBES' }],
  ['300001', { product_id: '300001', short_name: 'Terea A', category: 'ILUMA' }],
  ['300002', { product_id: '300002', short_name: 'Terea B', category: 'ILUMA' }]
]);
const line = (pid, qty) => ({ product_id: pid, qty, description: '' });
const catOf = p => (p && p.category) || 'CIGARETTES';
const opts = zeroFill => ({ categoryOf: catOf, zeroFill: zeroFill || new Set() });

console.log('one shelf ticked — unchanged behaviour\n');

{
  const matched = [line('100001', 4), line('100002', 1)];
  const { coverage, skip, scoped } = scopeByCoverage(matched, cigsOnly(), ['CIGARETTES'], opts());
  check(coverage.length === 1 && coverage[0].lines === 2 && coverage[0].products === 3,
    'coverage counts matched LINES against the shelf size',
    JSON.stringify(coverage));
  check(skip.size === 0, 'nothing is skipped when the report covers the ticked shelf');
  const { rows } = buildPayload(matched, scoped, 'SAFARI', '2026-09-20');
  check(rows.length === 3, '3 rows written — the shelf, zero-filled', rows.length);
  check(rows.filter(r => r.qty_sold === 0).length === 1,
    'the cigarette that did not sell is written as an explicit 0');
}

console.log('\nseveral shelves in one report — the point of the change\n');

{
  // One PDF that genuinely prints cigarettes and lubes.
  const matched = [line('100001', 4), line('200001', 2)];
  const { coverage, skip, scoped } =
    scopeByCoverage(matched, PRODUCTS, ['CIGARETTES', 'LUBES'], opts());
  check(skip.size === 0, 'both shelves appear in the file, so neither is skipped');
  check(scoped.size === 5, 'the payload scope is the UNION of the ticked shelves', scoped.size);
  const { rows } = buildPayload(matched, scoped, 'SAFARI', '2026-09-20');
  check(rows.length === 5, '5 rows — 3 cigarettes and 2 lubes', rows.length);
  check(!rows.some(r => r.product_id.startsWith('3')),
    'and NOT ONE Iluma row, because Iluma was not ticked');
  check(rows.find(r => r.product_id === '200002').qty_sold === 0,
    'the lube that did not sell is zero-filled, so it still reconciles');
}

console.log('\na shelf the report never mentions — the failure this guards\n');

{
  // Cigarettes and lubes ticked, but the file is a cigarette report.
  const matched = [line('100001', 4), line('100002', 1), line('100003', 7)];
  const { coverage, skip, scoped } =
    scopeByCoverage(matched, PRODUCTS, ['CIGARETTES', 'LUBES'], opts());
  const lubes = coverage.find(c => c.category === 'LUBES');
  check(lubes.lines === 0 && lubes.products === 2,
    'the mis-ticked shelf is reported as 0 lines of 2 products',
    JSON.stringify(lubes));
  check(skip.has('LUBES') && !skip.has('CIGARETTES'),
    'only the unmentioned shelf is skipped');
  check(scoped.size === 3, 'its products are out of scope entirely', scoped.size);
  const { rows } = buildPayload(matched, scoped, 'SAFARI', '2026-09-20');
  check(!rows.some(r => r.product_id.startsWith('2')),
    'so no lube is written down to zero by a cigarette report');

  // What it would have cost. This is the number the guard exists for.
  const unguarded = buildPayload(matched, PRODUCTS, 'SAFARI', '2026-09-20');
  const wouldZero = unguarded.rows.filter(r => r.product_id.startsWith('2') && r.qty_sold === 0);
  console.log(`     (unguarded, the same file would write ${wouldZero.length} lubes as ` +
    `having sold nothing — variance equal to the whole shelf)`);
}

console.log('\nand the legitimate case: a shelf that is in the report and sold nothing\n');

{
  const matched = [line('100001', 4)];
  const { skip, scoped } = scopeByCoverage(
    matched, PRODUCTS, ['CIGARETTES', 'LUBES'], opts(new Set(['LUBES'])));
  check(skip.size === 0, 'an explicit zeroFill opt-in stops the shelf being skipped');
  check(scoped.size === 5, 'its products come back into scope', scoped.size);
  const { rows } = buildPayload(matched, scoped, 'SAFARI', '2026-09-20');
  check(rows.filter(r => r.product_id.startsWith('2')).every(r => r.qty_sold === 0),
    'both lubes are written as 0, which is what keeps them in reconciliation');
}

console.log('\nbefore 15_categories.sql, when there is no category column\n');

{
  // No category on any row. catOf reads that as CIGARETTES, which is what every
  // row was, so a cigarettes-only import must behave exactly as it always did.
  const plain = new Map([...cigsOnly()].map(([k, p]) =>
    [k, { product_id: p.product_id, short_name: p.short_name }]));
  const matched = [line('100001', 4)];
  const { coverage, skip, scoped } = scopeByCoverage(matched, plain, ['CIGARETTES'], opts());
  check(coverage[0].products === 3 && coverage[0].lines === 1,
    'rows with no category column count as cigarettes', JSON.stringify(coverage));
  check(skip.size === 0 && scoped.size === 3,
    'so the pre-migration import is untouched by any of this');
}

function cigsOnly() {
  return new Map([...PRODUCTS].filter(([, p]) => p.category === 'CIGARETTES'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
