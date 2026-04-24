import re

# Fix lead.html
content = open('lead.html').read()

old = '''<div class="topbar__logo">Petron<span> Lead</span></div>
    <div style="font-size:0.82rem;font-weight:700;color:var(--accent)" id="leadBranchLabel"></div>
    <div id="leadNav" style="display:none;gap:12px;align-items:center" class="flex">
      <a href="dashboard.html" class="nav-link">Dashboard</a>
      <button class="btn btn--ghost btn--sm" onclick="logout()">Logout</button>
    </div>'''

new = '''    <!-- Left: Branch toggle -->
    <div style="position:relative;margin-left:52px;">
      <select id="branchToggle" onchange="switchBranchLead(this.value)" style="appearance:none;-webkit-appearance:none;background:#1F2A44;color:#E6EDF7;border:1px solid #2A3A5F;border-radius:99px;padding:7px 32px 7px 14px;font-family:inherit;font-size:0.82rem;font-weight:600;cursor:pointer;outline:none;">
        <option value="Safari">Safari</option>
        <option value="Nilai Desa Jati">Nilai Desa Jati</option>
      </select>
      <span style="position:absolute;right:10px;top:50%;transform:translateY(-50%);pointer-events:none;color:#94A3B8;font-size:0.75rem;">▾</span>
    </div>
    <!-- Centre: Title -->
    <div style="position:absolute;left:50%;transform:translateX(-50%);">
      <div style="font-family:Syne,sans-serif;font-size:1.1rem;font-weight:800;" id="leadTitle"><span style="color:#3B82F6;">Safari</span><span style="color:#E6EDF7;">Lead</span></div>
    </div>
    <!-- Right: Nav -->
    <div id="leadNav" style="display:none;gap:12px;align-items:center" class="flex">
      <button class="btn btn--ghost btn--sm" onclick="logout()">Logout</button>
    </div>'''

if old in content:
    content = content.replace(old, new)
    print('lead header replaced')
else:
    print('lead header NOT FOUND')

# Add switchBranchLead function
fn = """
function switchBranchLead(branch) {
  localStorage.setItem('selectedBranch', branch);
  const short = branch === 'Nilai Desa Jati' ? 'Nilai' : branch;
  document.title = short + 'Lead';
  const t = document.getElementById('leadTitle');
  if (t) t.innerHTML = '<span style="color:#3B82F6;">' + branch + '</span><span style="color:#E6EDF7;">Lead</span>';
}
window.addEventListener('DOMContentLoaded', function() {
  const saved = localStorage.getItem('selectedBranch') || 'Safari';
  const sel = document.getElementById('branchToggle');
  if (sel) sel.value = saved;
  const short = saved === 'Nilai Desa Jati' ? 'Nilai' : saved;
  document.title = short + 'Lead';
  const t = document.getElementById('leadTitle');
  if (t) t.innerHTML = '<span style="color:#3B82F6;">' + saved + '</span><span style="color:#E6EDF7;">Lead</span>';
});
"""

content = content.replace('  let currentUser    = null;', fn + '\n  let currentUser    = null;', 1)
open('lead.html','w').write(content)
print('lead done')

# Fix supervisor.html
content = open('supervisor.html').read()

# Find the topbar in supervisor
old_sup = re.search(r'<div class="topbar".*?</div>', content, re.DOTALL)
if old_sup:
    print('supervisor topbar found at:', old_sup.start())

# Add branch toggle to supervisor topbar
old2 = '<div class="topbar"'
new_topbar = '''<div class="topbar" style="position:relative;display:flex;align-items:center;justify-content:space-between;">
  <div style="position:relative;margin-left:52px;">
    <select id="branchToggle" onchange="switchBranchSup(this.value)" style="appearance:none;-webkit-appearance:none;background:#1F2A44;color:#E6EDF7;border:1px solid #2A3A5F;border-radius:99px;padding:7px 32px 7px 14px;font-family:inherit;font-size:0.82rem;font-weight:600;cursor:pointer;outline:none;">
      <option value="Safari">Safari</option>
      <option value="Nilai Desa Jati">Nilai Desa Jati</option>
    </select>
    <span style="position:absolute;right:10px;top:50%;transform:translateY(-50%);pointer-events:none;color:#94A3B8;font-size:0.75rem;">▾</span>
  </div>
  <div style="position:absolute;left:50%;transform:translateX(-50%);">
    <div style="font-family:Syne,sans-serif;font-size:1.1rem;font-weight:800;" id="supTitle"><span style="color:#3B82F6;">Safari</span><span style="color:#E6EDF7;">SignOff</span></div>
  </div>
  <div style="min-width:160px;"></div>
REPLACE_OLD_TOPBAR_CONTENT'''

# Find the existing topbar content and replace
topbar_match = re.search(r'<div class="topbar"[^>]*>(.*?)</div>\s*\n', content, re.DOTALL)
if topbar_match:
    old_topbar = topbar_match.group(0)
    new_t = '''<div class="topbar" style="position:relative;display:flex;align-items:center;justify-content:space-between;padding:0 20px;">
  <div style="position:relative;margin-left:52px;">
    <select id="branchToggle" onchange="switchBranchSup(this.value)" style="appearance:none;-webkit-appearance:none;background:#1F2A44;color:#E6EDF7;border:1px solid #2A3A5F;border-radius:99px;padding:7px 32px 7px 14px;font-family:inherit;font-size:0.82rem;font-weight:600;cursor:pointer;outline:none;">
      <option value="Safari">Safari</option>
      <option value="Nilai Desa Jati">Nilai Desa Jati</option>
    </select>
    <span style="position:absolute;right:10px;top:50%;transform:translateY(-50%);pointer-events:none;color:#94A3B8;font-size:0.75rem;">▾</span>
  </div>
  <div style="position:absolute;left:50%;transform:translateX(-50%);">
    <div style="font-family:Syne,sans-serif;font-size:1.1rem;font-weight:800;" id="supTitle"><span style="color:#3B82F6;">Safari</span><span style="color:#E6EDF7;">SignOff</span></div>
  </div>
  <div style="min-width:160px;"></div>
</div>
'''
    content = content.replace(old_topbar, new_t, 1)
    print('supervisor topbar replaced')
else:
    print('supervisor topbar NOT FOUND')

fn2 = """
function switchBranchSup(branch) {
  localStorage.setItem('selectedBranch', branch);
  const short = branch === 'Nilai Desa Jati' ? 'Nilai' : branch;
  document.title = short + 'SignOff';
  const t = document.getElementById('supTitle');
  if (t) t.innerHTML = '<span style="color:#3B82F6;">' + branch + '</span><span style="color:#E6EDF7;">SignOff</span>';
  if (typeof loadCompletions === 'function') loadCompletions();
}
window.addEventListener('DOMContentLoaded', function() {
  const saved = localStorage.getItem('selectedBranch') || 'Safari';
  const sel = document.getElementById('branchToggle');
  if (sel) sel.value = saved;
  const short = saved === 'Nilai Desa Jati' ? 'Nilai' : saved;
  document.title = short + 'SignOff';
  const t = document.getElementById('supTitle');
  if (t) t.innerHTML = '<span style="color:#3B82F6;">' + saved + '</span><span style="color:#E6EDF7;">SignOff</span>';
});
"""

content = content.replace('</script>', fn2 + '\n</script>', 1)
open('supervisor.html','w').write(content)
print('supervisor done')
