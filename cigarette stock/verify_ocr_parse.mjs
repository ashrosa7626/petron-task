// Verify the sales-report parser against the REAL scans.
//
// fixtures/sales_ocr_2026*.json is the actual Tesseract output for the 09/09
// and 10/09 Merchandise Sales Reports — the same PDFs the POS printed, read at
// 258 dpi turned 90 degrees, with every OCR mistake left in. The parser is
// imported straight out of stock-count/sales-parse.js, so this exercises the
// shipped code and not a copy of it.
//
// The numbers these fixtures must reproduce were established by hand from the
// paper: 31 lines, 152 packs, RM2,435.80 for 09/09.
//
//   node verify_ocr_parse.mjs
import { readFileSync } from 'node:fs';
import {
  parseLines, mergeDuplicates, findBusinessDate, findGrandTotal, identifyReport,
  reconcileTotals, explainShortfall, buildPayload, quantityEvidence, pluAgrees
} from '../stock-count/sales-parse.js';

let pass = 0, fail = 0;
const check = (ok, msg, extra) => {
  console.log((ok ? 'OK   ' : 'FAIL ') + msg + (ok || extra === undefined ? '' : '  -> ' + extra));
  ok ? pass++ : fail++;
};
const load = n => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8'));
const flat = fx => fx.pages.map(p => p.text).join('\n');
const read = fx => mergeDuplicates(parseLines(fx.pages));

// ===========================================================================
console.log('the real 09/09/2026 report — 31 lines, 152 packs, RM2,435.80\n');
// ===========================================================================
const f09 = load('sales_ocr_20260909.json');
const t09 = flat(f09);
const l09 = read(f09);

check(identifyReport(t09).key === 'sales', 'identified as the Merchandise Sales Report');
check(l09.length === 31, `31 product lines found (got ${l09.length})`);

const d09 = findBusinessDate(t09);
check(d09 && d09.date === '2026-09-09', 'business date is 09/09, the day reported', d09 && d09.date);
check(d09 && d09.date !== '2026-09-10',
  'NOT 10/09 — "Printed on 10/09/2026" is the first date in the header and the wrong one');
check(d09 && d09.ambiguous === true, '09/09 flagged ambiguous — day-first and month-first agree here');
check(d09 && d09.span === false, 'a single-day report is not flagged as a span');

const g09 = findGrandTotal(t09);
check(g09 && Math.abs(g09.nett_sales - 2435.80) < 0.01,
  'Grand Total read as 2,435.80', g09 && g09.nett_sales);

const rec09 = reconcileTotals(l09, g09);
check(rec09.balances,
  `every line accounted for: summed ${rec09.summed} = Grand Total ${rec09.grand}`,
  `short by ${rec09.shortfall}`);

const bad09 = l09.filter(l => !l.ok);
const packs09 = l09.filter(l => l.ok).reduce((n, l) => n + l.qty, 0);
check(bad09.length === 1, `1 quantity held back for a human (got ${bad09.length})`,
  bad09.map(b => b.product_id).join(','));
check(packs09 === 145, `145 packs confirmed by the report's own figures (got ${packs09})`);

// The one held back is worth 7 packs; 145 + 7 is the 152 counted off the paper.
const suggested09 = bad09.reduce((n, l) => n + (l.suggestions[0] ? l.suggestions[0].qty : 0), 0);
check(packs09 + suggested09 === 152,
  `145 confirmed + ${suggested09} suggested = 152 packs, the hand-checked total`,
  packs09 + suggested09);

const ches = bad09.find(l => l.product_id === '100642');
check(!!ches, 'Chesterfield Blue is the line whose quantity OCR mangled');
check(ches && ches.suggestions[0] && ches.suggestions[0].qty === 7,
  'its quantity works out to 7 from the columns that read cleanly',
  ches && JSON.stringify(ches.suggestions));
check(ches && ches.suggestions[0].from.length >= 2,
  'and by two independent routes, not one', ches && ches.suggestions[0].from.join(' + '));
check(ches && ches.qty !== 7,
  'but it is NOT applied — an unconfirmed quantity is never written on the parser\'s say-so');

// A misread PRICE that still proves the quantity is not a finding. Marlboro
// Menthol scanned 17.80 for 17.90; the cost columns still give 2 packs, and no
// price is ever written, so there is nothing here to tell anyone about.
const menthol = l09.find(l => l.product_id === '100632');
check(menthol && menthol.ok && menthol.qty === 2,
  'a line whose price misread but whose quantity is proved goes through unflagged',
  menthol && `ok=${menthol.ok} qty=${menthol.qty} price=${menthol.price}`);

// ===========================================================================
console.log('\nthe real 10/09/2026 report\n');
// ===========================================================================
const f10 = load('sales_ocr_20260910.json');
const t10 = flat(f10);
const l10 = read(f10);
const g10 = findGrandTotal(t10);
const rec10 = reconcileTotals(l10, g10);

check(l10.length === 27, `27 product lines found (got ${l10.length})`);
check(findBusinessDate(t10).date === '2026-09-10', 'business date is 10/09');
check(g10 && Math.abs(g10.nett_sales - 1376.70) < 0.01, 'Grand Total 1,376.70', g10 && g10.nett_sales);
check(rec10.balances, `balances: ${rec10.summed} = ${rec10.grand}`, `short by ${rec10.shortfall}`);

check(l10.every(l => l.ok),
  'every quantity on this report is confirmed — nothing to ask a human',
  l10.filter(l => !l.ok).map(l => l.product_id).join(','));
check(l10.reduce((n, l) => n + l.qty, 0) === 85, '85 packs',
  l10.reduce((n, l) => n + l.qty, 0));

// Lines whose price lost its decimal point ("1840" for 18.40) still confirm
// their quantity, because the point is put back before the columns are read.
// That is plumbing, and it is deliberately not reported as anything.
const dropped10 = l10.filter(l => /\s\d{4}\s/.test(l.raw));
check(dropped10.length >= 2,
  `${dropped10.length} lines really did scan with a bare integer where the price should be`);
check(dropped10.every(l => l.ok),
  'and every one of them still goes through without troubling anyone',
  dropped10.filter(l => !l.ok).map(l => l.product_id).join(','));

// ===========================================================================
console.log('\nthe file-level check is what catches a line lost whole\n');
// ===========================================================================
// A line dropped by OCR passes every per-line test, because it is not there to
// be tested. Remove LD Menthol (4 x 12.70) from the 09/09 fixture and the only
// thing that notices is the Grand Total.
const dropped = {
  pages: f09.pages.map(p => ({
    page: p.page,
    lines: p.lines.filter(l => !/100760/.test(l.text))
  }))
};
const lDrop = mergeDuplicates(parseLines(dropped.pages));
const recDrop = reconcileTotals(lDrop, g09);

check(lDrop.length === 30, 'one line fewer reaches the parser', lDrop.length);
check(lDrop.every(l => l.ok || l.suggestions.length),
  'and every surviving line still passes its own arithmetic — nothing local shows the loss');
check(!recDrop.balances, 'the file no longer balances');
check(Math.abs(recDrop.shortfall - 50.80) < 0.01,
  'short by exactly 50.80', recDrop.shortfall);

const why = explainShortfall(recDrop.shortfall, lDrop);
check(why.some(h => h.qty === 4 && Math.abs(h.price - 12.70) < 0.01),
  'the gap divides evenly as 4 x 12.70, naming the missing row',
  JSON.stringify(why));

// ===========================================================================
console.log('\nthe Item ID, and the things that have broken it before\n');
// ===========================================================================
const one = text => parseLines([{ page: 1, lines: [{ text, bbox: null }] }])[0];

// The line that cost a debugging cycle: a stray digit fused to the front of
// the ID, which a \b-anchored pattern dropped in silence.
let r = one('8885004830042 4100760 - LD MENTHOL 20S 4 12.70 11.91 47.64 50.80 50.80 3.16 6 SR 0.00');
check(r && r.product_id === '100760',
  'a digit fused to the front of the ID does not lose the line', r && r.product_id);
check(r && r.ok && r.qty === 4, 'and it still reads 4 packs', r && r.qty);

// The barcode sits in the same row and carries leading zeros; joining on it
// produces duplicate and missing rows, so it must never be the key.
r = one('95508788 100626 - MARLBORO BLACK MENTHOL 20S 1 17.90 16.70 16.70 17.90 17.90 1.20 7 SR 0.00');
check(r && r.product_id === '100626', 'the Item ID wins over the barcode beside it', r && r.product_id);

// One line in six comes back with a comma for the decimal point.
r = one('88823393 100642 - CHESTERFIELD BLUE 20S 7 12,80 11.85 82,95 89.60 89.60 6.65 7 SR 0.00');
check(r && r.ok && r.qty === 7 && Math.abs(r.price - 12.80) < 0.001,
  'a comma decimal separator reads the same as a point', r && `${r.qty} x ${r.price}`);

// A dropped decimal point is put back — but the reading is only taken because
// the quantity it implies is then corroborated.
r = one('01231233 100740 - WINSTON RED 20S 3 1660 15.52 46.56 49.80 49.80 3.24 7 SR 0.00');
check(r && r.ok && Math.abs(r.price - 16.60) < 0.001 && r.qty === 3,
  'a price of "1660" is re-read as 16.60, and 3 x 16.60 = 49.80 confirms 3 packs',
  r && `${r.qty} x ${r.price}`);

// A price that misreads while the COST columns still prove the quantity is not
// a problem: 46.56 / 15.52 is 3 exactly, so the line goes through even though
// Total Sales is nonsense. No price is written, so nothing here matters.
r = one('01231233 100740 - WINSTON RED 20S 3 1660 15.52 46.56 99.99 99.99 3.24 7 SR 0.00');
check(r && r.ok && r.qty === 3,
  'one surviving money column is enough to confirm a quantity',
  r && `ok=${r.ok} qty=${r.qty}`);

// ...but when every column disagrees, nothing is assumed.
r = one('01231233 100740 - WINSTON RED 20S 3 1660 15.52 44.11 99.99 99.99 3.24 7 SR 0.00');
check(r && !r.ok, 'a quantity nothing corroborates is held back, not applied',
  r && `ok=${r.ok} qty=${r.qty} price=${r.price}`);
check(r && !r.suggestions.length && /nothing else on the line confirms it/.test(r.reason),
  'and it says so plainly rather than inventing a suggestion', r && r.reason);

// A number at the end of a description must not be mistaken for the quantity.
r = one('9556109105715 100128 - PETER STUYVESANT 100 5 16.70 15.70 78.50 83.50 83.50 5.00 6 SR 0.00');
check(r && r.ok && r.qty === 5,
  'a description ending in a number does not become the quantity', r && r.qty);

// The subtotal and grand total rows are furniture, not products.
check(parseLines([{ page: 1, lines: [
  { text: 'Subtotal by Category: 2,435.80 2,435.80 159.61' },
  { text: 'Grand Total: 2,435.80 2,435.80 159.61' },
  { text: 'Page 2 of 2' }] }]).length === 0,
  'subtotal, grand total and page footer are never read as products');

// The tolerance is on the money, not on the ratio: 35.80 / 17.80 rounds to 2,
// but 2 x 17.80 is 20 cents out, so that pairing proves nothing.
const loose = quantityEvidence({ qty: 2, price: 17.80, cost: 16.70, total_cost: 33.40,
                                 total_sales: 35.80, nett_sales: 35.80 });
check(loose.length === 1 && loose[0].from.length === 1 && loose[0].from[0] === 'Total Cost ÷ Cost',
  'only the pairing that is exact to the cent corroborates a quantity',
  JSON.stringify(loose));

// ===========================================================================
console.log('\nthe PLU cross-check — a second label for the same pack\n');
// ===========================================================================
// PLU is never a join key and this does not make it one. It is checked only
// because the report prints it beside the Item ID, so the two can disagree.
check(pluAgrees('9556109106958', '9556109106958'), 'identical PLUs agree');

// The report prints its category code in the same region and OCR runs it onto
// the front of the barcode. Every one of these is a real pairing off the scans.
check(pluAgrees('0176164217', '76164217'), 'a category code run onto the front is not a mismatch');
check(pluAgrees('0201231233', '01231233'), 'nor is "02" in front of a PLU that starts with a zero');
check(pluAgrees('039556109105715', '9556109105715'), 'nor "03" in front of a 13-digit barcode');
check(pluAgrees('', '9556109106958'), 'nothing scanned means no complaint');

// ...but a genuinely different digit is caught. Dunhill Red really did scan as
// ...8171 against ...9171 on the 09/09 report.
check(!pluAgrees('9556109108171', '9556109109171'),
  'a single wrong digit in the middle IS a mismatch');
check(!pluAgrees('4902210200804', '490221200804'),
  'and so is a barcode one digit longer than the one on record');

// The parser has to pull the PLU off the line before any of that can happen.
r = one('02-02-02 01231233 100740 - WINSTON RED 20S 3 16.60 15.52 46.56 49.80 49.80 3.24 7 SR 0.00');
check(r && r.scanned_plu === '01231233',
  'the PLU is taken as the last digit run before the Item ID, not the category code',
  r && r.scanned_plu);
check(r && r.product_id === '100740', 'and the Item ID is still the Item ID', r && r.product_id);

// ===========================================================================
console.log('\nthe business date, which is never today and never the filename\n');
// ===========================================================================
const D = t => findBusinessDate(t);
check(D('Merchandise Sales Report Printed on 10/09/2026 15:49') === null,
  '"Printed on" alone yields no date — it is the day the paper came out, not the day reported');
check(D('Business Date: 25/12/2026').date === '2026-12-25', 'DD/MM/YYYY reads day-first');
check(D('Business Date: 25/12/2026').ambiguous === false,
  'not ambiguous when the first part cannot be a month');
check(D('Business Date: 2026-09-09').date === '2026-09-09', 'ISO handled');
check(D('Report Date 09-SEP-2026').date === '2026-09-09', 'DD-MMM-YYYY handled');
check(D('Site 304602 PETRON MRR2 SAFARI') === null, 'a site number is not mistaken for a date');

const span = D('Business Date From 01/09/2026 To 09/09/2026');
check(span && span.span === true && span.to === '2026-09-09',
  'a report covering a range is flagged as a span, so it can be refused', JSON.stringify(span));
check(D('Business Date From 09/09/2026 To 09/09/2026').span === false,
  'From = To is a single day, not a span');

// ===========================================================================
console.log('\nthe wrong report, which someone will upload eventually\n');
// ===========================================================================
// Real header text from the 26/08 Inventory Balance PDF.
const inv = [
  'Inventory Balance',
  'Site ID : 304602',
  'Site Name : PETRON MRR2 SAFARI',
  'Period : 01/08/2026 - 26/08/2026',
  'Item ID Description Unit Opening Receiving Sales (+) Sales Adjust Adjust StockTake Balance Total',
  '100137 ~~ DUNHILL ZEST 16.31 130 0 0 0 0 0 0 130 2,120.30'
].join('\n');
check(identifyReport(inv).key === 'inventory',
  'an Inventory Balance report is named, so the message can say which report to print instead');
check(findGrandTotal(inv) === null, 'it has no Grand Total, so it could never be written anyway');

// ===========================================================================
console.log('\nabsent products, the behaviour everything else depends on\n');
// ===========================================================================
// Only products that sold appear in the report. The rest sold nothing and must
// be written as an explicit zero, or they drop out of reconciliation entirely.
const products = new Map();
for (const l of l09) products.set(l.product_id, { product_id: l.product_id, short_name: l.description });
for (let i = 0; i < 25; i++) products.set('9000' + String(i).padStart(2, '0'), { short_name: 'unsold ' + i });
// 103735 really is the Item ID that sells but is not on the planogram, so it is
// the one taken back out of the product table to stand for an unknown.
products.delete('103735');

const sellers = l09.filter(l => l.ok && products.has(l.product_id));
const { rows, known, unknown } = buildPayload(sellers, products, 'SAFARI', '2026-09-09');
check(rows.length === products.size, `one row per active product (${rows.length})`);
check(rows.filter(r => r.qty_sold === 0).length === products.size - sellers.length,
  'every product absent from the report is written as an explicit zero',
  rows.filter(r => r.qty_sold === 0).length);
check(rows.every(r => r.sale_date === '2026-09-09' && r.branch_id === 'SAFARI'),
  'every row carries the business date and branch');
check(rows.every(r => Number.isInteger(r.qty_sold) && r.qty_sold >= 0),
  'every quantity is a non-negative integer');

const { unknown: unk2 } = buildPayload(
  sellers.concat([{ product_id: '103735', description: 'PETER STUYVESANT REMIX', qty: 1 }]),
  products, 'SAFARI', '2026-09-09');
check(unk2.length === 1 && unk2[0].product_id === '103735',
  'an Item ID with no product is flagged, not swallowed');
check(!buildPayload(sellers.concat([{ product_id: '103735', qty: 1 }]), products, 'SAFARI', 'x')
  .rows.some(r => r.product_id === '103735'), 'and it is not written');

// ===========================================================================
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
