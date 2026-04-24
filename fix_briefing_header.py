content = open('briefing.html').read()

old = '''<div class="topbar">
  <a href="dashboard.html">← Dashboard</a>
  <div class="topbar-title" id="topTitle">Shift Briefing</div>
  <span id="topShiftBadge"></span>
</div>'''

new = '''<div class="topbar">
  <!-- Left: Branch toggle -->
  <div style="position:relative;min-width:160px;">
    <select id="branchToggle" onchange="switchBranch(this.value)" style="appearance:none;-webkit-appearance:none;background:#1F2A44;color:#E6EDF7;border:1px solid #2A3A5F;border-radius:99px;padding:7px 32px 7px 14px;font-family:inherit;font-size:0.82rem;font-weight:600;cursor:pointer;outline:none;">
      <option value="Safari">Safari</option>
      <option value="Nilai Desa Jati">Nilai Desa Jati</option>
    </select>
    <span style="position:absolute;right:10px;top:50%;transform:translateY(-50%);pointer-events:none;color:#94A3B8;font-size:0.75rem;">▾</span>
  </div>
  <!-- Centre: Title -->
  <div class="topbar-title" id="topTitle">Shift Briefing</div>
  <!-- Right: Shift badge -->
  <span id="topShiftBadge"></span>
</div>'''

if old in content:
    content = content.replace(old, new)
    print('replaced header')
else:
    print('NOT FOUND')

open('briefing.html','w').write(content)
