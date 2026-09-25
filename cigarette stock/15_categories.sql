-- ============================================================
-- 15 — categories: cigarettes, heated tobacco (Iluma) and lubes
--
-- Run AFTER 14_add_branch.sql, in the Supabase SQL editor. Idempotent.
--
-- ------------------------------------------------------------
-- WHY THIS IS NEEDED AT ALL
-- ------------------------------------------------------------
-- Two constraints written when there was exactly one shelf make counting a
-- second one impossible:
--
--   planogram_version_one_active   unique (branch_id) where status='active'
--       -> ONE active planogram per branch. A lubes planogram could not
--          coexist with the cigarette one.
--
--   stock_count_one_per_day        unique (branch_id, count_date)
--       -> ONE count per branch per day. Counting cigarettes and lubes on
--          the same day would be a unique violation, which is exactly what
--          people do.
--
-- Both gain the category. Everything existing is backfilled CIGARETTES, so
-- nothing in flight moves and the cigarette module cannot tell the
-- difference.
--
-- ------------------------------------------------------------
-- WHY product.category RATHER THAN A JOIN THROUGH THE PLANOGRAM
-- ------------------------------------------------------------
-- A product's category could be inferred from which planogram holds its
-- facings. It must not be. A product with no facings is off the shelf and
-- has no planogram row at all — and the sales importer still needs to know
-- what it is, because it writes "sold nothing today" for every active
-- product in the category it is importing. Inferring would make a
-- de-listed lube invisible to that scoping and start filling it with zero
-- rows from the cigarette report.
-- ============================================================

begin;

-- ---------- the column ----------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'stock_category') then
    create type stock_category as enum ('CIGARETTES', 'ILUMA', 'LUBES');
  end if;
end $$;

alter table product           add column if not exists category stock_category;
alter table planogram_version add column if not exists category stock_category;
alter table stock_count       add column if not exists category stock_category;
alter table stock_restock     add column if not exists category stock_category;

-- Backfill before the NOT NULL: everything that exists today is cigarettes.
update product           set category = 'CIGARETTES' where category is null;
update planogram_version set category = 'CIGARETTES' where category is null;
update stock_count       set category = 'CIGARETTES' where category is null;
update stock_restock     set category = 'CIGARETTES' where category is null;

alter table product           alter column category set not null;
alter table planogram_version alter column category set not null;
alter table stock_count       alter column category set not null;
alter table stock_restock     alter column category set not null;

alter table product           alter column category set default 'CIGARETTES';
alter table planogram_version alter column category set default 'CIGARETTES';
alter table stock_count       alter column category set default 'CIGARETTES';
alter table stock_restock     alter column category set default 'CIGARETTES';

comment on column product.category is
  'Which shelf this product belongs to. Drives the sales importer''s zero-fill '
  'scope, so it must be stored on the product and not inferred from whether it '
  'currently has facings — a de-listed product has none and still has a category.';

-- ---------- the two constraints that blocked this ----------
drop index if exists planogram_version_one_active;
create unique index if not exists planogram_version_one_active
  on planogram_version (branch_id, category) where status = 'active';

do $$
begin
  if exists (select 1 from pg_constraint
              where conrelid = 'stock_count'::regclass
                and conname = 'stock_count_one_per_day') then
    alter table stock_count drop constraint stock_count_one_per_day;
  end if;
end $$;

alter table stock_count
  add constraint stock_count_one_per_day unique (branch_id, category, count_date);

comment on constraint stock_count_one_per_day on stock_count is
  'One count per branch per CATEGORY per trading day. Cigarettes, Iluma and '
  'lubes are counted on the same day as a matter of course, so the category is '
  'part of the key.';

create index if not exists stock_restock_lookup_cat
  on stock_restock (branch_id, category, restock_date) where status = 'submitted';

-- ---------- the view ----------
-- category is appended as the EIGHTEENTH column. The first seventeen keep
-- their names, order and types exactly: excel/counts_query.m pins that list
-- and excel/build_workbook.py addresses the Data sheet by position, so a
-- reorder here silently corrupts the workbook rather than failing.
--
-- Nothing else changes. A product belongs to exactly one category, so the
-- window partitioned by (branch_id, product_id) already separates them, and
-- the restock lateral joins on product_id and needs no category.
create or replace view vw_daily_reconciliation as
  with base as (
    select f.branch_id, f.count_date, f.shift, f.staff_name, f.product_id,
           f.packs, f.add_in,
           lag(coalesce(f.packs, 0)) over w as opening_packs,
           lag(f.count_date)         over w as opening_date
      from vw_count_submitted f
    window w as (partition by f.branch_id, f.product_id order by f.count_date)
  )
  select
    b.branch_id,
    b.count_date,
    b.shift,
    b.staff_name,
    p.product_id,
    p.plu,
    p.short_name,
    p.pos_description,
    b.opening_packs,
    b.add_in + coalesce(r.added, 0)                     as add_in,
    coalesce(b.packs, 0)                                as closing_packs,
    b.opening_packs + b.add_in + coalesce(r.added, 0)
      - coalesce(b.packs, 0)                            as sold_physical,
    s.qty_sold                                          as sold_pos,
    (b.opening_packs + b.add_in + coalesce(r.added, 0)
      - coalesce(b.packs, 0)) - s.qty_sold              as variance_packs,
    b.opening_date,
    coalesce(s.unit_price, p.unit_price)                as unit_price_used,
    round(
      ((b.opening_packs + b.add_in + coalesce(r.added, 0)
        - coalesce(b.packs, 0)) - s.qty_sold)
      * coalesce(s.unit_price, p.unit_price), 2)        as variance_rm,
    -- added by 15 --------------------------------------------------------
    p.category
  from base b
  join product p on p.product_id = b.product_id
  left join pos_sales_daily s
    on s.branch_id  = b.branch_id
   and s.sale_date  = b.count_date
   and s.product_id = b.product_id
  left join lateral (
    select sum(v.packs)::int as added
      from vw_restock_daily v
     where v.branch_id  = b.branch_id
       and v.product_id = b.product_id
       and v.restock_date <= b.count_date
       and (case when b.opening_date is null
                 then v.restock_date = b.count_date
                 else v.restock_date > b.opening_date end)
  ) r on true;

comment on view vw_daily_reconciliation is
  'Sold (physical) = opening + add_in - closing. add_in is the count line''s own '
  'add_in plus every SUBMITTED restock in the period (opening_date, count_date]. '
  'category is the LAST column: the first seventeen are pinned by '
  'excel/counts_query.m and addressed by position in excel/build_workbook.py.';

commit;

-- ============================================================
-- Verify
-- ============================================================

-- 1. Nothing was left without a category, and nothing existing moved.
select 'product' as t, category, count(*) from product group by category
union all select 'planogram_version', category, count(*) from planogram_version group by category
union all select 'stock_count', category, count(*) from stock_count group by category
union all select 'stock_restock', category, count(*) from stock_restock group by category
order by t, category;
-- Before seeding 16, expect CIGARETTES on every row and nothing else.

-- 2. Both constraints now carry the category.
select indexname, indexdef from pg_indexes
 where tablename = 'planogram_version' and indexname = 'planogram_version_one_active';
--   expect ... UNIQUE ... (branch_id, category) WHERE status = 'active'
select conname, pg_get_constraintdef(oid) from pg_constraint
 where conrelid = 'stock_count'::regclass and conname = 'stock_count_one_per_day';
--   expect UNIQUE (branch_id, category, count_date)

-- 3. THE ONE THAT MATTERS FOR THE WORKBOOK. The first 17 columns must be
--    unchanged and in order, with category 18th. If this fails, the Excel
--    Daily sheet reads the wrong column for every figure.
select string_agg(column_name, ',' order by ordinal_position) =
       'branch_id,count_date,shift,staff_name,product_id,plu,short_name,'
       'pos_description,opening_packs,add_in,closing_packs,sold_physical,'
       'sold_pos,variance_packs,opening_date,unit_price_used,variance_rm,category'
       as shape_is_right
  from information_schema.columns
 where table_name = 'vw_daily_reconciliation';
-- expect true

-- 4. The thing that was impossible before: two counts, same branch, same day.
--    begin;
--      insert into stock_count (branch_id, category, version_id, count_date, title, staff_name)
--      select 'SAFARI', 'LUBES', version_id, current_date, 'probe', 'probe'
--        from planogram_version where status='active' and category='CIGARETTES';
--      -- succeeds only because the constraint now includes category
--    rollback;
