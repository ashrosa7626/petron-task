-- ============================================================
-- 12 — let `authenticated` read and write what `anon` can
--
-- Run AFTER 11_restocks.sql, in the Supabase SQL editor.
--
-- ------------------------------------------------------------
-- THE BUG THIS FIXES, AND WHY IT WAS SO HARD TO SEE
-- ------------------------------------------------------------
-- Every policy in this module was written `to anon`. That is not "anyone
-- using the anon key" — it is the Postgres role the request runs as, and
-- PostgREST picks the role from the JWT in the Authorization header.
--
-- supabase-js stores a session in localStorage under sb-<ref>-auth-token and
-- sends it as the bearer token in preference to the anon key. Any other page
-- in this app that signs a user in therefore switches the cigarette pages to
-- role `authenticated` — which matches NO policy here, so PostgREST returns
--
--     200 OK    []
--
-- An empty array and no error. The page reports "No active planogram version
-- found" and nothing anywhere says the row was filtered out by RLS. It comes
-- and goes as the token expires and refreshes.
--
-- Verified on the live database 14 Sep 2026, same URL, same anon apikey:
--     Authorization: Bearer <anon key>     -> [{"version_id":1,...}]
--     Authorization: Bearer <user session> -> []
--
-- The pages are now pinned to the anon key (persistSession: false), which
-- stops the bleeding. This is the other half: a signed-in supervisor should
-- be able to read a planogram, not be silently shown nothing.
--
-- Policies cannot be ALTERed to add a role, so each is dropped and recreated
-- with the same predicate and `to anon, authenticated`. The predicates below
-- are copied verbatim from 01, 05, 08 and 11 — if you change one there,
-- change it here.
-- ============================================================

begin;

-- ---------- reference data: readable, never writable ----------
drop policy if exists read_branch  on branch;
drop policy if exists read_product on product;
drop policy if exists read_alias   on product_alias;
drop policy if exists read_version on planogram_version;
drop policy if exists read_facing  on planogram_facing;

create policy read_branch  on branch            for select to anon, authenticated using (true);
create policy read_product on product           for select to anon, authenticated using (true);
create policy read_alias   on product_alias     for select to anon, authenticated using (true);
create policy read_version on planogram_version for select to anon, authenticated using (status = 'active');
create policy read_facing  on planogram_facing  for select to anon, authenticated using (true);

-- ---------- counts ----------
-- update_count keeps the WITH CHECK that 05 added: without it Postgres reuses
-- USING as WITH CHECK and a count can never leave draft.
drop policy if exists insert_count on stock_count;
drop policy if exists read_count   on stock_count;
drop policy if exists update_count on stock_count;

create policy insert_count on stock_count for insert to anon, authenticated
  with check (status = 'draft');
create policy read_count   on stock_count for select to anon, authenticated using (true);
create policy update_count on stock_count for update to anon, authenticated
  using (status = 'draft')
  with check (status in ('draft','submitted'));

drop policy if exists insert_line on stock_count_line;
drop policy if exists read_line   on stock_count_line;
drop policy if exists update_line on stock_count_line;

create policy insert_line on stock_count_line for insert to anon, authenticated with check (
  exists (select 1 from stock_count c
           where c.count_id = stock_count_line.count_id and c.status = 'draft'));
create policy read_line   on stock_count_line for select to anon, authenticated using (true);
create policy update_line on stock_count_line for update to anon, authenticated using (
  exists (select 1 from stock_count c
           where c.count_id = stock_count_line.count_id and c.status = 'draft'));

-- ---------- POS sales (08) ----------
drop policy if exists read_sales   on pos_sales_daily;
drop policy if exists insert_sales on pos_sales_daily;
drop policy if exists update_sales on pos_sales_daily;

create policy read_sales   on pos_sales_daily for select to anon, authenticated using (true);
create policy insert_sales on pos_sales_daily for insert to anon, authenticated
  with check (qty_sold >= 0);
create policy update_sales on pos_sales_daily for update to anon, authenticated
  using (true) with check (qty_sold >= 0);

-- ---------- restocks (11) ----------
drop policy if exists read_restock   on stock_restock;
drop policy if exists insert_restock on stock_restock;
drop policy if exists update_restock on stock_restock;

create policy read_restock   on stock_restock for select to anon, authenticated using (true);
create policy insert_restock on stock_restock for insert to anon, authenticated
  with check (status = 'draft');
create policy update_restock on stock_restock for update to anon, authenticated
  using (status in ('draft','submitted'))
  with check (status in ('draft','submitted','void'));

drop policy if exists read_restock_line   on stock_restock_line;
drop policy if exists insert_restock_line on stock_restock_line;
drop policy if exists update_restock_line on stock_restock_line;
drop policy if exists delete_restock_line on stock_restock_line;

create policy read_restock_line on stock_restock_line for select to anon, authenticated using (true);
create policy insert_restock_line on stock_restock_line for insert to anon, authenticated with check (
  exists (select 1 from stock_restock r
           where r.restock_id = stock_restock_line.restock_id and r.status = 'draft'));
create policy update_restock_line on stock_restock_line for update to anon, authenticated using (
  exists (select 1 from stock_restock r
           where r.restock_id = stock_restock_line.restock_id and r.status = 'draft'));
create policy delete_restock_line on stock_restock_line for delete to anon, authenticated using (
  exists (select 1 from stock_restock r
           where r.restock_id = stock_restock_line.restock_id and r.status = 'draft'));

commit;

-- ============================================================
-- Verify. Every policy in the module should now list both roles; anything
-- still showing only {anon} was missed above.
-- ============================================================
select tablename, policyname, cmd, roles
  from pg_policies
 where schemaname = 'public'
   and tablename in ('branch','product','product_alias','planogram_version',
                     'planogram_facing','stock_count','stock_count_line',
                     'pos_sales_daily','stock_restock','stock_restock_line')
   and not (roles @> '{authenticated}')
 order by tablename, policyname;
-- Expect ZERO rows.

-- And the behaviour that started this: signed in or not, the active planogram
-- must come back. Before 12 the second of these returned [] with no error.
--   select count(*) from planogram_version where status = 'active';  -- expect 1
