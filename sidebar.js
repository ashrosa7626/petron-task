// sidebar.js - Unified navigation for Petron Task System
// Add <script src="sidebar.js"></script> before </body> on every page

(function() {
  /* Every href is resolved against THIS FILE's location, never against the page
     that included it.

     They used to be bare relative paths, which is fine from the app root and
     wrong everywhere else: from stock-count/start.html, "Home" resolved to
     stock-count/index.html — the count grid — so the Home button took you
     deeper into the cigarette module instead of out of it. sidebar.js lives at
     the app root, so its own URL is the root, wherever it is loaded from. */
  const SELF = (document.currentScript && document.currentScript.src) ||
               [...document.getElementsByTagName('script')]
                 .map(s => s.src).filter(s => /sidebar\.js(\?|$)/.test(s)).pop() || '';
  const ROOT = SELF ? SELF.slice(0, SELF.lastIndexOf('/') + 1)
                    : location.pathname.replace(/[^/]*$/, '');

  const PAGES = [
    { label:'Home',             href:'index.html' },
    { label:'Dashboard',        href:'dashboard.html' },
    { label:'Shift Briefing',   href:'briefing.html' },
    { label:'Lead Panel',       href:'lead.html' },
    { label:'Sign-Off Review',  href:'supervisor.html' },
    { label:'Cigarette Count',  href:'stock-count/start.html', section:'Cigarettes' },
    { label:'Count Results',    href:'stock-count/history.html' },
    { label:'Restock the Shelf',href:'stock-count/restock.html' },
    { label:'Import POS Sales', href:'stock-count/import-sales.html' },
    { label:'Edit the Shelf',   href:'stock-count/planogram.html' },
  ];

  // Branch is app-wide and lives in one key. The cigarette pages read the same
  // one, so switching here switches everything.
  const BRANCHES = ['Safari', 'Nilai Desa Jati'];
  const BRANCH_KEY = 'selectedBranch';
  const readBranch = () => {
    try { return localStorage.getItem(BRANCH_KEY) || BRANCHES[0]; } catch (e) { return BRANCHES[0]; }
  };

  const here = location.pathname.replace(/\/$/, '/index.html');

  // ── Inject CSS ──────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    body { margin: 0; }

    .sb-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.6);
      z-index: 299;
      backdrop-filter: blur(3px);
    }
    .sb-overlay.open { display: block; }

    .sb-sidebar {
      position: fixed;
      top: 0; left: 0; bottom: 0;
      width: 250px;
      background: #0B0F1A;
      border-right: 1px solid #1F2A44;
      z-index: 300;
      display: flex;
      flex-direction: column;
      transform: translateX(-100%);
      transition: transform 0.28s cubic-bezier(0.4,0,0.2,1);
      font-family: 'IBM Plex Sans', 'Segoe UI', sans-serif;
      box-shadow: 4px 0 24px rgba(0,0,0,0.4);
    }
    .sb-sidebar.open { transform: translateX(0); }

    .sb-header {
      padding: 20px 20px 16px;
      border-bottom: 1px solid #1F2A44;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .sb-brand {
      font-size: 1.1rem;
      font-weight: 800;
      color: #E6EDF7;
      font-family: 'Syne', sans-serif;
      letter-spacing: -0.3px;
    }
    .sb-brand span { color: #F97316; }
    .sb-date {
      font-size: 0.72rem;
      color: #64748B;
      margin-top: 3px;
    }
    .sb-close {
      background: #1F2A44;
      border: 1px solid #2A3A5F;
      color: #94A3B8;
      width: 30px;
      height: 30px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 1rem;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: all 0.15s;
    }
    .sb-close:hover { background: #2A3A5F; color: #E6EDF7; }

    .sb-nav {
      flex: 1;
      padding: 14px 10px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .sb-link {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 14px;
      border-radius: 10px;
      text-decoration: none;
      color: #94A3B8;
      font-size: 0.92rem;
      font-weight: 500;
      border: 1px solid transparent;
      transition: all 0.15s;
      cursor: pointer;
    }
    .sb-link:hover {
      background: #1F2A44;
      color: #E6EDF7;
      border-color: #2A3A5F;
    }
    .sb-link.active {
      background: rgba(249,115,22,0.12);
      border-color: rgba(249,115,22,0.35);
      color: #F97316;
      font-weight: 700;
    }
    .sb-sect {
      font-size: 0.66rem;
      font-weight: 700;
      letter-spacing: 0.8px;
      text-transform: uppercase;
      color: #475569;
      padding: 14px 14px 6px;
    }

    .sb-branchbox {
      padding: 12px 10px 12px;
      border-bottom: 1px solid #1F2A44;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .sb-branch {
      display: block;
      width: 100%;
      text-align: left;
      padding: 10px 14px;
      border-radius: 10px;
      background: transparent;
      border: 1px solid transparent;
      color: #94A3B8;
      font-family: inherit;
      font-size: 0.9rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s;
    }
    .sb-branch:hover { background: #1F2A44; color: #E6EDF7; border-color: #2A3A5F; }
    .sb-branch.on {
      background: rgba(59,130,246,0.14);
      border-color: rgba(59,130,246,0.4);
      color: #60A5FA;
      font-weight: 700;
    }
    .sb-link-dot {
      width: 7px; height: 7px;
      border-radius: 50%;
      background: #F97316;
      margin-left: auto;
      flex-shrink: 0;
    }

    .sb-footer {
      padding: 14px 20px;
      border-top: 1px solid #1F2A44;
      font-size: 0.72rem;
      color: #475569;
      text-align: center;
    }

    .sb-toggle {
      position: fixed;
      top: 10px;
      left: 14px;
      z-index: 298;
      background: #1F2A44;
      border: 1px solid #2A3A5F;
      border-radius: 9px;
      color: #E6EDF7;
      width: 40px;
      height: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 1.1rem;
      transition: all 0.15s;
      box-shadow: 0 2px 12px rgba(0,0,0,0.4);
    }
    .sb-toggle:hover { background: #2A3A5F; }
  `;
  document.head.appendChild(style);

  // ── Build nav items ─────────────────────────────────────
  // Active is decided on the RESOLVED path, so stock-count/index.html and the
  // root index.html cannot be mistaken for each other.
  const navItems = PAGES.map(p => {
    const url = new URL(p.href, ROOT);
    const isActive = url.pathname === here;
    return (p.section ? `<div class="sb-sect">${p.section}</div>` : '') +
      `<a href="${url.href}" class="sb-link ${isActive ? 'active' : ''}">
        <span>${p.label}</span>
        ${isActive ? '<span class="sb-link-dot"></span>' : ''}
      </a>`;
  }).join('');

  const branchNow = readBranch();
  const branchItems = BRANCHES.map(b =>
    `<button class="sb-branch ${b === branchNow ? 'on' : ''}" data-branch="${b}">${b}</button>`
  ).join('');

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-MY', { weekday:'long', day:'numeric', month:'long' });

  // ── Inject HTML ─────────────────────────────────────────
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="sb-overlay" id="sbOverlay" onclick="sbClose()"></div>
    <button class="sb-toggle" id="sbToggle" onclick="sbToggle()" title="Menu">&#9776;</button>
    <div class="sb-sidebar" id="sbSidebar">
      <div class="sb-header">
        <div>
          <div class="sb-brand">Petron<span>Tasks</span></div>
          <div class="sb-date">${dateStr}</div>
        </div>
        <button class="sb-close" onclick="sbClose()">&#x2715;</button>
      </div>
      <div class="sb-branchbox">
        <div class="sb-sect" style="padding-top:0">Branch</div>
        ${branchItems}
      </div>
      <nav class="sb-nav">${navItems}</nav>
      <div class="sb-footer">Petron Task System &copy; ${now.getFullYear()}</div>
    </div>`;
  document.body.appendChild(wrap);

  // ── Functions ───────────────────────────────────────────
  window.sbToggle = function() {
    document.getElementById('sbSidebar').classList.toggle('open');
    document.getElementById('sbOverlay').classList.toggle('open');
  };
  window.sbClose = function() {
    document.getElementById('sbSidebar').classList.remove('open');
    document.getElementById('sbOverlay').classList.remove('open');
  };

  /* Switching branch reloads rather than repainting.

     Some pages derive a great deal from the branch — which planogram version
     is active, which counts exist, which briefings are listed — and a page that
     repainted half of it would be showing one branch's header over another
     branch's data. A reload is slower and cannot be half-right. */
  wrap.querySelectorAll('[data-branch]').forEach(btn => {
    btn.addEventListener('click', () => {
      const b = btn.dataset.branch;
      if (b === readBranch()) return sbClose();
      try { localStorage.setItem(BRANCH_KEY, b); } catch (e) { /* storage can be full */ }
      location.reload();
    });
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') sbClose(); });
})();
