# Petron Tasks

A shared-tablet web app for daily staff task management.

## Files
| File | Purpose |
|------|---------|
| `index.html` | Staff name selection (home screen) |
| `pin.html` | Staff PIN verification |
| `tasks.html` | Staff task list + completion |
| `lead.html` | Team Lead login + task assignment |
| `dashboard.html` | Live completion dashboard |
| `style.css` | Shared styles |
| `app.js` | Supabase client + utilities |
| `supabase-setup.sql` | Run once in Supabase SQL Editor |

## Setup Steps

### 1. Supabase Database
1. Go to your Supabase project → **SQL Editor** → **New Query**
2. Paste the entire contents of `supabase-setup.sql` and click **Run**

### 2. Create Team Lead Account
1. In Supabase → **Authentication** → **Users** → **Add User**
2. Enter the Team Lead's email and password
3. Copy the UUID shown for that user
4. In SQL Editor, run:
```sql
insert into public.users (auth_id, name, role)
values ('<UUID here>', 'Team Lead', 'lead');
```

### 3. Deploy to GitHub Pages
1. Push all files to your GitHub repo (`ashrosa7626/petron-tasks`)
2. Go to repo **Settings** → **Pages**
3. Set source to **Deploy from branch** → `main` → `/ (root)`
4. Your app will be live at: `https://ashrosa7626.github.io/petron-tasks`

### 4. First Use
1. Open the app on your tablet
2. Go to `lead.html` and log in as Team Lead
3. Go to **Manage Staff** tab → add your staff members + PINs
4. Go to **Task Templates** tab → review/edit the default tasks
5. Each morning: go to **Assign Tasks** tab, tick tasks for each staff member, click **Save**
6. Staff tap their name on the home screen, enter PIN, complete tasks

## Daily Workflow
- **Morning**: Team Lead assigns tasks for the day
- **During shift**: Staff tap name → PIN → mark tasks complete (+ photo if required)
- **Anytime**: Team Lead checks dashboard for live progress
