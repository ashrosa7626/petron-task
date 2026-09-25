/* ===========================================================================
   What gets counted, and what gets counted together.

   A MODULE is one sitting. Tobacco is one sitting covering two shelves — the
   cigarette gondola and the Iluma cabinet stand next to each other and are
   counted at the same time — so it holds two categories, draws two grids
   behind one toggle, and one Submit closes both. Lubes is its own sitting.

   A CATEGORY is one shelf: one planogram version, one stock_count row, one
   restock record. Keeping them separate in the database is what lets each
   reconcile against its own POS report, and is why `15_categories.sql` put the
   category into both unique constraints.

   Every page reads this. There is deliberately no second copy of index.html
   for lubes: this module has been bitten twice by two copies of the same logic
   disagreeing (deriveBlocks, then sales-parse), and four more duplicated pages
   would make a third certain.
   =========================================================================== */

export const CATEGORIES = {
  CIGARETTES: { label: 'Cigarettes',     short: 'Cigs' },
  ILUMA:      { label: 'Heated tobacco', short: 'Iluma' },
  LUBES:      { label: 'Lubes',          short: 'Lubes' }
};

export const MODULES = {
  tobacco: {
    id: 'tobacco',
    label: 'Cigarettes & Iluma',
    short: 'Cigarettes',
    categories: ['CIGARETTES', 'ILUMA'],
    // What a count of this module is called, and what its localStorage keys
    // are prefixed with. `cig` is kept for tobacco so a count already in
    // flight on the shop device survives this change.
    prefix: 'cig',
    countTitle: d => 'Cig Count of ' + d
  },
  lubes: {
    id: 'lubes',
    label: 'Lubes',
    short: 'Lubes',
    categories: ['LUBES'],
    prefix: 'lub',
    countTitle: d => 'Lubes Count of ' + d
  }
};

export const DEFAULT_MODULE = 'tobacco';

/* The module for this page, from ?m=. Unknown or absent means tobacco, so
   every existing link and bookmark keeps working. */
export function currentModule(search) {
  const q = new URLSearchParams(search === undefined ? location.search : search);
  const id = (q.get('m') || '').toLowerCase();
  return MODULES[id] || MODULES[DEFAULT_MODULE];
}

/* Append ?m= to a link, but only when it is not the default — so the
   cigarette URLs people already have stay exactly as they were. */
export function href(page, mod) {
  const id = typeof mod === 'string' ? mod : (mod && mod.id);
  return id && id !== DEFAULT_MODULE ? `${page}?m=${id}` : page;
}

export const categoryLabel = c => (CATEGORIES[c] || {}).label || c;

/* localStorage keys, namespaced per module.

   `cig_count` and `cig_last_staff` keep their exact names for tobacco. A count
   open on the shop device right now is stored under those, and renaming them
   would strand it — the session would vanish mid-count with the numbers still
   only in memory. Lubes gets `lub_*`, which cannot collide. */
export const sessionKey = mod => `${mod.prefix}_count`;
export const staffKey = mod => `${mod.prefix}_last_staff`;
export const draftKey = countId => `cig_draft_${countId}`;   // keyed on the id, so module-agnostic
export const restockDraftKey = mod => `${mod.prefix}_restock_draft`;
export const restockPendingKey = mod => `${mod.prefix}_restock_pending`;
export const restockStaffKey = mod => `${mod.prefix}_restock_staff`;
