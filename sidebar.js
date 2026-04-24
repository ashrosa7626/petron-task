// sidebar.js - Unified navigation for Petron Task System
// Add <script src="sidebar.js"></script> before </body> on every page

(function() {
  const PAGES = [
    { label:'Home',           icon:'', href:'index.html' },
    { label:'Dashboard',      icon:'', href:'dashboard.html' },
    { label:'Shift Briefing', icon:'', href:'briefing.html' },
    { label:'Lead Panel',     icon:'', href:'lead.html' },
    { label:'Sign-Off Review',icon:'', href:'supervisor.html' },
  ];

  const currentFile = window.location.pathname.split('/').pop() || 'index.html';

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
    .sb-link-icon { font-size: 1.1rem; width: 26px; text-align: center; flex-shrink: 0; }
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
  const navItems = PAGES.map(p => {
    const isActive = currentFile === p.href || (currentFile === '' && p.href === 'index.html');
    return `<a href="${p.href}" class="sb-link ${isActive ? 'active' : ''}">
      <span class="sb-link-icon">${p.icon}</span>
      <span>${p.label}</span>
      ${isActive ? '<span class="sb-link-dot"></span>' : ''}
    </a>`;
  }).join('');

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
  document.addEventListener('keydown', e => { if (e.key === 'Escape') sbClose(); });
})();
