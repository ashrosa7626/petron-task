# Cigarette reconciliation — the Excel workbook

`Cigarette Reconciliation.xlsx` **refreshes itself.** Open it, or press
**Data → Refresh All**, and it pulls straight from the database. No script to run.

That needs a one-time setup of about fifteen minutes — the **Setup sheet inside the
workbook** walks through it, and `counts_query.m` is the query to paste. Until it is
done, Daily says "No data yet" and nothing else works. After it is done the Setup sheet
can be ignored.

## What's in it

| sheet | |
|---|---|
| **Daily** | One trading day, chosen from a dropdown. Summary block on top, products below, worst variance first. Prints on one page. |
| **Trends** | Variance by product over the last 14 counted days. |
| **Notes** | What the columns mean and what can make them lie. |
| **Setup** | The one-time attach instructions. |
| **Calc** | Hidden. The working-out. |
| **Data** | Hidden. Where the query lands — the raw view, every column. |

Daily and Trends are formulas over `Data`, addressed **by whole column**
(`Data!$N:$N`), so new days and new products appear on refresh with nothing edited.

> Not by structured reference (`Counts[variance_packs]`), which was the obvious choice
> and is wrong. Excel rewrites a reference to a table that does not exist yet into a
> permanent `#REF!` the first time the file is opened, and Power Query cannot be made to
> load into a table the builder created. Whole columns have neither problem.
>
> The cost: **Data's column order is load-bearing.** It must be exactly what
> `counts_query.m` returns. Both ends pin it and `verify_workbook.py` asserts it.

### Daily

Columns are `Opening`, `Added`, `Closing`, `Sold (counted)`, `Sold (POS)`, `Variance`,
`Variance RM`, then `Item ID` and `PLU` pushed out to the far right where they stay
available without being in the way. `branch_id` and `pos_description` are gone.

`Added` was dropped for a while, because `add_in` was always zero and a column of zeros
only implies something has been checked. The
[Restock screen](https://ashrosa7626.github.io/petron-task/stock-count/restock.html)
puts real numbers in it, so it is back — and it has to be, or `Sold (counted)` stops
adding up on the day a delivery went out.

Rows are ordered by **absolute** variance descending, so the problems are at the top
instead of wherever the alphabet put them. Variance is grey at zero and red from one
pack, getting heavier at five and again at ten.

The line at the top right says how many days are loaded and what the latest one is.
**If the day you counted this morning is not the latest, the file has not refreshed.**
That line exists because a stale workbook once passed for a fresh one.

Ctrl+P prints the day on screen on a single page, header row repeated.

### Trends

The last **14 counted days**, sorted by **how many days** each product was off before
how large the gap was. That ordering is the whole point: five nights off by one pack is
a leak worth chasing, one night off by five is an event. The leak sorts above the event.
Anything older than 14 days is still on the Data sheet.

## Rebuilding the structure

The workbook is generated. If the layout needs to change:

```
pip install openpyxl                          # once
python3 build_workbook.py --mode query        # the file to hand over
```

Then re-attach the query (Setup sheet, about two minutes). **Don't hand-edit the
workbook** — a rebuild will not keep the change. Anything that should be different
belongs in the script.

`--mode snapshot` writes a second file with the data baked in and no query needed. It
exists for testing: it uses the *same* formulas, so it is how the real ones get checked.

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

`10_prices_and_opening_date.sql` **has been run** — `Opening from` works, and the two
price columns exist. They are just empty:

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

**A delivery nobody recorded.** The count screen collects one number per product
and does not capture stock put out during the day — that is what the Restock
screen is for, and what `Added` shows. Packs that went onto the shelf without a
restock record make `Sold (counted)` understate what was sold, and the day reads
as negative variance. Check `Added` before believing a large negative.

**Counts must be consecutive.** `Opening` is the previous *submitted* count's
closing, whatever date that was — skip a day and two days of sales fold into
one, which reads as a large variance the day after the gap. That is what
**`Opening from`** in the summary is for: if it is not the day before, treat the
figures with suspicion.

## Tests

```
python3 verify_workbook.py            # structural + ranking rules
python3 verify_workbook.py --excel    # also drives Excel and reads back what the
                                      # FORMULAS computed (macOS only)
```

The live database has no variance in it yet — every day either has no opening or no POS
sales — so the ranking, totals and colouring would otherwise ship having never run. The
tests feed the builder a day set shaped to exercise them.

`--excel` matters more than it sounds. The rule that **an unknown variance is never
treated as a zero** lives in `COUNTIFS` formulas, which look correct whether or not they
are. `--excel` opens the workbook, switches the trading day and reads back Excel's own
answers, so that rule is tested rather than admired.

## `products_query.m`

Still here, unused by this workbook. It pulls the product table and is handy for
looking up a PLU or a description. Delete it if nobody wants it.


## If something looks wrong

- **Everything reads `—`** — no POS sales are loaded for that day, or it is the
  first count. The summary line says which.
- **`Variance RM` all blank** — `product.unit_price` is not set, and no sales report
  has been imported since the price column was added. Either fills it in.
- **The dropdown is missing recent days** — the query has not refreshed. Data →
  Refresh All. If that does nothing, the query was never attached: see the Setup sheet.
- **Everything says "No data yet"** — the query is not attached, or it landed somewhere
  other than `Data!$A$1`.
- **A large variance out of nowhere** — check `Opening from`. A skipped day
  folds two days of sales into one.
- **`#NAME?` anywhere** — shouldn't happen; the sheet deliberately uses only
  `INDEX`, `MATCH` and `IF` so it works in any version of Excel. Report it.
