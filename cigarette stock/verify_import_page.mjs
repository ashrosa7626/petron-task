// Load the sales import page's own module and check the things a person would
// notice in the first ten seconds.
//
// This exists because of a bug that shipped on 28 Sep: `ctx` was read one line
// above the `const ctx = {...}` that declares it, which is a temporal dead zone
// ReferenceError. It aborted the module at load, so every listener registered
// below that line — including the one that opens the file picker — never bound.
// The page rendered perfectly and pressing "Choose the sales PDF" did nothing.
//
// No unit test could have found that: the parser was fine, the payload builder
// was fine, and the failure was the page never finishing its own startup. So
// this runs the real module, off the real HTML, under page_dom_shim.mjs, and
// asserts it reaches the end and wires what it claims to.
//
// Offline. No network, no PDFs, no browser.
import { readFileSync } from 'node:fs';
import { makeDocument, makeStorage, makeDb } from './page_dom_shim.mjs';

const PAGE = new URL('../stock-count/import-sales.html', import.meta.url);
const html = readFileSync(PAGE, 'utf8');

let pass = 0, fail = 0;
const check = (ok, msg, extra) => {
  (ok ? pass++ : fail++);
  console.log((ok ? 'OK   ' : 'FAIL ') + msg + (ok || extra === undefined ? '' : `  -> ${extra}`));
};

// The page's module, as the browser would get it.
const source = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];

/* A product table with all three shelves on it, so the scoping is real. */
const PRODUCTS = [
  ...Array.from({ length: 4 }, (_, i) =>
    ({ product_id: '1000' + (i + 10), short_name: 'Cig ' + i, plu: '10' + i, active: true, category: 'CIGARETTES' })),
  ...Array.from({ length: 3 }, (_, i) =>
    ({ product_id: '2000' + (i + 10), short_name: 'Lube ' + i, plu: '20' + i, active: true, category: 'LUBES' })),
  ...Array.from({ length: 2 }, (_, i) =>
    ({ product_id: '3000' + (i + 10), short_name: 'Terea ' + i, plu: '30' + i, active: true, category: 'ILUMA' }))
];

async function load(opts = {}) {
  const doc = makeDocument(html);
  const { client, calls } = makeDb({
    branch: [{ branch_id: 'SAFARI', name: 'Safari' }],
    product: PRODUCTS,
    pos_sales_daily: [],
    stock_count: []
  });
  const local = makeStorage(opts.storageFull);
  if (opts.saved) local._map.set('pos_import_category', opts.saved);

  /* The shim goes on globalThis, not into a parameter list: modules.js is
     imported for real and reads `location` from its OWN scope, which a wrapper
     function's arguments cannot reach.

     They are deliberately NOT restored afterwards. The page's handlers reach for
     `document` when they fire, which is long after load() returns — pulling the
     shim back out is what makes a later click throw instead of doing its job.
     Each load() installs a fresh set, so the blocks below stay independent. */
  const g = {
    document: doc,
    localStorage: local,
    sessionStorage: makeStorage(false),
    location: { search: opts.search || '', href: '', reload() {} },
    supabase: { createClient: () => client },
    pdfjsLib: { GlobalWorkerOptions: {} }
  };
  g.window = globalThis;
  for (const k of Object.keys(g)) globalThis[k] = g[k];

  // Rewrite the import specifiers to absolute file URLs, then run the module
  // body inside an async function. The module's own text is otherwise untouched.
  const rewritten = source.replace(/from '\.\/([a-z-]+\.js)'/g,
    (_, f) => `from '${new URL('../stock-count/' + f, import.meta.url).href}'`);
  const imports = [...rewritten.matchAll(/^import\s+([\s\S]*?)\s+from\s+'([^']+)';/gm)];
  let body = rewritten;
  const bound = {};
  for (const m of imports) {
    body = body.replace(m[0], '');
    const mod = await import(m[2]);
    const names = m[1].replace(/[{}]/g, '').split(',').map(x => x.trim()).filter(Boolean);
    for (const n of names) bound[n] = mod[n];
  }

  let error = null;
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(...Object.keys(bound),
      `"use strict";return (async () => {${body}\n})();`);
    await fn(...Object.values(bound));
  } catch (e) {
    error = e;
  }
  // init() is fired at the end of the module and awaits the stubbed database.
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));
  return { doc, calls, local, error };
}

console.log('the module finishes loading — the bug that shipped\n');

{
  const { doc, error } = await load();
  check(!error, 'import-sales.html\'s module runs to the end with no exception',
    error && error.message);

  // The symptom, tested as the symptom: press the box, get a file dialog.
  const drop = doc.getElementById('drop');
  const file = doc.getElementById('file');
  let opened = 0;
  file.addEventListener('click', () => { opened++; });
  drop.click();
  check(opened === 1, 'pressing the drop zone opens the file picker exactly once', opened);

  // It is a button, so it has to answer the keyboard too.
  opened = 0;
  drop.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault() {} });
  check(opened === 1, 'and Enter on it does the same', opened);

  check(file.parent === null || file.parent.attrs.id !== 'drop',
    'the file input is not inside the drop zone, so the bubbled click cannot re-enter it');
}

console.log('\nthe picker — one shelf, or several\n');

{
  const { doc, calls } = await load();
  const rows = doc.getElementById('fCat').querySelectorAll('input');
  check(rows.length === 3, 'one row per category (cigarettes, heated tobacco, lubes)', rows.length);
  const on = rows.filter(r => r.checked).map(r => r.value);
  check(on.length === 1 && on[0] === 'CIGARETTES',
    'tobacco opens with cigarettes alone ticked — never wider than the likely report', on);

  const prodQ = calls.filter(c => c.table === 'product').pop();
  const inFilter = prodQ.filters.find(f => f[0] === 'in');
  check(inFilter && inFilter[1] === 'category',
    'the product list is fetched with an IN on category, so several can be asked for at once');
  check(JSON.stringify(inFilter[2]) === '["CIGARETTES"]',
    'and it asks for exactly what is ticked', JSON.stringify(inFilter && inFilter[2]));
}

{
  // Tick lubes as well: the query must widen to both, in the canonical order.
  const { doc, calls, local } = await load();
  const lubes = doc.getElementById('fCat').querySelectorAll('input').find(r => r.value === 'LUBES');
  lubes.checked = true;
  lubes.dispatchEvent({ type: 'change', preventDefault() {} });
  await new Promise(r => setTimeout(r, 0));

  const inFilter = calls.filter(c => c.table === 'product').pop().filters.find(f => f[0] === 'in');
  check(JSON.stringify(inFilter[2]) === '["CIGARETTES","LUBES"]',
    'ticking a second shelf refetches for both', JSON.stringify(inFilter[2]));
  check(local._map.get('pos_import_category') === 'CIGARETTES,LUBES',
    'and the choice is remembered as a list', local._map.get('pos_import_category'));

  const ticked = doc.getElementById('fCat').querySelectorAll('input').filter(r => r.checked);
  check(ticked.length === 2, 'both stay ticked after the repaint', ticked.length);
}

{
  // Unticking the last one is refused: nothing ticked is not a narrower import,
  // it is a page that cannot match a single line.
  const { doc, calls } = await load();
  const cigs = doc.getElementById('fCat').querySelectorAll('input').find(r => r.value === 'CIGARETTES');
  const before = calls.filter(c => c.table === 'product').length;
  cigs.checked = false;
  cigs.dispatchEvent({ type: 'change', preventDefault() {} });
  await new Promise(r => setTimeout(r, 0));
  const still = doc.getElementById('fCat').querySelectorAll('input').filter(r => r.checked);
  check(still.length === 1 && still[0].value === 'CIGARETTES',
    'the last tick refuses to come off', still.map(s => s.value));
  check(calls.filter(c => c.table === 'product').length === before,
    'and nothing is refetched for an empty selection');
}

console.log('\nwhat it remembers, and what it survives\n');

{
  const { doc } = await load({ saved: 'CIGARETTES,ILUMA' });
  const on = doc.getElementById('fCat').querySelectorAll('input')
    .filter(r => r.checked).map(r => r.value);
  check(JSON.stringify(on) === '["CIGARETTES","ILUMA"]',
    'a remembered list comes back ticked', on);
}

{
  // The old single-select stored a bare category name. Nobody's preference is
  // lost by the change to a list.
  const { doc } = await load({ saved: 'LUBES' });
  const on = doc.getElementById('fCat').querySelectorAll('input')
    .filter(r => r.checked).map(r => r.value);
  check(JSON.stringify(on) === '["LUBES"]',
    'a value saved by the old single-select version still works', on);
}

{
  // localStorage on the shop device has been full, and setItem throws there for
  // any key. The page must load and work regardless.
  const { doc, error } = await load({ storageFull: true });
  check(!error, 'the module still loads when localStorage.setItem throws',
    error && error.message);
  const cigs = doc.getElementById('fCat').querySelectorAll('input').find(r => r.value === 'LUBES');
  let threw = null;
  try {
    cigs.checked = true;
    cigs.dispatchEvent({ type: 'change', preventDefault() {} });
  } catch (e) { threw = e; }
  check(!threw, 'and ticking a shelf does not throw when the choice cannot be saved',
    threw && threw.message);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
