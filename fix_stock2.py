content = open('lead.html').read()

old = """    for (const cat of tree) {
      const isStock = cat.name?.toLowerCase().includes('stock');
      const catTasks = getAllCatTasks(cat);
      const catChecked = catTasks.length > 0 && catTasks.every(t => selectedTaskIds.has(t.id));
      let subcatHtml = '';
      for (const sub of cat.subcats) {
        const subTasks = getAllSubTasks(sub);
        let subContent = '';
        if (isStock) {
          // Skip — stock rendered separately below"""

new = """    for (const cat of tree) {
      const isStock = cat.name && cat.name.toLowerCase().includes('stock');
      if (isStock) continue; // Skip — stock rendered separately below
      const catTasks = getAllCatTasks(cat);
      const catChecked = catTasks.length > 0 && catTasks.every(t => selectedTaskIds.has(t.id));
      let subcatHtml = '';
      for (const sub of cat.subcats) {
        const subTasks = getAllSubTasks(sub);
        let subContent = '';
        if (false) {
          // Skip — stock rendered separately below"""

if old in content:
    content = content.replace(old, new)
    print('replaced')
else:
    print('NOT FOUND')

open('lead.html','w').write(content)
