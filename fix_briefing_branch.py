content = open('briefing.html').read()

fn = """
function switchBranch(branch) {
  localStorage.setItem('selectedBranch', branch);
  const short = branch === 'Nilai Desa Jati' ? 'Nilai' : branch;
  document.title = short + 'Briefing';
}
window.addEventListener('DOMContentLoaded', function() {
  const saved = localStorage.getItem('selectedBranch') || 'Safari';
  const sel = document.getElementById('branchToggle');
  if (sel) sel.value = saved;
});
"""

content = content.replace('// ─── SUPABASE SETUP', fn + '\n// ─── SUPABASE SETUP', 1)
open('briefing.html','w').write(content)
print('done')
