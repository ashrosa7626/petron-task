"""Generate the lubes and Iluma seed SQL from excel/Lubes planogram.xlsx.

Generated rather than hand-written because 52 products by 5 fields is exactly
where a transcription error hides — and because the three products that are
missing a POS Item ID today will get one later, and this has to be re-runnable
when they do.

It refuses to emit anything it cannot stand behind:
  * a product with no POS Item ID          -- the join key cannot be invented
  * a duplicate POS Item ID                -- two products would become one
  * a grid label matching no stock row     -- a facing pointing at nothing
  * the grid and the Positions column disagreeing

Those are the same refusals stock-count/planogram-diff.js enforces in the
browser. Read-only: writes a .sql file, touches no database.

    python3 gen_seed_from_xlsx.py
"""
import re
import sys
from collections import defaultdict

from read_xlsx import load

WORKBOOK = "../excel/Lubes planogram.xlsx"
OUT = "16_seed_lubes_iluma.sql"
BRANCH = "SAFARI"

SHEETS = [
    ("LUBES", "Lubes Planogram", "Lubes Stock List"),
    ("ILUMA", "Iluma Planogram", "Iluma Stock List"),
]

# Rows whose description is really a legend line under the table.
NOT_A_PRODUCT = ("PLU corrected", "On the paper", "Not placed", "Placement confidence")


def sq(s):
    return "'" + str(s).replace("'", "''") + "'"


def read_grid(rows):
    """{(shelf, position): label} from a sheet laid out like the cigarette one."""
    numrow = firstcol = None
    for i, r in enumerate(rows):
        for c in range(len(r) - 1):
            if r[c].strip() == "1" and r[c + 1].strip() == "2":
                numrow, firstcol = i, c
                break
        if numrow is not None:
            break
    if numrow is None:
        sys.exit("  no row of position numbers found")

    pos_at = {c: int(v) for c, v in enumerate(rows[numrow])
              if v.strip().isdigit() and c >= firstcol}
    grid = {}
    for r in rows[numrow + 1:]:
        shelf = ""
        for c in range(firstcol):
            v = r[c].strip().upper() if c < len(r) else ""
            if re.fullmatch(r"[A-Z]", v):
                shelf = v
                break
        if not shelf:
            continue
        for c, p in pos_at.items():
            label = r[c].strip() if c < len(r) else ""
            if label:
                grid[(shelf, p)] = label
    return grid


def read_products(rows, problems):
    """One row per product, keyed by POS Item ID. Skips legend lines."""
    hdr = next((r for r in rows if "POS Item ID" in r), None)
    if hdr is None:
        sys.exit("  no 'POS Item ID' header")
    col = {v.strip().upper(): i for i, v in enumerate(hdr) if v.strip()}

    def at(row, name):
        i = col.get(name)
        return row[i].strip() if i is not None and i < len(row) else ""

    out = {}
    for n, row in enumerate(rows[rows.index(hdr) + 1:], start=rows.index(hdr) + 2):
        desc, pid = at(row, "POS DESCRIPTION"), at(row, "POS ITEM ID")
        short, positions = at(row, "SHORT NAME"), at(row, "POSITIONS")
        if not desc and not short:
            continue
        if desc.startswith(NOT_A_PRODUCT):
            continue
        if not pid:
            # Real, on the shelf, and not seedable. Named so it can be chased.
            problems.append(
                f"row {n}: {short or desc!r} has NO POS Item ID — left off the "
                f"planogram (was at {positions or 'no position'})")
            continue
        if not re.fullmatch(r"\d{4,10}", pid):
            sys.exit(f"  row {n}: {pid!r} is not a POS Item ID")
        if pid in out:
            sys.exit(f"  row {n}: POS Item ID {pid} appears twice")
        out[pid] = {
            "product_id": pid,
            "pos_description": desc or short,
            "plu": at(row, "PLU"),
            "short_name": short or desc,
            "positions": positions,
            "row": n,
        }
    return out


def expand(text):
    cells = set()
    for tok in re.split(r"[|,]", text or ""):
        m = re.fullmatch(r"\s*([A-Za-z])\s*(\d+)\s*(?:-\s*(\d+))?\s*", tok)
        if not m:
            continue
        sh, a = m.group(1).upper(), int(m.group(2))
        b = int(m.group(3) or a)
        for p in range(min(a, b), max(a, b) + 1):
            cells.add((sh, p))
    return cells


# Brand only tints the 3px strip at the top of a block, so what matters is that
# products a person thinks of as one family share one colour. Taking the first
# word gave "Rev" and "Rev-X" different stripes for the same oil.
BRANDS = [
    ("REV-X", ("REV X", "REV-X")),
    ("Rider", ("RIDER",)),
    ("Blaze", ("BLAZE",)),
    ("2T", ("2T",)),
    ("ATF", ("ATF",)),
    ("Brake & Clutch", ("BRAKE",)),
    ("Coolant", ("COOLANT",)),
    ("TEREA", ("TEREA",)),
    ("FIIT", ("FIIT",)),
    ("IQOS", ("IQOS", "ILUMA")),
]


def brand_of(desc):
    u = desc.upper()
    for name, needles in BRANDS:
        if any(n in u for n in needles):
            return name
    words = [w for w in re.split(r"[\s/]+", u) if w]
    if words and words[0] == "PETRON":
        words = words[1:]
    return words[0].title() if words else ""


sheets = load(WORKBOOK)
lines, problems, summary = [], [], []

lines += [
    "-- ============================================================",
    "-- 16 — seed the lubes and Iluma shelves",
    "--",
    "-- GENERATED by gen_seed_from_xlsx.py from excel/Lubes planogram.xlsx.",
    "-- Do not hand-edit: re-run the generator instead, which is also how the",
    "-- three products still missing a POS Item ID get added once they have one.",
    "--",
    "-- Run AFTER 15_categories.sql. Idempotent.",
    "-- ============================================================",
    "",
    "begin;",
    "",
]

for category, grid_sheet, list_sheet in SHEETS:
    print(f"=== {category} ===")
    grid = read_grid(sheets[grid_sheet])
    products = read_products(sheets[list_sheet], problems)

    # Resolve every grid label to a product. Short name first, then the POS
    # description, then a unique prefix of it — the same order the browser uses.
    by_short = {p["short_name"].upper(): pid for pid, p in products.items()}
    by_desc = {p["pos_description"].upper(): pid for pid, p in products.items()}
    facings, unresolved, aliases = {}, defaultdict(list), {}
    for cell, label in grid.items():
        u = label.upper()
        pid = by_short.get(u) or by_desc.get(u)
        if not pid:
            hits = {v for k, v in by_desc.items() if k.startswith(u)}
            if len(hits) == 1:
                pid = hits.pop()
        if not pid:
            unresolved[label].append(cell)
            continue
        facings[cell] = pid
        aliases[label] = pid

    # The two sheets are two views of one layout and must agree.
    by_pid = defaultdict(set)
    for cell, pid in facings.items():
        by_pid[pid].add(cell)
    for pid, p in products.items():
        stated, actual = expand(p["positions"]), by_pid.get(pid, set())
        if stated != actual:
            fmt = lambda s: ",".join(f"{a}{b}" for a, b in sorted(s)) or "(none)"
            sys.exit(f"  {p['short_name']}: Positions says {fmt(stated)} but the "
                     f"grid has {fmt(actual)} — the sheets disagree")

    for label, cells in unresolved.items():
        problems.append(f"{category}: grid label {label!r} at "
                        f"{','.join(f'{a}{b}' for a, b in sorted(cells))} matches no product")

    placed = {pid for pid in by_pid}
    unplaced = [p for pid, p in products.items() if pid not in placed]
    print(f"  {len(products)} products, {len(placed)} on the shelf, {len(facings)} facings")
    if unplaced:
        print(f"  off the shelf (seeded inactive): {[p['short_name'] for p in unplaced]}")
    summary.append((category, len(placed), len(facings), len(unplaced)))

    lines.append(f"-- ---------- {category} ----------")
    lines.append("insert into product (product_id, plu, pos_description, short_name, brand, active, category) values")
    vals = []
    for pid, p in sorted(products.items()):
        # A product with no facings is off the shelf. Seed it inactive: left
        # active it would keep getting a zero row from the sales importer while
        # never appearing on a count, and drop out of reconciliation silently.
        active = "true" if pid in placed else "false"
        vals.append(f"  ({sq(pid)}, {sq(p['plu'])}, {sq(p['pos_description'])}, "
                    f"{sq(p['short_name'])}, {sq(brand_of(p['pos_description']))}, "
                    f"{active}, '{category}')")
    lines.append(",\n".join(vals))
    lines.append("on conflict (product_id) do update set")
    lines.append("  plu = excluded.plu, pos_description = excluded.pos_description,")
    lines.append("  short_name = excluded.short_name, brand = excluded.brand,")
    lines.append("  active = excluded.active, category = excluded.category;")
    lines.append("")

    lines.append("insert into product_alias (alias, product_id) values")
    lines.append(",\n".join(f"  ({sq(a)}, {sq(pid)})" for a, pid in sorted(aliases.items())))
    lines.append("on conflict (alias) do update set product_id = excluded.product_id;")
    lines.append("")

    # One active version per (branch, category) — enforced by the partial
    # unique index from 15, so re-running cannot leave two.
    lines += [
        f"insert into planogram_version (branch_id, category, status, effective_from, note)",
        f"select {sq(BRANCH)}, '{category}', 'active', current_date,",
        f"       'Seeded from Lubes planogram.xlsx'",
        f" where not exists (select 1 from planogram_version",
        f"                    where branch_id = {sq(BRANCH)} and category = '{category}'",
        f"                      and status = 'active');",
        "",
        "insert into planogram_facing (version_id, shelf, position, product_id)",
        "select v.version_id, f.shelf, f.position, f.product_id",
        "  from (values",
    ]
    cells = ",\n".join(
        f"    ({sq(sh)}, {p}, {sq(pid)})" for (sh, p), pid in sorted(facings.items()))
    lines.append(cells)
    lines += [
        "  ) as f(shelf, position, product_id)",
        f"  cross join (select version_id from planogram_version",
        f"               where branch_id = {sq(BRANCH)} and category = '{category}'",
        f"                 and status = 'active') v",
        "on conflict (version_id, shelf, position) do update set",
        "  product_id = excluded.product_id;",
        "",
    ]

lines.append("commit;")
lines.append("")
lines.append("-- ============================================================")
lines.append("-- Verify")
lines.append("-- ============================================================")
for category, prods, facs, off in summary:
    lines.append(f"-- {category}: expect {prods} products on the shelf, {facs} facings"
                 + (f", {off} seeded inactive (off the shelf)" if off else ""))
lines += [
    "select p.category, count(distinct p.product_id) filter (where p.active) as active_products,",
    "       count(f.*) as facings",
    "  from product p",
    "  left join planogram_facing f on f.product_id = p.product_id",
    "  left join planogram_version v on v.version_id = f.version_id and v.status = 'active'",
    " group by p.category order by p.category;",
]

if problems:
    lines.append("")
    lines.append("-- NOT SEEDED — these need a POS Item ID from the till before they can be")
    lines.append("-- counted. Add them on the Edit the Shelf page; no migration needed.")
    for p in problems:
        lines.append(f"--   {p}")

with open(OUT, "w") as fh:
    fh.write("\n".join(lines) + "\n")

print(f"\nwrote {OUT}")
if problems:
    print("\nNOT SEEDED:")
    for p in problems:
        print(f"  {p}")
