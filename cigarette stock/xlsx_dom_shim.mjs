// A DOMParser for Node, good enough for the XML inside an .xlsx.
//
// xlsx.js is written against the browser DOM. Rather than reimplement its
// parsing here — a copy would pass while the shipped code was broken — this
// gives Node just enough of DOMParser/getElementsByTagNameNS to run the real
// module unmodified. Shared by verify_xlsx.mjs and verify_planogram_diff.mjs.
//
// Namespace handling is deliberately loose: it matches on the LOCAL name, so
// `<x:sheet>` and `<sheet>` both answer to 'sheet'. An .xlsx only ever uses
// the two namespaces this project cares about, and being strict here would buy
// nothing but failures on files Excel writes perfectly happily.

// ---------------------------------------------------------------------------
// A DOM shim. xlsx.js uses DOMParser + getElementsByTagNameNS, which Node does
// not ship. This is a small XML parser exposing exactly that surface — enough
// to run the shipped code unmodified rather than testing a copy of it.
// ---------------------------------------------------------------------------
function parseXml(xml) {
  const nodes = [];
  const stack = [];
  const root = { name: '#doc', attrs: {}, children: [], text: '' };
  stack.push(root);
  const tag = /<([?!\/]?)([A-Za-z0-9_:.\-]+)((?:\s+[^<>]*?)?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = tag.exec(xml))) {
    const [, kind, name, attrText, selfClose, text] = m;
    if (text !== undefined) {
      const t = text.replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
      if (stack.length) stack[stack.length - 1].text += t;
      continue;
    }
    if (kind === '?' || kind === '!') continue;
    if (kind === '/') { stack.pop(); continue; }
    const attrs = {};
    const ar = /([A-Za-z0-9_:.\-]+)\s*=\s*"([^"]*)"/g;
    let a;
    while ((a = ar.exec(attrText || ''))) {
      attrs[a[1]] = a[2].replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
    }
    const node = { name, attrs, children: [], text: '' };
    stack[stack.length - 1].children.push(node);
    nodes.push(node);
    if (!selfClose) stack.push(node);
  }
  return { root, nodes };
}

function makeDoc(xml) {
  const { nodes } = parseXml(xml);
  const local = n => n.name.includes(':') ? n.name.split(':')[1] : n.name;
  const wrap = n => ({
    getAttribute: k => (k in n.attrs ? n.attrs[k]
      : (n.attrs['r:' + k] !== undefined ? n.attrs['r:' + k] : null)),
    getAttributeNS: (_ns, k) => {
      for (const [key, v] of Object.entries(n.attrs)) {
        if (key === k || key.endsWith(':' + k)) return v;
      }
      return null;
    },
    get textContent() { return n.text; },
    getElementsByTagNameNS: (_ns, want) => descend(n, want).map(wrap),
    getElementsByTagName: want => descend(n, want).map(wrap)
  });
  const descend = (from, want) => {
    const out = [];
    const walk = x => {
      for (const c of x.children) {
        if (want === '*' || local(c) === want) out.push(c);
        walk(c);
      }
    };
    walk(from);
    return out;
  };
  return {
    getElementsByTagNameNS: (_ns, want) => nodes.filter(n => local(n) === want).map(wrap),
    getElementsByTagName: want => nodes.filter(n => local(n) === want).map(wrap)
  };
}

globalThis.DOMParser = class { parseFromString(xml) { return makeDoc(xml); } };
