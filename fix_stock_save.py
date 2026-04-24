content = open('lead.html').read()

old = """    // 3. Stock items — Gondola + Cafe
    for (const [key, staffId] of Object.entries(stockItems['__assign__'] || {})) {
      if (!staffId) continue;
      const section = key.split('||')[1] || key;
      const items   = stockItems['s1']?.[key] || [];
      for (const item of items) {
        const trimmed = item.trim();
        if (!trimmed) continue;
        rows.push({
          date: today(), staff_id: staffId, is_adhoc: true,
          custom_task_name: `TOPUP:Stocks:${section}:${trimmed}`,
          photo_required: false, created_by: currentUser?.id, branch
        });
      }
    }"""

new = """    // 3. Stock items — individual item assignments
    const stockSections2 = ['Gondola', 'Cafe'];
    for (const sec of stockSections2) {
      const key = 'stock||' + sec;
      const items = (stockItems['s1']?.[key] || []).filter(i => i.trim());
      items.forEach((item, idx) => {
        const itemKey = key + '||' + idx;
        const staffId = stockItems['__assign__']?.[itemKey] || '';
        if (!staffId) return;
        rows.push({
          date: today(), staff_id: staffId, is_adhoc: true,
          custom_task_name: `TOPUP:Stocks:${sec}:${item.trim()}`,
          photo_required: false, created_by: currentUser?.id, branch
        });
      });
    }"""

if old in content:
    content = content.replace(old, new)
    print('replaced save')
else:
    print('NOT FOUND save')

open('lead.html','w').write(content)
