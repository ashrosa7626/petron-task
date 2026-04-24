content = open('index.html').read()

old = """    const { data: assignments, error } = await db
      .from('daily_assignments')
      .select(`id, staff_id, users(id, name), completions(id)`)
      .eq('date', today());"""

new = """    const currentBranch = localStorage.getItem('selectedBranch') || 'Safari';
    const { data: assignments, error } = await db
      .from('daily_assignments')
      .select(`id, staff_id, users(id, name), completions(id)`)
      .eq('date', today())
      .eq('branch', currentBranch);"""

if old in content:
    content = content.replace(old, new)
    print('replaced loadStaff')
else:
    print('NOT FOUND')

open('index.html','w').write(content)
