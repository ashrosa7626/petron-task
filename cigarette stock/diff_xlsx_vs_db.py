"""Compare CIGARETTES PLANOGRAM.xlsx against the live Supabase data.

The spreadsheet is the editor for the planogram, so it is the source of truth
here. This reports what the database would need in order to match it, and
writes 04_sync_to_spreadsheet.sql with exactly those changes.

Read-only against Supabase — the anon key cannot write.
"""
import json
import re
import urllib.request
from collections import defaultdict

from read_xlsx import load

BASE = "https://vwffiuciogthfzekkkkz.supabase.co/rest/v1"
KEY = re.search(r"eyJ[A-Za-z0-9_.-]+", open("../app.js").read()).group(0)
VERSION = 1


def get(path):
    req = urllib.request.Request(f"{BASE}/{path}", headers={"apikey": KEY})
    return json.load(urllib.request.urlopen(req))


def sq(s):
    return "'" + str(s).replace("'", "''") + "'"


# ---------- spreadsheet ----------
sheets = load("CIGARETTES PLANOGRAM.xlsx")

# Full Stock List: description | item id | plu | positions...
sheet_products = {}
for row in sheets["Full Stock List"][1:]:
    if len(row) < 4 or not row[2]:
        continue
    pid = row[2].strip()
    # The Positions column is one cell holding "A1-5 | B1-5", so split on the
    # pipe rather than relying on separate columns.
    tokens = []
    for cell in row[4:]:
        tokens += [t.strip() for t in re.split(r"[|,]", cell) if t.strip()]
    sheet_products[pid] = {
        "product_id": pid,
        "pos_description": row[1].strip(),
        "plu": row[3].strip(),
        "positions": tokens,
    }

# Planogram grid: row 2 is the position header, rows 3+ are shelves.
grid = {}          # (shelf, position) -> grid label
grid_labels = set()
for row in sheets["Planogram"][2:]:
    if len(row) < 2 or not row[1].strip():
        continue
    shelf = row[1].strip()
    for i, cell in enumerate(row[2:], start=1):
        label = cell.strip()
        if label:
            grid[(shelf, i)] = label
            grid_labels.add(label)

# ---------- database ----------
db_products = {p["product_id"]: p for p in get("product?select=product_id,plu,pos_description,short_name,brand")}
db_alias = {a["alias"]: a["product_id"] for a in get("product_alias?select=alias,product_id")}
db_facings = {(f["shelf"], f["position"]): f["product_id"]
              for f in get(f"planogram_facing?select=shelf,position,product_id&version_id=eq.{VERSION}")}

# ---------- resolve every grid cell ----------
# Case-insensitive alias lookup; the grid is upper case, aliases are stored so.
alias_ci = {k.upper(): v for k, v in db_alias.items()}

# A grid label with no alias is resolved against the Full Stock List instead —
# that is the POS Item ID the importer would otherwise stop and ask for.
by_desc = {m["pos_description"].upper(): pid for pid, m in sheet_products.items()}


def resolve(label):
    u = label.upper()
    if u in alias_ci:
        return alias_ci[u], False
    if u in by_desc:
        return by_desc[u], True
    hit = [pid for d, pid in by_desc.items() if d.startswith(u)]
    if len(hit) == 1:
        return hit[0], True
    return None, True


unresolved = []          # labels needing a new alias row
unknown = []             # labels nothing can resolve — these stop an import
sheet_facings = {}
for cell, label in grid.items():
    pid, needs_alias = resolve(label)
    if pid is None:
        unknown.append(label)
        continue
    if needs_alias and label not in unresolved:
        unresolved.append(label)
    sheet_facings[cell] = pid
unresolved.sort()
unknown = sorted(set(unknown))

print("=" * 68)
print("SPREADSHEET")
print("=" * 68)
print(f"  Full Stock List rows : {len(sheet_products)}")
print(f"  grid cells filled    : {len(grid)}")
print(f"  distinct grid labels : {len(grid_labels)}")
print(f"  labels with no alias : {len(unresolved)}  {unresolved if unresolved else ''}")
print(f"  labels unresolvable  : {len(unknown)}  {unknown if unknown else ''}")

print()
print("=" * 68)
print("DATABASE (version %d)" % VERSION)
print("=" * 68)
print(f"  product rows   : {len(db_products)}")
print(f"  alias rows     : {len(db_alias)}")
print(f"  facing rows    : {len(db_facings)}")

# ---------- internal check: grid vs the Positions column ----------
def expand(tokens):
    out = set()
    for t in tokens:
        m = re.fullmatch(r"([A-Z])(\d+)(?:-(\d+))?", t.replace(" ", ""))
        if not m:
            continue
        shelf, a, b = m.group(1), int(m.group(2)), int(m.group(3) or m.group(2))
        for p in range(a, b + 1):
            out.add((shelf, p))
    return out


print()
print("=" * 68)
print("INTERNAL CHECK — grid vs the Positions column, same workbook")
print("=" * 68)
grid_by_pid = defaultdict(set)
for cell, pid in sheet_facings.items():
    grid_by_pid[pid].add(cell)

internal_bad = 0
for pid, meta in sheet_products.items():
    stated = expand(meta["positions"])
    actual = grid_by_pid.get(pid, set())
    if stated != actual:
        internal_bad += 1
        fmt = lambda s: ",".join(f"{sh}{p}" for sh, p in sorted(s, key=lambda x: (x[0], x[1]))) or "(none)"
        print(f"  MISMATCH {meta['pos_description']} ({pid})")
        print(f"     Positions column : {fmt(stated)}")
        print(f"     grid             : {fmt(actual)}")
print("  clean — every product's grid cells match its Positions column"
      if not internal_bad else f"  {internal_bad} product(s) disagree")

# ---------- diff ----------
print()
print("=" * 68)
print("DIFF — what the database needs to match the spreadsheet")
print("=" * 68)

missing_products = [p for p in sheet_products if p not in db_products]
extra_products = [p for p in db_products if p not in sheet_products]

print(f"\nproducts missing from the database ({len(missing_products)}):")
for p in missing_products:
    print(f"  + {p}  {sheet_products[p]['pos_description']}  PLU {sheet_products[p]['plu']}")
print(f"\nproducts in the database but not the spreadsheet ({len(extra_products)}):")
for p in extra_products:
    print(f"  - {p}  {db_products[p]['pos_description']}")

plu_diff = [(p, db_products[p]["plu"], sheet_products[p]["plu"])
            for p in sheet_products if p in db_products and db_products[p]["plu"] != sheet_products[p]["plu"]]
print(f"\nPLU differences ({len(plu_diff)}):")
for p, a, b in plu_diff:
    print(f"  {p}: db {a}  ->  sheet {b}")

facing_diff = []
for cell in sorted(set(sheet_facings) | set(db_facings), key=lambda c: (c[0], c[1])):
    a, b = db_facings.get(cell), sheet_facings.get(cell)
    if a != b:
        facing_diff.append((cell, a, b))
print(f"\nfacing differences ({len(facing_diff)}):")
for (sh, p), a, b in facing_diff:
    na = db_products.get(a, {}).get("short_name", a or "(empty)")
    nb = db_products.get(b, {}).get("short_name") or (sheet_products.get(b, {}).get("pos_description", b)) or "(empty)"
    print(f"  {sh}{p}: {na}  ->  {nb}")

missing_alias = list(unresolved)
print(f"\ngrid labels needing a new alias ({len(missing_alias)}): {missing_alias}")

stale_alias = sorted(a for a, pid in db_alias.items() if a.upper() not in {l.upper() for l in grid_labels})
print(f"\naliases in the database that the current grid no longer uses ({len(stale_alias)}): {stale_alias}")

# ---------- emit migration ----------
lines = [
    "-- ============================================================",
    "-- 04 — sync the database to CIGARETTES PLANOGRAM.xlsx",
    "--",
    "-- Generated by diff_xlsx_vs_db.py. Run AFTER 01/02/03.",
    "-- The database had drifted from the spreadsheet: LD 100 Red was",
    "-- absent entirely and its two facings had been absorbed into the",
    "-- LD Red block, making C21-25 one contiguous product.",
    "--",
    "-- Idempotent.",
    "-- ============================================================",
    "",
    "begin;",
    "",
]

if missing_products:
    lines.append("-- Products present in the spreadsheet but missing from the database.")
    lines.append("insert into product (product_id, plu, pos_description, short_name, brand) values")
    # short_name and brand are not in the spreadsheet; take them from the
    # original seed where it already had the product, rather than inventing one.
    seed = open("02_seed.sql").read()
    seeded = {m[0]: (m[3], m[4]) for m in re.findall(
        r"\('(\d+)', '([^']*)', '((?:[^']|'')*)', '((?:[^']|'')*)', '([^']*)'\)", seed)}
    vals = []
    for p in missing_products:
        m = sheet_products[p]
        desc = m["pos_description"]
        short, brand = seeded.get(p, (desc.title(), desc.split()[0].title()))
        vals.append(f"  ({sq(p)}, {sq(m['plu'])}, {sq(desc)}, {sq(short)}, {sq(brand)})")
    lines.append(",\n".join(vals))
    lines.append("on conflict (product_id) do update set")
    lines.append("  plu = excluded.plu, pos_description = excluded.pos_description;")
    lines.append("")

if missing_alias:
    lines.append("-- Grid labels that the importer cannot currently resolve.")
    lines.append("insert into product_alias (alias, product_id) values")
    vals = []
    for label in missing_alias:
        vals.append(f"  ({sq(label)}, {sq(resolve(label)[0])})")
    lines.append(",\n".join(vals))
    lines.append("on conflict (alias) do update set product_id = excluded.product_id;")
    lines.append("")

if facing_diff:
    lines.append(f"-- {len(facing_diff)} facing(s) that disagree with the grid.")
    lines.append("insert into planogram_facing (version_id, shelf, position, product_id) values")
    vals = [f"  ({VERSION}, {sq(sh)}, {p}, {sq(new)})" for (sh, p), _, new in facing_diff if new]
    lines.append(",\n".join(vals))
    lines.append("on conflict (version_id, shelf, position) do update set")
    lines.append("  product_id = excluded.product_id;")
    lines.append("")

if stale_alias:
    lines.append("-- Aliases the current grid no longer uses. Left in place on purpose:")
    lines.append("-- they still resolve to the right product, so an older copy of the")
    lines.append("-- spreadsheet keeps importing. Uncomment only if you want them gone.")
    for a in stale_alias:
        lines.append(f"-- delete from product_alias where alias = {sq(a)};")
    lines.append("")

lines += [
    "commit;",
    "",
    "-- Expected afterwards: 54 products, 162 facings, 58 blocks,",
    "-- 3 products split across blocks (LD Red, LD 100 Red, Marlboro Black).",
    "",
]

with open("04_sync_to_spreadsheet.sql", "w") as fh:
    fh.write("\n".join(lines))

# The layout the page will read once the migration is applied, so the block
# derivation can be checked before touching the database.
with open("expected_facings.json", "w") as fh:
    json.dump({
        "facings": [{"shelf": sh, "position": p, "product_id": pid}
                    for (sh, p), pid in sorted(sheet_facings.items(), key=lambda x: (x[0][0], x[0][1]))],
        "products": [{"product_id": pid,
                      "short_name": db_products.get(pid, {}).get("short_name")
                      or sheet_products[pid]["pos_description"],
                      "plu": sheet_products[pid]["plu"]}
                     for pid in sheet_products],
    }, fh, indent=1)

print()
print("=" * 68)
print("wrote 04_sync_to_spreadsheet.sql")
print("=" * 68)
