-- ============================================================
-- 13 — let a signed-in lead edit the planogram from the browser
--
-- Run AFTER 12_authenticated_role.sql, which is a PREREQUISITE, not an
-- option: the editor page reads planogram data while signed in, and until
-- 12 is in, every policy in this module is `to anon` only, so an
-- authenticated read returns 200 OK with an EMPTY ARRAY and no error.
-- That is the bug that emptied the restock page on 14 Sep.
--
-- ------------------------------------------------------------
-- WHY NOT JUST GRANT anon
-- ------------------------------------------------------------
-- The anon key ships inside app.js. It is in the page source of every
-- screen and inside the Excel workbook's Power Query. Granting it write
-- on the planogram would let anyone who opens DevTools move facings,
-- deactivate products or rewrite PLUs.
--
-- And it would be SILENT. The count is blind — staff are shown no
-- expected quantity — so a gondola that no longer matches the screen
-- cannot be noticed by the person counting it. It would surface weeks
-- later as variance nobody can explain.
--
-- So writes are granted to `authenticated` and gated on the role the app
-- already keeps in public.users. Those accounts exist: lead.html and
-- supervisor.html have signed in with them since April. anon gains
-- NOTHING here — it keeps select, exactly as 12 left it.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- Who may edit.
--
-- security definer because RLS on `users` would otherwise have to allow
-- every authenticated user to read every other user's row just to answer
-- this question. search_path is pinned: a security definer function
-- without it is the classic privilege-escalation hole.
--
-- To narrow this to named people later, change ONLY this function — every
-- policy below defers to it.
-- ------------------------------------------------------------
create or replace function is_planogram_editor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from users u
     where u.auth_id = auth.uid()
       and u.role in ('supervisor', 'lead')
  );
$$;

revoke all on function is_planogram_editor() from public;
grant execute on function is_planogram_editor() to authenticated;

comment on function is_planogram_editor is
  'True when the caller signed in as a supervisor or lead. The single place '
  'that decides who may change the shelf — every planogram write policy '
  'defers to it, so narrowing access is a one-line change here.';

-- ------------------------------------------------------------
-- product — insert and update only. NO DELETE POLICY, deliberately.
--
-- Removing an item from the range sets active = false. A delete would be
-- refused anyway by the foreign keys from stock_count_line and
-- pos_sales_daily, and should be: every historical count has to keep
-- resolving to the product it counted. A product with no facings has
-- already vanished from the count and restock grids, which is what
-- "removed" means to the people using them.
-- ------------------------------------------------------------
drop policy if exists edit_product_ins on product;
drop policy if exists edit_product_upd on product;

create policy edit_product_ins on product for insert to authenticated
  with check (is_planogram_editor());
create policy edit_product_upd on product for update to authenticated
  using (is_planogram_editor()) with check (is_planogram_editor());

-- ------------------------------------------------------------
-- product_alias — the spreadsheet's grid labels. Fully editable,
-- including delete: an alias carries no history, it is only how a cell in
-- the sheet resolves to an Item ID.
-- ------------------------------------------------------------
drop policy if exists edit_alias_ins on product_alias;
drop policy if exists edit_alias_upd on product_alias;
drop policy if exists edit_alias_del on product_alias;

create policy edit_alias_ins on product_alias for insert to authenticated
  with check (is_planogram_editor());
create policy edit_alias_upd on product_alias for update to authenticated
  using (is_planogram_editor()) with check (is_planogram_editor());
create policy edit_alias_del on product_alias for delete to authenticated
  using (is_planogram_editor());

-- ------------------------------------------------------------
-- planogram_version — insert and update. No delete: an archived version
-- is the record of how the shelf looked, and stock_count.version_id
-- points at it.
--
-- Note the read policy from 01/12 is `using (status = 'active')`, so an
-- archived version is invisible to the app. The editor needs to see them
-- to offer an undo, hence the extra select policy for editors only.
-- ------------------------------------------------------------
drop policy if exists edit_version_ins on planogram_version;
drop policy if exists edit_version_upd on planogram_version;
drop policy if exists read_version_editor on planogram_version;

create policy edit_version_ins on planogram_version for insert to authenticated
  with check (is_planogram_editor());
create policy edit_version_upd on planogram_version for update to authenticated
  using (is_planogram_editor()) with check (is_planogram_editor());
create policy read_version_editor on planogram_version for select to authenticated
  using (is_planogram_editor());

-- ------------------------------------------------------------
-- planogram_facing — the grid itself. Delete is allowed because a new
-- version is built by copying facings forward and then correcting them;
-- a facing carries no history of its own. What protects history is that
-- the OLD version's rows are never touched — the page writes to the new
-- version_id only, and stock_count_line keys on product_id, never on a
-- shelf position.
-- ------------------------------------------------------------
drop policy if exists edit_facing_ins on planogram_facing;
drop policy if exists edit_facing_upd on planogram_facing;
drop policy if exists edit_facing_del on planogram_facing;

create policy edit_facing_ins on planogram_facing for insert to authenticated
  with check (is_planogram_editor());
create policy edit_facing_upd on planogram_facing for update to authenticated
  using (is_planogram_editor()) with check (is_planogram_editor());
create policy edit_facing_del on planogram_facing for delete to authenticated
  using (is_planogram_editor());

commit;

-- ============================================================
-- Verify. The first query is the one that matters.
-- ============================================================

-- 1. anon must hold NO write policy on any of these four tables.
--    Expect ZERO rows. A row here means the public key can edit the shelf.
select tablename, policyname, cmd, roles
  from pg_policies
 where schemaname = 'public'
   and tablename in ('product','product_alias','planogram_version','planogram_facing')
   and cmd <> 'SELECT'
   and roles && '{anon}'
 order by tablename, policyname;

-- 2. The editor policies exist and name only `authenticated`.
--    Expect 11 rows, every one with roles = {authenticated}.
select tablename, policyname, cmd, roles
  from pg_policies
 where schemaname = 'public'
   and policyname like 'edit\_%' escape '\'
 order by tablename, policyname;

-- 3. The gate itself. Run as anon (a plain PostgREST request) it must be
--    false; run in the SQL editor auth.uid() is null, so this is also false.
--    A signed-in lead calling it through PostgREST gets true:
--      curl .../rest/v1/rpc/is_planogram_editor -H "apikey: <anon>"      -> false
--      curl .../rest/v1/rpc/is_planogram_editor -H "Authorization: Bearer <lead jwt>"
select is_planogram_editor() as should_be_false_here;

-- 4. And the negative test that actually proves it. With the ANON key:
--      curl -X PATCH '.../rest/v1/product?product_id=eq.103732' \
--           -H "apikey: <anon>" -H "Content-Type: application/json" \
--           -d '{"plu":"HACKED"}'
--    Expect no row updated. Then confirm nothing changed:
--      select product_id, plu from product where product_id = '103732';
