-- ============================================================
-- 07 — opening_packs must coalesce a not-on-shelf night to zero
--
-- Run AFTER 01/02/03/04/05, in the Supabase SQL editor.
--
-- vw_daily_reconciliation coalesced the CLOSING figure but not the
-- OPENING one:
--
--   lag(f.packs) over w        as opening_packs      -- null if absent
--   coalesce(f.packs, 0)       as closing_packs      -- zero if absent
--
-- not_on_shelf stores packs = null, so a product that was genuinely out
-- of stock closed at 0 but opened the next day at NULL. Every arithmetic
-- column derived from it went null, and the row silently dropped out of
-- reconciliation on the day the product came back — exactly the day the
-- variance matters most.
--
-- not_on_shelf means genuinely out of stock: closing is zero, so opening
-- the next day is zero too. This makes opening consistent with closing.
--
-- Only the three lag() expressions change. Column names, order and types
-- are untouched, so Power Query against this view keeps working.
-- ============================================================

begin;

create or replace view vw_daily_reconciliation as
  select
    f.branch_id,
    f.count_date,
    f.shift,
    f.staff_name,
    p.product_id,
    p.plu,
    p.short_name,
    p.pos_description,
    lag(coalesce(f.packs, 0)) over w              as opening_packs,
    f.add_in,
    coalesce(f.packs, 0)                          as closing_packs,
    (lag(coalesce(f.packs, 0)) over w) + f.add_in
      - coalesce(f.packs, 0)                      as sold_physical,
    s.qty_sold                                    as sold_pos,
    ((lag(coalesce(f.packs, 0)) over w) + f.add_in
      - coalesce(f.packs, 0)) - s.qty_sold        as variance_packs
  from vw_count_submitted f
  join product p on p.product_id = f.product_id
  left join pos_sales_daily s
    on s.branch_id = f.branch_id
   and s.sale_date = f.count_date
   and s.product_id = f.product_id
  window w as (partition by f.branch_id, f.product_id order by f.count_date);

comment on view vw_daily_reconciliation is
  'Sold (physical) = opening + add_in - closing, opening being the previous '
  'submitted count''s closing for the same product. A not_on_shelf line stores '
  'packs = null and is read as zero on BOTH sides, so a product that was out of '
  'stock opens the next day at zero rather than null. opening_packs is still '
  'null on a product''s first ever count, where there is genuinely no opening.';

-- ------------------------------------------------------------
-- Cleanup: a probe count used to prove RLS is enforced on
-- stock_count_line and that 05 fixed the submit transition. It is
-- submitted, so there is deliberately no anon delete path for it, and
-- it would otherwise sit in vw_daily_reconciliation as a 2019 row.
-- ------------------------------------------------------------
delete from stock_count where title like 'RLS PROBE%';

commit;

-- The first count of a product still has no opening, and should not:
--   lag() returns null because there is no previous row, not because the
--   previous row was absent. Only a null *packs* on an existing previous
--   row is now read as zero.
--
-- Verify by re-running 06_verify_reconciliation.sql. Peter Stuyvesant Red
-- goes from sold_physical NULL to 10 on 2020-01-02.
