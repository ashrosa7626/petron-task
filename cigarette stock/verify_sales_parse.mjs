// Exercise the importer's text parsing on synthetic rows shaped like a
// Merchandise Sales Report. The real PDF is not available here, so this pins
// down the behaviour the parser is specified to have: Item ID from the
// Description prefix, quantity from the Qty column, never the PLU.
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../stock-count/import-sales.html', import.meta.url), 'utf8');
const grab = (from, to) => {
  const a = html.indexOf(from), b = html.indexOf(to);
  if (a < 0 || b < 0) throw new Error('could not locate ' + from);
  return html.slice(a, b);
};
const src =
  grab('const MONTHS =', '/* ==================================================================\n   Payload');
const { findBusinessDate, parseLines, findColumns } = await import(
  'data:text/javascript,' + encodeURIComponent(
    src + '\nexport { findBusinessDate, parseLines, findColumns };'));

let pass = 0, fail = 0;
const check = (ok, msg, extra) => {
  console.log((ok ? 'OK   ' : 'FAIL ') + msg + (ok || extra === undefined ? '' : '  -> ' + extra));
  ok ? pass++ : fail++;
};

// A row as readPdfRows would produce it: cells with x positions.
const row = (cells) => ({
  page: 1, y: 0,
  cells: cells.map(([s, x]) => ({ s: String(s), x, w: String(s).length * 5 })),
  text: cells.map(c => c[0]).join(' ')
});

// ---------- business date ----------
console.log('business date, from the header only\n');

const hdr = t => [row([[t, 40]])];
let d;

d = findBusinessDate(hdr('Business Date: 09/09/2026'));
check(d && d.date === '2026-09-09', 'DD/MM/YYYY reads day-first', d && d.date);
check(d && d.ambiguous === true, 'flags 09/09 as ambiguous — both parts could be a month');

d = findBusinessDate(hdr('Business Date: 25/12/2026'));
check(d && d.date === '2026-12-25', '25/12/2026 -> 2026-12-25', d && d.date);
check(d && d.ambiguous === false, 'not ambiguous when the first part cannot be a month');

d = findBusinessDate(hdr('Report Date 09-SEP-2026'));
check(d && d.date === '2026-09-09', 'DD-MMM-YYYY handled', d && d.date);

d = findBusinessDate(hdr('Business Date: 2026-09-09'));
check(d && d.date === '2026-09-09', 'ISO handled', d && d.date);

d = findBusinessDate(hdr('Merchandise Sales Report   Site 304602'));
check(d === null, 'no date in header returns null rather than guessing');

// The filename must never be the source; the parser only ever sees rows.
d = findBusinessDate(hdr('Site 304602    Petron MRR2 Safari'));
check(d === null, 'site number is not mistaken for a date');

// ---------- product lines ----------
console.log('\nproduct lines, Item ID from the Description prefix\n');

// Columns: Barcode | Description | Qty | Amount | Cost | Margin
const header = row([['Barcode', 60], ['Description', 150], ['Qty', 330],
                    ['Amount', 400], ['Cost', 470], ['Margin', 540]]);
const cols = findColumns([header]);
check(cols.source === 'header', 'Qty column located from the heading');

const data = [
  header,
  row([['9556109106958', 60], ['103732 - DUNHILL CLASSIC', 150], ['32', 330],
       ['672.00', 400], ['540.00', 470], ['132.00', 540]]),
  row([['76164217', 60], ['100634 - MARLBORO RED 20S', 150], ['1', 330],
       ['21.00', 400], ['17.00', 470], ['4.00', 540]]),
  row([['095508788', 60], ['100626 - MARLBORO BLACK MENTHOL 20S', 150], ['1', 330],
       ['21.00', 400], ['17.00', 470], ['4.00', 540]]),
  row([['CATEGORY TOTAL', 150], ['34', 330], ['714.00', 400]]),
];

let lines = parseLines(data, cols.qtyX);
check(lines.length === 3, 'three product lines found, category total ignored', lines.length);

const byId = Object.fromEntries(lines.map(l => [l.product_id, l]));
check(!!byId['103732'] && byId['103732'].qty === 32, 'Dunhill Classic qty 32 from the Qty column',
  byId['103732'] && byId['103732'].qty);
check(!!byId['100634'] && byId['100634'].qty === 1, 'Marlboro Red qty 1', byId['100634'] && byId['100634'].qty);

// The critical negative: a leading-zero PLU sits in the same row and must not
// be mistaken for the join key.
check(!!byId['100626'], 'Item ID 100626 parsed, not the barcode 095508788');
check(!lines.some(l => l.product_id === '095508788' || l.product_id === '9556109106958'),
  'no barcode/PLU was ever treated as a product_id');

check(byId['103732'].description === 'DUNHILL CLASSIC',
  'description carries through without the ID', byId['103732'].description);

// Quantity must come from the Qty column, not the first number on the row.
check(byId['103732'].qty !== 672, 'amount column not mistaken for quantity');

// ---------- a product split across two category groups ----------
console.log('\nrepeated products\n');
const dup = [
  header,
  row([['x', 60], ['100730 - MEVIUS ORIGINAL BLUE 20S', 150], ['4', 330], ['84.00', 400]]),
  row([['x', 60], ['100730 - MEVIUS ORIGINAL BLUE 20S', 150], ['2', 330], ['42.00', 400]]),
];
lines = parseLines(dup, cols.qtyX);
check(lines.length === 1, 'the same product on two lines collapses to one', lines.length);
check(lines[0].qty === 6, 'its quantities are summed, not overwritten', lines[0] && lines[0].qty);

// ---------- no Qty heading ----------
console.log('\nfallback when the layout changes\n');
const noHead = findColumns([row([['Barcode', 60], ['Description', 150], ['Units', 330]])]);
check(noHead.source === 'header', 'Units accepted as a Qty heading');
const missing = findColumns([row([['Barcode', 60], ['Description', 150], ['Total', 330]])]);
check(missing.source === 'guess' && missing.qtyX === null,
  'unrecognised heading falls back to guess, so the page can warn');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
