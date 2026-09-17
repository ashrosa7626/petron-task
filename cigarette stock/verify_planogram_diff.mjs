// What the editor page would do to the database, checked without touching it.
//
// The important test is the FIRST one: the real workbook against the live
// database must diff to nothing. If it does not, then either the two have
// drifted (which is itself the finding) or the diff is wrong — and every other
// result here would be built on sand.
//
// Everything after that applies one invented edit at a time to the real
// workbook and checks exactly what it produces, including the edits that must
// be REFUSED. Needs the network for the database side.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PASS = [], FAIL = [];
const check = (ok, msg, extra) => {
  (ok ? PASS : FAIL).push(msg);
  console.log((ok ? 'OK   ' : 'FAIL ') + msg + (ok || extra === undefined ? '' : `  -> ${extra}`));
};

// Same DOM shim the xlsx test uses, so xlsx.js runs unmodified.
await import('./xlsx_dom_shim.mjs');

const { readXlsx, writeXlsx } = await import('../stock-count/xlsx.js');
const { diffPlanogram, buildWorkbookRows, expandPositions, formatPositions, isActive } =
  await import('../stock-count/planogram-diff.js');

const KEY = readFileSync(new URL('../app.js', import.meta.url), 'utf8').match(/eyJ[A-Za-z0-9_.-]+/)[0];
const get = async p => {
  const r = await fetch('https://vwffiuciogthfzekkkkz.supabase.co/rest/v1/' + p,
    { headers: { apikey: KEY } });
  if (!r.ok) throw new Error(p + ' -> ' + r.status);
  return r.json();
};

const version = (await get('planogram_version?select=version_id&status=eq.active'))[0];
const db = {
  products: new Map((await get('product?select=product_id,plu,pos_description,short_name,brand,active'))
    .map(p => [p.product_id, p])),
  aliases: new Map((await get('product_alias?select=alias,product_id')).map(a => [a.alias, a.product_id])),
  facings: new Map((await get(`planogram_facing?select=shelf,position,product_id&version_id=eq.${version.version_id}`))
    .map(f => [f.shelf + ':' + f.position, f.product_id])),
  counts: new Map()
};
for (const l of await get('stock_count_line?select=product_id')) {
  db.counts.set(l.product_id, (db.counts.get(l.product_id) || 0) + 1);
}

console.log(`\nactive version ${version.version_id} — ${db.products.size} products, ` +
  `${db.aliases.size} aliases, ${db.facings.size} facings\n`);

/* The baseline is GENERATED from the database, not read from the repo's
   CIGARETTES PLANOGRAM.xlsx.

   That file was the source of truth while the only way to change the shelf was
   to edit it and run a migration. The editor page changed that: the database is
   now authoritative and the workbook is a snapshot, which drifts the moment
   anyone edits a PLU in the browser — as it already has. Asserting against the
   stale file would fail for the right reason and the wrong purpose.

   What still has to hold is the round trip: download, upload unchanged, no
   diff. Generating the baseline the same way the download button does is the
   only way to test that honestly. */
const wb = await writeXlsx(buildWorkbookRows(db));
const sheets = await readXlsx(await wb.arrayBuffer());

// ---------------------------------------------------------------------------
console.log('a freshly generated workbook is a no-op\n');
// ---------------------------------------------------------------------------
const base = diffPlanogram(sheets, db);
check(base.errors.length === 0, 'it passes every validation',
  base.errors.slice(0, 3).join(' | '));
check(base.moved.length === 0, 'no facing differs from the database', base.moved.length);
check(base.added.length === 0 && base.deactivated.length === 0,
  'no product is added or removed',
  `+${base.added.length} -${base.deactivated.length}`);
check(base.plu.length === 0, 'no PLU differs', JSON.stringify(base.plu.slice(0, 2)));
check(base.empty, 'so uploading it untouched is a no-op — the baseline the editor needs');
check(base.after.facings === db.facings.size &&
      base.after.products === new Set(db.facings.values()).size,
  `and it describes the same shelf: ${new Set(db.facings.values()).size} products ` +
  `across ${db.facings.size} facings`,
  `${base.after.products} / ${base.after.facings}`);

// The repo's workbook is a snapshot, kept for the xlsx parser tests. Report how
// far it has drifted rather than asserting it has not — drift is expected now.
{
  const raw = readFileSync(new URL('./CIGARETTES PLANOGRAM.xlsx', import.meta.url));
  const old = await readXlsx(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const d = diffPlanogram(old, db);
  const drift = d.plu.length + d.added.length + d.deactivated.length + d.moved.length;
  console.log(drift
    ? `     note: the repo's CIGARETTES PLANOGRAM.xlsx is ${drift} change(s) behind the ` +
      `database (${d.plu.map(p => p.product_id).join(', ') || 'no PLUs'}). Expected — the ` +
      `editor writes to the database, and that file is now only a snapshot.`
    : `     note: the repo's CIGARETTES PLANOGRAM.xlsx still matches the database.`);
}

// ---------------------------------------------------------------------------
console.log('\nediting a PLU — the thing Rosa asked for first\n');
// ---------------------------------------------------------------------------
const clone = () => JSON.parse(JSON.stringify(sheets));
const stockCol = (s, header) => {
  const rows = s['Full Stock List'];
  const h = rows.findIndex(r => r.some(c => String(c).toUpperCase() === 'POS ITEM ID'));
  return [rows, h, rows[h].findIndex(c => String(c).toUpperCase() === header)];
};
const rowOf = (s, pid) => {
  const [rows, h, idCol] = stockCol(s, 'POS ITEM ID');
  for (let r = h + 1; r < rows.length; r++) if (String(rows[r][idCol]).trim() === pid) return r;
  return -1;
};

{
  const s = clone();
  const [rows, , pluCol] = stockCol(s, 'PLU');
  const r = rowOf(s, '100734');                       // Mevius Sky Blue
  // Derived from whatever is there now, never a literal: a fixed value silently
  // became a no-op the day that PLU was corrected in the database for real.
  const was = String(rows[r][pluCol]);
  const now = was === '490221200804' ? '4902210200804' : '490221200804';
  rows[r][pluCol] = now;
  const d = diffPlanogram(s, db);
  check(d.errors.length === 0, 'a PLU edit passes validation', d.errors.join(' | '));
  check(d.plu.length === 1 && d.plu[0].product_id === '100734',
    'exactly one PLU change is reported', JSON.stringify(d.plu));
  check(d.plu[0].to === now && d.plu[0].from === was,
    'with both the old and the new value, so it can be read before it is applied',
    `${d.plu[0] && d.plu[0].from} -> ${d.plu[0] && d.plu[0].to}`);
  check(d.shelfChanged === false,
    'and it does NOT change the shelf, so no new planogram version is made');
}

// ---------------------------------------------------------------------------
console.log('\nadding a product\n');
// ---------------------------------------------------------------------------
// The gondola is FULL — 6 shelves x 27 positions is exactly the 162 facings it
// holds. So adding a product is never "put it in the gap"; it always takes a
// facing from something else. The test has to reflect that or it is testing a
// shelf that does not exist.
{
  const s = clone();
  const [rows, h] = stockCol(s, 'POS ITEM ID');
  const hdr = rows[h].map(c => String(c).toUpperCase());
  const put = (row, header, v) => { const i = hdr.indexOf(header); if (i >= 0) row[i] = v; };
  const row = new Array(rows[h].length).fill('');
  put(row, 'POS DESCRIPTION', 'ROTHMANS DEMI BLUE');
  put(row, 'POS ITEM ID', '109001');
  put(row, 'PLU', '9556109100001');
  put(row, 'POSITIONS', 'B5');
  rows.push(row);

  // B5 is one of Dunhill Classic's ten facings (A1-5, B1-5). Give it away, and
  // shrink Dunhill Classic's Positions to match or the two sheets disagree.
  const [, , posCol] = stockCol(s, 'POSITIONS');
  rows[rowOf(s, '103732')][posCol] = 'A1-5 | B1-4';

  const plan = s['Planogram'];
  const numRow = plan.findIndex(r => r.some((c, i) => String(c).trim() === '1' && String(r[i + 1]).trim() === '2'));
  const firstCol = plan[numRow].findIndex(c => String(c).trim() === '1');
  const bRow = plan.findIndex((r, i) => i > numRow && r.some(c => String(c).trim().toUpperCase() === 'B'));
  plan[bRow][firstCol + 4] = 'ROTHMANS DEMI BLUE';

  const d = diffPlanogram(s, db);
  check(d.errors.length === 0, 'adding a product by taking a facing from another passes',
    d.errors.join(' | '));
  check(d.added.length === 1 && d.added[0].product_id === '109001',
    'the new product is reported', JSON.stringify(d.added.map(a => a.product_id)));
  check(d.moved.length === 1 && d.moved[0].cell === 'B:5' &&
        d.moved[0].before === '103732' && d.moved[0].after === '109001',
    'and the one facing is shown changing hands, from and to',
    JSON.stringify(d.moved));
  check(d.shelfChanged === true, 'the shelf changed, so a new version IS made');
  check(d.after.products === 55 && d.after.facings === 162,
    'the shape becomes 55 products across the same 162 facings — the shelf is full',
    `${d.after.products} / ${d.after.facings}`);
  check(d.newAliases.size === 0,
    'no alias is proposed — the label IS the product\'s own name, so it already resolves',
    JSON.stringify([...d.newAliases.keys()]));
  check(d.deactivated.length === 0,
    'and Dunhill Classic is NOT treated as removed — it still has nine facings',
    JSON.stringify(d.deactivated.map(x => x.product_id)));
}

// An alias is for a label that is NOT the product's own name — the "RED Winston"
// case. Those still have to be captured, or the label stops resolving the next
// time the sheet is read.
{
  const s = clone();
  const plan = s['Planogram'];
  let done = false;
  outer2: for (const row of plan) {
    for (let c = 0; c < row.length; c++) {
      if (String(row[c]).trim().toUpperCase() === 'DUNHILL CLASSIC') {
        row[c] = 'Dunhill Classic';   // same product, different capitalisation
        done = true;
        break outer2;
      }
    }
  }
  const d = diffPlanogram(s, db);
  check(done && d.errors.length === 0 && d.newAliases.size === 0,
    'a label differing only in case needs no alias either — matching is case-insensitive',
    d.errors.join(' | '));
}
{
  // A genuinely non-canonical label: resolves by prefix, so it DOES need an alias.
  const s = clone();
  const plan = s['Planogram'];
  let hits = 0;
  for (const row of plan) {
    for (let c = 0; c < row.length; c++) {
      // The generated grid uses the short name. Shorten it further into
      // something that is nobody's name but still prefix-matches exactly one
      // description — that is what an alias is for.
      if (String(row[c]).trim().toUpperCase() === 'PETER STUYVESANT REMIX') {
        row[c] = 'PETER STUYVESANT REM'; hits++;
      }
    }
  }
  const d = diffPlanogram(s, db);
  const posOk = d.errors.every(e => !/nothing on Full Stock List matches/.test(e));
  check(hits > 0 && posOk && d.newAliases.has('PETER STUYVESANT REM'),
    'a shortened label resolves by prefix and IS registered as an alias, so it keeps working',
    JSON.stringify([...d.newAliases.keys()]));
}

// ---------------------------------------------------------------------------
console.log('\nremoving a product — never a delete\n');
// ---------------------------------------------------------------------------
{
  const s = clone();
  const [rows, , actCol] = stockCol(s, 'ACTIVE');
  const [, , posCol] = stockCol(s, 'POSITIONS');
  const r = rowOf(s, '100760');                       // LD Menthol
  const was = String(rows[r][posCol]);
  rows[r][posCol] = '';
  if (actCol >= 0) rows[r][actCol] = 'FALSE';
  // clear its cells from the grid
  const plan = s['Planogram'];
  for (const row of plan) {
    for (let c = 0; c < row.length; c++) {
      if (String(row[c]).trim().toUpperCase().startsWith('LD MENTHOL')) row[c] = '';
    }
  }
  const d = diffPlanogram(s, db);
  check(d.errors.length === 0, 'clearing it from both sheets passes', d.errors.join(' | '));
  const gone = d.deactivated.find(x => x.product_id === '100760');
  check(!!gone, 'it is reported as deactivated, not deleted',
    JSON.stringify(d.deactivated.map(x => x.product_id)));
  check(gone && /Active = FALSE/.test(gone.why || ''),
    'the reason names the Active column, since that is what was set', gone && gone.why);
  check(gone && gone.counts > 0,
    'the number of historical count lines still referencing it is shown, ' +
    'because those must keep resolving', gone && gone.counts);
  check(d.moved.length === expandPositions(was).length &&
        d.moved.every(m => m.after === null),
    'its facings are freed and nothing takes them',
    `${d.moved.length} freed, was at ${was}`);
}

// Clearing the grid ALONE has to remove it too. That is how the older workbook
// said it, having no Active column — and it is the truth of the matter either
// way: a product with no facings never appears on a count, so leaving it active
// would have the sales importer writing it a zero row that reconciles against
// nothing.
{
  const s = clone();
  const [rows, , posCol] = stockCol(s, 'POSITIONS');
  rows[rowOf(s, '100760')][posCol] = '';               // Active left TRUE on purpose
  const plan = s['Planogram'];
  for (const row of plan) {
    for (let c = 0; c < row.length; c++) {
      if (String(row[c]).trim().toUpperCase().startsWith('LD MENTHOL')) row[c] = '';
    }
  }
  const d = diffPlanogram(s, db);
  const gone = d.deactivated.find(x => x.product_id === '100760');
  check(d.errors.length === 0 && !!gone, 'clearing only the grid removes it as well',
    d.errors.join(' | ') || JSON.stringify(d.deactivated.map(x => x.product_id)));
  check(gone && /no facings/.test(gone.why || ''),
    'and the reason says so, rather than claiming a column was set that was not',
    gone && gone.why);
}

// ---------------------------------------------------------------------------
console.log('\nedits that must be REFUSED\n');
// ---------------------------------------------------------------------------
{
  const s = clone();
  const [rows, , idCol] = stockCol(s, 'POS ITEM ID');
  const r = rowOf(s, '100760');
  rows[r][idCol] = '';
  const d = diffPlanogram(s, db);
  check(d.errors.some(e => /no POS Item ID/i.test(e)),
    'a product with no POS Item ID is refused — it cannot be invented',
    d.errors[0]);
}
{
  const s = clone();
  const [rows, , idCol] = stockCol(s, 'POS ITEM ID');
  rows[rowOf(s, '100760')][idCol] = '103732';         // already Dunhill Classic
  const d = diffPlanogram(s, db);
  check(d.errors.some(e => /appears twice/i.test(e)),
    'a duplicated POS Item ID is refused', d.errors[0]);
}
{
  const s = clone();
  const [rows, , posCol] = stockCol(s, 'POSITIONS');
  rows[rowOf(s, '100760')][posCol] = 'F20-21';        // grid still says otherwise
  const d = diffPlanogram(s, db);
  check(d.errors.some(e => /the two sheets must agree/i.test(e)),
    'the Positions column disagreeing with the grid is refused', d.errors[0]);
}
{
  const s = clone();
  const plan = s['Planogram'];
  outer: for (const row of plan) {
    for (let c = 0; c < row.length; c++) {
      if (String(row[c]).trim().toUpperCase() === 'DUNHILL CLASSIC') {
        row[c] = 'MARLBORO GOLD SOMETHING'; break outer;
      }
    }
  }
  const d = diffPlanogram(s, db);
  check(d.errors.some(e => /nothing on Full Stock List matches/i.test(e)),
    'a grid label matching no product is refused, rather than silently dropping a facing',
    d.errors[0]);
}
{
  // The workbook in the repo predates the Active column, so add one — this is
  // the shape the editor page downloads.
  const s = clone();
  const [rows, h] = stockCol(s, 'POS ITEM ID');
  const actCol = rows[h].length;
  rows[h][actCol] = 'Active';
  for (let r = h + 1; r < rows.length; r++) {
    while (rows[r].length < actCol) rows[r].push('');
    rows[r][actCol] = 'TRUE';
  }
  rows[rowOf(s, '103732')][actCol] = 'FALSE';         // still all over shelves A and B
  const d = diffPlanogram(s, db);
  check(d.errors.some(e => /still has facings/i.test(e)),
    'marking a product inactive while it still holds facings is refused', d.errors[0]);
}
{
  // And the case the column exists FOR: absent means leave alone, not blank.
  const s = clone();
  const d = diffPlanogram(s, db);
  check(d.renamed.length === 0,
    'a workbook with no Short Name or Brand column reports NO renames — absent ' +
    'means leave alone, never overwrite 54 curated names with the POS shouting',
    JSON.stringify(d.renamed.slice(0, 2).map(x => x.product_id)));
}

// ---------------------------------------------------------------------------
console.log('\nsmall pieces\n');
// ---------------------------------------------------------------------------
check(formatPositions(expandPositions('A1-5 | B1-5')) === 'A1-5 | B1-5',
  'positions survive expand -> format unchanged', formatPositions(expandPositions('A1-5 | B1-5')));
check(formatPositions(expandPositions('C21, C23, C25')) === 'C21 | C23 | C25',
  'a split product keeps its gaps — LD Red is three blocks, not one run',
  formatPositions(expandPositions('C21, C23, C25')));
check(expandPositions('B18 | C16').length === 2,
  'and Marlboro Black keeps its two diagonally offset facings');
check(isActive('') && isActive('TRUE') && isActive('yes') &&
      !isActive('FALSE') && !isActive('no') && !isActive('0'),
  'Active accepts what Excel actually writes, and only an explicit negative removes');

console.log(`\n${PASS.length} passed, ${FAIL.length} failed`);
process.exit(FAIL.length ? 1 : 0);
