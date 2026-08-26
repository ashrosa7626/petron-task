"""Derive connected regions (4-way adjacency) from the seeded planogram.

Read-only sanity check before building the page: confirms how many regions
each product forms and whether every region is a true rectangle.
"""
import json
import re
import urllib.request
from collections import defaultdict, deque

BASE = "https://vwffiuciogthfzekkkkz.supabase.co/rest/v1"
KEY = re.search(r"eyJ[A-Za-z0-9_.-]+", open("../app.js").read()).group(0)


def get(path):
    req = urllib.request.Request(f"{BASE}/{path}", headers={"apikey": KEY})
    return json.load(urllib.request.urlopen(req))


facings = get("planogram_facing?select=shelf,position,product_id&version_id=eq.1")
products = {p["product_id"]: p for p in get("product?select=product_id,short_name,plu")}

by_product = defaultdict(set)
for f in facings:
    by_product[f["product_id"]].add((f["shelf"], f["position"]))

shelves = sorted({f["shelf"] for f in facings})
row_of = {s: i for i, s in enumerate(shelves)}

total_regions = 0
non_rect = []
split = []

for pid, cells in by_product.items():
    grid = {(row_of[s], p) for s, p in cells}
    seen = set()
    regions = []
    for cell in sorted(grid):
        if cell in seen:
            continue
        q, region = deque([cell]), []
        seen.add(cell)
        while q:
            r, c = q.popleft()
            region.append((r, c))
            for nr, nc in ((r + 1, c), (r - 1, c), (r, c + 1), (r, c - 1)):
                if (nr, nc) in grid and (nr, nc) not in seen:
                    seen.add((nr, nc))
                    q.append((nr, nc))
        regions.append(region)

    total_regions += len(regions)
    name = products.get(pid, {}).get("short_name", "?")
    for region in regions:
        rs = [r for r, _ in region]
        cs = [c for _, c in region]
        h = max(rs) - min(rs) + 1
        w = max(cs) - min(cs) + 1
        if h * w != len(region):
            non_rect.append((name, pid, sorted(region), h, w))
    if len(regions) > 1:
        pos = " | ".join(
            ",".join(f"{shelves[r]}{c}" for r, c in sorted(rg)) for rg in regions
        )
        split.append((name, len(regions), pos))

print(f"products in planogram : {len(by_product)}")
print(f"facings               : {len(facings)}")
print(f"regions (blocks)      : {total_regions}")
print(f"shelves               : {''.join(shelves)}  positions 1..{max(f['position'] for f in facings)}")

print(f"\nsplit products ({len(split)}):")
for name, n, pos in sorted(split):
    print(f"  {name:24} {n} blocks   {pos}")

print(f"\nnon-rectangular regions ({len(non_rect)}):")
for name, pid, region, h, w in non_rect:
    print(f"  {name} ({pid}) {len(region)} cells in {h}x{w} box -> {region}")

longest = sorted(products.values(), key=lambda p: -len(p["short_name"]))[:5]
print("\nlongest short_name values:")
for p in longest:
    print(f"  {len(p['short_name']):2} {p['short_name']}")
