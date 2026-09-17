/* ===========================================================================
   What an edited spreadsheet would change.

   This is the whole safety of the editor page: nothing is written until a
   person has read what this produces. It is a pure function of (workbook,
   database) with no I/O, so the tests can run it over invented edits without a
   browser or a network.

   The rules it enforces are the module's rules, not new ones:

     * product_id is the POS Item ID and the join key everywhere. It cannot be
       invented, so a new product without one is refused.
     * plu is display-only. Changing it is always safe and never touches a
       count.
     * counts key on product_id, never on a shelf position, so moving a facing
       cannot corrupt history — but it does change what staff are asked to
       count, which is why it makes a new planogram version.
     * a product is never deleted. It is deactivated, because stock_count_line
       and pos_sales_daily still point at it.
   =========================================================================== */

export const EDITOR_COLUMNS =
  ['POS Description', 'POS Item ID', 'PLU', 'Short Name', 'Brand', 'Active', 'Positions'];

const norm = s => String(s == null ? '' : s).trim();
const upper = s => norm(s).toUpperCase();

/* TRUE/FALSE, yes/no, 1/0, or blank meaning still stocked. Excel writes these
   differently depending on locale and on whether someone typed it or picked
   it, so be generous — and treat only an explicit negative as "removed". */
export function isActive(cell) {
  const v = upper(cell);
  if (v === '') return true;
  return !['FALSE', 'NO', 'N', '0', 'INACTIVE', 'REMOVED'].includes(v);
}

/* "A1-5 | B1-5" -> [['A',1],['A',2],...]. One cell holds the lot, so split on
   the pipe or a comma rather than expecting separate columns. */
export function expandPositions(text) {
  const out = [];
  for (const tok of String(text || '').split(/[|,]/)) {
    const m = /^\s*([A-Z])\s*(\d+)\s*(?:-\s*(\d+))?\s*$/i.exec(tok);
    if (!m) continue;
    const shelf = m[1].toUpperCase();
    const a = Number(m[2]), b = Number(m[3] || m[2]);
    for (let p = Math.min(a, b); p <= Math.max(a, b); p++) out.push([shelf, p]);
  }
  return out;
}

export const cellKey = (shelf, position) => shelf + ':' + position;

/* The inverse, for writing the sheet back out: [['A',1],['A',2],['B',1]]
   -> "A1-2 | B1". Contiguous runs are collapsed the way the workbook does. */
export function formatPositions(cells) {
  const byShelf = new Map();
  for (const [shelf, p] of cells) {
    if (!byShelf.has(shelf)) byShelf.set(shelf, []);
    byShelf.get(shelf).push(p);
  }
  const parts = [];
  for (const shelf of [...byShelf.keys()].sort()) {
    const ps = [...new Set(byShelf.get(shelf))].sort((a, b) => a - b);
    let i = 0;
    while (i < ps.length) {
      let j = i;
      while (j + 1 < ps.length && ps[j + 1] === ps[j] + 1) j++;
      parts.push(shelf + (i === j ? ps[i] : ps[i] + '-' + ps[j]));
      i = j + 1;
    }
  }
  return parts.join(' | ');
}

/* ------------------------------------------------------------------------
   Read the two sheets.

   Column order is found by HEADER NAME, not by position: someone reordering
   columns in Excel is an ordinary thing to do and must not silently shift
   every value one to the left. A missing required header is an error.
   ------------------------------------------------------------------------ */
export function readWorkbook(sheets) {
  const errors = [];
  const stock = sheets['Full Stock List'];
  const plan = sheets['Planogram'];
  if (!stock) errors.push('The workbook has no sheet called "Full Stock List".');
  if (!plan) errors.push('The workbook has no sheet called "Planogram".');
  if (errors.length) return { errors, products: new Map(), grid: new Map(), shelves: [] };

  // Header row: the first row carrying "POS Item ID".
  let hdrRow = -1;
  for (let r = 0; r < stock.length; r++) {
    if (stock[r].some(c => upper(c) === 'POS ITEM ID')) { hdrRow = r; break; }
  }
  if (hdrRow < 0) {
    errors.push('No "POS Item ID" column found on Full Stock List. ' +
      'Download a fresh copy rather than editing an old one.');
    return { errors, products: new Map(), grid: new Map(), shelves: [] };
  }
  const col = {};
  stock[hdrRow].forEach((c, i) => { const k = upper(c); if (k) col[k] = i; });
  for (const need of ['POS DESCRIPTION', 'POS ITEM ID', 'PLU']) {
    if (col[need] === undefined) errors.push(`Full Stock List is missing the "${need}" column.`);
  }

  /* Which columns the workbook actually carries.

     THIS IS NOT BOOKKEEPING. A column that is not in the sheet means "leave
     this alone", never "set it to blank". The workbook in the repo has no
     Short Name and no Brand column, so treating absent as empty made all 54
     products look renamed — and uploading it would have overwritten every
     curated short_name with the SHOUTED POS description. A field is only ever
     compared, or written, when its column is present. */
  const present = new Set(Object.keys(col));
  const has = name => present.has(name);

  const products = new Map();
  for (let r = hdrRow + 1; r < stock.length; r++) {
    const row = stock[r];
    const at = name => (col[name] === undefined ? '' : norm(row[col[name]]));
    const pid = at('POS ITEM ID');
    const desc = at('POS DESCRIPTION');
    if (!pid && !desc) continue;                       // a blank spacer row
    const where = `Full Stock List row ${r + 1}`;

    if (!pid) {
      errors.push(`${where}: "${desc}" has no POS Item ID. That is the number ` +
        `everything joins on and it cannot be guessed — take it from the till.`);
      continue;
    }
    if (!/^\d{4,10}$/.test(pid)) {
      errors.push(`${where}: "${pid}" does not look like a POS Item ID (expected 4-10 digits).`);
      continue;
    }
    if (products.has(pid)) {
      errors.push(`${where}: POS Item ID ${pid} appears twice. Each product needs its own.`);
      continue;
    }
    const p = { product_id: pid, pos_description: desc, plu: at('PLU'), row: r + 1 };
    // undefined means "the sheet did not say", which is different from blank.
    if (has('SHORT NAME')) p.short_name = at('SHORT NAME');
    if (has('BRAND')) p.brand = at('BRAND');
    if (has('ACTIVE')) p.active = isActive(at('ACTIVE'));
    if (has('POSITIONS')) p.positions = expandPositions(at('POSITIONS'));
    products.set(pid, p);
  }

  // Planogram grid: find the row of position numbers, then read shelves below.
  let numRow = -1, firstCol = -1;
  for (let r = 0; r < plan.length && numRow < 0; r++) {
    for (let c = 0; c < plan[r].length; c++) {
      if (norm(plan[r][c]) === '1' && norm(plan[r][c + 1]) === '2') {
        numRow = r; firstCol = c; break;
      }
    }
  }
  if (numRow < 0) {
    errors.push('The Planogram sheet has no row of position numbers (1, 2, 3...).');
    return { errors, products, grid: new Map(), shelves: [] };
  }
  const positionAt = new Map();
  for (let c = firstCol; c < plan[numRow].length; c++) {
    const n = Number(norm(plan[numRow][c]));
    if (Number.isInteger(n) && n > 0) positionAt.set(c, n);
  }

  const grid = new Map();     // "A:1" -> label
  const shelves = [];
  for (let r = numRow + 1; r < plan.length; r++) {
    const row = plan[r];
    let shelf = '';
    for (let c = 0; c < firstCol; c++) {
      const v = upper(row[c]);
      if (/^[A-Z]$/.test(v)) { shelf = v; break; }
    }
    if (!shelf) continue;
    if (shelves.includes(shelf)) {
      errors.push(`The Planogram sheet has shelf ${shelf} twice.`);
      continue;
    }
    shelves.push(shelf);
    for (const [c, p] of positionAt) {
      const label = norm(row[c]);
      if (label) grid.set(cellKey(shelf, p), label);
    }
  }
  return { errors, products, grid, shelves, present };
}

/* ------------------------------------------------------------------------
   Resolve every grid label to a product_id.

   A cell holds a NAME, not an ID, because that is what a person can read on
   the shelf. product_alias maps the names people actually write to the ID.
   `RED Winston` and `WINSTON RED` both mean 100740 — which is why counting
   alias rows is not counting products.
   ------------------------------------------------------------------------ */
export function resolveGrid(grid, products, aliases) {
  const byAlias = new Map();
  for (const [alias, pid] of aliases) byAlias.set(upper(alias), pid);
  const byDesc = new Map();
  for (const [pid, p] of products) byDesc.set(upper(p.pos_description), pid);
  const byShort = new Map();
  for (const [pid, p] of products) if (p.short_name) byShort.set(upper(p.short_name), pid);
  // Resolving may use a name the sheet did not supply; writing never does.

  const facings = new Map();          // "A:1" -> product_id
  const unresolved = new Map();       // label -> [cells]
  const newAliases = new Map();       // label -> product_id

  for (const [cell, label] of grid) {
    const u = upper(label);
    let pid = byAlias.get(u) ?? byDesc.get(u) ?? byShort.get(u) ?? null;
    if (!pid) {
      // A unique prefix match is how the workbook's shorter labels resolve.
      const hits = [...byDesc.entries()].filter(([d]) => d.startsWith(u)).map(([, v]) => v);
      const uniq = [...new Set(hits)];
      if (uniq.length === 1) pid = uniq[0];
    }
    if (!pid) {
      if (!unresolved.has(label)) unresolved.set(label, []);
      unresolved.get(label).push(cell);
      continue;
    }
    facings.set(cell, pid);
    if (!byAlias.has(u)) newAliases.set(label, pid);
  }
  return { facings, unresolved, newAliases };
}

/* ------------------------------------------------------------------------
   The diff.

   db: { products: Map(pid -> row), aliases: Map(alias -> pid),
         facings: Map(cellKey -> pid), counts: Map(pid -> number) }
   ------------------------------------------------------------------------ */
export function diffPlanogram(sheets, db) {
  const wb = readWorkbook(sheets);
  const errors = [...wb.errors];

  const { facings, unresolved, newAliases } = resolveGrid(wb.grid, wb.products, db.aliases);

  for (const [label, cells] of unresolved) {
    errors.push(`The Planogram sheet says "${label}" at ${cells.map(pretty).join(', ')}, ` +
      `but nothing on Full Stock List matches it. Either correct the spelling or add ` +
      `the product with its POS Item ID.`);
  }

  // The two sheets have to agree with each other. They are two views of one
  // layout and the workbook has been internally inconsistent before.
  const gridByProduct = new Map();
  for (const [cell, pid] of facings) {
    if (!gridByProduct.has(pid)) gridByProduct.set(pid, new Set());
    gridByProduct.get(pid).add(cell);
  }
  for (const [pid, p] of wb.products) {
    if (!p.positions) continue;        // no Positions column: the grid stands alone
    const stated = new Set(p.positions.map(([s, n]) => cellKey(s, n)));
    const actual = gridByProduct.get(pid) || new Set();
    if (stated.size !== actual.size || [...stated].some(c => !actual.has(c))) {
      errors.push(`${p.pos_description}: the Positions column says ` +
        `${formatPositions([...stated].map(unkey)) || '(none)'} but the grid has it at ` +
        `${formatPositions([...actual].map(unkey)) || '(none)'}. The two sheets must agree.`);
    }
  }

  // A product cannot be both off the range and on the shelf.
  for (const [pid, p] of wb.products) {
    if (p.active === false && (gridByProduct.get(pid) || new Set()).size) {
      errors.push(`${p.pos_description} is marked Active = FALSE but still has facings ` +
        `at ${formatPositions([...gridByProduct.get(pid)].map(unkey))}. ` +
        `Clear it from the grid as well as the Positions column.`);
    }
  }

  // ---- products ----
  const added = [], plu = [], renamed = [], deactivated = [], reactivated = [];
  const onShelf = pid => (gridByProduct.get(pid) || new Set()).size > 0;

  for (const [pid, p] of wb.products) {
    const was = db.products.get(pid);
    if (!was) { added.push(p); continue; }
    if (norm(was.plu) !== norm(p.plu)) plu.push({ ...p, from: norm(was.plu), to: norm(p.plu) });

    // Only fields the sheet carries are compared — see `present` above.
    const changed = {}, from = {};
    for (const f of ['pos_description', 'short_name', 'brand']) {
      if (p[f] === undefined) continue;
      if (norm(was[f]) !== norm(p[f])) { changed[f] = norm(p[f]); from[f] = norm(was[f]); }
    }
    if (Object.keys(changed).length) renamed.push({ ...p, changed, from });

    /* Removed from the range. Two ways to say it, and BOTH must work:
         - Active = FALSE, when the sheet has that column
         - no facings at all, which is how the older workbook says it, and is
           also the truth of the matter — a product with no facings never
           appears on the count screen, so if it stayed active the sales
           importer would keep writing it a zero row that nothing reconciles
           against. That is a silent hole, so close it. */
    const off = p.active === false || !onShelf(pid);
    if (was.active && off) {
      deactivated.push({
        ...p, counts: db.counts.get(pid) || 0,
        why: p.active === false ? 'marked Active = FALSE' : 'no facings left on the grid'
      });
    }
    if (!was.active && !off) reactivated.push(p);
  }
  // Present in the database, gone from the sheet entirely — treated as removed.
  for (const [pid, was] of db.products) {
    if (wb.products.has(pid) || !was.active) continue;
    deactivated.push({
      product_id: pid, pos_description: was.pos_description, plu: was.plu,
      short_name: was.short_name, brand: was.brand, active: false,
      counts: db.counts.get(pid) || 0, droppedFromSheet: true
    });
  }

  // ---- facings ----
  const moved = [];
  for (const cell of new Set([...facings.keys(), ...db.facings.keys()])) {
    const before = db.facings.get(cell) || null;
    const after = facings.get(cell) || null;
    if (before !== after) moved.push({ cell, before, after });
  }
  moved.sort((a, b) => a.cell.localeCompare(b.cell, undefined, { numeric: true }));

  const shelfChanged = moved.length > 0;

  return {
    errors,
    products: wb.products,
    shelves: wb.shelves,
    facings,
    newAliases,
    added, plu, renamed, deactivated, reactivated, moved,
    shelfChanged,
    // A count of what the shelf becomes, so the page can show 54 -> 55 rather
    // than making someone work it out.
    /* What the shelf becomes. "54 products" has always meant products with
       facings — the same number deriveBlocks reports — not rows on a sheet.
       An inactive product is not on the grid, so it is already excluded. */
    after: {
      products: new Set(facings.values()).size,
      facings: facings.size
    },
    empty: !errors.length && !added.length && !plu.length && !renamed.length &&
           !deactivated.length && !reactivated.length && !moved.length && !newAliases.size
  };
}

const unkey = k => { const [s, p] = k.split(':'); return [s, Number(p)]; };
const pretty = k => { const [s, p] = k.split(':'); return s + p; };
