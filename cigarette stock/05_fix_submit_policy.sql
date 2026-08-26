-- ============================================================
-- 05 — let a draft count actually be submitted
--
-- Run AFTER 01/02/03/04, in the Supabase SQL editor.
--
-- 01_schema.sql declared:
--
--   create policy update_count on stock_count for update to anon
--     using (status = 'draft');
--
-- Postgres reuses a policy's USING expression as its WITH CHECK when no
-- WITH CHECK is given. So the *new* row also had to satisfy
-- status = 'draft' — which makes the draft -> submitted transition
-- impossible. Submitting a count failed with:
--
--   42501  new row violates row-level security policy for table "stock_count"
--
-- The fix keeps the freeze intact: USING still admits only drafts, so a
-- submitted count can never be updated again, while WITH CHECK allows the
-- one transition the app needs.
-- ============================================================

begin;

drop policy if exists update_count on stock_count;

create policy update_count on stock_count for update to anon
  using       (status = 'draft')                  -- only a draft may be touched
  with check  (status in ('draft','submitted'));  -- and it may become submitted

-- stock_count_line needs no equivalent change: its policies test the parent's
-- status, lines are always written while the parent is still a draft, and the
-- row being written never changes that status.

-- Remove the probe row used to diagnose the policy (lines cascade).
delete from stock_count where title = 'RLS PROBE - delete me';

commit;

-- Verify:
--   select polname, pg_get_expr(polqual, polrelid)      as using_expr,
--          pg_get_expr(polwithcheck, polrelid)          as with_check_expr
--     from pg_policy where polrelid = 'stock_count'::regclass and polname = 'update_count';
