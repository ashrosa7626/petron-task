# POS sales PDF parser — reference implementation

Verified against the 09/09/2026 Merchandise Sales Report:
**31 lines, 152 packs, RM2,435.80**, balancing to the report's own Grand Total.

The POS can only print. Both sample PDFs are scans with no text layer
(`pdfplumber` reports 0 characters, images only), so OCR is the only route.

## Run it

```
apt-get install -y tesseract-ocr poppler-utils
pip install pillow pytesseract
python parse_sales_pdf.py report.pdf
```

## The five things that cost a debugging cycle each

1. **Rotate −90° before OCR.** The report prints sideways. Unrotated,
   Tesseract reads columns as rows and the output is unusable.
   300dpi greyscale, `--psm 6`.

2. **Never anchor the item ID on a word boundary.** A real line came out as
   `8885004830042 4100760 - LD MENTHOL` — a stray mark fused to the front of
   the ID. A `\b`-anchored pattern matched nothing and dropped the line in
   silence. Take the six digits immediately before the dash, then validate
   the ID against the `product` table.

3. **Accept `,` or `.` as the decimal separator.** OCR returns `17,90` for
   `17.90` on roughly one line in six.

4. **Per line: `Qty × Price` must equal `Total Sales`.** This is what makes
   OCR acceptable for data feeding a financial reconciliation — a misread
   digit breaks the equation instead of passing quietly. Never write a line
   that fails.

5. **Across the file: summed Total Sales must equal the Grand Total.**
   A line lost entirely to OCR passes every per-line test, because it is not
   there to be tested. Only the file-level total catches it. In testing the
   sum came up short by exactly 50.80 — which is 4 × 12.70, naming the
   missing LD Menthol line outright. **If this does not balance, block the
   save** and report the shortfall; a gap that divides evenly by some
   product's price points straight at the missing row.

## What the caller still has to do

- **Write absent products as qty 0.** Only products that sold appear in the
  report. On 09/09 that left 24 of 54 products unmentioned — leave them out
  and they drop out of reconciliation entirely.
- **Take the date from the report header**, not from today or the filename.
- **Upsert** on `(branch_id, sale_date, product_id)` so re-uploading a day
  overwrites cleanly.
- **Show unknown item IDs rather than swallowing them.** On 09/09,
  `103735 - PETER STUYVESANT REMIX PURPLE YELLOW` sold one pack and is not on
  the planogram. That is information, not noise.
- **Put failures in a correction list** with the scan visible, so a human
  types the right quantity rather than the system guessing.

## Where it ended up: the browser

Shipped in `stock-count/import-sales.html`, with the parsing and both
validations in `stock-count/sales-parse.js` so the page and the tests share one
implementation. **Tesseract.js, client-side.** The reasoning, since the
alternative was reasonable:

- **There is no server in this system to put it on.** The whole app is static
  files on GitHub Pages with Supabase behind it. Server-side OCR means a host, a
  deploy path and a place to keep secrets — a new thing to maintain and to be
  woken up by, for one upload a day.
- **The scan never leaves the machine.** No sales document crosses a network it
  did not already have to cross.
- **The cost lands where it can be afforded.** One desk task, once a day: about
  25–30 seconds a page on a laptop, plus a 15 MB one-off download of the
  recogniser that the browser then caches. A phone would be slow, and the
  import is not a phone job.
- **The validations make the weaker environment safe.** Whatever OCR gets
  wrong has to survive `Qty × Price = Total Sales` and the Grand Total before it
  can be written, and that is true wherever the recogniser runs.

Revisit if reports ever get long — the 15-page Inventory Balance would be minutes,
not seconds — or if the import has to happen on a phone.

### Then narrowed: only the quantity is judged

`qty_sold` is the only value this system writes. No price ever reaches the
database. So the per-line check stopped being *"does the money add up"* and
became *"is the quantity proved"*:

`Total Sales ÷ Price`, `Total Cost ÷ Cost` and `Nett Sales ÷ Price` are each the
quantity as the POS computed it, from digits read independently of the quantity
itself. Land on the number OCR read and the line is taken. Agree on a **different**
number and a human is asked. **A misread price that still proves the quantity is
not reported**, because it changes nothing that gets written.

On the real scans that is the difference between 2 flags and 1 on 09/09, and
between 1 and none on 10/09 — the lines it stopped raising were all of the form
"price scanned 17.80 instead of 17.90, quantity fine".

The Grand Total comparison stayed, demoted to a **warning**. It is the only thing
that can notice a line lost *whole*, since such a line is proved by nothing and
flagged by nothing. It no longer blocks, because a mismatch can equally mean a
misread price.

PLU is now **cross-checked** against the Item ID — still never joined on. They are
two labels for the same pack, so disagreement means one was misread. Advisory.
It immediately found one worth knowing about: Mevius Sky Blue is
`490221200804` in the database, the seed *and* `products_reference.csv`, but both
scans read `4902210200804` — 13 digits, a plausible EAN-13. The reference data
looks a digit short. Left alone; check it against the pack.

### What changed on the way across

- **Render at the scan's own resolution, not at 300dpi.** The PDFs are ~258dpi
  scans; resampling them up to 300 blurs every stroke. On the 09/09 report that
  cost two extra misread lines. The native figure is read out of the pdf.js
  operator list, needs no canvas, and falls back to 300 if it cannot be found.
- **The decimal point OCR drops is put back.** `18.40` scans as `1840` on a few
  lines in every report, which shifts the whole money block one column over so it
  can corroborate nothing. A bare 3–5 digit integer in a money column is re-read
  with the point restored — plumbing, not a finding, and not reported, because the
  reading is only taken when the quantity it implies is proved.
- **A flagged line gets a suggestion, not a decision**, with the crop of the scan
  beside it, and a human still has to accept it.
- **No sign-in.** Reading a printed report does not need an account, and the PIN
  flow was dropping people on My Tasks: `pin.html` opens with
  `if (!staffId) location.href = 'index.html'`, losing the `?next=` that would have
  brought them back. A required name box replaces it — a note saying who was at the
  keyboard, not authentication. `09_pos_sales_imported_by.sql` stores it; the page
  probes for the column and works without it.
- **No low-resolution orientation probe.** There was one, and it cost minutes: at
  130dpi the scan is too soft for Tesseract to find the words the probe asks about,
  so it failed on a report it should have recognised and then tried all four
  orientations at a full page each. Page 1 is read turned 90° at full resolution,
  and only a page that comes back not looking like the report tries the others.
- **The Qty-column picker is gone.** It existed to let someone correct a guess
  about which printed column held the quantity. The arithmetic proves it now.
- **"Printed on" is excluded explicitly.** It is the first date in the header
  and it is the wrong one — the day the paper came out, usually the day after
  the one being reported.
- **A multi-day report is refused.** `Business Date From X To Y` with X ≠ Y
  cannot be filed against one `sale_date` without adding the days together.

### Tests

`verify_ocr_parse.mjs` runs the shipped parser over `fixtures/sales_ocr_*.json`
— the real Tesseract output for the 09/09 and 10/09 scans, every mistake left
in. It pins the numbers established from the paper (31 lines, 152 packs,
RM2,435.80), each quirk above, and the dropped-line case: delete LD Menthol from
the fixture and the only thing that notices is the Grand Total, short by exactly
50.80.

```
node verify_ocr_parse.mjs        # offline, no PDFs needed
node verify_sales_payload.mjs    # needs the network and the known-good SQL
```
