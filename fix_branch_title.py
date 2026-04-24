content = open('index.html').read()

old = """function switchBranch(branch) {
  localStorage.setItem('selectedBranch', branch);
  document.getElementById('branchToggle').value = branch;
  var title = document.getElementById('headerTitle');
  if (title) title.innerHTML = '<span style=\"color:#3B82F6\">' + branch + '</span><span style=\"color:#E6EDF7;\">Tasks</span>';"""

new = """function switchBranch(branch) {
  localStorage.setItem('selectedBranch', branch);
  document.getElementById('branchToggle').value = branch;
  var title = document.getElementById('headerTitle');
  if (title) title.innerHTML = '<span style=\"color:#3B82F6\">' + branch + '</span><span style=\"color:#E6EDF7;\">Tasks</span>';
  const short = branch === 'Nilai Desa Jati' ? 'Nilai' : branch;
  document.title = short + 'Tasks';"""

if old in content:
    content = content.replace(old, new)
    print('replaced')
else:
    print('NOT FOUND')

open('index.html','w').write(content)
