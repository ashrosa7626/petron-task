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
- Briefings filtered by branch (b.branch field)
- Carried issues: unresolved issues auto-appear in next briefing
- 9-step flow: Attendance, Welcome, Checklist, Adhoc, Issues, Feedback, Closing, Photos, Review

## Common Issues & Fixes
- GitHub Pages caches aggressively — use ?v=X or Disable Cache in DevTools
- Never use terminal for JS with !, ?, special chars — write to .py file instead
- After header redesigns, check for dead element references in JS (e.g. leadBranchLabel)
- Emojis in JS strings can cause syntax errors — use HTML entities instead

## Deployment
- git add . → git commit -m "message" → git push
- GitHub Actions auto-deploys to GitHub Pages
- Check deployment at: https://github.com/ashrosa7626/petron-task/actions
