"""Minimal xlsx reader (zipfile + ElementTree) — openpyxl is not installed.

Returns each sheet as a list of rows of strings, addressed by cell reference so
blank cells are preserved rather than silently collapsing the grid.
"""
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"


def col_to_index(ref):
    letters = re.match(r"[A-Z]+", ref).group(0)
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def load(path):
    z = zipfile.ZipFile(path)

    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        root = ET.fromstring(z.read("xl/sharedStrings.xml"))
        for si in root.findall(f"{NS}si"):
            shared.append("".join(t.text or "" for t in si.iter(f"{NS}t")))

    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    target = {r.get("Id"): r.get("Target") for r in rels}

    sheets = {}
    for sh in wb.find(f"{NS}sheets"):
        name = sh.get("name")
        path_ = target[sh.get(f"{REL}id")].lstrip("/")
        if not path_.startswith("xl/"):
            path_ = "xl/" + path_
        sheets[name] = read_sheet(ET.fromstring(z.read(path_)), shared)
    return sheets


def read_sheet(root, shared):
    rows = []
    for row in root.iter(f"{NS}row"):
        cells = {}
        for c in row.findall(f"{NS}c"):
            ref = c.get("r")
            t = c.get("t")
            if t == "inlineStr":
                is_ = c.find(f"{NS}is")
                val = "".join(x.text or "" for x in is_.iter(f"{NS}t")) if is_ is not None else ""
            else:
                v = c.find(f"{NS}v")
                if v is None or v.text is None:
                    val = ""
                elif t == "s":
                    val = shared[int(v.text)]
                else:
                    val = v.text
            val = val.strip()
            if val:
                cells[col_to_index(ref)] = val
        width = max(cells) + 1 if cells else 0
        rows.append([cells.get(i, "") for i in range(width)])
    while rows and not any(rows[-1]):
        rows.pop()
    return rows


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "CIGARETTES PLANOGRAM.xlsx"
    for name, rows in load(path).items():
        print(f"\n{'=' * 70}\nSHEET: {name}   ({len(rows)} rows)\n{'=' * 70}")
        for i, r in enumerate(rows, 1):
            if any(r):
                print(f"{i:3} | " + " | ".join(r))
