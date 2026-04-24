content = open('briefing.html').read()

old = """function switchBranch(branch) {
  localStorage.setItem('selectedBranch', branch);
  const short = branch === 'Nilai Desa Jati' ? 'Nilai' : branch;
  document.title = short + 'Briefing';
}
window.addEventListener('DOMContentLoaded', function() {
  const saved = localStorage.getItem('selectedBranch') || 'Safari';
  const sel = document.getElementById('branchToggle');
  if (sel) sel.value = saved;
});"""

new = """function switchBranch(branch) {
  localStorage.setItem('selectedBranch', branch);
  const short = branch === 'Nilai Desa Jati' ? 'Nilai' : branch;
  document.title = short + 'Briefing';
  const topTitle = document.getElementById('topTitle');
  if (topTitle) topTitle.innerHTML = '<span style="color:#3B82F6;">' + branch + '</span><span style="color:#E6EDF7;">Briefing</span>';
}
window.addEventListener('DOMContentLoaded', function() {
  const saved = localStorage.getItem('selectedBranch') || 'Safari';
  const sel = document.getElementById('branchToggle');
  if (sel) sel.value = saved;
  const short = saved === 'Nilai Desa Jati' ? 'Nilai' : saved;
  document.title = short + 'Briefing';
  const topTitle = document.getElementById('topTitle');
  if (topTitle) topTitle.innerHTML = '<span style="color:#3B82F6;">' + saved + '</span><span style="color:#E6EDF7;">Briefing</span>';
});"""

if old in content:
    content = content.replace(old, new)
    print('replaced')
else:
    print('NOT FOUND')

open('briefing.html','w').write(content)
