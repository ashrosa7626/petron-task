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
- shift_staff table is RLS-blocked for anon key — do NOT rely on it for reads/writes; use shift_briefings instead

## Branch System
- Two branches: Safari and Nilai Desa Jati
- Branch stored in localStorage key: selectedBranch
- All pages have a branch toggle dropdown in the header
- Data must always be filtered by branch

## Header Pattern (all pages)
- Left: Branch toggle (margin-left:52px to avoid sidebar button)
- Centre: [BranchName][PageName] in Syne font, blue branch + white page
- Right: Actions (logout, date, etc.) — briefing.html shows today's date via todayStr()
- Title updates dynamically when branch changes via switchBranch function

## Sidebar
- sidebar.js injected before </body> on all pages
- Shows hamburger menu top-left
- Dark theme matching briefing.html

## Task Assignment Reset
- Tasks do NOT reset automatically — they become invisible when the date changes
- `today()` in app.js determines the active date — rolls over at 7am MYT (not midnight)
- 7am MYT = 11pm UTC previous day. Before 7am MYT, today() returns yesterday's date (night shift sees its tasks)
- Formula: add UTC+8 offset, if hour < 7 subtract one day, format as YYYY-MM-DD
- Lead must log in each day to create new assignments; re-saving deletes and recreates that day's rows

## Shift Briefing System
- Uses Supabase table: shift_briefings (key-value store)
- Briefings: key = `briefing:{timestamp}`, value = full JSON blob (incl. base64 photos)
- Staff list: key = `stafflist:all`, value = `{ staff: [{name, branch}], updated }`
- Staff are per-branch: branch = "Safari" | "Nilai Desa Jati" | "Both"
- switchBranch() re-derives state.staffList from state.allStaff via deriveStaffList() — no reload needed
- Briefings filtered by branch (b.branch field)
- Carried issues: unresolved issues auto-appear in next briefing (scans latest 60 briefings)
- 9-step flow: Attendance, Welcome, Checklist, Adhoc, Issues, Feedback, Closing, Photos, Review
- Checklist sections: 6 core Morning/Night sections only
- Download: PDF via print window (↓ Save = single briefing, ↓ Week / ↓ Month = combined)
- Today's date shown in topbar via todayStr() = new Date() formatted — always current

## Briefing Storage Architecture
- Every save writes to localStorage first (`pb_b_{timestamp}`), then Supabase
- If photos make JSON too large for localStorage, saves without photos and marks `_photosStripped: true`
- dbListAll skips _photosStripped entries from local merge → they are fetched from Supabase (which has full photos)
- Supabase version overwrites localStorage when fetched, restoring photos
- localStorage briefings pruned to 2 weeks via pruneOldLocal() called at init
- Dashboard renders from localStorage instantly (paintDashboard), then Supabase syncs in background
- setDbFilter() repaints from allBriefingsCache — no re-fetch
- Issue Resolved/Not Resolved buttons use data-* attributes + btnSetResolved() handler (avoids inline boolean/large-int onclick bugs)

## Staff List Storage
- Primary: `stafflist:all` key in shift_briefings table → `{ staff: [{name, branch}], updated }`
- Local cache: `pb_staff_all` in localStorage → `[{name, branch}]`
- Migration path on first load: old `stafflist:Safari` / `stafflist:Nilai Desa Jati` → new format, then old pb_staff names-only array
- Last resort: extract unique names from briefing attendance arrays, assign branch from briefing.branch
- state.allStaff = full list; state.staffList = branch-filtered names (derived by deriveStaffList())

## Common Issues & Fixes
- GitHub Pages caches aggressively — use ?v=X or Disable Cache in DevTools
- Never use terminal for JS with !, ?, special chars — write to .py file instead
- After header redesigns, always check for dead element references in JS
- Emojis in JS strings can cause syntax errors — use HTML entities instead
- shift_staff RLS blocks anon key — store staff in shift_briefings under stafflist:all instead
- Photos in briefing history missing? Check _photosStripped flag — dbListAll will re-fetch from Supabase
- Inline boolean/large-int onclick args are unreliable — use data-* attributes + a named handler
- Supabase batch select may silently return empty on some RLS configs — dbListAll uses keys-first approach

## Recent Fixes (Apr–May 2026)
- **lead.html**: dead `leadBranchLabel` reference caused tasks stuck on "Loading..."
- **briefing.html dashboard**: instant load from localStorage, Supabase syncs in background
- **briefing.html storage**: localStorage-first with Supabase fallback; _photosStripped flag ensures photos are recovered
- **briefing.html staff**: per-branch staff list with branch selector on add and per-row branch editing
- **briefing.html issues**: Resolved/Not Resolved use data-* + btnSetResolved() handler
- **app.js today()**: rolls over at 7am MYT (UTC+8, hour < 7 → use previous date)

## Deployment
- git add . → git commit -m "message" → git push
- GitHub Actions auto-deploys to GitHub Pages
- Check deployment at: https://github.com/ashrosa7626/petron-task/actions
