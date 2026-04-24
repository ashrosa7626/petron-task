content = open('index.html').read()

fn = """
<script>
function switchBranch(branch) {
  localStorage.setItem('selectedBranch', branch);
  const short = branch === 'Nilai Desa Jati' ? 'Nilai' : branch;
  document.title = short + 'Tasks';
  const headerTitle = document.getElementById('headerTitle');
  if (headerTitle) headerTitle.innerHTML = '<span style="color:#3B82F6">' + branch + '</span><span style="color:#E6EDF7;">Tasks</span>';
  if (typeof loadStaff === 'function') loadStaff();
  if (typeof initPage === 'function') initPage();
  location.reload();
}
window.addEventListener('DOMContentLoaded', function() {
  const saved = localStorage.getItem('selectedBranch') || 'Safari';
  const sel = document.getElementById('branchToggle');
  if (sel) sel.value = saved;
  const short = saved === 'Nilai Desa Jati' ? 'Nilai' : saved;
  document.title = short + 'Tasks';
  const headerTitle = document.getElementById('headerTitle');
  if (headerTitle) headerTitle.innerHTML = '<span style="color:#3B82F6">' + saved + '</span><span style="color:#E6EDF7;">Tasks</span>';
});
</script>"""

content = content.replace('</body>', fn + '\n</body>')
open('index.html','w').write(content)
print('done')
