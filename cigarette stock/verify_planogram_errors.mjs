// What the shelf editor SAYS when a workbook is wrong.
//
// Offline, no network, no .xlsx: readWorkbook takes sheets as arrays of rows, so
// a sheet can be written here directly. Imported from
// stock-count/planogram-diff.js, the module the page itself imports.
//
// Why a test about wording. On 01 Oct a lubes upload was refused for a duplicate
// POS Item ID and the reply was "I don't think there is any". There was — but the
// message named only the SECOND row and neither description:
//
//     Full Stock List row 34: POS Item ID 104719 appears twice.
//
// which leaves you to find the first one by eye, down a column of six-digit
// numbers, in a file you have just edited. A refusal that cannot be acted on
// reads as a bug in the checker, and the next move after that is to work around
// the checker. So the message is part of the contract, and this pins it.
import { readWorkbook } from '../stock-count/planogram-diff.js';

let pass = 0, fail = 0;
const check = (ok, msg, extra) => {
  (ok ? pass++ : fail++);
  console.log((ok ? 'OK   ' : 'FAIL ') + msg + (ok || extra === undefined ? '' : `  -> ${extra}`));
};

const HDR = ['', 'POS Description', 'POS Item ID', 'PLU', 'Short Name', 'Brand', 'Active', 'Positions'];
const row = (desc, pid, plu, short, pos) => ['', desc, pid, plu, short, '', 'TRUE', pos];

// A minimal valid grid: the position-number row, then one shelf.
const planSheet = labels => {
  const nums = ['', '', '1', '2', '3'];
  const shelf = ['', 'A', ...labels];
  return [['', 'Planogram'], nums, shelf];
};

const wb = (stockRows, labels) => ({
  'Full Stock List': [HDR, ...stockRows],
  'Planogram': planSheet(labels)
});

console.log('a clean workbook\n');
{
  const r = readWorkbook(wb([
    row('BLAZE HTP 0W40 1L', '104719', '9001', 'Blaze HTP 0W40 1L', 'A1'),
    row('REV-X TURBO HTP 5W40 1L', '104720', '9002', 'Rev-X Turbo 5W40 1L', 'A2')
  ], ['Blaze HTP 0W40 1L', 'Rev-X Turbo 5W40 1L', '']));
  check(r.errors.length === 0, 'two products with their own IDs raise nothing', r.errors);
  check(r.products.size === 2, 'and both are read', r.products.size);
}

console.log('\nthe duplicate that was reported as not being there\n');
{
  const r = readWorkbook(wb([
    row('BLAZE HTP 0W40 1L', '104719', '9001', 'Blaze HTP 0W40 1L', 'A1'),
    row('REV-X TURBO HTP 5W40 1L', '104719', '9002', 'Rev-X Turbo 5W40 1L', 'A2')
  ], ['Blaze HTP 0W40 1L', 'Rev-X Turbo 5W40 1L', '']));

  check(r.errors.length === 1, 'one error for one duplicate', r.errors);
  const e = r.errors[0] || '';
  check(e.includes('104719'), 'it names the Item ID', e);
  check(/row 2\b/.test(e) && /row 3\b/.test(e),
    'it names BOTH rows, not just the second one — the whole point', e);
  check(e.includes('BLAZE HTP 0W40 1L') && e.includes('REV-X TURBO HTP 5W40 1L'),
    'and both descriptions, so you can see which two collided without hunting', e);
  check(/merged into a single line|join/i.test(e),
    'and says why it matters: the two products would become one', e);

  // The first row still parsed. Refusing the file does not mean losing the half
  // of it that was fine, and the diff the user reads is built from this.
  check(r.products.size === 1 && r.products.has('104719'),
    'the first of the two is kept, the second dropped', [...r.products.keys()]);
}

console.log('\nwhat it must NOT call a duplicate\n');
{
  // Two products whose IDs differ only in a leading zero are two products. PLU
  // has the leading-zero problem all over this system; the Item ID must not
  // inherit it here by being normalised.
  const r = readWorkbook(wb([
    row('A PRODUCT', '104719', '9001', 'A', 'A1'),
    row('ANOTHER', '0104719', '9002', 'B', 'A2')
  ], ['A', 'B', '']));
  check(!r.errors.some(e => /appears|two rows/i.test(e)),
    '104719 and 0104719 are not the same ID', r.errors);
}
{
  // A blank spacer row between groups is ordinary spreadsheet formatting.
  const r = readWorkbook(wb([
    row('A PRODUCT', '104719', '9001', 'A', 'A1'),
    ['', '', '', '', '', '', '', ''],
    row('ANOTHER', '104720', '9002', 'B', 'A2')
  ], ['A', 'B', '']));
  check(r.errors.length === 0, 'a blank row is skipped, not read as a product', r.errors);
  check(r.products.size === 2, 'and both real rows still land', r.products.size);
}
{
  // Three rows, one ID repeated twice: two errors, each naming the first row and
  // its own row. Not one error that stops at the first collision.
  const r = readWorkbook(wb([
    row('FIRST', '104719', '9001', 'A', 'A1'),
    row('SECOND', '104719', '9002', 'B', 'A2'),
    row('THIRD', '104719', '9003', 'C', 'A3')
  ], ['A', 'B', 'C']));
  check(r.errors.filter(e => e.includes('104719')).length === 2,
    'a triplicate reports both collisions, so one pass fixes the file',
    r.errors.length);
}

console.log('\nthe other refusals still refuse\n');
{
  const r = readWorkbook(wb([
    ['', 'NO ID AT ALL', '', '9001', 'A', '', 'TRUE', 'A1']
  ], ['A', '', '']));
  check(r.errors.some(e => /no POS Item ID/i.test(e)),
    'a product with no Item ID is refused, and told where to get one', r.errors);
}
{
  const r = readWorkbook(wb([
    row('NOT AN ID', 'ABC', '9001', 'A', 'A1')
  ], ['A', '', '']));
  check(r.errors.some(e => /does not look like a POS Item ID/i.test(e)),
    'a non-numeric Item ID is refused', r.errors);
}
{
  const r = readWorkbook({ 'Planogram': planSheet(['A', '', '']) });
  check(r.errors.some(e => /Full Stock List/.test(e)),
    'a workbook with the wrong sheets says which sheet is missing', r.errors);
  // This is what the repo's own `Lubes planogram.xlsx` hits: its sheets are
  // "Lubes Planogram" and "Lubes Stock List", so it is NOT uploadable as-is.
  // The editor's download is the file to edit; that one is a seed fixture.
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
