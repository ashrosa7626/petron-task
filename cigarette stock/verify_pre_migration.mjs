// Does the shipped code still find the cigarette planogram on a database
// WITHOUT the category column?
//
// This is the deploy-order question, and it is not academic: the pages go live
// the moment they are pushed, the migration is run by hand minutes or hours
// later, and the count happens every night in between. The first version of
// this change asked PostgREST for `category` by name and refused a sitting
// whose every shelf was not set up — which would have taken the nightly
// cigarette count down until somebody opened the SQL editor.
//
// Keep this passing until 15_categories.sql is in everywhere; after that it
// simply reports that categories are present and checks the same resolution.
import { readFileSync } from 'node:fs';
import { catOf, hasCategories, MODULES } from '../stock-count/modules.js';

const KEY = readFileSync(new URL('../app.js', import.meta.url), 'utf8')
  .match(/eyJ[A-Za-z0-9_.-]+/)[0];
const get = async q => (await fetch('https://vwffiuciogthfzekkkkz.supabase.co/rest/v1/' + q,
  { headers: { apikey: KEY } })).json();

const versions = await get('planogram_version?select=*&status=eq.active');
const branches = await get('branch?select=branch_id,name');

let pass = 0, fail = 0;
const ok = (c, m, e) => { c ? pass++ : fail++;
  console.log((c ? 'OK   ' : 'FAIL ') + m + (c || e === undefined ? '' : `  -> ${e}`)); };

console.log(`\nlive schema: category column present = ${hasCategories(versions)}\n`);

const norm = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
const match = branches.find(b => norm(b.name).includes(norm('Safari')));
ok(!!match, 'Safari resolves', match && match.branch_id);

// What index.html/start.html now do to find each shelf.
for (const [modId, mod] of Object.entries(MODULES)) {
  const found = mod.categories.map(cat => ({
    cat, v: versions.find(v => v.branch_id === match.branch_id && catOf(v) === cat) || null
  }));
  const got = found.filter(f => f.v).map(f => f.cat);
  const missing = found.filter(f => !f.v).map(f => f.cat);
  console.log(`  ${modId}: found ${got.join(',') || 'none'}${missing.length ? ' | missing ' + missing.join(',') : ''}`);
}

const cig = versions.find(v => v.branch_id === match.branch_id && catOf(v) === 'CIGARETTES');
ok(!!cig, 'THE ONE THAT MATTERS: the cigarette planogram still resolves pre-migration',
   cig && cig.version_id);

if (cig) {
  const fac = await get(`planogram_facing?select=shelf,position,product_id,version_id&version_id=eq.${cig.version_id}`);
  ok(fac.length === 162, `and still has its 162 facings`, fac.length);
  ok(fac.every(f => f.version_id === cig.version_id),
     'every facing carries its version_id, which is how the page splits them per shelf');
}

// Lubes must find nothing and say so, rather than borrowing the cigarette shelf.
const lub = versions.find(v => v.branch_id === match.branch_id && catOf(v) === 'LUBES');
ok(!lub, 'lubes correctly finds NO planogram yet, rather than falling back to cigarettes');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
