content = open('briefing.html').read()

# 1. Save briefing with branch
old = """  await dbSet('briefing:' + ts, data);"""
new = """  data.branch = localStorage.getItem('selectedBranch') || 'Safari';
  await dbSet('briefing:' + ts, data);"""

if old in content:
    content = content.replace(old, new, 1)
    print('save fixed')
else:
    print('save NOT FOUND')

# 2. Filter dashboard by branch
old2 = """  const filtered = dbFilter === 'All' ? briefings : briefings.filter(b => b.shift === dbFilter);"""
new2 = """  const currentBranch = localStorage.getItem('selectedBranch') || 'Safari';
  const branchFiltered = briefings.filter(b => !b.branch || b.branch === currentBranch);
  const filtered = dbFilter === 'All' ? branchFiltered : branchFiltered.filter(b => b.shift === dbFilter);"""

if old2 in content:
    content = content.replace(old2, new2, 1)
    print('filter fixed')
else:
    print('filter NOT FOUND')

# 3. Also filter carried issues by branch
old3 = """  const issueMap = {};
  const sorted = [...keys].sort((a,b) => b.localeCompare(a));
  for (const key of sorted) {
    const b = await dbGet(key);
    if (!b) continue;"""
new3 = """  const issueMap = {};
  const currentBranch = localStorage.getItem('selectedBranch') || 'Safari';
  const sorted = [...keys].sort((a,b) => b.localeCompare(a));
  for (const key of sorted) {
    const b = await dbGet(key);
    if (!b) continue;
    if (b.branch && b.branch !== currentBranch) continue;"""

if old3 in content:
    content = content.replace(old3, new3, 1)
    print('carried issues fixed')
else:
    print('carried issues NOT FOUND')

open('briefing.html','w').write(content)
