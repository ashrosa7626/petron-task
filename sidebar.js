// sidebar.js - Shared navigation sidebar for Petron Task System
// Include this script in every page: <script src="sidebar.js"></script>

(function() {
  const PAGES = [
    { id: 'home',      label: 'Home',           icon: '🏠', href: 'index.html' },
    { id: 'tasks',     label: 'Tasks',          icon: '✅', href: 'tasks.html' },
    { id: 'dashboard', label: 'Dashboard',      icon: '📊', href: 'dashboard.html' },
    { id: 'briefing',  label: 'Shift Briefing', icon: '⛽', href: 'briefing.html' },
    { id: 'lead',      label: 'Lead',           icon: '👑', href: 'lead.html' },
  ];

  // Detect current page
  const currentFile = window.location.pathname.split('/').pop() || 'index.html';

  // Inject CSS
  const style = document.createElement('style');
  style.textContent = `
    * { box-sizing: border-box; }

    .sb-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.5);
      z-index: 199;
      backdrop-filter: blur(2px);
    }
    .sb-overlay.open { display: block; }

    .sb-sidebar {
      position: fixed;
      top: 0; left: 0; bottom: 0;
      width: 240px;
      background: #0F1B3D;
      border-right: 1px solid #1F2A44;
      z-index: 200;
      display: flex;
      flex-direction: column;
      transform: translateX(-100%);
      transition: transform 0.25s ease;
      font-family: 'IBM Plex Sans', sans-serif;
    }
    .sb-sidebar.open { transform: translateX(0); }

    .sb-logo {
      padding: 20px 20px 16px;
      border-bottom: 1px solid #1F2A44;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .sb-logo-title {
      font-size: 1rem;
      font-weight: 800;
      color: #E6EDF7;
      font-family: 'Syne', sans-serif;
      letter-spacing: -0.3px;
    }
    .sb-logo-sub {
      font-size: 0.72rem;
      color: #64748B;
      margin-top: 2px;
    }
    .sb-close {
      background: none;
      border: none;
      color: #64748B;
      font-size: 1.3rem;
      cursor: pointer;
      padding: 4px;
      line-height: 1;
    }
    .sb-close:hover { color: #E6EDF7; }

    .sb-nav {
      flex: 1;
      padding: 12px 10px;
      overflow-y: auto;
    }

    .sb-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 14px;
      border-radius: 10px;
      text-decoration: none;
      color: #94A3B8;
      font-size: 0.95rem;
      font-weight: 500;
      margin-bottom: 4px;
      transition: all 0.15s;
      border: 1px solid transparent;
    }
    .sb-item:hover {
      background: #1F2A44;
      color: #E6EDF7;
    }
    .sb-item.active {
      background: rgba(249,115,22,0.12);
      border-color: rgba(249,115,22,0.3);
      color: #F97316;
      font-weight: 700;
    }
    .sb-item-icon {
      font-size: 1.1rem;
      width: 24px;
      text-align: center;
      flex-shrink: 0;
    }
    .sb-item-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #F97316;
      margin-left: auto;
      flex-shrink: 0;
    }

    .sb-footer {
      padding: 14px 16px;
      border-top: 1px solid #1F2A44;
      font-size: 0.75rem;
      color: #475569;
      text-align: center;
    }

    .sb-toggle {
      position: fixed;
      top: 12px;
      left: 16px;
      z-index: 198;
      background: #1F2A44;
      border: 1px solid #2A3A5F;
      border-radius: 8px;
      color: #E6EDF7;
      width: 38px;
      height: 38px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 1rem;
      transition: all 0.15s;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    }
    .sb-toggle:hover { background: #2A3A5F; }

    /* Push topbar title to center properly when toggle is present */
    .topbar { padding-left: 60px !important; }
  `;
  document.head.appendChild(style);

  // Build sidebar HTML
  const navItems = PAGES.map(p => {
    const isActive = currentFile === p.href || 
      (currentFile === '' && p.href === 'index.html');
    return `
      <a href="${p.href}" class="sb-item ${isActive ? 'active' : ''}">
        <span class="sb-item-icon">${p.icon}</span>
        <span>${p.label}</span>
        ${isActive ? '<span class="sb-item-dot"></span>' : ''}
      </a>`;
  }).join('');

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-MY', { weekday:'short', day:'numeric', month:'short' });

  const sidebarHTML = `
    <div class="sb-overlay" id="sbOverlay" onclick="closeSidebar()"></div>
    <button class="sb-toggle" id="sbToggle" onclick="toggleSidebar()" title="Menu">&#9776;</button>
    <div class="sb-sidebar" id="sbSidebar">
      <div class="sb-logo">
        <div>
          <div class="sb-logo-title">⛽ Petron</div>
          <div class="sb-logo-sub">${dateStr}</div>
        </div>
        <button class="sb-close" onclick="closeSidebar()">&#x2715;</button>
      </div>
      <nav class="sb-nav">${navItems}</nav>
      <div class="sb-footer">Petron Task System</div>
    </div>`;

  // Inject into body
  const wrapper = document.createElement('div');
  wrapper.innerHTML = sidebarHTML;
  while (wrapper.firstChild) {
    document.body.insertBefore(wrapper.firstChild, document.body.firstChild);
  }

  // Toggle functions
  window.toggleSidebar = function() {
    document.getElementById('sbSidebar').classList.toggle('open');
    document.getElementById('sbOverlay').classList.toggle('open');
  };
  window.closeSidebar = function() {
    document.getElementById('sbSidebar').classList.remove('open');
    document.getElementById('sbOverlay').classList.remove('open');
  };

  // Close on Escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeSidebar();
  });

})();
