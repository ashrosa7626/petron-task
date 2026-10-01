// Correcting a submitted count, driven through the real history.html.
//
// Offline. Runs the page's own module under page_dom_shim.mjs, the same rig as
// verify_import_page.mjs and for the same reason: nothing else loads a page, and
// a top-level throw takes every listener with it while the page still draws.
//
// What this is guarding, beyond "it loads":
//
//   * The Correct button must appear on a SUBMITTED count and not on a draft. A
//     draft holds no lines at all until it is submitted — the figures are still
//     on the counting device — so a button there would edit nothing.
//   * An update must carry corrected_by and corrected_reason. The trigger in
//     18_count_corrections.sql refuses the change without them, so a page that
//     omits either produces an error the user cannot act on.
//   * An RLS refusal is 200 with an EMPTY ARRAY and no error. This module has
//     been bitten by that three times. The page must notice rows did not come
//     back and say so, not report success.
//   * A count whose correction table does not exist yet (18 not run) must still
//     open and read normally.
import { readFileSync } from 'node:fs';
import { makeDocument, makeStorage, makeDb } from './page_dom_shim.mjs';

const PAGE = new URL('../stock-count/history.html', import.meta.url);
const html = readFileSync(PAGE, 'utf8');
const source = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];

let pass = 0, fail = 0;
const check = (ok, msg, extra) => {
  (ok ? pass++ : fail++);
  console.log((ok ? 'OK   ' : 'FAIL ') + msg + (ok || extra === undefined ? '' : `  -> ${extra}`));
};

const PRODUCTS = [
  { product_id: '100001', short_name: 'Cig A', plu: '111', active: true, category: 'CIGARETTES' },
  { product_id: '100002', short_name: 'Cig B', plu: '222', active: true, category: 'CIGARETTES' },
  { product_id: '100003', short_name: 'Cig C', plu: '333', active: true, category: 'CIGARETTES' }
];
const SUBMITTED = {
  count_id: 50, branch_id: 'SAFARI', category: 'CIGARETTES', count_date: '2026-09-30',
  shift: 'NIGHT', staff_name: 'Asyraf', status: 'submitted', version_id: 3,
  submitted_at: '2026-09-30T16:00:00Z', title: 'Cig Count of 30/09/2026'
};
const DRAFT = { ...SUBMITTED, count_id: 51, count_date: '2026-10-01', status: 'draft',
  submitted_at: null, title: 'Cig Count of 01/10/2026' };

function tables(opts = {}) {
  return {
    branch: [{ branch_id: 'SAFARI', name: 'Petron MRR2 Safari' }],
    product: PRODUCTS,
    planogram_version: [{ version_id: 3, branch_id: 'SAFARI', category: 'CIGARETTES',
                          status: 'active' }],
    planogram_facing: [
      { version_id: 3, shelf: 'A', position: 1, product_id: '100001' },
      { version_id: 3, shelf: 'A', position: 2, product_id: '100002' },
      { version_id: 3, shelf: 'A', position: 3, product_id: '100003' }
    ],
    stock_count: opts.counts || [SUBMITTED, DRAFT],
    stock_count_line: [
      { count_id: 50, product_id: '100001', packs: 10, add_in: 0, not_on_shelf: false },
      { count_id: 50, product_id: '100002', packs: 21, add_in: 0, not_on_shelf: false },
      { count_id: 50, product_id: '100003', packs: 0, add_in: 0, not_on_shelf: false }
    ],
    stock_count_correction: opts.corrections ||
      (opts.noCorrectionTable
        ? { __result: { data: null, error: { message: 'relation "stock_count_correction" does not exist' } } }
        : []),
    pos_sales_daily: opts.hasPos === false ? [] : [{ product_id: '100001' }],
    vw_daily_reconciliation: opts.rec || [],
    stock_restock: [],
    stock_restock_line: []
  };
}

async function load(opts = {}) {
  const doc = makeDocument(html);
  const t = tables(opts);
  if (opts.updateResult) {
    // Only the UPDATE is overridden. The initial read of the same table has to
    // succeed, or there are no rows on screen to correct in the first place.
    const rows = t.stock_count_line;
    t.stock_count_line = { rows, __result: q => (q.update ? opts.updateResult : null) };
  }
  const { client, calls } = makeDb(t);
  const local = makeStorage(opts.storageFull);
  const confirms = [];

  const g = {
    document: doc,
    localStorage: local,
    sessionStorage: makeStorage(false),
    location: { search: opts.search || '', pathname: '/stock-count/history.html', href: '' },
    history: { replaceState() {} },
    supabase: { createClient: () => client },
    confirm: msg => { confirms.push(msg); return opts.confirm !== false; },
    alert: () => {},
    print: () => {}
  };
  g.window = globalThis;
  for (const k of Object.keys(g)) globalThis[k] = g[k];

  const rewritten = source.replace(/from '\.\/([a-z-]+\.js)'/g,
    (_, f) => `from '${new URL('../stock-count/' + f, import.meta.url).href}'`);
  const imports = [...rewritten.matchAll(/^import\s+([\s\S]*?)\s+from\s+'([^']+)';/gm)];
  let body = rewritten;
  const bound = {};
  for (const m of imports) {
    body = body.replace(m[0], '');
    const mod = await import(m[2]);
    for (const n of m[1].replace(/[{}]/g, '').split(',').map(x => x.trim()).filter(Boolean)) {
      bound[n] = mod[n];
    }
  }

  let error = null;
  try {
    const fn = new Function(...Object.keys(bound),
      `"use strict";return (async () => {${body}\n})();`);
    await fn(...Object.values(bound));
  } catch (e) { error = e; }
  for (let i = 0; i < 4; i++) await new Promise(r => setTimeout(r, 0));
  return { doc, calls, local, error, confirms };
}

const rowFor = (doc, id) =>
  doc.getElementById('listRows').querySelectorAll('.row').find(r => r.dataset.id === String(id));

console.log('the page loads and lists\n');
{
  const { doc, error } = await load();
  check(!error, 'history.html\'s module runs to the end with no exception',
    error && error.message);
  const rows = doc.getElementById('listRows').querySelectorAll('.row');
  check(rows.length === 2, 'both counts are listed', rows.length);
}

console.log('\nthe Correct button, and where it is not\n');
{
  const { doc } = await load();
  rowFor(doc, 50).click();
  await new Promise(r => setTimeout(r, 0));
  check(doc.getElementById('btnEdit').hidden === false,
    'a submitted count offers Correct counts');
  check(doc.getElementById('editPanel').hidden === true,
    'and the panel stays shut until it is pressed');
}
{
  const { doc } = await load();
  rowFor(doc, 51).click();
  await new Promise(r => setTimeout(r, 0));
  check(doc.getElementById('btnEdit').hidden === true,
    'a draft does not — it holds no lines to correct');
}
{
  // 18_count_corrections.sql not run. The page must still work, and the button
  // must say what is missing rather than failing on the first update.
  const { doc, error } = await load({ noCorrectionTable: true });
  check(!error, 'a database without the correction table still opens the page',
    error && error.message);
  rowFor(doc, 50).click();
  await new Promise(r => setTimeout(r, 0));
  doc.getElementById('btnEdit').click();
  check(/18_count_corrections/.test(doc.getElementById('dNotes').innerHTML),
    'and Correct counts names the migration instead of pretending',
    doc.getElementById('dNotes').innerHTML.slice(-120));
}

console.log('\nediting\n');
async function openEdit(opts = {}) {
  const r = await load(opts);
  rowFor(r.doc, 50).click();
  await new Promise(x => setTimeout(x, 0));
  r.doc.getElementById('btnEdit').click();
  return r;
}
{
  const { doc } = await openEdit();
  check(doc.getElementById('editPanel').hidden === false, 'the panel opens');
  const inputs = doc.getElementById('dTable').querySelectorAll('.pk-in');
  check(inputs.length === 3, 'every packs figure becomes an input', inputs.length);
  check(inputs.map(i => i.value).join(',') === '10,21,0',
    'pre-filled with what the database holds', inputs.map(i => i.value).join(','));
  check(doc.getElementById('eStatus').textContent.includes('restate its variance'),
    'and it says up front that saving restates the variance',
    doc.getElementById('eStatus').textContent);
}
{
  const { doc } = await openEdit({ hasPos: false });
  check(doc.getElementById('eStatus').textContent.includes('No POS report'),
    'a day with no sales loaded says only the stock figures change',
    doc.getElementById('eStatus').textContent);
}
{
  const { doc } = await openEdit();
  const inp = doc.getElementById('dTable').querySelectorAll('.pk-in')[1];
  inp.value = '12';
  doc.getElementById('dTable').dispatchEvent({ type: 'input', target: inp });
  check(inp.classList.contains('chg'), 'a changed figure is highlighted');
  check(doc.getElementById('eStatus').textContent.startsWith('1 figure changed'),
    'and counted', doc.getElementById('eStatus').textContent);

  // Re-typing the same number is not a correction and must not be offered as one.
  inp.value = '21';
  doc.getElementById('dTable').dispatchEvent({ type: 'input', target: inp });
  check(!inp.classList.contains('chg'), 'putting it back clears the highlight');
}

console.log('\nwhat the save refuses\n');
{
  const { doc, calls } = await openEdit();
  const before = calls.length;
  doc.getElementById('btnEditSave').click();
  await new Promise(r => setTimeout(r, 0));
  check(/Nothing has changed/.test(doc.getElementById('eStatus').textContent),
    'saving with no edit says so', doc.getElementById('eStatus').textContent);
  check(calls.length === before, 'and writes nothing');
}
{
  const { doc, calls } = await openEdit();
  const inp = doc.getElementById('dTable').querySelectorAll('.pk-in')[1];
  inp.value = '12';
  doc.getElementById('dTable').dispatchEvent({ type: 'input', target: inp });
  doc.getElementById('eWhy').value = 'recounted';
  const before = calls.length;
  doc.getElementById('btnEditSave').click();
  await new Promise(r => setTimeout(r, 0));
  check(/name/i.test(doc.getElementById('eStatus').textContent),
    'no name is refused — the trigger would refuse it anyway, so ask here',
    doc.getElementById('eStatus').textContent);
  check(calls.length === before, 'and nothing is written');
}
{
  const { doc, calls } = await openEdit();
  const inp = doc.getElementById('dTable').querySelectorAll('.pk-in')[1];
  inp.value = '12';
  doc.getElementById('dTable').dispatchEvent({ type: 'input', target: inp });
  doc.getElementById('eWho').value = 'Rosa';
  const before = calls.length;
  doc.getElementById('btnEditSave').click();
  await new Promise(r => setTimeout(r, 0));
  check(/reason/i.test(doc.getElementById('eStatus').textContent),
    'no reason is refused', doc.getElementById('eStatus').textContent);
  check(calls.length === before, 'and nothing is written');
}

console.log('\nwhat the save sends\n');
{
  const { doc, calls, local, confirms } = await openEdit();
  const inp = doc.getElementById('dTable').querySelectorAll('.pk-in')[1];
  inp.value = '12';
  doc.getElementById('dTable').dispatchEvent({ type: 'input', target: inp });
  doc.getElementById('eWho').value = 'Rosa';
  doc.getElementById('eWhy').value = 'recounted the shelf, 12 not 21';
  doc.getElementById('btnEditSave').click();
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));

  check(confirms.length === 1, 'it confirms once before writing', confirms.length);
  const c = confirms[0] || '';
  check(c.includes('Cig B: 21 → 12'), 'naming the product and both figures', c.split('\n')[2]);
  check(/VARIANCE will change/.test(c),
    'and spelling out that the variance moves, not just "are you sure"');
  check(/opening figure of the next count/.test(c),
    'and that the next count\'s opening moves too');

  const up = calls.filter(q => q.table === 'stock_count_line' && q.update);
  check(up.length === 1, 'exactly one line is updated — only what changed', up.length);
  const sent = up[0] ? up[0].update : {};
  check(sent.packs === 12, 'carrying the new figure', sent.packs);
  check(sent.corrected_by === 'Rosa' && /recounted/.test(sent.corrected_reason || ''),
    'and the name and reason the trigger requires', JSON.stringify(sent));
  check(up[0].filters.some(f => f[0] === 'eq' && f[1] === 'count_id') &&
        up[0].filters.some(f => f[0] === 'eq' && f[1] === 'product_id'),
    'keyed on count_id AND product_id, so one row moves');
  check(String(up[0].select || '').includes('product_id'),
    'with .select(), or PostgREST returns nothing to check');
  check(local._map.get('cig_correct_who') === 'Rosa', 'the name is remembered for next time');
}
{
  // Declining the confirmation must write nothing.
  const { doc, calls } = await openEdit({ confirm: false });
  const inp = doc.getElementById('dTable').querySelectorAll('.pk-in')[1];
  inp.value = '12';
  doc.getElementById('dTable').dispatchEvent({ type: 'input', target: inp });
  doc.getElementById('eWho').value = 'Rosa';
  doc.getElementById('eWhy').value = 'recounted the shelf';
  doc.getElementById('btnEditSave').click();
  await new Promise(r => setTimeout(r, 0));
  check(!calls.some(q => q.table === 'stock_count_line' && q.update),
    'saying no at the confirmation writes nothing');
}

console.log('\nthe empty array that means "refused"\n');
{
  /* PostgREST answers a blocked write with 200 and []. res.error is null. The
     page must not call that a success — three bugs in this module came from
     exactly this, which is why the editor states how many rows it expects. */
  const { doc } = await openEdit({ updateResult: { data: [], error: null } });
  const inp = doc.getElementById('dTable').querySelectorAll('.pk-in')[1];
  inp.value = '12';
  doc.getElementById('dTable').dispatchEvent({ type: 'input', target: inp });
  doc.getElementById('eWho').value = 'Rosa';
  doc.getElementById('eWhy').value = 'recounted the shelf';
  doc.getElementById('btnEditSave').click();
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));
  const st = doc.getElementById('eStatus').textContent;
  check(/accepted no change/.test(st),
    'an empty array is reported as a refusal, not a success', st);
  check(/18_count_corrections/.test(st),
    'and names the migration that unfreezes a submitted count', st);
}

console.log('\na count that has already been corrected\n');
{
  const { doc } = await load({
    corrections: [{ count_id: 50, product_id: '100002', old_packs: 21, new_packs: 12,
                    reason: 'recounted the shelf', corrected_by: 'Rosa',
                    corrected_at: '2026-10-01T02:00:00Z' }]
  });
  check(!!rowFor(doc, 50).querySelector('.fixed'),
    'the list marks it Corrected without anyone opening it');
  rowFor(doc, 50).click();
  await new Promise(r => setTimeout(r, 0));
  const notes = doc.getElementById('dNotes').innerHTML;
  check(/Corrected/.test(notes), 'the report says it was corrected', notes.slice(0, 80));
  check(/recounted the shelf/.test(notes) && /Rosa/.test(notes),
    'with the reason and who gave it — the whole point of allowing the edit');
  check(/21/.test(notes) && /12/.test(notes), 'and what the figure was before');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
