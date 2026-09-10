-- ============================================================
-- 08 — let the sales importer write pos_sales_daily
--
-- Run AFTER 01–07, in the Supabase SQL editor.
--
-- 01_schema.sql gave anon a read policy only:
--
--   create policy read_sales on pos_sales_daily for select to anon using (true);
--
-- because sales were expected to arrive with the service key. The import
-- page runs in the browser, so it needs a deliberate, narrow write path
-- instead — putting a service key in client code is not an option.
--
-- Scope of what this grants:
--   * insert and update only, both gated on qty_sold >= 0
--   * NO delete policy. A day is corrected by re-uploading it, which
--     upserts; rows are never removed.
--   * product_id already carries a foreign key to product, so an Item ID
--     that is not a known product cannot be written at all. The importer
--     surfaces those to the user; this is the database backstop.
--
-- This extends the same anon-write trust the count screen already relies
-- on for stock_count and stock_count_line to a third table. It does not
-- open a new class of access: the anon key is public in app.js either way.
-- ============================================================

begin;

-- Enforce the floor in the table, not only in the page.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'pos_sales_daily'::regclass
      and conname = 'pos_sales_qty_non_negative'
  ) then
    alter table pos_sales_daily
      add constraint pos_sales_qty_non_negative check (qty_sold >= 0);
  end if;
end $$;

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
--   select polname, polcmd,
--          pg_get_expr(polqual, polrelid)     as using_expr,
--          pg_get_expr(polwithcheck, polrelid) as with_check_expr
--     from pg_policy where polrelid = 'pos_sales_daily'::regclass
--    order by polname;
--
-- Expect exactly three: read_sales (r), insert_sales (a), update_sales (w).
-- No row with polcmd = 'd'.
