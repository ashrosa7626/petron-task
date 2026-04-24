content = open('index.html').read()

old = '''    <div class="logo">
      <div class="logo__mark">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 22V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16"/>
          <path d="M3 11h12"/>
          <path d="M15 6h1a2 2 0 0 1 2 2v3.5a1.5 1.5 0 0 0 3 0V8l-3-3"/>
          <path d="M3 22h12"/>
        </svg>
      </div>
      <div class="logo__text">Petron<span>Tasks</span></div>
    </div>
    <div class="header-right">
      <div class="date-pill" id="dateLabel">—</div>
      <div class="clock-pill" id="clock">--:--</div>
      <div style="position:relative">
        <select id="branchToggle" onchange="switchBranch(this.value)" style="
          appearance:none;
          -webkit-appearance:none;
          background:#1F2A44;
          color:#E6EDF7;
          border:1px solid #2A3A5F;
          border-radius:99px;
          padding:8px 36px 8px 16px;
          font-family:inherit;
          font-size:0.85rem;
          font-weight:600;
          cursor:pointer;
          outline:none;
        ">
          <option value="Safari">🏢 Safari</option>
          <option value="Nilai Desa Jati">🏢 Nilai Desa Jati</option>
        </select>
        <span style="
          position:absolute;right:12px;top:50%;
          transform:translateY(-50%);
          pointer-events:none;color:#94A3B8;font-size:0.75rem;
        ">▾</span>
      </div>
    </div>'''

new = '''    <!-- Left: Branch toggle -->
    <div style="display:flex;align-items:center;gap:8px;min-width:180px">
      <div style="position:relative">
        <select id="branchToggle" onchange="switchBranch(this.value)" style="
          appearance:none;
          -webkit-appearance:none;
          background:#1F2A44;
          color:#E6EDF7;
          border:1px solid #2A3A5F;
          border-radius:99px;
          padding:8px 36px 8px 16px;
          font-family:inherit;
          font-size:0.85rem;
          font-weight:600;
          cursor:pointer;
          outline:none;
        ">
          <option value="Safari">🏢 Safari</option>
          <option value="Nilai Desa Jati">🏢 Nilai Desa Jati</option>
        </select>
        <span style="
          position:absolute;right:12px;top:50%;
          transform:translateY(-50%);
          pointer-events:none;color:#94A3B8;font-size:0.75rem;
        ">▾</span>
      </div>
    </div>
    <!-- Centre: Title -->
    <div style="position:absolute;left:50%;transform:translateX(-50%);text-align:center">
      <div class="logo__text" id="headerTitle">Safari<span>Tasks</span></div>
    </div>
    <!-- Right: Date & Clock -->
    <div class="header-right" style="min-width:180px;justify-content:flex-end">
      <div class="date-pill" id="dateLabel">—</div>
      <div class="clock-pill" id="clock">--:--</div>
    </div>'''

if old in content:
    content = content.replace(old, new)
    print('header replaced')
else:
    print('NOT FOUND - trying partial match')

# Fix header to be relative positioned for absolute centering
content = content.replace(
    '.header {',
    '.header { position:relative;'
)

# Update switchBranch to also update title
content = content.replace(
    'function switchBranch(branch) {\n  localStorage.setItem(\'selectedBranch\', branch);\n  document.getElementById(\'branchToggle\').value = branch;',
    '''function switchBranch(branch) {
  localStorage.setItem('selectedBranch', branch);
  document.getElementById('branchToggle').value = branch;
  var title = document.getElementById('headerTitle');
  if (title) title.innerHTML = branch + '<span>Tasks</span>';'''
)

# Update DOMContentLoaded to also set title
content = content.replace(
    'window.addEventListener(\'DOMContentLoaded\', function() {\n  const saved = localStorage.getItem(\'selectedBranch\') || \'Safari\';\n  const sel = document.getElementById(\'branchToggle\');\n  if (sel) sel.value = saved;\n});',
    '''window.addEventListener('DOMContentLoaded', function() {
  const saved = localStorage.getItem('selectedBranch') || 'Safari';
  const sel = document.getElementById('branchToggle');
  if (sel) sel.value = saved;
  var title = document.getElementById('headerTitle');
  if (title) title.innerHTML = saved + '<span>Tasks</span>';
});'''
)

open('index.html','w').write(content)
print('done')
