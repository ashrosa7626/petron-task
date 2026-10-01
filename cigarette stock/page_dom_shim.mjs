// Just enough browser to LOAD stock-count/import-sales.html's module in Node.
//
// Why this exists: on 28 Sep the page shipped with `ctx` read one line above the
// `const ctx = {...}` that declares it. That is a temporal dead zone
// ReferenceError, it aborts the module at load, and every listener registered
// after it therefore never binds — so the page drew perfectly and the "Choose
// the sales PDF" box did nothing at all when pressed. Nothing in the test suite
// could have caught it, because nothing loaded the page.
//
// The same shape as xlsx_dom_shim.mjs, and for the same reason: run the shipped
// code unmodified rather than test a copy of it. This is deliberately NOT a DOM
// implementation — it is the surface import-sales.html actually touches, and it
// throws on anything else so a widening page cannot quietly go unchecked.

// ---------------------------------------------------------------------------
// A tiny HTML parser. Only what the page generates: tags, attributes, text.
// ---------------------------------------------------------------------------
const VOID = new Set(['input', 'br', 'img', 'hr', 'meta', 'link']);

function parseHtml(html, owner) {
  const root = [];
  const stack = [{ children: root }];
  const tag = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*?)?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = tag.exec(html))) {
    const [, close, name, attrText, selfClose, text] = m;
    const top = stack[stack.length - 1];
    if (text !== undefined) {
      if (text.trim()) top.children.push({ text: decode(text) });
      continue;
    }
    if (close) { if (stack.length > 1) stack.pop(); continue; }
    const attrs = {};
    const ar = /([a-zA-Z0-9_:.\-]+)(?:\s*=\s*"([^"]*)")?/g;
    let a;
    while ((a = ar.exec(attrText || ''))) attrs[a[1]] = a[2] === undefined ? '' : decode(a[2]);
    const node = new El(name.toLowerCase(), owner);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    top.children.push(node);
    if (!selfClose && !VOID.has(node.tagName)) stack.push(node);
  }
  return root;
}

const decode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&middot;/g, '·').replace(/&rsquo;/g, '’').replace(/&mdash;/g, '—')
  .replace(/&hellip;/g, '…').replace(/&minus;/g, '−').replace(/&amp;/g, '&');

// ---------------------------------------------------------------------------
class El {
  constructor(tagName, doc) {
    this.tagName = tagName;
    this.doc = doc;
    this.children = [];
    this.attrs = {};
    this.dataset = {};
    this.listeners = {};
    this.parent = null;
    this._text = '';
    this._html = '';
    this.value = '';
    this.hidden = false;
    this.checked = false;
    this.disabled = false;
    this.style = {};
    this.classList = new ClassList();
  }

  setAttribute(k, v) {
    this.attrs[k] = v;
    if (k === 'class') v.split(/\s+/).filter(Boolean).forEach(c => this.classList.add(c));
    else if (k === 'value') this.value = v;
    else if (k === 'checked') this.checked = true;
    else if (k === 'hidden') this.hidden = true;
    else if (k.startsWith('data-')) {
      this.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
    }
  }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }

  set innerHTML(html) {
    this._html = String(html);
    this.children = parseHtml(this._html, this.doc);
    for (const c of this.children) if (c instanceof El) c.parent = this;
  }
  get innerHTML() { return this._html; }

  set textContent(t) { this._text = String(t); this.children = []; this._html = ''; }
  get textContent() {
    return this._text || this.children.map(c => c instanceof El ? c.textContent : c.text).join('');
  }

  insertAdjacentHTML(_where, html) {
    this._html += html;
    const added = parseHtml(html, this.doc);
    for (const c of added) if (c instanceof El) c.parent = this;
    this.children.push(...added);
  }

  descendants() {
    const out = [];
    const walk = n => {
      for (const c of n.children) {
        if (!(c instanceof El)) continue;
        out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }

  matches(sel) {
    let m = /^\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]$/.exec(sel);
    if (m) return m[2] === undefined ? m[1] in this.attrs : this.attrs[m[1]] === m[2];
    m = /^([a-z]+)\[type=([a-z]+)\]$/.exec(sel);
    if (m) return this.tagName === m[1] && this.attrs.type === m[2];
    m = /^([a-z]*)\.([A-Za-z0-9_-]+)$/.exec(sel);
    if (m) return (!m[1] || this.tagName === m[1]) && this.classList.contains(m[2]);
    if (/^[a-z]+$/.test(sel)) return this.tagName === sel;
    throw new Error(`page_dom_shim: selector not supported: ${sel}`);
  }
  querySelectorAll(sel) { return this.descendants().filter(n => n.matches(sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }

  closest(sel) {
    for (let n = this; n; n = n.parent) if (n instanceof El && n.matches(sel)) return n;
    return null;
  }

  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this);
  }

  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }

  // Bubbling, because that is the behaviour the drop zone depends on: its own
  // click handler calls file.click(), and the input used to be a CHILD of it.
  dispatchEvent(ev) {
    ev.target = ev.target || this;
    for (let n = this; n; n = n.parent) {
      // Both routes, because pages use both: addEventListener for things wired
      // once at load, and an `onclick =` assignment for a handler that has to be
      // REPLACED every time a view re-renders with a new closure. history.html
      // does the latter for its buttons, and a shim that only knew about
      // addEventListener reported the buttons as dead.
      const direct = n['on' + ev.type];
      if (typeof direct === 'function') direct.call(n, ev);
      for (const fn of (n.listeners[ev.type] || []).slice()) fn.call(n, ev);
    }
    return true;
  }
  click() {
    // The spec's click-in-progress flag. Without it a bubbled click that calls
    // click() again on the same element recurses forever.
    if (this._clicking) return;
    this._clicking = true;
    try { this.dispatchEvent({ type: 'click', preventDefault() {} }); }
    finally { this._clicking = false; }
  }
  focus() { this.doc.activeElement = this; }
  scrollIntoView() {}
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
}

class ClassList {
  constructor() { this.set = new Set(); }
  add(...c) { c.forEach(x => this.set.add(x)); }
  remove(...c) { c.forEach(x => this.set.delete(x)); }
  contains(c) { return this.set.has(c); }
  toggle(c, on) { (on === undefined ? !this.set.has(c) : on) ? this.set.add(c) : this.set.delete(c); }
  get value() { return [...this.set].join(' '); }
}

// ---------------------------------------------------------------------------
// The document: one element per id in the page's static HTML. A flat registry
// is enough — the page reaches everything through getElementById, and anything
// it builds itself arrives through innerHTML above.
// ---------------------------------------------------------------------------
export function makeDocument(html) {
  const doc = {
    ids: new Map(),
    activeElement: null,
    head: null,
    getElementById(id) { return doc.ids.get(id) || null; },
    createElement(tag) { return new El(String(tag).toLowerCase(), doc); }
  };
  doc.head = new El('head', doc);
  // The WHOLE tag, not up to the id: `hidden` is as often written after the id
  // as before it, and matching only the prefix made every such element start out
  // visible — which is the opposite of what the page expects and quietly broke
  // the first checks written against it.
  for (const m of html.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g)) {
    const tag = m[0], attrs = m[2];
    const id = /\bid="([^"]+)"/.exec(attrs);
    if (!id) continue;
    const node = new El(m[1].toLowerCase(), doc);
    if (/\bhidden\b/.test(attrs.replace(/"[^"]*"/g, ''))) node.hidden = true;
    const cls = /\bclass="([^"]+)"/.exec(attrs);
    if (cls) node.setAttribute('class', cls[1]);
    doc.ids.set(id[1], node);
  }
  return doc;
}

// A memory-backed Storage. `full: true` makes setItem throw the way the shop
// device's does, which is a real state this page has to survive.
export function makeStorage(full) {
  const map = new Map();
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      if (full) throw new Error('QuotaExceededError');
      map.set(k, String(v));
    },
    removeItem: k => map.delete(k),
    _map: map
  };
}

/* A Supabase stand-in. Records every call so a test can assert what the page
   asked the database for — which is how the category scoping is checked. */
export function makeDb(tables) {
  const calls = [];
  const client = {
    from(table) {
      const q = { table, filters: [] };
      calls.push(q);
      const rows = () => {
        const t = tables[table];
        return Array.isArray(t) ? t : ((t && t.rows) || []);
      };
      const builder = {
        select(cols) { q.select = cols; return builder; },
        eq(c, v) { q.filters.push(['eq', c, v]); return builder; },
        in(c, v) { q.filters.push(['in', c, v]); return builder; },
        gte(c, v) { q.filters.push(['gte', c, v]); return builder; },
        order() { return builder; },
        limit() { return builder; },
        upsert(r) { q.upsert = r; return builder; },
        update(r) { q.update = r; return builder; },
        insert(r) { q.insert = r; return builder; },
        then(resolve) {
          /* A per-table override, so a test can make one table answer with an
             error (the table does not exist yet) or with an EMPTY ARRAY — which
             is how PostgREST reports an RLS refusal, and the mistake this module
             has made three times. Both have to be reachable from a test.

             It may be a FUNCTION of the query, because a table is usually read
             and written in the same page: overriding every call on it would
             starve the read that has to succeed first for there to be anything
             to write. */
          const o = tables[table];
          const over = o && o.__result;
          const res = typeof over === 'function' ? (over(q) || { data: rows(), error: null })
            : over ? over
            : { data: rows(), error: null };
          return Promise.resolve(res).then(resolve);
        }
      };
      q.builder = builder;
      return builder;
    }
  };
  return { client, calls };
}

export { El };
