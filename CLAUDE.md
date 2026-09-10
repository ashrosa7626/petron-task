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
`cigarette stock/` — `BRIEF.md`, `01_schema.sql` … `07_fix_opening_coalesce.sql`,
`CIGARETTES PLANOGRAM.xlsx`, `products_reference.csv`.
Run the SQL in numbered order. Counts are in **packs**; cartons are out of scope.

Pages, all under `stock-count/`:
- `start.html` — page 1: title, trading day, staff name. Creates or resumes the draft.
- `index.html` — the count grid: pan, pinch/button zoom, overview, one input per block.
- `history.html` — results: every count for the branch, newest first; open one for its
  lines in shelf order plus the reconciliation columns, with CSV and print.
  Linked from `start.html` only, **not** from the count grid — the count is blind, and
  a link to previous quantities sitting next to the inputs defeats that.

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
- **Excel export is pull, not push** (`excel/`): Power Query hits the Supabase REST
  endpoint with the anon key and refreshes on open / every 60 min, so a submitted
  count reaches the workbook with no export step. `counts_query.m` (name the query
  `Counts`) and `products_query.m` (`Products`); `README.md` has the setup and the
  Excel-side POS reconciliation. Points to note when editing the M:
  - it **pages** — PostgREST caps responses at 1000 rows, which 54 products/day
    reaches in under three weeks
  - `BaseUrl` must stay constant with `RelativePath`/`Query` doing the work, or
    `Web.Contents` cannot resolve stored credentials and refresh breaks
  - `plu` and `product_id` are typed `text`; numeric typing eats leading zeros
  - `Table.TransformColumnTypes` pins culture `"en-US"` so ISO dates parse on a
    dd/MM locale
  - the empty-result branch builds the table from `ColumnList`, so formulas
    survive the period before the first submission
  - POS reconciliation is done in the sheet only because `pos_sales_daily` has no
    loader; once one exists, `variance_packs` arrives computed and the sheet
    columns become redundant
- Open items: `short_name` values are drafts; the POS daily sales export format is
  unseen so `pos_sales_daily` has no loader; only Safari is seeded — Nilai Desa Jati
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

## Deployment
- git add . → git commit -m "message" → git push
- GitHub Actions auto-deploys to GitHub Pages
- Check deployment at: https://github.com/ashrosa7626/petron-task/actions
