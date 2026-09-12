# Petron Task System — Project Notes

## Project Overview
A petrol station management system for Petron Safari and Nilai Desa Jati branches.
Hosted on GitHub Pages: https://ashrosa7626.github.io/petron-task/

## Tech Stack
- Plain HTML/CSS/JS (no React, no build tools)
- Supabase for database and auth
- GitHub Pages for hosting
- sidebar.js for shared navigation across all pages

## Pages
- index.html — Home page, staff task overview
- dashboard.html — Supervisor task dashboard
- briefing.html — Shift briefing system (Day/Night)
- lead.html — Team lead login and task assignment
- supervisor.html — Sign-off review page
- sidebar.js — Shared navigation sidebar (included in all pages)

## Supabase
- Project ID: vwffiuciogthfzekkkkz
- URL: https://vwffiuciogthfzekkkkz.supabase.co
- Key is in app.js
- Tables: daily_assignments, completions, users, task_templates, categories, subcategories, subgroups, shift_briefings, shift_staff
- shift_staff table is RLS-blocked for anon key — do NOT rely on it for reads/writes; use shift_briefings instead

## Branch System
- Two branches: Safari and Nilai Desa Jati
- Branch stored in localStorage key: selectedBranch
- All pages have a branch toggle dropdown in the header
- Data must always be filtered by branch

## Header Pattern (all pages)
- Left: Branch toggle (margin-left:52px to avoid sidebar button)
- Centre: [BranchName][PageName] in Syne font, blue branch + white page
- Right: Actions (logout, date, etc.) — briefing.html shows today's date via todayStr()
- Title updates dynamically when branch changes via switchBranch function

## Sidebar
- sidebar.js injected before </body> on all pages
- Shows hamburger menu top-left
- Dark theme matching briefing.html

## Task Assignment Reset
- Tasks do NOT reset automatically — they become invisible when the date changes
- `today()` in app.js determines the active date — rolls over at 7am MYT (not midnight)
- 7am MYT = 11pm UTC previous day. Before 7am MYT, today() returns yesterday's date (night shift sees its tasks)
- Formula: add UTC+8 offset, if hour < 7 subtract one day, format as YYYY-MM-DD
- Lead must log in each day to create new assignments; re-saving deletes and recreates that day's rows

## Shift Briefing System
- Uses Supabase table: shift_briefings (key-value store)
- Briefings: key = `briefing:{timestamp}`, value = full JSON blob (incl. base64 photos)
- Staff list: key = `stafflist:all`, value = `{ staff: [{name, branch}], updated }`
- Staff are per-branch: branch = "Safari" | "Nilai Desa Jati" | "Both"
- switchBranch() re-derives state.staffList from state.allStaff via deriveStaffList() — no reload needed
- Briefings filtered by branch (b.branch field)
- Carried issues: unresolved issues auto-appear in next briefing (scans latest 60 briefings)
- 9-step flow: Attendance, Welcome, Checklist, Adhoc, Issues, Feedback, Closing, Photos, Review
- Checklist sections: 6 core Morning/Night sections only
- Download: PDF via print window (↓ Save = single briefing, ↓ Week / ↓ Month = combined)
- Today's date shown in topbar via todayStr() = new Date() formatted — always current

## Briefing Storage Architecture
- Every save writes to localStorage first (`pb_b_{timestamp}`), then Supabase
- If photos make JSON too large for localStorage, saves without photos and marks `_photosStripped: true`
- dbListAll skips _photosStripped entries from local merge → they are fetched from Supabase (which has full photos)
- Supabase version overwrites localStorage when fetched, restoring photos
- localStorage briefings pruned to 2 weeks via pruneOldLocal() called at init
- Dashboard renders from localStorage instantly (paintDashboard), then Supabase syncs in background
- setDbFilter() repaints from allBriefingsCache — no re-fetch
- Issue Resolved/Not Resolved buttons use data-* attributes + btnSetResolved() handler (avoids inline boolean/large-int onclick bugs)

## Staff List Storage
- Primary: `stafflist:all` key in shift_briefings table → `{ staff: [{name, branch}], updated }`
- Local cache: `pb_staff_all` in localStorage → `[{name, branch}]`
- Migration path on first load: old `stafflist:Safari` / `stafflist:Nilai Desa Jati` → new format, then old pb_staff names-only array
- Last resort: extract unique names from briefing attendance arrays, assign branch from briefing.branch
- state.allStaff = full list; state.staffList = branch-filtered names (derived by deriveStaffList())

## Common Issues & Fixes
- GitHub Pages caches aggressively — use ?v=X or Disable Cache in DevTools
- Never use terminal for JS with !, ?, special chars — write to .py file instead
- After header redesigns, always check for dead element references in JS
- Emojis in JS strings can cause syntax errors — use HTML entities instead
- shift_staff RLS blocks anon key — store staff in shift_briefings under stafflist:all instead
- Photos in briefing history missing? Check _photosStripped flag — dbListAll will re-fetch from Supabase
- Inline boolean/large-int onclick args are unreliable — use data-* attributes + a named handler
- Supabase batch select may silently return empty on some RLS configs — dbListAll uses keys-first approach

## Supervisor Sign-off Page (supervisor.html)
- Shows completions for **Today & Yesterday** (48h UTC window, grouped by MYT operational date)
- `yesterday()` function: same 7am MYT rollover as `today()`, then subtract one more day
- `operationalDate(isoStr)` converts any UTC ISO string to MYT operational date (used to group completions)
- Fetch range: `gte(utcCutoff + 'T00:00:00')` where utcCutoff = 48h ago UTC date — no upper bound needed
- `buildStaffHtml(comps, pfx)` renders staff accordions; `pfx` is date-derived (e.g. `20260519-`) to keep DOM IDs unique across day groups
- `renderCompletions()` splits filtered completions into Today/Yesterday groups, renders each with a day header

## Dashboard (dashboard.html)
- **Tasks of the Day** section (`#taskListRows`) appears above Staff Completion Journey
- `renderTaskList(data)` groups assignments by category, shows task name + assigned staff + done/pending status + signoff badge
- `togDt(cid)` collapses/expands task categories; chevron flips on toggle
- CSS classes: `.dtcat-hdr`, `.dtcat-nm`, `.dtcat-bd`, `.dtrow`, `.dtrow-name`, `.dt-staff`
- `renderTaskList` reuses the same `assignments2` array already fetched — no extra DB query

## Stock Assignment Memory (lead.html)
- Stock item key format: `TOPUP:Stocks:{section}:{item}` (e.g. `TOPUP:Stocks:Gondola:Milo 3in1`)
- Assignment key in `stockItems['__assign__']`: `stock||{section}||{itemIndex}` (e.g. `stock||Gondola||0`)
- Restore loop in `loadAssignView()` must store at item-index level (`key + '||' + idx`) — section-level key never matches Step 2 lookup
- Housekeeping uses template IDs (`taskAssignments[tplId]`) — completely separate code path, works correctly

## Cigarette Stock Count Module
Daily physical count of the cigarette gondola (Safari: 6 shelves A–F × 27 positions,
162 facings, 54 products, **58 blocks**). Spec, workbook and SQL live in
`cigarette stock/` — `BRIEF.md`, `01_schema.sql` … `08_pos_sales_write_policy.sql`,
`CIGARETTES PLANOGRAM.xlsx`, `products_reference.csv`.
Run the SQL in numbered order. Counts are in **packs**; cartons are out of scope.

Pages, all under `stock-count/`:
- `start.html` — page 1: title, trading day, staff name. Creates or resumes the draft.
  Also the hub: buttons to *View past counts* and *Import POS sales*.
- `index.html` — the count grid: pan, pinch/button zoom, overview, one input per block.
- `history.html` — results: every count for the branch, newest first; open one for its
  lines in shelf order plus the reconciliation columns, with CSV and print.
  Linked from `start.html` only, **not** from the count grid — the count is blind, and
  a link to previous quantities sitting next to the inputs defeats that.
- `import-sales.html` — loads the POS Merchandise Sales Report PDF into
  `pos_sales_daily`. Reached from `start.html` and `history.html`.

Excel reporting lives in `excel/` — see the export section below. The published
setup guide is at https://claude.ai/code/artifact/f2489e09-bf24-4782-978b-4ed5cef39172
(republish `excel/guide.html` to that same URL to update it). **`guide.html` was
rewritten for the generated workbook in Sep 2026 but has NOT been republished** —
the live artifact still describes the old Power Query + SUMIFS setup.

### Sign-in and the `?next=` round trip
The app's identity is the PIN session: `sessionStorage.staff_id` / `staff_name`, set by
`index.html` and verified by `pin.html`. Two rules learned the hard way:
- **Never hard-redirect an unsigned visitor to `index.html`.** `pin.html` used to finish
  on `tasks.html` unconditionally, so any page that bounced someone to sign in appeared
  to open My Tasks. Ask in place instead.
- `pin.html` now honours `?next=`, and `index.html` forwards it, so sign-in returns the
  user to the page they wanted. `safeNext()` accepts **same-site relative paths only** —
  anything with a scheme, or starting `//` or `/`, is rejected, so a crafted `next`
  cannot redirect off-site. No `next` behaves exactly as before.
- **One hop still drops it**: `pin.html` opens with
  `if (!staffId) window.location.href = 'index.html'` — no `next`. Anyone landing on
  the PIN screen without having picked a staff member loses where they were going and
  ends on My Tasks after signing in. Sep 2026: `import-sales.html` was reported doing
  exactly this. **That page no longer signs in at all** (see the sales loader below),
  so the report was answered by removing the dependency rather than the bug — the
  dropped `next` in `pin.html` is still there for any other page that needs it.

**`CIGARETTES PLANOGRAM.xlsx` is the source of truth for the layout**, not the seed
and not the database. `Planogram` sheet = the 6×27 grid; `Full Stock List` = product
id, PLU and positions. When they disagree, the workbook wins and the database gets a
migration.

Three rules that must never be broken:

- **Counts key on `product_id` (the POS Item ID), never on shelf position.**
  `stock_count_line` PK is `(count_id, product_id)`. Staff enter one number per
  product — all facings of a product counted together — so 54 inputs, not 162.
  Keying on shelf/position would mean re-merchandising the gondola silently
  corrupts every historical count.
- **`plu` is display-only and must never be used as a join key.**
  It is shown to staff so they can verify the pack in hand, nothing more. The POS
  export contains the same PLU with and without a leading zero on several lines,
  so joining on it produces duplicate and missing rows. Join on `product_id`.
- **The planogram layout comes from the database, never from code.**
  Build the count grid from `planogram_facing` rows for the branch's `active`
  `planogram_version`. Blocks are derived at runtime: group facings by product,
  find connected regions (4-way adjacency), one rectangle per region. Never
  hard-code shelves, positions, or block spans. Shelf changes are a data change
  (spreadsheet upload → new `planogram_version`, old one archived, never edited in
  place). If a change to the shelf requires a code change, the design is wrong.

Supporting notes:
- `product_alias` maps spreadsheet grid names → `product_id`; this is how the
  importer resolves a cell. A cell with no alias must stop the import and ask for
  the POS Item ID. **Alias count is not product count** — `RED Winston` is a stale
  label kept alongside `WINSTON RED`, both → `100740`. Counting alias rows is what
  produced the wrong "54 products" figure when the database only had 53.
- **The database drifted from the workbook once already** (Aug 2026): LD 100 Red
  (`107628`) was missing entirely — no product row, no alias, no facings — and its
  two facings `C22`/`C24` had been absorbed into LD Red, making `C21-25` look like
  one contiguous 5-facing block. `02_seed.sql` was correct; the database had been
  hand-edited. `04_sync_to_spreadsheet.sql` restores it. Verify with
  `python3 diff_xlsx_vs_db.py` before trusting either side.
- `count_date` is the **trading day being closed**, not the clock date. A count
  taken just after midnight ending the 26th has `count_date = 26th`; its closing
  becomes the 27th's opening. Never derive it from `now()` — default deliberately
  and let staff correct it. The `title` field ("Cig Count of DD/MM/YYYY") is a
  label only — never parse it for the date.
- One count per branch per trading day (`stock_count_one_per_day`). A duplicate
  tap must resume the existing draft, not error.
- Split products are real, not hypothetical — verified against the workbook:
  LD Red (C21, C23, C25 — 3 blocks), LD 100 Red (C22, C24 — 2 blocks),
  Marlboro Black (B18, C16 — 2 blocks, diagonally offset and never visually
  adjacent). Each piece needs a "1 of 3" marker, sibling highlighting with
  off-screen direction hints, and the progress footer counts products (54), not
  blocks (58).
- **Blind count** — never display the expected or previous quantity anywhere on
  the count screen.
- Drafts write every keystroke to localStorage and sync on submit; submit requires
  all 54 products to have a number, then sets
  `status = 'submitted'` and RLS freezes the count. No delete path for a submitted
  count.
- **Exactly one input per block** (Sep 2026, at Rosa's request). Both the "not on
  shelf" tick and the secondary add-in field were removed from the count screen.
  Consequences, all UI-only — the schema is untouched:
  - nothing on the shelf is entered as **0**, so `not_on_shelf` is always written
    `false`; block state is two-valued, uncounted or counted
  - `add_in` is always written **0** — the count screen no longer collects
    deliveries
  - `counted_or_absent` is satisfied because `packs` is always present
  - loading a line or local draft carrying `not_on_shelf` reads it back as 0
- **Known gap from the above:** `sold_physical = opening + add_in − closing`, and
  `add_in` is now always 0, so on any day stock was added to the shelf the
  reconciliation **understates what was sold** by exactly the delivery quantity,
  and shows it as negative variance. Deliveries must reach `stock_count_line.add_in`
  some other way (a separate loader, or restoring the field) before variance can be
  trusted on delivery days. Raised twice and confirmed as intended — do not
  silently re-add the field.
- **Schema fixes found by building the count screen** (both in `cigarette stock/`):
  `05_fix_submit_policy.sql` — `update_count` declared only `USING (status =
  'draft')`, and Postgres reuses `USING` as `WITH CHECK` when none is given, so a
  count could never leave draft; submit failed with `42501`. Fixed by adding
  `with check (status in ('draft','submitted'))`, which keeps the freeze.
  `07_fix_opening_coalesce.sql` — the view coalesced closing but not opening, so a
  `not_on_shelf` night closed at 0 but opened NULL the next day; now
  `lag(coalesce(f.packs, 0))`. A product's first ever count still opens NULL.
- `vw_daily_reconciliation` computes `sold_physical = opening + add_in − closing`
  and the variance against `pos_sales_daily`. Excel/Power Query reads it directly
  — do not rename its columns.
- **POS sales loader** (`stock-count/import-sales.html` + `stock-count/sales-parse.js`,
  Sep 2026). **The report is a CCITT G4 fax scan with no text layer at all** — pdf.js
  finds zero characters — so it is read by **OCR in the browser** (Tesseract.js 7.0.0,
  pinned, loaded lazily from jsdelivr). The parsing lives in `sales-parse.js` as an ES
  module so the page and the tests share one implementation; the page's script is
  `type="module"` for that reason. The text-layer path is still tried first and feeds
  the *same* parser, so a digital report would not be trusted any more blindly.
  - **Only the quantity is judged** (changed Sep 2026, at Rosa's request). `qty_sold`
    is the only value this system writes — no price ever reaches the database — so
    the money columns are read as **evidence for the quantity and nothing else**:
    `Total Sales ÷ Price`, `Total Cost ÷ Cost` and `Nett Sales ÷ Price` are each the
    quantity as the POS computed it, from digits read independently of it. A line
    whose read quantity lands exactly on one of them (to the cent, on the *money*,
    never on the ratio) is taken. When they agree on a **different** number, the
    quantity is wrong and a human is asked. **A misread price that still proves the
    quantity is not reported at all** — it changes nothing that gets written. This
    took 09/09 from 2 flags to 1 and 10/09 from 1 to 0.
  - The **Grand Total check survives as a warning, not a gate**: summed `Nett Sales`
    against the report's own total is the only thing that can notice a line lost
    *whole* to OCR, because such a line is proved by nothing and flagged by nothing.
    A gap that divides evenly by a price names the missing row (50.80 = 4 × 12.70 on
    09/09). It no longer blocks — a mismatch can equally mean a misread price.
  - **PLU is cross-checked against the Item ID**, and still never joined on. They are
    two labels for the same pack printed side by side; disagreement means one was
    misread. Advisory only. Two cautions make it usable: the report's category code
    runs onto the front of the barcode (`0201231233` for `01231233`), so the last
    digit run before the Item ID is taken and a match is allowed when either value
    ends with the other; and leading zeros are stripped. It found a real one —
    **Mevius Sky Blue `100734` is `490221200804` in `product`, `02_seed.sql` and
    `products_reference.csv`, but both scans read `4902210200804`** (13 digits, a
    plausible EAN-13). The reference data is likely a digit short. Not changed —
    verify against the pack.
  - **Absent means zero.** Only products that sold appear in the report; every other
    active product is written as `qty_sold = 0`. Leaving them out drops them from
    `vw_daily_reconciliation` entirely — on 09/09 that would have been **24 of 54
    products with no variance**. Pinned by `verify_sales_payload.mjs`.
  - **`product_id` is the six digits IMMEDIATELY before the dash — no `\b` anchor.**
    A real line scanned as `8885004830042 4100760 - LD MENTHOL`, a stray digit fused
    to the front of the ID; a `\b`-anchored pattern matched nothing and dropped the
    line in silence. Never the Barcode/PLU column — same leading-zero problem as
    everywhere else.
  - **Render at the scan's native resolution**, read from the pdf.js operator list
    (`paintImageMaskXObject` args carry width/height; no canvas needed), clamped
    180–450, default 300. Resampling a 258dpi scan up to 300 blurs it and cost two
    extra misread lines on the 09/09 report.
  - The report prints **sideways**, so page 1 is read at full resolution turned 90°
    and only if that does not come back looking like the report are the other three
    orientations tried. **There is no low-resolution orientation probe** — there was,
    and it was a trap: at 130dpi the scan is too soft for Tesseract to find the words
    it is being asked about, so the probe failed on the 09/09 report it should have
    recognised and then ground through all four orientations at a full page each.
    The question is already answered by the page-1 read that has to happen anyway.
  - **Comma or period as the decimal separator** — `17,90` for `17.90`, about one
    line in six.
  - **A dropped decimal point is put back.** `18.40` scans as `1840`, shifting the
    money block a column over so it can corroborate nothing. A bare 3–5 digit integer
    in a money column is re-read with the point restored — but this is plumbing, not
    a finding: the reading is only taken if the quantity it implies is then proved,
    and it is **not reported**, because no price is written. (It used to be listed as
    a "repair"; that card is gone.)
  - **A flagged line gets a suggestion, never a decision**, offered beside **a crop
    of the actual scan line** taken while the page canvas is still in memory.
  - Business date comes from the **report header**, never today's date or the filename.
    **`Printed on` is excluded explicitly** — it is the first date on the page and the
    wrong one (the day the paper came out, usually the day after). `09/09/2026` is
    genuinely ambiguous day/month, so it is flagged for confirmation. No date found →
    the user must set it; it never defaults. **`Business Date From X To Y` with X ≠ Y
    is refused** — a multi-day report cannot be filed against one `sale_date`.
  - **The wrong report is named, not shrugged at.** `identifyReport()` recognises
    Inventory Balance and friends, which also carry six-digit Item IDs.
  - Unknown Item IDs are listed individually and **never written** — the FK to
    `product` is the database backstop. `103735 PETER STUYVESANT REMIX PURPLE YELLOW`
    sells but is not on the planogram; that is information, not noise. They **do**
    count towards the Grand Total check, because the POS counted them.
  - A missing or draft count for that date **warns but does not block** — sales can
    legitimately arrive before the count.
  - **No sign-in.** The page used to require the PIN session before writing; that gate
    is gone (Sep 2026). A required **name text box above the drop zone** replaces it,
    remembered in `localStorage.pos_import_staff`. It is **not authentication** and
    must not be read as any — a margin note saying who was at the keyboard.
  - `09_pos_sales_imported_by.sql` adds `imported_by text`. It is **optional**: the
    page probes for the column once at load (`select imported_by limit 1`) and leaves
    the field out if it is missing, because sending a column that is not there fails
    the whole upsert. Until it is run, the name gates the button but is not stored.
  - **What blocks a write**: unconfirmed quantities, an unset date, a multi-day report,
    an empty name. *Not* a price mismatch, *not* a PLU mismatch, *not* the Grand Total.
  - `08_pos_sales_write_policy.sql` grants anon insert+update on `pos_sales_daily`
    only, gated `qty_sold >= 0`, with **no delete policy** — a day is corrected by
    re-uploading, which upserts on `(branch_id, sale_date, product_id)`.
  - Tests: `verify_ocr_parse.mjs` runs the shipped parser over
    `cigarette stock/fixtures/sales_ocr_2026*.json`, the **real Tesseract output** for
    the 09/09 and 10/09 scans with every mistake left in. Offline, no PDFs needed.
    `verify_sales_parse.mjs` was deleted — it tested the Qty-column picker, which the
    arithmetic proof replaced.
- **Excel reporting is a generated workbook** (`excel/`, rebuilt Sep 2026). It was
  one flat table of every day stacked together, which is unreadable past a week.
  `build_workbook.py` pulls `vw_daily_reconciliation` and writes
  `Cigarette Reconciliation.xlsx`: **Daily** (one trading day from a dropdown,
  summary block, sorted by *absolute* variance desc, prints on one page),
  **Trends** (variance by product × date, sorted by days-off before size, so a
  leak outranks an event), **Notes**, and a **hidden Data** sheet holding the raw
  view. Only Data holds values; Daily reads it by formula, so the date selector
  refilters one table rather than needing a sheet per day.
  - **Refresh = re-run the script.** This is push, not pull — the deliberate
    reversal of the old design, because the structure could not be delivered any
    other way (see the next bullet). The file is rebuilt from scratch each run,
    so **never hand-edit it**; changes belong in the script.
  - **Not a PivotTable, though one was asked for.** AppleScript cannot create a
    pivot cache in Excel 16.89 (`-50 Parameter error` on every variant of
    `make new pivot cache`), and the `slicer` class in Excel's sdef is declared
    with no properties, so a slicer cannot be scripted at all. Hand-authoring
    pivot + slicer OOXML risks Excel's repair prompt, and a pivot cache is a
    snapshot anyway — with no Power Query it would buy nothing over formulas that
    recalculate instantly. Daily uses `INDEX`/`MATCH` off a data-validation date
    cell instead: same one-table-one-format behaviour, verifiable, and no
    `_xlfn.` dynamic-array landmines.
  - **Keys are date SERIALS, not formatted strings.** `TEXT(d,"yyyy-mm-dd")` uses
    localised tokens, so a string key silently stops matching on non-English
    Excel. Concatenating a date coerces to its serial everywhere. Learned by
    watching the sheet blank out the moment a date was typed rather than picked.
  - **`INDEX` into an empty cell returns 0, not blank.** Every lookup goes through
    a blank test, because otherwise an unknown total renders as a confident
    "0 packs of variance" on exactly the day nothing could be checked. Unknown
    shows an em dash; totals skip those rows.
  - `Added` is dropped everywhere a person looks (`add_in` is always 0); it stays
    on the hidden raw sheet. `branch_id`/`pos_description` dropped;
    `product_id`/`plu` moved to the far right.
  - `verify_workbook.py` feeds the builder synthetic days with variance in them,
    because **the live database still has none** — every day has either no
    opening or no POS — so ranking, totals and colouring would otherwise ship
    unexercised. 38 checks.
- **The Power Query path still exists** and is now the subordinate alternative:
  it hits the Supabase REST endpoint with the anon key and refreshes on open /
  every 60 min, giving live data but the flat table with none of the structure.
  `counts_query.m` (name the query `Counts`) and `products_query.m` (`Products`).
  Kept because it is the only no-Python route. Points to note when editing the M:
  - it **pages** — PostgREST caps responses at 1000 rows, which 54 products/day
    reaches in under three weeks
  - `BaseUrl` must stay constant with `RelativePath`/`Query` doing the work, or
    `Web.Contents` cannot resolve stored credentials and refresh breaks
  - `plu` and `product_id` are typed `text`; numeric typing eats leading zeros
  - `Table.TransformColumnTypes` pins culture `"en-US"` so ISO dates parse on a
    dd/MM locale
  - the empty-result branch builds the table from `ColumnList`, so formulas
    survive the period before the first submission
  - POS reconciliation is **no longer done in the sheet** — the loader exists, so
    `variance_packs` arrives computed. The old `POS` sheet and its `SUMIFS` columns
    should be deleted from any workbook still carrying them; two sources for the
    same number will disagree the first time one is not updated by hand
- Open items: `short_name` values are drafts; only Safari is seeded — Nilai Desa Jati
  needs its own planogram version. The `short_name` cases that actually bite are the
  three that land in a **single-facing (76px) block**: `E12` Rothmans Kool Hokkaido
  Mint (27 chars), `E16` Chesterfield Charcoal, `E27` Mevius Menthol White. Wide
  blocks absorb long names; these clamp to two lines.

Tooling in `cigarette stock/` (all read-only against Supabase — the anon key cannot
write, so migrations are run by hand in the Supabase SQL editor):
- `read_xlsx.py` — minimal xlsx reader (zipfile + ElementTree); openpyxl is not
  installed. Note the `Positions` column is **one cell** holding `A1-5 | B1-5`, so
  split on the pipe rather than expecting separate columns.
- `diff_xlsx_vs_db.py` — diffs the workbook against live Supabase, cross-checks the
  grid against the `Positions` column, regenerates `04_sync_to_spreadsheet.sql` and
  writes `expected_facings.json`.
- `verify_blocks.mjs` / `verify_expected.mjs` — import `deriveBlocks` **straight out
  of `stock-count/index.html`** so the tests exercise shipped code, then assert
  facings reconcile, no block overlaps another, every drawn cell matches its facing
  row, and every split block carries a correct "n of m" marker.

## Recent Fixes (Apr–May 2026)
- **lead.html**: dead `leadBranchLabel` reference caused tasks stuck on "Loading..."
- **lead.html**: stock assignment restore used section-level key; fixed to item-index key (`stock||Gondola||0`) matching Step 2
- **briefing.html dashboard**: instant load from localStorage, Supabase syncs in background
- **briefing.html storage**: localStorage-first with Supabase fallback; _photosStripped flag ensures photos are recovered
- **briefing.html staff**: per-branch staff list with branch selector on add and per-row branch editing
- **briefing.html issues**: Resolved/Not Resolved use data-* + btnSetResolved() handler
- **app.js today()**: rolls over at 7am MYT (UTC+8, hour < 7 → use previous date)
- **supervisor.html**: two-day sign-off with operationalDate() grouping; unique accordion IDs via date prefix
- **dashboard.html**: Tasks of the Day flat list above staff completion journey; font sizes bumped across all pages
- **style.css**: base font bumped 16px → 17px; small labels bumped proportionally in briefing.html and dashboard.html

## Cigarette Module — State as of 11 Sep 2026
Verified against the live database, not from memory. Re-check before trusting.

**Migrations applied:** 01–08 are in. `pos_sales_daily` holds 54 rows, so `08`'s
write policy is live and an import has succeeded. **`09` and `10` are written but
NOT run** — verified 12 Sep 2026: `product` has no `unit_price` and the view has no
`opening_date`, so the workbook shows those as unavailable. Both are optional and
everything degrades gracefully without them.

**Data in the system:**

Re-verified 12 Sep 2026 against the live view:

| count_date | status | staff | opening | sold_physical | sold_pos | variance |
|---|---|---|---|---|---|---|
| 2026-08-26 | draft | — | — | — | — | — |
| 2026-09-09 | submitted | Luqman | 0/54 | 0/54 | **54/54** | 0/54 |
| 2026-09-10 | submitted | Luqman | **54/54** | **54/54** | 0/54 | 0/54 |
| 2026-09-11 | submitted | Aktar | **54/54** | **54/54** | 0/54 | 0/54 |

**Variance is still 0 rows everywhere, and this is the thing to understand.** Each half
works; they have never overlapped on the same day. `variance_packs` needs *both* a
previous submitted count (for `opening_packs`) *and* a `pos_sales_daily` row for that
same day. 09/09 has POS but is the first count so has no opening; 10/09 and 11/09 have
openings but no POS yet. **Importing the 10/09 or 11/09 sales report completes the
chain** and is still the single next action that proves the pipeline end to end — it is
also what makes the Excel workbook show anything but em dashes.

**Two known distortions in the current numbers**, both expected, neither a bug:
- 09/09 was a **test count** — one product at 7 packs, the other 53 at 0. So 10/09's
  openings are nearly all 0 and its `sold_physical` comes out negative.
- `add_in` is always 0 (the count screen has one input), so any day stock went onto the
  shelf reads as negative variance. See the known-gap note in the module section.

**The real PDFs have now been read.** `~/Downloads/20260910155519.pdf` is the 09/09
report and `~/Downloads/20260910161828.pdf` is 10/09 — both CCITT G4 scans, no text
layer. Read end to end in a real browser through the shipped page: 09/09 gives 31
lines balancing to RM2,435.80 (144 packs clean + 8 across 2 flagged lines = the 152
counted off the paper); 10/09 gives 27 lines balancing to RM1,376.70. Captured as
`cigarette stock/fixtures/sales_ocr_2026*.json` so the tests keep running without them.
`~/Downloads/20260826112033.pdf` is an **Inventory Balance** report, not a sales report
— it is the fixture case for uploading the wrong one.

**Not done:**
- **The 10/09 sales report has still not been written to the database** — the import
  was verified up to the point of writing and deliberately stopped there. Loading it
  is what completes the variance chain, and it is the single next action.
- No `pos_sales_daily` loader for Nilai Desa Jati; only Safari has a planogram.
- `short_name` values are still drafts.
- OCR accuracy is measured on two reports only: 1–2 lines a report need a human, and
  2 more are repaired automatically. Worth re-checking that rate after a few weeks of
  real use — if it climbs, the print quality or the scanner setting has moved.

## Deployment
- git add . → git commit -m "message" → git push
- GitHub Actions auto-deploys to GitHub Pages
- Check deployment at: https://github.com/ashrosa7626/petron-task/actions
