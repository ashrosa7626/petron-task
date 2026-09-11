-- ============================================================
-- 09 — record who imported a day's sales
--
-- Run AFTER 08, in the Supabase SQL editor.
--
-- The import page used to require a PIN sign-in before it would write, and
-- took the name from that session. That gate is gone: reading a printed
-- report and typing the packs off it is not work that needs an account, and
-- being bounced to a sign-in screen mid-task was costing more than it was
-- protecting. The page asks for a name instead.
--
-- A typed name is not authentication and this column must not be read as if
-- it were — anyone can type anything. It is a note in the margin saying who
-- was at the keyboard, which is what is actually wanted when a number looks
-- wrong three weeks later.
--
-- The page works with or without this column: it probes for it once at load
-- and simply leaves the field out if it is not there. So running this is
-- optional, and running it later is fine — earlier rows keep a null.
-- ============================================================

begin;

alter table pos_sales_daily
  add column if not exists imported_by text;

comment on column pos_sales_daily.imported_by is
  'Name typed by whoever ran the import. Not authenticated — a margin note, not an identity.';

-- 08 granted anon insert and update gated on qty_sold. Those policies are
-- column-agnostic, so nothing needs regranting for the new column. They are
-- restated here only so this file is a complete description of the write
-- path rather than something that has to be read alongside 08.
drop policy if exists insert_sales on pos_sales_daily;
create policy insert_sales on pos_sales_daily
  for insert to anon
  with check (qty_sold >= 0);

drop policy if exists update_sales on pos_sales_daily;
create policy update_sales on pos_sales_daily
  for update to anon
  using      (true)
  with check (qty_sold >= 0);

commit;

-- Verify:
--   select column_name, data_type
--     from information_schema.columns
--    where table_name = 'pos_sales_daily'
--    order by ordinal_position;
--
-- Expect: branch_id, sale_date, product_id, qty_sold, imported_by.
