-- ============================================================
-- 06 — verify vw_daily_reconciliation over two consecutive days
--
-- Run in the Supabase SQL editor. NON-DESTRUCTIVE: the whole script
-- runs inside a transaction that ends in ROLLBACK, so the test counts
-- never persist. Read the three result sets, then let it roll back.
--
-- Sold (physical) = opening + add_in - closing,
-- where opening is the previous submitted count's closing.
-- ============================================================

begin;

-- Dates far in the past so they cannot collide with a real count.
insert into stock_count (branch_id, version_id, count_date, title, staff_name, status, submitted_at)
values
  ('SAFARI', 1, date '2020-01-01', 'TEST day 1', 'verify', 'submitted', now()),
  ('SAFARI', 1, date '2020-01-02', 'TEST day 2', 'verify', 'submitted', now());

-- Three products, each exercising a different path.
--   103732 Dunhill Classic — the ordinary case
--   104922 Dunhill Red     — a delivery day, add_in > 0
--   100128 P. Stuyvesant   — marked not on shelf on day 1
-- Written as a plain VALUES list rather than a CTE joined to an aliased
-- VALUES relation: same rows, but nothing here resembles defining a new
-- relation, which is what makes a pattern-based linter cry "table without RLS".
insert into stock_count_line (count_id, product_id, packs, add_in, not_on_shelf)
values
  ((select count_id from stock_count
     where branch_id = 'SAFARI' and count_date = date '2020-01-01'), '103732', 100,  0, false),
  ((select count_id from stock_count
     where branch_id = 'SAFARI' and count_date = date '2020-01-01'), '104922',  60,  0, false),
  ((select count_id from stock_count
     where branch_id = 'SAFARI' and count_date = date '2020-01-01'), '100128', null, 0, true ),
  ((select count_id from stock_count
     where branch_id = 'SAFARI' and count_date = date '2020-01-02'), '103732',  72,  0, false),
  ((select count_id from stock_count
     where branch_id = 'SAFARI' and count_date = date '2020-01-02'), '104922',  85, 50, false),
  ((select count_id from stock_count
     where branch_id = 'SAFARI' and count_date = date '2020-01-02'), '100128',  30, 40, false);
--  day 2 arithmetic: Dunhill Classic 100 +  0 -  72 = 28
--                    Dunhill Red      60 + 50 -  85 = 25
--                    P. Stuyvesant     0 + 40 -  30 = 10  (opened out of stock)

-- What the POS says it sold on day 2.
insert into pos_sales_daily (branch_id, sale_date, product_id, qty_sold) values
  ('SAFARI', date '2020-01-02', '103732', 28),   -- agrees   -> variance 0
  ('SAFARI', date '2020-01-02', '104922', 22),   -- 3 short  -> variance 3
  ('SAFARI', date '2020-01-02', '100128', 10)    -- agrees   -> variance 0
on conflict (branch_id, sale_date, product_id) do update set qty_sold = excluded.qty_sold;

-- ---------- 1. the two days as the view reports them ----------
select count_date, short_name,
       opening_packs, add_in, closing_packs,
       sold_physical, sold_pos, variance_packs
  from vw_daily_reconciliation
 where branch_id = 'SAFARI'
   and count_date in (date '2020-01-01', date '2020-01-02')
 order by count_date, short_name;

-- Expected (with 07_fix_opening_coalesce.sql applied):
--   2020-01-01  every row: opening null (no prior count) -> sold_physical null
--   2020-01-02  Dunhill Classic  opening 100, add_in  0, closing 72
--                                sold_physical 28, sold_pos 28, variance  0
--   2020-01-02  Dunhill Red      opening  60, add_in 50, closing 85
--                                sold_physical 25, sold_pos 22, variance  3
--   2020-01-02  Peter Stuyvesant Red  opening 0 (day 1 was out of stock),
--                                add_in 40, closing 30
--                                sold_physical 10, sold_pos 10, variance  0
--
-- Before 07 the last row read opening NULL -> sold_physical NULL, and fell
-- out of reconciliation on the very day the product came back.

-- ---------- 2. the not-on-shelf edge case, isolated ----------
-- not_on_shelf stores packs = null and means genuinely out of stock, so it
-- must read as zero on BOTH sides: closing 0 on the night it is absent, and
-- opening 0 the next morning. 07 makes opening consistent with closing.
-- Day 1 here should show closing 0; day 2 should show opening 0, not null.
select count_date, short_name, closing_packs, opening_packs, sold_physical
  from vw_daily_reconciliation
 where branch_id = 'SAFARI' and product_id = '100128'
   and count_date in (date '2020-01-01', date '2020-01-02')
 order by count_date;

-- ---------- 3. column names Power Query depends on ----------
select column_name, data_type
  from information_schema.columns
 where table_name = 'vw_daily_reconciliation'
 order by ordinal_position;

rollback;   -- nothing above is kept
