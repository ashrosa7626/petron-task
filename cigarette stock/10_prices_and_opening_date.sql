-- ============================================================
-- 10 — unit prices (for Variance RM) and the opening date
--
-- Run AFTER 09, in the Supabase SQL editor.
--
-- Two things the Excel workbook asked for that the schema could not answer:
-- what a pack is worth, and which day the opening figure came from.
--
-- ------------------------------------------------------------
-- WHY TWO PRICE COLUMNS, NOT ONE
-- ------------------------------------------------------------
-- The obvious move is a single product.unit_price. It is not enough on its
-- own, because variance is per DAY and cigarette prices move — a duty change
-- revalues the whole gondola overnight. Valuing August's variance at today's
-- price would quietly restate history every time a price is updated.
--
-- So the price is stored where it is actually observed:
--
--   pos_sales_daily.unit_price   what the pack sold for ON THAT DAY. The sales
--                                report prints it, and the importer already
--                                reads it (it uses price to prove the quantity),
--                                so this costs nothing to collect and is exact.
--
--   product.unit_price           the current list price. The fallback, and the
--                                only answer available for a product that had
--                                variance but sold nothing that day — which is
--                                precisely the shrinkage case worth pricing.
--
-- variance_rm uses the daily price when there is one and the list price
-- otherwise, so a day with sales is valued exactly and a day without is valued
-- approximately rather than not at all. unit_price_used is exposed alongside so
-- the workbook can show WHICH price was applied instead of implying precision
-- it does not have.
--
-- Both are nullable on purpose. Until product.unit_price is filled in, a
-- product that did not sell simply has no RM figure, and the workbook says so
-- rather than showing a confident zero.
--
-- ------------------------------------------------------------
-- OPENING DATE
-- ------------------------------------------------------------
-- opening_packs is the previous SUBMITTED count's closing, whatever date that
-- was — skip a day and it silently folds two days of sales into one. The date
-- is therefore not decoration: it is how you tell a normal night from a gap.
-- It is a lag() over the same window that already produces opening_packs, so
-- it cannot disagree with it.
--
-- ONLY COLUMNS ARE ADDED. Nothing is renamed or reordered, so anything already
-- reading this view keeps working.
-- ============================================================

begin;

alter table product
  add column if not exists unit_price numeric(10,2);

comment on column product.unit_price is
  'Current list price per pack, in RM. Fallback for valuing variance on a day '
  'the product did not sell. Not a price history — see pos_sales_daily.unit_price.';

alter table pos_sales_daily
  add column if not exists unit_price numeric(10,2);

comment on column pos_sales_daily.unit_price is
  'Price per pack as printed on that day''s sales report, in RM. Written by the '
  'import page, which already reads price to prove the quantity.';

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
      - coalesce(f.packs, 0)) - s.qty_sold        as variance_packs,
    -- added by 10 --------------------------------------------------------
    lag(f.count_date) over w                      as opening_date,
    coalesce(s.unit_price, p.unit_price)          as unit_price_used,
    round(
      (((lag(coalesce(f.packs, 0)) over w) + f.add_in
        - coalesce(f.packs, 0)) - s.qty_sold)
      * coalesce(s.unit_price, p.unit_price), 2)  as variance_rm
  from vw_count_submitted f
  join product p on p.product_id = f.product_id
  left join pos_sales_daily s
    on s.branch_id = f.branch_id
   and s.sale_date = f.count_date
   and s.product_id = f.product_id
  window w as (partition by f.branch_id, f.product_id order by f.count_date);

comment on view vw_daily_reconciliation is
  'Sold (physical) = opening + add_in - closing, opening being the previous '
  'submitted count''s closing for the same product, taken on opening_date. A '
  'not_on_shelf line stores packs = null and is read as zero on BOTH sides, so a '
  'product that was out of stock opens the next day at zero rather than null. '
  'opening_packs and opening_date are both null on a product''s first ever count, '
  'where there is genuinely no opening. variance_rm values the variance at the '
  'price that day''s report printed, falling back to the product list price, and '
  'is null when neither is known.';

commit;

-- Verify:
--   select count_date, opening_date, short_name, opening_packs, closing_packs,
--          sold_physical, sold_pos, variance_packs, unit_price_used, variance_rm
--     from vw_daily_reconciliation
--    where branch_id = 'SAFARI'
--    order by count_date, short_name
--    limit 20;
--
-- Expect opening_date null on the first count of each product and the previous
-- count's date thereafter. variance_rm stays null until a price is known:
-- the import page fills pos_sales_daily.unit_price from the next report loaded,
-- and product.unit_price is yours to set, e.g.
--
--   update product set unit_price = 18.20 where product_id = '103732';
--
-- Filling product.unit_price for all 54 is what makes RM figures appear on
-- products that had variance but no sales — the shrinkage case.
