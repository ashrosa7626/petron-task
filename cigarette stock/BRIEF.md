# Cigarette stock count — build brief

A daily physical stock count for the cigarette gondola at Petron MRR2 Safari,
replacing a paper form. Staff count on a phone; the numbers reconcile against
the POS daily sales figure.

This is a new module inside **PetronTasks** (vanilla HTML/CSS/JS on GitHub
Pages, Supabase for data and auth, PIN login already built). Reuse the existing
styling, PIN session and Supabase client. Do not introduce a framework or a
build step.

## Files in this handoff

| File | What it is |
|---|---|
| `01_schema.sql` | Supabase schema — tables, reconciliation view, RLS policies |
| `02_seed.sql` | 54 products, 54 planogram aliases, 162 facings. Idempotent |
| `03_daily_count.sql` | Switches to one count per day with a staff-written title |
| `products_reference.csv` | The same products in readable form, for checking |
| `CIGARETTES_PLANOGRAM.xlsx` | Source spreadsheet: `Planogram` grid + `Full Stock List` |

Run in order: `01`, `02`, `03`.

## The shape of the problem

The gondola is 6 shelves (A–F) by 27 positions, holding 162 facings of 54
products. A product usually occupies several adjacent facings — Dunhill Classic
covers A1-5 and B1-5, ten facings in one rectangle.

**Staff enter one number per product, not per facing.** They count every facing
of a product together and type the total. 54 inputs, not 162.

Counts are in **packs**. Cartons are out of scope.

## Data model, in short

- `product_id` is the POS Item ID and is the join key everywhere.
- `plu` is display-only. Never join on it — the POS export contains the same
  PLU with and without a leading zero on several lines.
- `stock_count_line` keys on product, never on shelf position, so moving a
  product on the shelf cannot break historical counts.
- `product_alias` maps the names written in the spreadsheet grid to products.
  This is how the importer resolves a cell.

`Sold (physical) = opening + add_in − closing`, where opening is the previous
submitted count's closing. `vw_daily_reconciliation` already computes this and
the variance against `pos_sales_daily`.

## The count happens once a day, at midnight

One count per branch per trading day, taken at the POS day rollover. There is
no shift selector.

**`count_date` is the trading day being closed, not the clock date.** A count
taken just after midnight at the end of the 26th has `count_date = 26th`, and
its closing figures become the opening for the 27th. Getting this backwards
shifts every variance by a day, so default the field deliberately and let staff
correct it rather than deriving it from `now()`.

## What to build

### Page 1 — start a count

Three fields:

- **Title** — free text, pre-filled as `Cig Count of DD/MM/YYYY` from the date,
  editable. This is a label only. Never parse it to get the date.
- **Date** — the trading day being closed. This is the real date field and the
  only one the system trusts.
- **Staff name**.

Creates a `stock_count` row with `status = 'draft'`. If a draft already exists
for this branch and date, resume it rather than creating a second. The database
enforces one count per branch per day, so handle that conflict gracefully — a
staff member who taps twice should land back in their own draft, not an error.

### Page 2 — the count screen

A pannable canvas laid out like the planogram: 27 columns across, 6 shelves
down. Build it from `planogram_facing`, never hard-code the layout.

**Deriving blocks.** Group facings by product, find the connected regions
(4-way adjacency), draw one rectangle per region. All rectangles belonging to
one product share a single input.

This is not a hypothetical case. Three products are split today, and the
planogram is fixed — these cannot be merchandised together, so the interface
has to handle them properly:

| Product | Blocks | Positions |
|---|---|---|
| LD Red | 3 | C21, C23, C25 |
| LD 100 Red | 2 | C22, C24 |
| Marlboro Black | 2 | B18, C16 |

LD Red and LD 100 Red interleave along shelf C, so both render as scattered
one-facing blocks. Marlboro Black is the hard case: its two facings are on
different shelves *and* two columns apart, so they are diagonally offset and
never visually adjacent.

Split products need more than a shared colour, because Marlboro Black's pieces
can be far enough apart to be off-screen from each other. Requirements:

- A count marker on each piece — "1 of 3", "2 of 3" — so a lone block announces
  that it is part of something bigger.
- Focusing any piece highlights all its siblings, and if a sibling is off
  screen, show a directional hint pointing to it.
- The progress footer counts products, not blocks. LD Red is one of 54, not
  three.

Without this, someone counts C21, sees a number in the box, and moves on
leaving two thirds of the LD Red stock uncounted — a variance that looks like
theft.

**Layout.** Fixed column width of about 76px; a block spans its facings, so
widths stay proportional to the real shelf. Column numbers pinned to the top
edge and shelf letters pinned to the left, both staying put while panning in
either direction.

**Inside a block.** `short_name` over two lines, `plu` small beneath it, one
number input. Keep the type size identical in a one-column block and a
five-column block — wide blocks get more whitespace, not bigger text. Several
blocks are only one facing wide, so the one-column case is the layout to design
against, not the exception.

**Colour carries state, not brand:** not yet counted, counted, not on shelf.
Brand goes on a 3px strip along the top edge of the block, enough to orient
someone panning across without competing with the state signal.

**Add-in.** Each block needs a second, secondary field for stock added to the
shelf during the day. It defaults to 0 and should stay out of the way — most
days it is untouched. Without it the arithmetic breaks on every delivery day.

**Navigation.** Pinch out to an overview showing state colour only, no text;
tap a block to zoom to it. A pinned footer shows progress ("41 of 54") and a
"next empty" button that scrolls to the nearest uncounted block. The numeric
keypad should advance to the next empty block, so a whole count can be done
without tapping blocks directly.

**Blind count.** Never show the expected or previous quantity. If the screen
displays what the system expects, that number gets typed back and the exercise
becomes theatre.

**Drafts survive.** Write every keystroke to local storage and sync on submit.
A count takes about ten minutes inside a shop with thick walls; one dropped
connection must not lose it.

**Submit** requires all 54 blocks to have either a number or a "not on shelf"
tick, then sets `status = 'submitted'`. Partial counts are worse than none —
they produce variance nobody can explain. RLS freezes the count at that point.

### Admin — updating the planogram

The spreadsheet is the editor. Upload `CIGARETTES_PLANOGRAM.xlsx`, parse the
`Planogram` sheet, resolve each cell through `product_alias`, and show a diff
(*3 products added, 1 removed, Dunhill Zest moved from B13-15 to B12-15*)
before writing a new `planogram_version` and activating it. A grid cell whose
name has no alias stops the import and asks for the POS Item ID.

Never edit a version in place. Archive the old one so past counts stay
interpretable.

### Excel connection

Reporting reads `vw_daily_reconciliation` through Power Query, via the Supabase
REST endpoint with a read-only key. Nothing to build in the app — just do not
break the view's column names.

## Constraints worth repeating

- No framework, no build step. Drafts depend on local storage.
- Never join on PLU.
- Counts key on product, not position.
- `count_date` is the trading day closed, not the clock date.
- No delete path for a submitted count. Corrections are a separate adjustment
  record, out of scope for this build.
- Everything the staff screen shows comes from the database. If a change to the
  shelf requires a code change, the design is wrong.

## Known open items

These do not block the build, but the data is not final:

1. **`short_name` values in the seed are drafts.** They come from the
   spreadsheet grid, not from Rosa. Nine exceed 18 characters and will not fit
   a narrow block — Rothmans Kool Hokkaido Mint is the worst at 27. Treat them
   as placeholders and make them easy to update.
2. **The POS daily sales export has not been seen yet**, so `pos_sales_daily`
   has no loader. Build the count side first; the import is a separate, small
   piece of work once the file format is known.
3. **Only one branch is seeded.** Nilai Desa Jati has its own layout and needs
   its own planogram version once its grid exists.
