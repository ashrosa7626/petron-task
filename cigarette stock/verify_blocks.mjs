// Run the shipped block derivation against the live data, for EVERY active
// shelf. planogram.js is the module the count and restock screens both import,
// so this exercises exactly the code that draws the grid — not a copy of it.
//
// It used to take the first active planogram version and check that. That was
// fine while there was one shelf; with cigarettes, Iluma and lubes all active
// it checked whichever PostgREST happened to return first and silently ignored
// the other two.
import { readFileSync } from 'node:fs';
import { deriveBlocks } from '../stock-count/planogram.js';

const KEY = readFileSync(new URL('../app.js', import.meta.url), 'utf8').match(/eyJ[A-Za-z0-9_.-]+/)[0];
const get = async p => {
  const r = await fetch('https://vwffiuciogthfzekkkkz.supabase.co/rest/v1/' + p, { headers: { apikey: KEY } });
  if (!r.ok) throw new Error(p + ' -> ' + r.status);
  return r.json();
};

const PASS = [], FAIL = [];
const check = (ok, msg, extra) => {
  (ok ? PASS : FAIL).push(msg);
  console.log((ok ? '  OK   ' : '  FAIL ') + msg + (ok || extra === undefined ? '' : `  -> ${extra}`));
};

// The ACTIVE versions, never a hard-coded id. Editing a shelf from
// planogram.html archives the old version and makes a new one, so a test
// pinned to a number would quietly check an archived layout and pass.
const versions = await get('planogram_version?select=version_id,category,branch_id&status=eq.active');
if (!versions.length) throw new Error('no active planogram version');
const products = new Map(
  (await get('product?select=product_id,short_name,plu,brand,category')).map(p => [p.product_id, p]));

// What each shelf should be. Not a guess: measured from the workbook and the
// seed, and pinned here so a bad edit or a half-run migration is loud.
const EXPECT = {
  CIGARETTES: { products: 54, facings: 162, blocks: 58, split: 3 },
  ILUMA:      { products: 21, facings: 34,  blocks: 21, split: 0 },
  LUBES:      { products: 31, facings: 47,  blocks: 35, split: 4 }
};

for (const v of versions.sort((a, b) => a.category.localeCompare(b.category))) {
  const facings = await get(
    `planogram_facing?select=shelf,position,product_id&version_id=eq.${v.version_id}`);
  const shelves = [...new Set(facings.map(f => f.shelf))].sort();
  const { blocks, nonRect, productCount } = deriveBlocks(facings, shelves);
  const drawn = blocks.reduce((n, b) => n + b.facings, 0);
  const split = [...new Set(blocks.filter(b => b.regionTotal > 1).map(b => b.productId))];

  console.log(`\n${v.category} — ${v.branch_id} v${v.version_id} · ${shelves.join('')} · ` +
    `${productCount} products · ${facings.length} facings · ${blocks.length} blocks`);

  check(drawn === facings.length, 'every facing is drawn exactly once',
    `${drawn} vs ${facings.length}`);

  // No two blocks may occupy the same cell — one product's input sitting on
  // another's facing is how a count goes wrong without anybody noticing.
  const occupied = new Map();
  let overlaps = 0;
  for (const b of blocks) {
    for (let r = b.row; r < b.row + b.h; r++) {
      for (let c = b.col; c < b.col + b.w; c++) {
        const k = r + ':' + c;
        if (occupied.has(k)) { overlaps++; console.log(`    OVERLAP ${shelves[r]}${c}`); }
        occupied.set(k, b.productId);
      }
    }
  }
  check(overlaps === 0, 'no block overlaps another', overlaps);

  // Every drawn cell must match the facing actually in the database.
  let wrong = 0;
  const rowOf = Object.fromEntries(shelves.map((s, i) => [s, i]));
  for (const f of facings) {
    if (occupied.get(rowOf[f.shelf] + ':' + f.position) !== f.product_id) wrong++;
  }
  check(wrong === 0, 'every cell matches its facing row', wrong);

  // A split product that loses its "n of m" marker is counted once and the
  // rest of its stock is never counted at all.
  let badMarks = 0;
  for (const pid of split) {
    const parts = blocks.filter(b => b.productId === pid)
      .sort((a, b) => a.regionIndex - b.regionIndex);
    if (!parts.every((p, i) => p.regionIndex === i && p.regionTotal === parts.length)) badMarks++;
    console.log(`    split: ${products.get(pid)?.short_name || pid} — ` +
      parts.map(p => `${p.label} [${p.regionIndex + 1} of ${p.regionTotal}]`).join('  '));
  }
  check(badMarks === 0, 'every split product carries a correct "n of m" marker', badMarks);

  if (nonRect.length) {
    // Legitimate — lubes Blaze Multi 20W50 4L is an L across C7, C8 and D8 —
    // as long as the pieces are marked, which the check above proves.
    console.log(`    L-shaped, drawn as row runs: ` +
      nonRect.map(n => `${products.get(n.productId)?.short_name || n.productId} (${n.box} box)`).join(', '));
  }

  const want = EXPECT[v.category];
  if (want) {
    check(productCount === want.products && facings.length === want.facings &&
          blocks.length === want.blocks && split.length === want.split,
      `matches the seeded shape: ${want.products} products, ${want.facings} facings, ` +
      `${want.blocks} blocks, ${want.split} split`,
      `${productCount}/${facings.length}/${blocks.length}/${split.length}`);
  } else {
    console.log(`    (no expected shape recorded for ${v.category})`);
  }
}

console.log(`\n${PASS.length} passed, ${FAIL.length} failed`);
process.exit(FAIL.length ? 1 : 0);
