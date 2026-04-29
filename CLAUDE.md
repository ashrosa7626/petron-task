# Petron Task System — Project Notes

## Project Overview
A petrol station management system for Petron Safari and Nilai Desa Jati branches.
Hosted on GitHub Pages: https://ashrosa7626.github.io/petron-task/

## Tech Stack
- Plain HTML/CSS/JS (no React, no build tools)
- Supabase for database and auth
- GitHub Pages for hosting
- sidebar.js for shared navigation across all pages

## Pages
- index.html — Home page, staff task overview
- dashboard.html — Supervisor task dashboard
- briefing.html — Shift briefing system (Day/Night)
- lead.html — Team lead login and task assignment
- supervisor.html — Sign-off review page
- sidebar.js — Shared navigation sidebar (included in all pages)

## Supabase
- Project ID: vwffiuciogthfzekkkkz
- URL: https://vwffiuciogthfzekkkkz.supabase.co
- Key is in app.js
- Tables: daily_assignments, completions, users, task_templates, categories, subcategories, subgroups, shift_briefings, shift_staff

## Branch System
- Two branches: Safari and Nilai Desa Jati
- Branch stored in localStorage key: selectedBranch
- All pages have a branch toggle dropdown in the header
- Data must always be filtered by branch

## Header Pattern (all pages)
- Left: Branch toggle (margin-left:52px to avoid sidebar button)
- Centre: [BranchName][PageName] in Syne font, blue branch + white page
- Right: Actions (logout, date, etc.)
- Title updates dynamically when branch changes via switchBranch function

## Sidebar
- sidebar.js injected before </body> on all pages
- Shows hamburger menu top-left
- Dark theme matching briefing.html

## Shift Briefing System
- Uses Supabase tables: shift_briefings, shift_staff
- Briefings stored as key-value rows: key = `briefing:{timestamp}`, value = full JSON blob (incl. base64 photos)
- Briefings filtered by branch (b.branch field)
- Carried issues: unresolved issues auto-appear in next briefing
- 9-step flow: Attendance, Welcome, Checklist, Adhoc, Issues, Feedback, Closing, Photos, Review
- Checklist sections: 6 core Morning/Night sections only (SA/CSA/General removed for brevity)
- Download exports: per-briefing (↓ Save button) and weekly/monthly (↓ Week / ↓ Month buttons)
- `dbListAll(prefix, limit)` — batch fetch helper; pass limit=60 for issue scans, no limit for dashboard
- init() renders home immediately then loads staff + carried issues in parallel (non-blocking)
- Carried-issues scan limited to 60 most recent briefings to avoid loading all historical data

## Common Issues & Fixes
- GitHub Pages caches aggressively — use ?v=X or Disable Cache in DevTools
- Never use terminal for JS with !, ?, special chars — write to .py file instead
- After header redesigns, always check for dead element references in JS — e.g. `leadBranchLabel` was removed from the HTML but still referenced in `enterLeadView()`, causing `loadAssignView()` to never run (tasks stuck on "Loading...")
- Emojis in JS strings can cause syntax errors — use HTML entities instead
- briefing.html: if no briefings show for current branch, older records may be under a different branch — the dashboard shows a hint message in this case
- Supabase batch select (`select('key,value')`) may silently return empty on some RLS configs — `dbListAll` falls back to individual fetches automatically

## Recent Fixes (Apr 2026)
- **lead.html**: dead `leadBranchLabel` reference in `enterLeadView()` threw TypeError before `loadAssignView()` was called — task list was permanently stuck on "Loading..."
- **briefing.html load speed**: replaced sequential N+1 Supabase fetches with single batch query; init now renders immediately and loads data in background
- **briefing.html consistency**: briefings were inconsistently shown due to race conditions in sequential async fetches — fixed by batch query with fallback
- **briefing.html checklist**: removed SA/CSA/General Reminders sections to keep briefing leaner

## Deployment
- git add . → git commit -m "message" → git push
- GitHub Actions auto-deploys to GitHub Pages
- Check deployment at: https://github.com/ashrosa7626/petron-task/actions
