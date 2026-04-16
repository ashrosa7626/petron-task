-- ============================================================
-- PETRON TASKS — Migration: Supervisor Sign-Off
-- Run this in Supabase → SQL Editor → New Query
-- ============================================================

-- 1. Add shift + area columns to task_templates
alter table public.task_templates
  add column if not exists shift text check (shift in ('morning','afternoon','night','any')) default 'any',
  add column if not exists area  text check (area  in ('forecourt','cafe','store','any'))  default 'any';

-- 2. Add shift + area columns to daily_assignments
alter table public.daily_assignments
  add column if not exists shift text check (shift in ('morning','afternoon','night','any')) default 'any',
  add column if not exists area  text check (area  in ('forecourt','cafe','store','any'))  default 'any';

-- 3. Add supervisor role to users table check constraint
-- (drops and recreates the role check to include 'supervisor')
alter table public.users
  drop constraint if exists users_role_check;

alter table public.users
  add constraint users_role_check
  check (role in ('staff', 'lead', 'supervisor'));

-- 4. Create SIGN_OFFS table
create table if not exists public.sign_offs (
  id             uuid primary key default gen_random_uuid(),
  completion_id  uuid references public.completions(id) on delete cascade,
  supervisor_id  uuid references public.users(id) on delete set null,
  status         text not null check (status in ('approved', 'flagged')),
  notes          text,
  signed_at      timestamptz default now()
);

alter table public.sign_offs enable row level security;

create policy "Public read sign_offs"
  on public.sign_offs for select using (true);

create policy "Public insert sign_offs"
  on public.sign_offs for insert with check (true);

create policy "Public update sign_offs"
  on public.sign_offs for update using (true);

-- 5. Update completions to track sign-off status (denormalised for fast queries)
alter table public.completions
  add column if not exists signoff_status text
    check (signoff_status in ('pending','approved','flagged'))
    default 'pending';

-- ============================================================
-- DONE. After running this, add your supervisor account:
--
-- Step 1: Supabase → Authentication → Users → Add User
--         Enter supervisor's email + password, copy their UUID
--
-- Step 2: Run in SQL Editor:
--   insert into public.users (auth_id, name, role)
--   values ('<UUID>', 'Supervisor Name', 'supervisor');
-- ============================================================
