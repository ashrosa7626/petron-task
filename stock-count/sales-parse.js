// ===========================================================================
// Merchandise Sales Report — parsing and validation.
//
// The POS can only print, and every report we have is a CCITT G4 fax scan with
// no text layer at all, so OCR is the only route in. Everything here is written
// on that assumption: the input is a noisy transcription, and the job is to
// decide which lines can be trusted rather than to believe all of them.
//
// THE ONLY VALUE THIS SYSTEM WRITES IS qty_sold. No price ever reaches the
// database. So the money columns are not audited for their own sake — they are
// read as EVIDENCE FOR THE QUANTITY, and nothing else:
//
//   Total Sales / Price   and   Total Cost / Cost   and   Nett Sales / Price
//
// are each the quantity, computed by the POS before anything was scanned. When
// one of them lands exactly on the number OCR read, the quantity is proved by
// digits read independently of it, and the line is taken. When they agree on a
// DIFFERENT number, the quantity is wrong and a human is asked — that is the
// only thing flagged. A misread price that still proves the quantity is not a
// problem and is not reported: it changes nothing that gets written.
//
// One file-level check survives, as a warning rather than a gate: the Nett
// Sales column should sum to the report's own Grand Total. A line lost entirely
// to OCR is proved by nothing and flagged by nothing, because it is not there
// to be tested — this is the only thing that notices it is gone.
//
// Imported by both import-sales.html and cigarette stock/verify_ocr_parse.mjs,
// so the tests exercise the shipped code rather than a copy of it.
// ===========================================================================

// Tolerance for money comparisons. Two decimal places throughout, so anything
// beyond a cent of drift is a misread rather than rounding.
export const CENT = 0.02;

// ---------------------------------------------------------------------------
// A number as OCR hands it back.
//
// Tesseract returns '17,90' for '17.90' on roughly one line in six, so comma
// and period are both accepted as the decimal separator, and thousands
// separators go either way too ('2,435.80').
// ---------------------------------------------------------------------------
const NUM = String.raw`-?\d{1,3}(?:[.,]\d{3})*[.,]\d{2}|-?\d+[.,]\d{2}`;
const NUM_RE = new RegExp(NUM, 'g');

export function toNum(s) {
  const t = String(s).trim().replace(/\s+/g, '');
  const cut = Math.max(t.lastIndexOf(','), t.lastIndexOf('.'));
  if (cut === -1) return Number(t);
  return Number(t.slice(0, cut).replace(/[.,]/g, '') + '.' + t.slice(cut + 1));
}

// ---------------------------------------------------------------------------
// The Item ID, taken as the six digits IMMEDIATELY before the dash — no word
// boundary anywhere.
//
// One real line came back as:
//     8885004830042 4100760 - LD MENTHOL 4 12.70 ...
// a stray mark fused onto the front of the ID. A \b-anchored pattern matched
// nothing and dropped the whole line in silence. Taking the last six digits
// before the dash recovers it, and the ID is checked against the product table
// afterwards, so a bad capture surfaces rather than persists.
//
// The Barcode/PLU sits in the same row and must never be mistaken for the key:
// the POS export prints several PLUs both with and without a leading zero, so
// joining on it produces duplicate and missing rows.
// ---------------------------------------------------------------------------
export const ITEM_LINE = new RegExp(String.raw`(\d{6})\s*[-‐-―]\s*(.+)$`);

// Qty, then the money columns in printed order:
//   Price | Cost | Total Cost | Total Sales | Nett Sales
// The last is optional — if OCR mangles it the line is still worth reading, it
// just falls back to Total Sales for the file total.
const NUMERIC_BLOCK = new RegExp(
  String.raw`(?<![\d.,])(\d{1,4})\s+` +
  `(${NUM})\\s+(${NUM})\\s+(${NUM})\\s+(${NUM})` +
  `(?:\\s+(${NUM}))?`
);

// Lines that are furniture, not data. Checked before anything else so a
// subtotal row carrying a six-digit-looking figure can never become a product.
const NOT_A_PRODUCT =
  /(grand\s*total|sub\s*-?\s*total|page\s+\d+\s+of|business\s+date|printed\s+on|site\s+(id|name)|department\s+code|category\s+code|cashier)/i;

// ---------------------------------------------------------------------------
// The decimal point that OCR drops.
//
// '18.40' comes back as '1840' on a handful of lines in every report — the
// point is a two-pixel mark on a fax scan. That shifts the whole money block
// by one column, and a column read one place out cannot corroborate anything.
//
// A bare 3-5 digit integer sitting in a money column is therefore re-read with
// the point put back two from the right. This is plumbing, not a finding: it
// only ever matters because it lets the money columns speak for the quantity,
// and a reading is only taken when the quantity it implies is proved. A price
// misread in a way that changes nothing about the quantity is not reported,
// because no price is ever written.
// ---------------------------------------------------------------------------
const MONEY_TOKEN = new RegExp(`^(?:${NUM})$`);
const BARE_INT = /^\d{1,5}$/;

const moneyValue = tok => {
  if (MONEY_TOKEN.test(tok)) return { value: toNum(tok), repaired: false };
  // A bare integer only reads as money if the point can go two from the right.
  if (BARE_INT.test(tok) && tok.length >= 3) {
    return { value: Number(tok.slice(0, -2) + '.' + tok.slice(-2)), repaired: true };
  }
  return null;
};

// Read the money block starting at `i`, where tokens[i] is the quantity.
function readBlockAt(tokens, i) {
  const qtyTok = tokens[i];
  if (!BARE_INT.test(qtyTok) || qtyTok.length > 4) return null;
  const cols = [];
  for (let k = 1; k <= 5; k++) {
    const v = tokens[i + k] === undefined ? null : moneyValue(tokens[i + k]);
    if (!v && k <= 4) return null;      // price..total_sales are all required
    cols.push(v);
  }
  const [price, cost, total_cost, total_sales, nett] = cols;
  return {
    qty: parseInt(qtyTok, 10),
    price: price.value, cost: cost.value,
    total_cost: total_cost.value, total_sales: total_sales.value,
    nett_sales: nett ? nett.value : total_sales.value
  };
}

// ---------------------------------------------------------------------------
// What the money columns say the quantity is.
//
// Each ratio is the quantity as the POS computed it, from digits read
// independently of the quantity itself. The tolerance is on the MONEY, never
// on the ratio: 35.80 / 17.80 is 2.011, which rounds to 2 within a hundredth,
// but 2 x 17.80 is twenty cents out, so that pairing proves nothing and must
// not be allowed to look as if it does.
// ---------------------------------------------------------------------------
export function quantityEvidence(row) {
  const found = new Map();
  const add = (total, unit, from) => {
    if (!(unit > 0) || !(total > 0) || !isFinite(total) || !isFinite(unit)) return;
    const n = Math.round(total / unit);
    if (n < 1 || n > 9999) return;
    if (Math.abs(n * unit - total) > CENT) return;
    if (!found.has(n)) found.set(n, { qty: n, from: [] });
    found.get(n).from.push(from);
  };
  add(row.total_sales, row.price, 'Total Sales ÷ Price');
  add(row.total_cost, row.cost, 'Total Cost ÷ Cost');
  add(row.nett_sales, row.price, 'Nett Sales ÷ Price');
  return [...found.values()].sort((a, b) => b.from.length - a.from.length);
}

const proves = (row, qty) => quantityEvidence(row).some(e => e.qty === qty);

// Every starting position is tried, and the first reading whose quantity the
// money columns actually corroborate wins. A description ending in a number
// ("PETER STUYVESANT 100 5 16.70 ...") would otherwise be mistaken for the
// quantity; nothing corroborates it, so the scan moves on. If no reading is
// corroborated the leftmost valid one is returned anyway, so the line can be
// shown to a human with its numbers rather than as a blank.
function readMoneyBlock(rest) {
  const tokens = rest.trim().split(/\s+/);
  let first = null;
  for (let i = 0; i < tokens.length - 4; i++) {
    const hit = readBlockAt(tokens, i);
    if (!hit) continue;
    if (proves(hit, hit.qty)) return { reading: hit, proved: true };
    if (!first) first = hit;
  }
  return first ? { reading: first, proved: false } : null;
}

// ---------------------------------------------------------------------------
// The Barcode/PLU printed to the left of the Item ID, as a CROSS-CHECK.
//
// It is never a join key and this does not make it one — `product_id` remains
// the only thing anything joins on. The point is different: the PLU and the
// Item ID are two independent labels for the same pack, printed side by side.
// If they disagree, one of them was misread, and that is worth saying out loud
// next to a line whose quantity was taken on trust.
//
// Two things stop this from crying wolf:
//   * the report prints its category code in the same region, so OCR runs
//     '02' onto the front of the barcode ('0201231233' for '01231233'). The
//     LAST run of digits before the Item ID is taken, and a match is allowed
//     when either value ends with the other.
//   * leading zeros differ between the POS export and the product table on
//     several lines — the same leading-zero problem that is why PLU is never
//     a join key — so they are stripped before comparing.
// ---------------------------------------------------------------------------
function scannedPlu(text, productId) {
  const at = text.indexOf(productId);
  if (at < 0) return null;
  const before = text.slice(0, at);
  const runs = before.match(/\d+/g);
  if (!runs || !runs.length) return null;
  const last = runs[runs.length - 1];
  return last.length >= 6 ? last : null;
}

const bare = s => String(s == null ? '' : s).replace(/\D/g, '').replace(/^0+/, '');

export function pluAgrees(scanned, known) {
  const a = bare(scanned), b = bare(known);
  if (!a || !b) return true;                 // nothing to compare, no complaint
  return a === b || a.endsWith(b) || b.endsWith(a);
}

// ---------------------------------------------------------------------------
// Business date — from the report header, never from today and never from the
// filename. The header prints two dates and the wrong one is listed first:
//
//     Merchandise Sales Report        Printed on 10/09/2026 15:49
//     Business Date From 09/09/2026 To 09/09/2026
//
// 'Printed on' is when the paper came out of the machine, usually the morning
// after the day being reported. Taking it would file every day's sales against
// the wrong date, so it is excluded explicitly rather than by luck of ordering.
// ---------------------------------------------------------------------------
const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
                 JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };

const iso = (y, m, d) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

export function parseDateToken(tok) {
  if (!tok) return null;
  let m = String(tok).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return { date: iso(+m[1], +m[2], +m[3]), ambiguous: false, raw: tok };

  m = String(tok).match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    const d = +m[1], mo = +m[2];
    if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
    // Malaysian reports print day first. When the first part cannot be a month
    // that reading is certain; when both could be, it is a real ambiguity and
    // has to be confirmed rather than assumed.
    return { date: iso(y, mo, d), ambiguous: d <= 12 && mo <= 12, raw: tok };
  }

  m = String(tok).match(/^(\d{1,2})[-/]?([A-Za-z]{3})[-/]?(\d{2,4})$/);
  if (m && MONTHS[m[2].toUpperCase()]) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return { date: iso(y, MONTHS[m[2].toUpperCase()], +m[1]), ambiguous: false, raw: tok };
  }
  return null;
}

const DATE_TOKEN = String.raw`\d{1,4}[/\-.][A-Za-z0-9]{1,4}[/\-.]\d{2,4}`;

export function findBusinessDate(text) {
  const flat = String(text).replace(/\s+/g, ' ');

  // "Business Date From 09/09/2026 To 09/09/2026" — the range form. A report
  // covering more than one day cannot be filed against a single sale_date, so
  // the span is reported back and the caller refuses it.
  let m = flat.match(new RegExp(
    String.raw`business\s*date\s*(?:from)?\s*[:\-]?\s*(${DATE_TOKEN})\s*(?:to|-|–)\s*(${DATE_TOKEN})`, 'i'));
  if (m) {
    const from = parseDateToken(m[1]), to = parseDateToken(m[2]);
    if (from) return Object.assign(from, {
      label: 'Business Date',
      to: to ? to.date : null,
      span: !!(to && to.date !== from.date)
    });
  }

  // "Business Date: 09/09/2026" — the single-day form.
  m = flat.match(new RegExp(
    String.raw`(business\s*date|bus\.?\s*date|report\s*date)\s*[:\-]?\s*(${DATE_TOKEN})`, 'i'));
  if (m) {
    const d = parseDateToken(m[2]);
    if (d) return Object.assign(d, { label: m[1], to: d.date, span: false });
  }

  // Nothing labelled. Deliberately no fallback to the first date on the page:
  // that is "Printed on", which is the wrong day. Let the user set it.
  return null;
}

// ---------------------------------------------------------------------------
// Which report is this?
//
// The POS prints several that look alike at a glance. Inventory Balance also
// carries "Item ID", "Description" and six-digit IDs, and someone will upload
// it sooner or later. It has no Grand Total, so it would be refused anyway —
// but refused with a shrug about unreadable numbers rather than "this is the
// wrong report", which is the difference between a five-second fix and a
// support call.
// ---------------------------------------------------------------------------
const REPORTS = [
  { key: 'sales', title: 'Merchandise Sales Report', re: /merchandise\s+sales\s+report/i },
  { key: 'inventory', title: 'Inventory Balance', re: /inventory\s+balance/i },
  { key: 'shift', title: 'Shift Report', re: /shift\s+(summary|report)/i },
  { key: 'department', title: 'Department Sales Report', re: /department\s+sales\s+report/i }
];

export function identifyReport(text) {
  const head = String(text).split('\n').slice(0, 25).join('\n');
  for (const r of REPORTS) if (r.re.test(head)) return r;
  return { key: 'unknown', title: null };
}

// ---------------------------------------------------------------------------
// Grand Total. The row mirrors the column order and prints three figures:
//     Grand Total:   2,435.80   2,435.80   159.61
//                    Total Sales  Nett Sales  Gross Profit
// ---------------------------------------------------------------------------
export function findGrandTotal(text) {
  for (const raw of String(text).split('\n')) {
    const m = raw.match(/grand\s*total\s*[:\.]?\s*(.+)$/i);
    if (!m) continue;
    const nums = (m[1].match(NUM_RE) || []).map(toNum);
    if (!nums.length) continue;
    return {
      total_sales: nums[0],
      nett_sales: nums.length >= 2 ? nums[1] : nums[0],
      figures: nums,
      raw: raw.trim()
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Product lines.
//
// `pages` is [{ page, lines: [{ text, bbox, confidence }] }] — bbox is carried
// through untouched so the page can crop the scan beside a correction. A plain
// string is accepted too, for tests that only care about the text.
// ---------------------------------------------------------------------------
export function asPages(input) {
  if (typeof input === 'string') {
    return [{ page: 1, lines: input.split('\n').map(t => ({ text: t, bbox: null })) }];
  }
  return input;
}

// A wrapped description continues on the next line: "100634 - MARLBORO RED"
// then "20S". Display only — every number lives on the first line.
const isContinuation = l =>
  l.text.trim().length > 0 && l.text.trim().length < 60 &&
  !ITEM_LINE.test(l.text) && !NOT_A_PRODUCT.test(l.text) &&
  !new RegExp(NUM).test(l.text);

export function parseLines(input) {
  const pages = asPages(input);
  const out = [];

  for (const pg of pages) {
    const lines = pg.lines || [];
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      const text = (ln.text || '').trim();
      if (!text || NOT_A_PRODUCT.test(text)) continue;

      const head = text.match(ITEM_LINE);
      if (!head) continue;
      const product_id = head[1];
      const rest = head[2];

      let description = rest.replace(new RegExp(String.raw`\s+\d.*$`), '').trim();
      for (let j = i + 1; j < lines.length && j <= i + 2; j++) {
        if (!isContinuation(lines[j])) break;
        description += ' ' + lines[j].text.trim();
      }

      const row = {
        product_id,
        description: description.replace(/\s+/g, ' ').trim(),
        scanned_plu: scannedPlu(text, product_id),
        page: pg.page, bbox: ln.bbox || null,
        confidence: ln.confidence, raw: text,
        qty: null, price: null, cost: null,
        total_cost: null, total_sales: null, nett_sales: null,
        ok: false, reason: '', suggestions: []
      };

      // ------------------------------------------------------------------
      // Only the quantity is judged. A reading whose quantity the money
      // columns corroborate is taken; otherwise the line goes to a human
      // with whatever those columns do say.
      // ------------------------------------------------------------------
      const hit = readMoneyBlock(rest) ||
        (() => {
          const b = rest.match(NUMERIC_BLOCK);
          if (!b) return null;
          return {
            proved: false,
            reading: {
              qty: parseInt(b[1], 10), price: toNum(b[2]), cost: toNum(b[3]),
              total_cost: toNum(b[4]), total_sales: toNum(b[5]),
              nett_sales: b[6] === undefined ? toNum(b[5]) : toNum(b[6])
            }
          };
        })();

      if (!hit) {
        row.reason = 'the quantity on this line could not be read at all';
        out.push(row);
        continue;
      }

      Object.assign(row, hit.reading);
      row.suggestions = quantityEvidence(row).filter(e => e.qty !== row.qty);

      if (hit.proved) {
        row.ok = true;
      } else if (row.suggestions.length) {
        const top = row.suggestions[0];
        row.reason =
          `read as ${row.qty} pack${row.qty === 1 ? '' : 's'}, but the report's own ` +
          `figures work out to ${top.qty}`;
      } else {
        row.reason =
          `read as ${row.qty} pack${row.qty === 1 ? '' : 's'}, and nothing else on the ` +
          `line confirms it`;
      }
      out.push(row);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The same product can print on more than one line when the report splits by
// category. Merging happens after validation, so one bad half cannot quietly
// contaminate a good one.
// ---------------------------------------------------------------------------
export function mergeDuplicates(lines) {
  const merged = new Map();
  for (const l of lines) {
    const prev = merged.get(l.product_id);
    if (!prev) { merged.set(l.product_id, Object.assign({}, l, { parts: 1 })); continue; }
    prev.qty = (prev.qty || 0) + (l.qty || 0);
    prev.nett_sales = (prev.nett_sales || 0) + (l.nett_sales || 0);
    prev.total_sales = (prev.total_sales || 0) + (l.total_sales || 0);
    prev.parts += 1;
    prev.ok = prev.ok && l.ok;
    if (!l.ok && !prev.reason) prev.reason = l.reason;
  }
  return [...merged.values()];
}

// ---------------------------------------------------------------------------
// The file-level check.
//
// Every parsed line counts towards it, including Item IDs with no product row:
// they sold, the POS counted them in its Grand Total, and leaving them out
// would manufacture a shortfall that looks exactly like a dropped line.
//
// Corrected lines arrive already carrying the figure a human confirmed — the
// caller applies corrections to a copy of the parsed rows, so backing one out
// returns to exactly what the scan said.
// ---------------------------------------------------------------------------
export function reconcileTotals(lines, grand) {
  const summed = round2(lines.reduce((n, l) => {
    const v = l.nett_sales == null ? 0 : l.nett_sales;
    return n + (isFinite(v) ? v : 0);
  }, 0));

  if (!grand) {
    return { summed, grand: null, balances: false, shortfall: null,
             reason: 'no Grand Total was found in the report' };
  }
  const shortfall = round2(grand.nett_sales - summed);
  return {
    summed, grand: grand.nett_sales, balances: Math.abs(shortfall) < CENT,
    shortfall, reason: ''
  };
}

const round2 = n => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// A shortfall that divides evenly by some product's price names the line that
// went missing. On the 09/09 report a gap of 50.80 was 4 x 12.70 — the LD
// Menthol row, dropped whole by OCR.
// ---------------------------------------------------------------------------
export function explainShortfall(shortfall, lines, products) {
  const gap = Math.abs(shortfall);
  if (gap < CENT) return [];
  const prices = new Map();
  for (const l of lines) if (l.price > 0) prices.set(l.price.toFixed(2), l.price);
  if (products) {
    for (const p of products.values()) {
      const v = Number(p.unit_price || p.price);
      if (v > 0) prices.set(v.toFixed(2), v);
    }
  }
  const hits = [];
  for (const price of prices.values()) {
    const n = gap / price;
    const r = Math.round(n);
    if (r >= 1 && r <= 999 && Math.abs(n - r) * price < CENT) {
      hits.push({ qty: r, price, note: `${r} x ${price.toFixed(2)} = ${gap.toFixed(2)}` });
    }
  }
  return hits.sort((a, b) => a.qty - b.qty).slice(0, 6);
}

// ---------------------------------------------------------------------------
// Payload. The important behaviour: EVERY active product gets a row.
//
// Only products that sold appear in the report; the rest sold nothing and must
// be written as an explicit zero. Leaving them out drops them from
// vw_daily_reconciliation entirely — on 09/09 that would have been 24 of 54
// products with no variance at all.
// ---------------------------------------------------------------------------
export function buildPayload(parsedLines, products, branchId, saleDate) {
  const sold = new Map(parsedLines.map(l => [l.product_id, l.qty]));
  const known = [], unknown = [];
  for (const l of parsedLines) (products.has(l.product_id) ? known : unknown).push(l);

  const rows = [];
  for (const [pid] of products) {
    rows.push({
      branch_id: branchId,
      sale_date: saleDate,
      product_id: pid,
      qty_sold: sold.has(pid) ? sold.get(pid) : 0
    });
  }
  return { rows, known, unknown };
}
