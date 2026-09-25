/* ===========================================================================
   The cigarette gondola, drawn from the database.

   Shared by the count screen (index.html) and the restock screen
   (restock.html) so there is ONE implementation of how facings become blocks.
   This is the same reason sales-parse.js exists: the tests
   (cigarette stock/verify_blocks.mjs, verify_expected.mjs) import deriveBlocks
   straight out of this file, so what they check is what ships.

   The three rules this file must never break:

     * Blocks are keyed on product_id, never on shelf position. Re-merchandising
       the gondola must not touch a single historical count.
     * plu is display only. It is drawn on the block so staff can check the pack
       in hand, and it is never a join key.
     * The layout comes from planogram_facing. Nothing here knows how many
       shelves there are, how wide a block is, or where anything sits. A shelf
       change is a data change.

   What is page-specific and deliberately NOT here: what a number means once it
   is typed, when a block counts as done, and everything about submitting.
   =========================================================================== */

/* ======================= block derivation ======================= */
/* Facings are grouped by product_id — never by shelf position — then split
   into connected regions using 4-way adjacency. One product may own several
   regions; they share one identity and one input. */
export function deriveBlocks(facings, shelves) {
  const rowOf = {};
  shelves.forEach((s, i) => { rowOf[s] = i; });

  const byProduct = new Map();
  for (const f of facings) {
    if (!byProduct.has(f.product_id)) byProduct.set(f.product_id, []);
    byProduct.get(f.product_id).push([rowOf[f.shelf], f.position]);
  }

  const blocks = [];
  const nonRect = [];

  for (const [productId, cells] of byProduct) {
    const key = (r, c) => r + ':' + c;
    const grid = new Set(cells.map(([r, c]) => key(r, c)));
    const seen = new Set();
    const regions = [];

    const sorted = [...cells].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (const start of sorted) {
      if (seen.has(key(start[0], start[1]))) continue;
      const queue = [start];
      const region = [];
      seen.add(key(start[0], start[1]));
      while (queue.length) {
        const [r, c] = queue.pop();
        region.push([r, c]);
        for (const [nr, nc] of [[r + 1, c], [r - 1, c], [r, c + 1], [r, c - 1]]) {
          if (grid.has(key(nr, nc)) && !seen.has(key(nr, nc))) {
            seen.add(key(nr, nc));
            queue.push([nr, nc]);
          }
        }
      }
      regions.push(region);
    }

    /* Collect the rectangles this product will actually be DRAWN as, then
       number them. Numbering by region instead was wrong for an L-shape:

       Lubes Blaze Multi 20W50 4L holds C7, C8 and D8. Those are all connected,
       so it is ONE region — but it is not a rectangle, so it is drawn as two
       pieces, C7-8 and D8. Numbering by region gave both pieces "1 of 1" and
       therefore no marker at all, so the grid showed one product as two
       unrelated blocks. Someone counts C7-8, sees a number in the box and
       moves on, and the packs on D8 are never counted — the exact failure the
       markers exist to prevent, and the reason LD Red is called out in
       CLAUDE.md.

       Cigarettes has no non-rectangular region, so every product there is
       drawn as one piece per region and this numbers identically. */
    const pieces = [];
    regions.forEach(region => {
      const rows = region.map(c => c[0]);
      const cols = region.map(c => c[1]);
      const h = Math.max(...rows) - Math.min(...rows) + 1;
      const w = Math.max(...cols) - Math.min(...cols) + 1;
      // A region that is not a solid rectangle cannot be drawn as its bounding
      // box — the box would cover another product's facings. Fall back to one
      // rectangle per contiguous run within each row.
      if (h * w !== region.length) {
        nonRect.push({ productId, cells: region.length, box: h + 'x' + w });
        for (const rect of rowRuns(region)) pieces.push({ cells: rect, fragment: true });
      } else {
        pieces.push({ cells: region, fragment: false });
      }
    });

    // Reading order, so "1 of 2" is the one you meet first.
    pieces.sort((a, b) => {
      const top = cs => Math.min(...cs.map(c => c[0]));
      const left = cs => Math.min(...cs.map(c => c[1]));
      return top(a.cells) - top(b.cells) || left(a.cells) - left(b.cells);
    });
    pieces.forEach((piece, i) => {
      blocks.push(makeBlock(productId, piece.cells, i, pieces.length, shelves, piece.fragment));
    });
  }
  return { blocks, nonRect, productCount: byProduct.size };
}

export function rowRuns(region) {
  const byRow = new Map();
  for (const [r, c] of region) {
    if (!byRow.has(r)) byRow.set(r, []);
    byRow.get(r).push(c);
  }
  const runs = [];
  for (const [r, cols] of byRow) {
    cols.sort((a, b) => a - b);
    let run = [[r, cols[0]]];
    for (let i = 1; i < cols.length; i++) {
      if (cols[i] === cols[i - 1] + 1) run.push([r, cols[i]]);
      else { runs.push(run); run = [[r, cols[i]]]; }
    }
    runs.push(run);
  }
  return runs;
}

export function makeBlock(productId, region, regionIndex, regionTotal, shelves, fragment) {
  const rows = region.map(c => c[0]);
  const cols = region.map(c => c[1]);
  const minRow = Math.min(...rows), minCol = Math.min(...cols);
  return {
    productId, row: minRow, col: minCol,
    h: Math.max(...rows) - minRow + 1,
    w: Math.max(...cols) - minCol + 1,
    facings: region.length, regionIndex, regionTotal, fragment,
    label: [...new Set(rows)].sort((a, b) => a - b).map(r => {
      const rc = region.filter(c => c[0] === r).map(c => c[1]).sort((a, b) => a - b);
      return shelves[r] + (rc[0] === rc[rc.length - 1] ? rc[0] : rc[0] + '-' + rc[rc.length - 1]);
    }).join(', ')
  };
}

export function brandColour(brand) {
  if (!brand) return 'var(--p-border)';
  let h = 0;
  for (let i = 0; i < brand.length; i++) h = (h * 31 + brand.charCodeAt(i)) % 360;
  return `hsl(${h} 62% 55%)`;
}

export const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ============================ the grid ============================
   createGrid wires one scroller + grid element pair into a pannable,
   pinch-zoomable gondola and hands back the navigation the pages need.

   opts:
     scroller, grid            the two elements
     zoomIn, zoomOut, overview optional buttons
     cellHtml(pid, name)       markup placed at the foot of every block —
                               the page's input, or '' for a read-only view
     onEnter(pid)              Enter pressed inside a block's input
   ================================================================= */
const Z_MIN = 0.22, Z_MAX = 1.5, Z_OVERVIEW = 0.3, OV_THRESHOLD = 0.45;

export function createGrid(opts) {
  const sc = opts.scroller, g = opts.grid;
  const cellHtml = opts.cellHtml || (() => '');

  const state = {
    BLOCKS: [], PRODUCTS: new Map(), SHELVES: [], ORDER: [],
    facings: [], maxPos: 0, derived: null, missingProd: [], overflowing: []
  };
  let zoom = 1, lastFullZoom = 1;

  /* ------------------------------ zoom ------------------------------ */
  function applyZoom(z, clientX, clientY) {
    z = Math.max(Z_MIN, Math.min(Z_MAX, z));
    const r = sc.getBoundingClientRect();
    // Anchor: keep the content point under the cursor/pinch centre still.
    const ax = clientX == null ? r.width / 2 : clientX - r.left;
    const ay = clientY == null ? r.height / 2 : clientY - r.top;
    const cx = (sc.scrollLeft + ax) / zoom;
    const cy = (sc.scrollTop + ay) / zoom;

    zoom = z;
    g.style.setProperty('--z', z);
    g.classList.toggle('ov', z < OV_THRESHOLD);
    if (opts.overview) opts.overview.classList.toggle('on', z < OV_THRESHOLD);
    void g.offsetWidth;                       // force reflow before scrolling

    sc.scrollLeft = cx * z - ax;
    sc.scrollTop = cy * z - ay;
    if (z >= OV_THRESHOLD) lastFullZoom = z;
  }

  if (opts.zoomIn) opts.zoomIn.addEventListener('click', () => applyZoom(zoom * 1.25));
  if (opts.zoomOut) opts.zoomOut.addEventListener('click', () => applyZoom(zoom / 1.25));
  if (opts.overview) opts.overview.addEventListener('click', () => {
    if (zoom < OV_THRESHOLD) applyZoom(lastFullZoom || 1);
    else applyZoom(Z_OVERVIEW);
  });

  // Trackpad pinch and ctrl+wheel arrive as a wheel event with ctrlKey set.
  function onWheel(e) {
    if (!e.ctrlKey) return;
    e.preventDefault();
    applyZoom(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08), e.clientX, e.clientY);
  }

  // Two-finger pinch.
  let pinch = null;
  const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  function onTouchStart(e) {
    if (e.touches.length === 2) { pinch = { d: dist(e.touches), z: zoom }; drag = null; }
  }
  function onTouchMove(e) {
    if (pinch && e.touches.length === 2) {
      e.preventDefault();
      const t = e.touches;
      applyZoom(pinch.z * (dist(t) / pinch.d),
        (t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2);
    }
  }
  function onTouchEnd(e) { if (e.touches.length < 2) pinch = null; }

  /* Drag to pan with a mouse. Native scrolling already handles touch. */
  let drag = null;
  function onPointerDown(e) {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    if (e.target.closest('input,button')) return;
    drag = { x: e.clientX, y: e.clientY, sl: sc.scrollLeft, st: sc.scrollTop, moved: false };
    sc.classList.add('grabbing');
  }
  function onPointerMove(e) {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
    sc.scrollLeft = drag.sl - dx;
    sc.scrollTop = drag.st - dy;
  }
  function onPointerUp() {
    if (drag) sc.classList.remove('grabbing');
    drag = null;
  }

  /* ===================== navigation helpers ===================== */
  function blockEls(pid) {
    return [...g.querySelectorAll('.blk[data-pid="' + CSS.escape(pid) + '"]')];
  }
  function centreOn(node, o) {
    const nr = node.getBoundingClientRect(), sr = sc.getBoundingClientRect();
    sc.scrollTo({
      left: sc.scrollLeft + (nr.left - sr.left) - (sr.width - nr.width) / 2,
      top: sc.scrollTop + (nr.top - sr.top) - (sr.height - nr.height) / 2,
      behavior: (o && o.instant) ? 'auto' : 'smooth'
    });
  }
  function zoomToBlock(node) {
    const pid = node.dataset.pid;
    applyZoom(lastFullZoom < OV_THRESHOLD ? 1 : lastFullZoom);
    requestAnimationFrame(() => {
      const again = blockEls(pid)[Number(node.dataset.bi) || 0] || node;
      centreOn(again);
      const inp = again.querySelector('.pk');
      if (inp) setTimeout(() => inp.focus({ preventScroll: true }), 260);
      else highlight(pid, again);
    });
  }

  /* Focusing any piece highlights all its siblings; if a sibling is off screen,
     the focused piece shows an arrow pointing to it. Without this, someone
     counts C21, sees a number in the box and moves on, leaving two thirds of the
     LD Red stock uncounted — a variance that looks like theft. */
  function clearHighlight() {
    g.querySelectorAll('.blk.sib,.blk.here,.blk.hashint').forEach(b => {
      b.classList.remove('sib', 'here', 'hashint');
      const h = b.querySelector('.blk-hint');
      if (h) h.textContent = '';
    });
  }
  function highlight(pid, focusedEl) {
    clearHighlight();
    const els = blockEls(pid);
    if (els.length < 2) { if (focusedEl) focusedEl.classList.add('here'); return; }
    els.forEach(b => b.classList.add('sib'));
    if (focusedEl) focusedEl.classList.add('here');

    const sr = sc.getBoundingClientRect();
    const dirs = new Set();
    for (const b of els) {
      if (b === focusedEl) continue;
      const r = b.getBoundingClientRect();
      const off = r.right < sr.left + 2 || r.left > sr.right - 2 ||
                  r.bottom < sr.top + 2 || r.top > sr.bottom - 2;
      if (!off) continue;
      if (r.right < sr.left + 2) dirs.add('&larr;');
      else if (r.left > sr.right - 2) dirs.add('&rarr;');
      if (r.bottom < sr.top + 2) dirs.add('&uarr;');
      else if (r.top > sr.bottom - 2) dirs.add('&darr;');
    }
    if (dirs.size && focusedEl) {
      const h = focusedEl.querySelector('.blk-hint');
      if (h) { h.innerHTML = [...dirs].join(''); focusedEl.classList.add('hashint'); }
    }
  }

  /* Next product in reading order for which pred() is true, wrapping. */
  function next(fromPid, pred) {
    const start = fromPid ? state.ORDER.indexOf(fromPid) + 1 : 0;
    for (let i = 0; i < state.ORDER.length; i++) {
      const pid = state.ORDER[(start + i) % state.ORDER.length];
      if (pred(pid)) return pid;
    }
    return null;
  }
  function goTo(pid) {
    if (!pid) return;
    if (zoom < OV_THRESHOLD) applyZoom(lastFullZoom || 1);
    const node = blockEls(pid)[0];
    if (!node) return;
    centreOn(node);
    const inp = node.querySelector('.pk');
    if (inp) setTimeout(() => inp.focus({ preventScroll: true }), 250);
    else highlight(pid, node);
  }

  /* ============================ render ============================ */
  function render(facings, products) {
    state.facings = facings;
    state.PRODUCTS = products;
    state.SHELVES = [...new Set(facings.map(f => f.shelf))].sort();
    state.maxPos = Math.max(...facings.map(f => f.position));

    const derived = deriveBlocks(facings, state.SHELVES);
    state.derived = derived;
    state.BLOCKS = derived.blocks.sort((a, b) => a.row - b.row || a.col - b.col);
    // Reading order across the gondola, one entry per product.
    state.ORDER = [...new Set(state.BLOCKS.map(b => b.productId))];

    g.style.gridTemplateColumns = `var(--gutter-w) repeat(${state.maxPos}, var(--col-w))`;
    g.style.gridTemplateRows = `var(--hdr-h) repeat(${state.SHELVES.length}, var(--row-h))`;

    let html = '<div class="corner"></div>';
    for (let p = 1; p <= state.maxPos; p++) {
      html += `<div class="colnum" style="grid-column:${p + 1};grid-row:1">${p}</div>`;
    }
    state.SHELVES.forEach((s, i) => {
      html += `<div class="shelf" style="grid-column:1;grid-row:${i + 2}">${esc(s)}</div>`;
    });

    const perProduct = {};
    state.missingProd = [];
    state.overflowing = [];
    for (const b of state.BLOCKS) {
      perProduct[b.productId] = (perProduct[b.productId] || 0);
      const idx = perProduct[b.productId]++;
      const p = products.get(b.productId);
      if (!p) state.missingProd.push(b.productId);
      const name = p ? p.short_name : b.productId;
      const plu = p ? p.plu : '';
      if (name.length > 18) state.overflowing.push(name);

      const split = b.regionTotal > 1;
      html += `<div class="blk" data-pid="${esc(b.productId)}" data-bi="${idx}"
          title="${esc(name)} &middot; PLU ${esc(plu)} &middot; ${esc(b.label)}"
          style="grid-column:${b.col + 1} / span ${b.w};grid-row:${b.row + 2} / span ${b.h}">
          <div class="blk-brand" style="background:${brandColour(p && p.brand)}"></div>
          <div class="blk-hint"></div>
          ${split ? `<div class="blk-of">${b.regionIndex + 1} of ${b.regionTotal}</div>` : ''}
          <div class="blk-nm">${esc(name)}</div>
          <div class="blk-plu">${esc(plu)}</div>
          <div class="blk-pos">${esc(b.label)}</div>
          ${cellHtml(b.productId, name)}
        </div>`;
    }
    g.innerHTML = html;

    // In overview a tap means "take me there", not "edit".
    g.addEventListener('click', e => {
      const blk = e.target.closest('.blk');
      if (!blk) return;
      if (zoom < OV_THRESHOLD) { e.preventDefault(); zoomToBlock(blk); return; }
      if (!e.target.closest('input')) highlight(blk.dataset.pid, blk);
    });
    g.addEventListener('focusin', e => {
      const blk = e.target.closest('.blk');
      if (blk) highlight(blk.dataset.pid, blk);
    });
    // The numeric keypad moves on without tapping blocks directly.
    g.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      const t = e.target;
      if (!t.dataset || !t.dataset.pid) return;
      e.preventDefault();
      if (opts.onEnter) opts.onEnter(t.dataset.pid, t);
    });

    sc.addEventListener('wheel', onWheel, { passive: false });
    sc.addEventListener('touchstart', onTouchStart, { passive: true });
    sc.addEventListener('touchmove', onTouchMove, { passive: false });
    sc.addEventListener('touchend', onTouchEnd, { passive: true });
    sc.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    sc.addEventListener('scroll', () => {
      const here = g.querySelector('.blk.here');
      if (here) highlight(here.dataset.pid, here);
    }, { passive: true });

    return derived;
  }

  /* ============================ logging ============================ */
  function log() {
    const { SHELVES, BLOCKS, PRODUCTS, facings, maxPos, derived } = state;
    console.clear();
    console.log('%cCigarette planogram — derived blocks',
      'font-weight:700;font-size:13px;color:#60A5FA');
    console.log(`${SHELVES.join('')} × 1..${maxPos} · ${derived.productCount} products · ` +
      `${facings.length} facings · ${BLOCKS.length} blocks`);

    console.table(BLOCKS.map(b => {
      const p = PRODUCTS.get(b.productId) || {};
      return {
        product_id: b.productId, short_name: p.short_name || '(no product row)',
        plu: p.plu || '', brand: p.brand || '', at: b.label, facings: b.facings,
        w: b.w, h: b.h,
        block: b.regionTotal > 1 ? `${b.regionIndex + 1} of ${b.regionTotal}` : '1 of 1'
      };
    }));

    const drawn = BLOCKS.reduce((n, b) => n + b.facings, 0);
    console.log(drawn === facings.length
      ? `%c✓ ${drawn} facings drawn, matches the ${facings.length} rows read`
      : `%c✗ drew ${drawn} but read ${facings.length} — regions do not reconcile`,
      'color:' + (drawn === facings.length ? '#22C55E' : '#FF4D4F'));

    const split = [...new Set(BLOCKS.filter(b => b.regionTotal > 1).map(b => b.productId))];
    if (split.length) {
      console.groupCollapsed(`%c${split.length} product(s) split across blocks`, 'color:#F59E0B');
      for (const pid of split) {
        const parts = BLOCKS.filter(b => b.productId === pid);
        console.log(`${(PRODUCTS.get(pid) || {}).short_name || pid} — ${parts.length} blocks: ` +
          parts.map(b => b.label).join(' | '));
      }
      console.groupEnd();
    }
    if (derived.nonRect.length) console.warn('Non-rectangular regions, drawn as row runs:', derived.nonRect);
    if (state.missingProd.length) console.warn('Facings whose product_id has no product row:', state.missingProd);
    if (state.overflowing.length) console.warn(`short_name over 18 chars: ${state.overflowing.length}`, state.overflowing);

    window.blocks = BLOCKS;
  }

  return {
    render, log, blockEls, goTo, next, highlight, clearHighlight,
    centreOn, applyZoom,
    get zoom() { return zoom; },
    get blocks() { return state.BLOCKS; },
    get order() { return state.ORDER; },
    get products() { return state.PRODUCTS; },
    get shelves() { return state.SHELVES; },
    get missingProducts() { return state.missingProd; },
    get derived() { return state.derived; }
  };
}
