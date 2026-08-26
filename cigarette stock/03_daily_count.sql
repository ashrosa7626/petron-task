-- ============================================================
-- 03 — one count per day, with a staff-written title
--
-- Run AFTER 01_schema.sql. Safe to run on a database that already
-- has 01 and 02 applied. Idempotent.
--
-- Changes:
--   * stock_count gains a `title` column (e.g. "Cig Count of 26/08/2026")
--   * one count per branch per day, instead of one per shift
--   * `shift` becomes optional and is no longer part of the key
-- ============================================================

begin;

alter table stock_count add column if not exists title text;

-- Drop the old (branch, date, shift) uniqueness, whatever it got named.
do $$
declare c text;
begin
  select conname into c
  from pg_constraint
  where conrelid = 'stock_count'::regclass
    and contype = 'u'
    and pg_get_constraintdef(oid) like '%count_date, shift%';
  if c is not null then
    execute format('alter table stock_count drop constraint %I', c);
  end if;
end $$;

alter table stock_count alter column shift drop not null;

-- Backfill any existing rows, then make the title required.
update stock_count
   set title = 'Cig Count of ' || to_char(count_date, 'DD/MM/YYYY')
 where title is null;

alter table stock_count alter column title set not null;

-- One count per branch per trading day.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'stock_count'::regclass
      and conname = 'stock_count_one_per_day'
  ) then
    alter table stock_count
      add constraint stock_count_one_per_day unique (branch_id, count_date);
  end if;
end $$;

comment on column stock_count.count_date is
  'The trading day being closed, NOT the clock date of the count. A count taken '
  'just after midnight at the end of the 26th has count_date = 26th, and its '
  'closing figures become the opening for the 27th.';

comment on column stock_count.title is
  'Staff-written label, pre-filled as "Cig Count of DD/MM/YYYY" from count_date. '
  'Display only — never parse it for the date.';

comment on column stock_count.shift is
  'Normally null. Kept nullable so a single product can be re-counted outside '
  'the daily count if its variance needs isolating.';

commit;
