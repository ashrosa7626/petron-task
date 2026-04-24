import re
content = open('index.html').read()

# Find the header section and replace it entirely
old_pattern = r'<header class="header">.*?</header>'
new_header = '''<header class="header" style="position:relative;display:flex;align-items:center;justify-content:space-between;padding:0 20px;">
    <!-- Left: Branch toggle -->
    <div style="display:flex;align-items:center;min-width:200px;">
      <div style="position:relative">
        <select id="branchToggle" onchange="switchBranch(this.value)" style="appearance:none;-webkit-appearance:none;background:#1F2A44;color:#E6EDF7;border:1px solid #2A3A5F;border-radius:99px;padding:8px 36px 8px 16px;font-family:inherit;font-size:0.85rem;font-weight:600;cursor:pointer;outline:none;">
          <option value="Safari">Safari</option>
          <option value="Nilai Desa Jati">Nilai Desa Jati</option>
        </select>
        <span style="position:absolute;right:12px;top:50%;transform:translateY(-50%);pointer-events:none;color:#94A3B8;font-size:0.75rem;">▾</span>
      </div>
    </div>
    <!-- Centre: Title -->
    <div style="position:absolute;left:50%;transform:translateX(-50%);text-align:center;">
      <div style="font-family:Syne,sans-serif;font-size:1.2rem;font-weight:800;color:#E6EDF7;" id="headerTitle">Safari<span style="color:#F97316;">Tasks</span></div>
    </div>
    <!-- Right: Date & Clock -->
    <div style="display:flex;align-items:center;gap:12px;min-width:200px;justify-content:flex-end;">
      <div class="date-pill" id="dateLabel">—</div>
      <div class="clock-pill" id="clock">--:--</div>
    </div>
  </header>'''

content = re.sub(old_pattern, new_header, content, flags=re.DOTALL)
open('index.html','w').write(content)
print('done')
