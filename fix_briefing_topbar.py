content = open('briefing.html').read()

# Find and replace the topbar section
import re

old = '''<div class="topbar">
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

new = '''<div class="topbar" style="position:relative;display:flex;align-items:center;justify-content:space-between;">
  <!-- Left: Branch toggle (offset for sidebar button) -->
  <div style="position:relative;margin-left:52px;">
    <select id="branchToggle" onchange="switchBranch(this.value)" style="appearance:none;-webkit-appearance:none;background:#1F2A44;color:#E6EDF7;border:1px solid #2A3A5F;border-radius:99px;padding:7px 32px 7px 14px;font-family:inherit;font-size:0.82rem;font-weight:600;cursor:pointer;outline:none;">
      <option value="Safari">Safari</option>
      <option value="Nilai Desa Jati">Nilai Desa Jati</option>
    </select>
    <span style="position:absolute;right:10px;top:50%;transform:translateY(-50%);pointer-events:none;color:#94A3B8;font-size:0.75rem;">▾</span>
  </div>
  <!-- Centre: Title -->
  <div style="position:absolute;left:50%;transform:translateX(-50%);">
    <div style="font-family:Syne,sans-serif;font-size:1.1rem;font-weight:800;" id="topTitle"><span style="color:#3B82F6;">Safari</span><span style="color:#E6EDF7;">Briefing</span></div>
  </div>
  <!-- Right: Shift badge -->
  <span id="topShiftBadge"></span>
</div>'''

if old in content:
    content = content.replace(old, new)
    print('replaced')
else:
    print('NOT FOUND - trying with old dashboard link')
    old2 = '<a href="dashboard.html">← Dashboard</a>'
    if old2 in content:
        content = content.replace(old2, '')
        print('removed dashboard link')

open('briefing.html','w').write(content)
