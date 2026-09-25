// modules.js decides what is counted together and what the localStorage keys
// are called. Both are load-bearing:
//
//   * getting the categories wrong means a sitting that submits half a shelf
//   * getting a KEY wrong strands a count already open on the shop device,
//     whose numbers live only in a local draft until Submit
//
// Offline, no network.
import { MODULES, currentModule, href, sessionKey, staffKey, draftKey,
         restockDraftKey, categoryLabel, DEFAULT_MODULE } from '../stock-count/modules.js';

let pass = 0, fail = 0;
const ok = (c, m, extra) => {
  c ? pass++ : fail++;
  console.log((c ? 'OK   ' : 'FAIL ') + m + (c || extra === undefined ? '' : `  -> ${extra}`));
};

console.log('\nwhich module a page is showing\n');
ok(currentModule('').id === 'tobacco', 'no ?m= means tobacco, so every existing link still works');
ok(currentModule('?m=lubes').id === 'lubes', '?m=lubes selects lubes');
ok(currentModule('?m=LUBES').id === 'lubes', 'and it is case-insensitive');
ok(currentModule('?m=nonsense').id === DEFAULT_MODULE,
   'an unknown module falls back rather than showing an empty page');
ok(currentModule('?readonly=1').id === 'tobacco', 'other params do not confuse it');

console.log('\nlinks\n');
ok(href('index.html', MODULES.tobacco) === 'index.html',
   'tobacco links are left exactly as they were — no ?m= appended');
ok(href('index.html', MODULES.lubes) === 'index.html?m=lubes', 'lubes links carry the module');
ok(href('history.html', 'lubes') === 'history.html?m=lubes', 'and a bare id works too');

console.log('\nstorage keys — the ones that can strand a count in progress\n');
ok(sessionKey(MODULES.tobacco) === 'cig_count',
   'tobacco keeps cig_count: a sitting open on the shop device is stored under it');
ok(staffKey(MODULES.tobacco) === 'cig_last_staff', 'and cig_last_staff');
ok(sessionKey(MODULES.lubes) === 'lub_count', 'lubes gets its own key');
ok(restockDraftKey(MODULES.lubes) === 'lub_restock_draft', 'including for restocks');
ok(sessionKey(MODULES.lubes) !== sessionKey(MODULES.tobacco),
   'and no two modules can collide');
ok(draftKey(42) === 'cig_draft_42',
   'drafts key on count_id, so they are module-agnostic and survive this change');

console.log('\nwhat is counted together\n');
ok(MODULES.tobacco.categories.join() === 'CIGARETTES,ILUMA',
   'tobacco is two shelves in one sitting', MODULES.tobacco.categories);
ok(MODULES.lubes.categories.join() === 'LUBES', 'lubes is one');
const all = Object.values(MODULES).flatMap(m => m.categories);
ok(new Set(all).size === all.length,
   'no category belongs to two modules — it would be counted twice on the same day', all);
ok(categoryLabel('ILUMA') === 'Heated tobacco', 'Iluma reads as heated tobacco on screen');
ok(MODULES.tobacco.countTitle('25/09/2026') === 'Cig Count of 25/09/2026',
   'the tobacco count title is unchanged, so past and future counts read alike');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
