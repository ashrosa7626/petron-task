-- ============================================================
-- 17 — restore the lost planogram_version rows, and stop it happening again
--
-- Run in the Supabase SQL editor, as one script. Idempotent: running it twice
-- changes nothing the second time.
--
-- ------------------------------------------------------------
-- WHAT WENT WRONG
-- ------------------------------------------------------------
-- Probed 01 Oct 2026. `planogram_version` held only two rows — v3 (cigarettes,
-- active) and v5 (Iluma, active). But `planogram_facing` still held facings for
-- versions 1, 2, 4 and 6:
--
--     version 1   162 facings   the original cigarette gondola
--     version 2   162 facings   a cigarette edit from 17 Sep
--     version 4    47 facings   THE LUBES SHELF as first seeded, 31 products
--     version 6    50 facings   THE LUBES SHELF as re-uploaded, 34 products
--
-- Consequences, all of them live:
--
--   * LUBES had no active version, so start.html correctly refused to begin a
--     count and said the shelf was not set up. The shelf was there; its version
--     row was not. That is why the message read as wrong.
--   * NINE SUBMITTED CIGARETTE COUNTS pointed at versions that no longer
--     existed (counts 4-11 at v1, count 12 at v2). `stock_count.version_id` is
--     the record of what each count was counted against, so that is history
--     with a dangling reference, not a cosmetic problem.
--   * Two empty lubes drafts (24 on 28/09, 29 on 29/09) pointed at v4.
--
-- ------------------------------------------------------------
-- HOW IT WAS POSSIBLE — THE PART THAT MATTERS
-- ------------------------------------------------------------
-- 01_schema.sql declares:
--
--     planogram_facing.version_id  references planogram_version on delete cascade
--     stock_count.version_id       references planogram_version
--
-- Under those constraints this state is UNREACHABLE. Deleting a version row
-- would have cascaded its facings away, and the stock_count reference would have
-- blocked deleting v1, v2 or v4 at all. Facings for a version that does not
-- exist also could not be inserted.
--
-- So the constraints are not on the live tables. The database did not come from
-- 01_schema.sql exactly — which is established here: it was hand-edited once
-- before, losing LD 100 Red (see 04_sync_to_spreadsheet.sql). Restoring the rows
-- without restoring the constraints would leave the same deletion one click
-- away, so section 3 adds them back.
--
-- ------------------------------------------------------------
-- WHICH LUBES SHELF BECOMES ACTIVE
-- ------------------------------------------------------------
-- v6, the re-upload. It is v4 plus the three products that had no POS Item ID
-- when lubes was first seeded and therefore could not be placed:
--
--     104719  BLAZE HTP 0W40 1L
--     104720  REV-X TURBO HTP 5W40 1L
--     103583  REV-X SYN BLEND 10W40 1L
--
-- All three now have product rows, are active, and are category LUBES. v6 was
-- checked offline with the shipped deriveBlocks before this script was written:
-- 50 facings over shelves A-D, 34 products, 38 blocks, every facing drawn
-- exactly once, no overlaps, 4 split products, every product row present and in
-- the right category. It is a sound shelf.
--
-- Both lubes drafts are EMPTY (no stock_count_line rows at all), so nothing is
-- lost by the newer shelf becoming the one that gets counted.
--
-- To prefer the older 31-product shelf instead, swap the two statuses:
--     update planogram_version set status='archived' where version_id=6;
--     update planogram_version set status='active'   where version_id=4;
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. Put the missing version rows back
-- ------------------------------------------------------------
-- effective_from is informational; `status` is what the pages resolve on. The
-- dates come from the counts that reference each version, so the history reads
-- in the right order.
insert into planogram_version (version_id, branch_id, category, effective_from, status, note)
values
  (1, 'SAFARI', 'CIGARETTES', '2026-08-26', 'archived',
   'Restored 01/10/2026 — row lost, 162 facings intact. Referenced by counts 4-11.'),
  (2, 'SAFARI', 'CIGARETTES', '2026-09-17', 'archived',
   'Restored 01/10/2026 — row lost, 162 facings intact. Referenced by count 12.'),
  (4, 'SAFARI', 'LUBES',      '2026-09-25', 'archived',
   'Restored 01/10/2026 — row lost, 47 facings intact. Superseded by v6.'),
  (6, 'SAFARI', 'LUBES',      '2026-09-30', 'active',
   'Restored 01/10/2026 — row lost, 50 facings intact. Adds the three products that had no POS Item ID.')
on conflict (version_id) do update
  set status   = excluded.status,
      category = excluded.category,
      note     = excluded.note;

-- The identity sequence is behind after inserting explicit ids, so the next
-- upload on the Edit the Shelf page would try to reuse one and fail.
select setval(pg_get_serial_sequence('planogram_version', 'version_id'),
              (select max(version_id) from planogram_version));

-- ------------------------------------------------------------
-- 2. Check before constraining
-- ------------------------------------------------------------
-- Section 3 cannot add a foreign key while an orphan exists, and a half-applied
-- repair is worse than none — so stop here with a readable message rather than
-- a constraint-violation error forty lines down.
do $$
declare
  orphan_facings int;
  orphan_counts  int;
  active_lubes   int;
begin
  select count(*) into orphan_facings
    from planogram_facing f
    left join planogram_version v using (version_id)
   where v.version_id is null;

  select count(*) into orphan_counts
    from stock_count c
    left join planogram_version v using (version_id)
   where v.version_id is null;

  if orphan_facings > 0 or orphan_counts > 0 then
    raise exception
      'Still orphaned: % facings and % counts point at a version with no row. '
      'Section 1 did not cover every version. Run: '
      'select distinct version_id from planogram_facing '
      'where version_id not in (select version_id from planogram_version);',
      orphan_facings, orphan_counts;
  end if;

  select count(*) into active_lubes
    from planogram_version
   where branch_id = 'SAFARI' and category = 'LUBES' and status = 'active';

  if active_lubes <> 1 then
    raise exception 'Expected exactly one active LUBES version for SAFARI, found %.', active_lubes;
  end if;
end $$;

-- ------------------------------------------------------------
-- 3. The constraints that would have prevented all of this
-- ------------------------------------------------------------
-- Declared in 01_schema.sql and absent from the live tables. Added by name so
-- re-running is a no-op.
--
-- planogram_facing cascades: a version and its facings are one thing, and a
-- version row with no facings is useless. stock_count does NOT cascade — a
-- submitted count must never be removable by tidying up a planogram, which is
-- exactly the deletion that caused this.
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'planogram_facing_version_id_fkey'
                    and conrelid = 'planogram_facing'::regclass) then
    alter table planogram_facing
      add constraint planogram_facing_version_id_fkey
      foreign key (version_id) references planogram_version(version_id) on delete cascade;
    raise notice 'added planogram_facing -> planogram_version (on delete cascade)';
  end if;

  if not exists (select 1 from pg_constraint
                  where conname = 'stock_count_version_id_fkey'
                    and conrelid = 'stock_count'::regclass) then
    alter table stock_count
      add constraint stock_count_version_id_fkey
      foreign key (version_id) references planogram_version(version_id);
    raise notice 'added stock_count -> planogram_version (no cascade, deliberately)';
  end if;
end $$;

commit;

-- ------------------------------------------------------------
-- 4. Verify — read these, do not assume
-- ------------------------------------------------------------

-- Every version, and what hangs off it. Expect v3 active CIGARETTES,
-- v5 active ILUMA, v6 active LUBES, and v1/v2/v4 archived.
select v.version_id, v.category, v.status, v.effective_from,
       (select count(*) from planogram_facing f where f.version_id = v.version_id) as facings,
       (select count(distinct f.product_id) from planogram_facing f
         where f.version_id = v.version_id) as products,
       (select count(*) from stock_count c where c.version_id = v.version_id) as counts
  from planogram_version v
 order by v.version_id;

-- Exactly one active row per branch and category.
select branch_id, category, count(*) as active_versions
  from planogram_version where status = 'active'
 group by branch_id, category order by category;

-- Nothing dangling. Both must return zero rows.
select 'orphan facing' as what, version_id from planogram_facing
 where version_id not in (select version_id from planogram_version)
union all
select 'orphan count', version_id from stock_count
 where version_id not in (select version_id from planogram_version);

-- The constraints are on. Expect two rows.
select conname, pg_get_constraintdef(oid)
  from pg_constraint
 where conname in ('planogram_facing_version_id_fkey', 'stock_count_version_id_fkey');
