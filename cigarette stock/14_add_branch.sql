-- ============================================================
-- 14 — a second branch for the cigarette module
--
-- Run in the Supabase SQL editor. Safe to re-run.
--
-- The app has had a Safari / Nilai Desa Jati toggle since April, but the
-- cigarette module's `branch` table only ever had SAFARI in it. Picking the
-- other branch therefore had nothing to match, and every page used to fall
-- back to "whatever branch does have a planogram" — which meant Safari's
-- shelf, Safari's counts and Safari's history shown under a Nilai Desa Jati
-- heading. That fallback is gone from the pages; this is the other half.
--
-- Adding the row makes the branch REAL but still empty: it has no planogram
-- version, so the count, restock and results pages will say so plainly rather
-- than showing another branch's data. Giving it a shelf is a separate job,
-- because only somebody standing in front of the gondola knows the layout.
--
-- The name must contain "Nilai Desa Jati" for the pages to match it: they
-- compare the app's localStorage `selectedBranch` against branch_id and name,
-- letters only, case-insensitive, by substring.
-- ============================================================

begin;

insert into branch (branch_id, name, pos_site_id) values
  ('NILAI', 'Petron Nilai Desa Jati', null)
on conflict (branch_id) do update set name = excluded.name;

commit;

-- Verify: two branches, one of which has no planogram yet.
select b.branch_id, b.name,
       (select count(*) from planogram_version v
         where v.branch_id = b.branch_id and v.status = 'active') as active_planograms
  from branch b
 order by b.branch_id;

-- Expect:
--   NILAI   Petron Nilai Desa Jati   0
--   SAFARI  Petron MRR2 Safari       1
--
-- With 0, the cigarette pages say the branch has no shelf set up and stop.
-- That is deliberate: a count filed against the wrong branch cannot be found
-- again, and no reconciliation afterwards could tell.
