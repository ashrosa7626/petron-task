# Cigarette reconciliation — the Excel workbook

`Cigarette Reconciliation.xlsx` is generated. To make it, or to refresh it:

```
pip install openpyxl          # once
python3 build_workbook.py
```

It pulls `vw_daily_reconciliation` from Supabase with the public read-only key
and rebuilds the file from scratch. **Don't hand-edit it** — the next run won't
keep the change. Anything that should be different belongs in the script.

## What's in it

| sheet | |
|---|---|
| **Daily** | One trading day, chosen from a dropdown. Summary block on top, products below, worst variance first. Prints on one page. |
| **Trends** | Variance by product across every counted day. |
| **Notes** | What the columns mean and what can make them lie. |
| **Data** | Hidden. The raw view, every column, exactly as it came back. |

Only `Data` holds values. Daily reads it by formula, so changing the date
recalculates in place — one table, one set of formatting, no sheet per day.

### Daily

Columns are `Opening`, `Closing`, `Sold (counted)`, `Sold (POS)`, `Variance`,
`Variance RM`, then `Item ID` and `PLU` pushed out to the far right where they
stay available without being in the way. `branch_id` and `pos_description` are
gone. So is `Added` — `add_in` is always zero, so a column of zeros would only
imply something had been checked. It is still on the hidden sheet.

Rows are ordered by **absolute** variance descending, so the problems are at the
top instead of wherever the alphabet put them. Variance is grey at zero and red
from one pack, getting heavier at five and again at ten.

Ctrl+P prints the day on screen on a single page, header row repeated.

### Trends

Sorted by **how many days** each product was off, before how large the gap was.
That ordering is the whole point: five nights off by one pack is a leak worth
chasing, one night off by five is an event. The leak sorts above the event.

## Zero and unknown are not the same thing

This is the thing to understand about every figure in here.

`Variance` comes from the database view and is **never recalculated in Excel**,
so it cannot drift from what the system believes. That also means it is *blank*
whenever the view cannot work it out, which happens for two different reasons:

- **No POS sales loaded for that day.** Nothing to compare the shelf against.
- **No opening figure.** The first count of a product has nothing to sell down
  from, and a variance needs an opening.

Either way the workbook shows an **em dash, not a zero**, and the summary says
which in plain English. A blank cell in a spreadsheet reads as "nothing wrong";
these days are "not checked", which is a different thing entirely and the one
worth knowing about. Totals skip them rather than treating them as agreement.

To fill them in: import that day's sales report on
[the import page](https://ashrosa7626.github.io/petron-task/stock-count/import-sales.html).

## Variance RM

Needs a price, and prices need `10_prices_and_opening_date.sql` (in
`cigarette stock/`). Until it is run, the RM column and `Opening from` read as
unavailable and everything else works.

After it is run:

- `pos_sales_daily.unit_price` — filled automatically from the next sales report
  imported. The importer already reads the price to prove the quantity, so this
  is the price that actually applied on the day.
- `product.unit_price` — **yours to set.** It is the fallback, and the only
  answer for a product that had variance but sold nothing that day, which is
  exactly the shrinkage case worth pricing.

```sql
update product set unit_price = 18.20 where product_id = '103732';
```

Until `product.unit_price` is set, a product with variance and no sales has no
RM figure, and the workbook leaves it blank rather than showing a confident zero.

## Reading the variance

- **0** — physical and POS agree.
- **positive** — more left the shelf than the till sold: shrinkage, a miscount,
  or stock put out and not recorded.
- **negative** — the till sold more than the shelf lost: usually a delivery.
- **an em dash** — not known. See above.

## Two things that will skew it

**Deliveries are not recorded.** The count screen collects one number per
product and no longer captures stock added during the day, so `add_in` is always
zero. On any day stock went onto the shelf, `Sold (counted)` understates what
was sold and the day reads as negative variance.

**Counts must be consecutive.** `Opening` is the previous *submitted* count's
closing, whatever date that was — skip a day and two days of sales fold into
one, which reads as a large variance the day after the gap. That is what
**`Opening from`** in the summary is for: if it is not the day before, treat the
figures with suspicion.

## Tests

```
python3 verify_workbook.py
```

The live database has no variance in it yet — every day either has no opening or
no POS sales — so the ranking, totals and colouring would otherwise ship having
never run. This feeds the builder a day set shaped to exercise them and asserts
the answers, including that a leak outranks an event and that unknown never
sums as zero.

## The live-refresh alternative

`counts_query.m` and `products_query.m` are Power Query for pulling the same
view straight into Excel. That refreshes on its own, on open and every 60
minutes, with no script to run — but it gives you the flat stacked table with
none of the structure above, which is what this rebuild was replacing.

Kept because it is the only no-Python path. If nobody is using it, it can go.

Points to note if you edit the M:

- it **pages** — PostgREST caps responses at 1000 rows, which 54 products a day
  reaches in under three weeks
- `BaseUrl` must stay constant with `RelativePath`/`Query` doing the work, or
  `Web.Contents` cannot resolve stored credentials and refresh breaks
- `plu` and `product_id` are typed `text`; numeric typing eats leading zeros
- `Table.TransformColumnTypes` pins culture `"en-US"` so ISO dates parse on a
  dd/MM locale
- the empty-result branch builds the table from `ColumnList`, so formulas
  survive the period before the first submission

## If something looks wrong

- **Everything reads `—`** — no POS sales are loaded for that day, or it is the
  first count. The summary line says which.
- **`Variance RM` all blank** — migration 10 has not been run, or
  `product.unit_price` is not set.
- **The dropdown has the wrong days** — the workbook is a snapshot. Re-run
  `build_workbook.py`.
- **A large variance out of nowhere** — check `Opening from`. A skipped day
  folds two days of sales into one.
- **`#NAME?` anywhere** — shouldn't happen; the sheet deliberately uses only
  `INDEX`, `MATCH` and `IF` so it works in any version of Excel. Report it.
