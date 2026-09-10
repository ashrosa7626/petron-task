# Sending cigarette counts to Excel

Excel pulls from Supabase. Nothing pushes. Once set up, every submitted count
appears in the workbook on its own — open the file, or wait for the refresh
interval, and the new day is there. No export step, no file to copy.

The count screen already writes to Supabase on submit. This just points Excel at
the same data.

## What arrives

`vw_daily_reconciliation`, one row per product per **submitted** trading day:

| column | meaning |
|---|---|
| `branch_id`, `count_date`, `staff_name` | which count |
| `product_id` | the POS Item ID — **the only safe join key** |
| `plu`, `short_name`, `pos_description` | for reading, never for joining |
| `opening_packs` | previous submitted count's closing |
| `add_in` | stock added during the day |
| `closing_packs` | what was counted |
| `sold_physical` | `opening + add_in − closing` |
| `sold_pos` | from `pos_sales_daily` |
| `variance_packs` | `sold_physical − sold_pos` |

Drafts never appear. The view reads `vw_count_submitted`, so a count reaches
Excel only once submitted — a half-finished count must not reconcile.

## Setup, once

1. **Data → Get Data → From Other Sources → Blank Query**
2. **Home → Advanced Editor**, delete what's there, paste all of
   [`counts_query.m`](counts_query.m), **Done**
3. Rename the query to **`Counts`** — the sheet formulas below depend on that name
4. **Close & Load**
5. If Excel asks about credentials for `supabase.co`, choose **Anonymous**
6. Repeat 1–4 with [`products_query.m`](products_query.m), named **`Products`**

### Make it automatic

**Data → Queries & Connections →** right-click **Counts → Properties**:

- [x] Refresh data when opening the file
- [x] Refresh every `60` minutes

That is the whole automation. The workbook is now live against the count system.

## Reconciling against the POS

`sold_pos` and `variance_packs` currently come back blank, because
`pos_sales_daily` is empty — the POS daily sales export has never been seen, so
nothing loads it. Until that exists, do the POS side in Excel.

**The intended long-term fix is a loader that writes `pos_sales_daily`.** Then
`variance_packs` arrives already computed and the sheet below becomes redundant.
Worth doing once someone can hand over a sample POS export.

### 1. A `POS` sheet

Three columns, then **Insert → Table**, named **`POS`**:

| sale_date | product_id | qty_sold |
|---|---|---|
| 2026-09-09 | 103732 | 28 |
| 2026-09-09 | 104922 | 22 |

Format `product_id` as **Text before pasting**. This matters: if one side is text
and the other is a number, the lookup silently returns 0 and every product reads
as a perfect variance. Use the `Products` query to map POS descriptions or PLUs
to `product_id`.

### 2. Two columns beside the `Counts` table

Click the first empty cell to the right of the table and add:

**`pos_qty`**

```excel
=SUMIFS(POS[qty_sold], POS[sale_date], [@count_date], POS[product_id], [@product_id])
```

**`variance`**

```excel
=IF([@sold_physical]="", "", [@sold_physical] - [@pos_qty])
```

`SUMIFS` is deliberate — it returns 0 for a product the POS never sold, rather
than `#N/A`, and it tolerates the POS listing a product twice in a day.

Columns added inside the table survive refresh and fill down onto new rows.

## Reading the result

- `variance` **0** — physical and POS agree
- **positive** — more went missing than the POS sold: shrinkage, miscount, or an unrecorded delivery
- **negative** — the POS sold more than the shelf lost: usually a delivery not recorded as `add_in`
- **blank `sold_physical`** — no previous count to open from. Every product shows
  this on its first ever count; it fills in from the second consecutive day.

## Two things that will skew variance right now

**`add_in` is always 0.** The count screen collects one number per product and no
longer captures deliveries. On any day stock went onto the shelf, `sold_physical`
understates what was sold by the delivery quantity and shows as negative
variance. Either record deliveries into `stock_count_line.add_in` another way, or
treat negative variance on delivery days as expected.

**Counts must be consecutive.** `opening_packs` is the previous *submitted*
count's closing, whatever date that was. Skip a day and the gap silently folds
two days of sales into one, which reads as a large variance on the day after the
gap.

## If the refresh fails

- **Credential prompt reappears** — Data → Get Data → Data Source Settings →
  clear permissions for `supabase.co`, refresh, choose Anonymous.
- **Empty table** — normal before the first count is submitted. Check
  [the results page](https://ashrosa7626.github.io/petron-task/stock-count/history.html)
  shows a count marked Submitted.
- **Stops at 1000 rows** — the query pages past that; check the M wasn't
  truncated when pasted.
- **Leading zeros gone from PLU** — a column got typed as a number. PLU is
  display-only and never a join key, so this is cosmetic, but the fix is
  `type text` in the M.
