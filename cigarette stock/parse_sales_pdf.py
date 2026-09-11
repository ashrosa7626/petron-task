"""
Reference parser for the POS Merchandise Sales Report (Petron MRR2 Safari).

Verified against the 09/09/2026 report: 31 lines, 152 packs, RM2,435.80,
matching the report's own Grand Total exactly.

The source PDFs are scans of printouts with NO text layer, so OCR is the
only route. This file exists so the production implementation can port a
working approach rather than rediscover it — every non-obvious decision
below cost a debugging cycle to find.

Usage:
    python parse_sales_pdf.py <report.pdf>

Requires: tesseract-ocr, poppler-utils, pillow, pytesseract
"""

import re
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image
import pytesseract

# --------------------------------------------------------------------------
# LESSON 1 — the report prints sideways.
# Render at 300dpi greyscale and rotate -90 before OCR. Without the rotation
# Tesseract sees columns as rows and the output is unusable.
# --------------------------------------------------------------------------
RENDER_DPI = 300
ROTATE_DEGREES = -90
TESSERACT_CONFIG = '--psm 6'          # assume a uniform block of text

# --------------------------------------------------------------------------
# LESSON 2 — do NOT anchor the item ID on a word boundary.
# One real line OCR'd as:
#     8885004830042 4100760 - LD MENTHOL 4 12.70 ...
# A stray mark fused onto the front of the ID. A \b-anchored pattern matched
# nothing and dropped the entire line in silence. Taking the six digits
# immediately before the dash recovers it. The ID is validated against the
# product table afterwards, so a wrong capture surfaces rather than persists.
# --------------------------------------------------------------------------
ITEM_LINE = re.compile(r'(\d{6})\s*[-\u2013]\s*(.+)')

# --------------------------------------------------------------------------
# LESSON 3 — OCR confuses '.' and ',' in decimals, on roughly one line in six.
# '17.90' comes back as '17,90'. Accept either and normalise.
# --------------------------------------------------------------------------
NUM = r'-?\d{1,3}(?:[.,]\d{3})*[.,]\d{2}|-?\d+[.,]\d{2}'

# qty, price, cost, total_cost, total_sales — the first numeric block after
# the description. The lookbehind stops a mid-number match.
NUMERIC_BLOCK = re.compile(
    r'(?<![\d.,])(\d{1,4})\s+'
    r'(' + NUM + r')\s+(' + NUM + r')\s+(' + NUM + r')\s+(' + NUM + r')'
)

BUSINESS_DATE = re.compile(
    r'Business\s+Date\s+From\s+(\d{2}/\d{2}/\d{4})\s+To\s+(\d{2}/\d{2}/\d{4})',
    re.I
)
GRAND_TOTAL = re.compile(r'Grand\s+Total[:\s]+(' + NUM + r')', re.I)

CENT = 0.02          # tolerance for the per-line arithmetic check


def to_float(s):
    """Parse a decimal that may use either ',' or '.' as its separator."""
    s = s.strip().replace(' ', '')
    cut = max(s.rfind(','), s.rfind('.'))
    if cut == -1:
        return float(s)
    whole, frac = s[:cut], s[cut + 1:]
    return float(re.sub(r'[.,]', '', whole) + '.' + frac)


def ocr_pages(pdf_path):
    """Render each page and return its OCR text."""
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(
            ['pdftoppm', '-r', str(RENDER_DPI), '-gray', '-png',
             str(pdf_path), str(Path(tmp) / 'pg')],
            check=True
        )
        for png in sorted(Path(tmp).glob('pg*.png')):
            image = Image.open(png).rotate(ROTATE_DEGREES, expand=True)
            yield pytesseract.image_to_string(image, config=TESSERACT_CONFIG)


def parse(pdf_path):
    """
    Returns (rows, failures, meta).

    rows      — lines whose arithmetic checks out, safe to write
    failures  — lines needing a human; NEVER write these
    meta      — business_date, grand_total, and the totals comparison
    """
    rows, failures = [], []
    business_date = grand_total = None

    for text in ocr_pages(pdf_path):
        if business_date is None:
            m = BUSINESS_DATE.search(text)
            if m:
                business_date = (m.group(1), m.group(2))
        if grand_total is None:
            m = GRAND_TOTAL.search(text)
            if m:
                grand_total = to_float(m.group(1))

        for raw in text.split('\n'):
            line = raw.strip()
            if not line:
                continue
            head = ITEM_LINE.search(line)
            if not head:
                continue
            item_id, rest = head.group(1), head.group(2)

            block = NUMERIC_BLOCK.search(rest)
            if not block:
                failures.append({
                    'item_id': item_id,
                    'reason': 'could not read the numbers on this line',
                    'raw': line,
                })
                continue

            qty = int(block.group(1))
            price = to_float(block.group(2))
            total_sales = to_float(block.group(5))

            # ------------------------------------------------------------------
            # LESSON 4 — the report can check its own work, and must.
            # Qty x Price must equal Total Sales. This is what makes OCR
            # acceptable for data feeding a financial reconciliation: a
            # misread digit breaks the equation instead of passing silently.
            # ------------------------------------------------------------------
            if abs(qty * price - total_sales) > CENT:
                failures.append({
                    'item_id': item_id,
                    'reason': (f'{qty} x {price:.2f} = {qty * price:.2f}, '
                               f'but the report says {total_sales:.2f}'),
                    'raw': line,
                })
                continue

            rows.append({
                'item_id': item_id,
                'qty': qty,
                'price': price,
                'total_sales': total_sales,
                'description': rest[:60].strip(),
            })

    # ----------------------------------------------------------------------
    # LESSON 5 — the file-level check is the one that catches dropped lines.
    # A line lost to OCR passes every per-line test, because it is not there
    # to be tested. Summing Total Sales against the Grand Total catches it.
    # In testing this came up short by exactly 50.80 — which is 4 x 12.70,
    # pointing straight at the missing LD Menthol line.
    # If this does not balance, BLOCK THE SAVE. Report the shortfall; a gap
    # that divides evenly by some product's price names the missing line.
    # ----------------------------------------------------------------------
    summed = round(sum(r['total_sales'] for r in rows), 2)
    meta = {
        'business_date': business_date,
        'grand_total': grand_total,
        'summed_total': summed,
        'balances': grand_total is not None and abs(summed - grand_total) < CENT,
        'shortfall': None if grand_total is None else round(grand_total - summed, 2),
        'line_count': len(rows),
        'total_qty': sum(r['qty'] for r in rows),
    }
    return rows, failures, meta


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)

    rows, failures, meta = parse(sys.argv[1])

    print(f"business date : {meta['business_date']}")
    print(f"lines parsed  : {meta['line_count']}")
    print(f"total qty     : {meta['total_qty']}")
    print(f"summed sales  : {meta['summed_total']:,.2f}")
    if meta['grand_total'] is not None:
        print(f"grand total   : {meta['grand_total']:,.2f}")
        print(f"balances      : {'YES' if meta['balances'] else 'NO'}")
        if not meta['balances']:
            print(f"shortfall     : {meta['shortfall']:,.2f}  <- a line is missing or misread")

    if failures:
        print(f"\n{len(failures)} line(s) need a human — do not write these:")
        for f in failures:
            print(f"  {f['item_id']}: {f['reason']}")
            print(f"    {f['raw'][:100]}")

    # Products absent from the report sold zero. The caller must write those
    # as qty 0 for every active product, or they drop out of reconciliation
    # entirely — on 09/09 that would have been 24 of 54 products.


if __name__ == '__main__':
    main()
