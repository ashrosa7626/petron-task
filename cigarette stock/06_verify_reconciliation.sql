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
with d as (
  select count_id, count_date from stock_count
   where branch_id = 'SAFARI' and count_date in (date '2020-01-01', date '2020-01-02')
)
insert into stock_count_line (count_id, product_id, packs, add_in, not_on_shelf)
select d.count_id, v.product_id, v.packs, v.add_in, v.nos
from d
join (values
  (date '2020-01-01', '103732', 100,  0, false),
  (date '2020-01-01', '104922',  60,  0, false),
  (date '2020-01-01', '100128', null, 0, true ),
  (date '2020-01-02', '103732',  72,  0, false),   -- sold 100 +  0 -  72 = 28
  (date '2020-01-02', '104922',  85, 50, false),   -- sold  60 + 50 -  85 = 25
  (date '2020-01-02', '100128',  40, 40, false)    -- opening was NOT ON SHELF
) as v(count_date, product_id, packs, add_in, nos)
  on v.count_date = d.count_date;

-- What the POS says it sold on day 2.
insert into pos_sales_daily (branch_id, sale_date, product_id, qty_sold) values
  ('SAFARI', date '2020-01-02', '103732', 28),   -- agrees   -> variance 0
  ('SAFARI', date '2020-01-02', '104922', 22),   -- 3 short  -> variance 3
  ('SAFARI', date '2020-01-02', '100128', 40)
on conflict (branch_id, sale_date, product_id) do update set qty_sold = excluded.qty_sold;

-- ---------- 1. the two days as the view reports them ----------
select count_date, short_name,
       opening_packs, add_in, closing_packs,
       sold_physical, sold_pos, variance_packs
  from vw_daily_reconciliation
 where branch_id = 'SAFARI'
   and count_date in (date '2020-01-01', date '2020-01-02')
 order by count_date, short_name;

-- Expected:
--   2020-01-01  every row: opening null (no prior count) -> sold_physical null
--   2020-01-02  Dunhill Classic  opening 100, add_in  0, closing 72
--                                sold_physical 28, sold_pos 28, variance  0
--   2020-01-02  Dunhill Red      opening  60, add_in 50, closing 85
--                                sold_physical 25, sold_pos 22, variance  3
--   2020-01-02  Peter Stuyvesant Red  opening NULL because day 1 was
--                                not_on_shelf -> sold_physical NULL  <-- see below

-- ---------- 2. the not-on-shelf edge case, isolated ----------
-- A product marked "not on shelf" stores packs = null. The view takes
-- opening from lag(f.packs), so the NEXT day's arithmetic silently becomes
-- null rather than treating an absent product as zero stock. If that is not
-- wanted, the view needs lag(coalesce(f.packs, 0)).
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
