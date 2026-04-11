-- ============================================================
-- PETRON TASKS — Supabase Database Setup
-- Run this entire script in Supabase → SQL Editor → New Query
-- ============================================================

-- 1. USERS TABLE (staff + leads)
create table if not exists public.users (
  id         uuid primary key default gen_random_uuid(),
  auth_id    uuid references auth.users(id) on delete set null,
  name       text not null,
  role       text not null check (role in ('staff', 'lead')),
  pin_hash   text,
  created_at timestamptz default now()
);

-- 2. TASK TEMPLATES
create table if not exists public.task_templates (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  description    text,
  photo_required boolean default false,
  is_active      boolean default true,
  created_at     timestamptz default now()
);

-- 3. DAILY ASSIGNMENTS
create table if not exists public.daily_assignments (
  id                uuid primary key default gen_random_uuid(),
  date              date not null,
  staff_id          uuid references public.users(id) on delete cascade,
  task_template_id  uuid references public.task_templates(id) on delete set null,
  is_adhoc          boolean default false,
  custom_task_name  text,
  photo_required    boolean default false,
  created_by        uuid,
  created_at        timestamptz default now()
);

-- 4. COMPLETIONS
create table if not exists public.completions (
  id             uuid primary key default gen_random_uuid(),
  assignment_id  uuid references public.daily_assignments(id) on delete cascade,
  staff_id       uuid references public.users(id) on delete set null,
  completed_at   timestamptz default now(),
  photo_url      text,
  notes          text
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.users             enable row level security;
alter table public.task_templates    enable row level security;
alter table public.daily_assignments enable row level security;
alter table public.completions       enable row level security;

-- Allow all anon reads and writes (the app handles auth itself via PIN)
-- For a production app you'd lock these down further

create policy "Public read users"             on public.users             for select using (true);
create policy "Public insert users"           on public.users             for insert with check (true);
create policy "Public update users"           on public.users             for update using (true);

create policy "Public read templates"         on public.task_templates    for select using (true);
create policy "Public insert templates"       on public.task_templates    for insert with check (true);
create policy "Public update templates"       on public.task_templates    for update using (true);

create policy "Public read assignments"       on public.daily_assignments for select using (true);
create policy "Public insert assignments"     on public.daily_assignments for insert with check (true);
create policy "Public update assignments"     on public.daily_assignments for update using (true);
create policy "Public delete assignments"     on public.daily_assignments for delete using (true);

create policy "Public read completions"       on public.completions       for select using (true);
create policy "Public insert completions"     on public.completions       for insert with check (true);

-- ============================================================
-- STORAGE BUCKET FOR PHOTOS
-- Run this separately in SQL Editor
-- ============================================================

insert into storage.buckets (id, name, public)
values ('task-photos', 'task-photos', true)
on conflict do nothing;

create policy "Public photo upload" on storage.objects
  for insert with check (bucket_id = 'task-photos');

create policy "Public photo read" on storage.objects
  for select using (bucket_id = 'task-photos');

-- ============================================================
-- SEED: Default task templates (edit as needed)
-- ============================================================

insert into public.task_templates (name, description, photo_required, is_active) values
  ('Open station checklist',  'Complete all opening procedures',        false, true),
  ('Clean fuel pump area',    'Wipe down pumps and surrounding area',   true,  true),
  ('Check oil/fluid levels',  'Inspect and top up fluids as needed',    false, true),
  ('Restock shop shelves',    'Ensure shelves are stocked and tidy',    false, true),
  ('Clean bathrooms',         'Clean and restock bathroom supplies',    true,  true),
  ('End of shift report',     'Complete daily close-out paperwork',     false, true);

-- ============================================================
-- TEAM LEAD ACCOUNT SETUP
-- After running this SQL, go to:
-- Supabase → Authentication → Users → Add User
-- Create a user with your Team Lead email + password
-- Then run this to link them:
--
-- insert into public.users (auth_id, name, role)
-- values ('<paste auth user UUID here>', 'Team Lead', 'lead');
-- ============================================================
