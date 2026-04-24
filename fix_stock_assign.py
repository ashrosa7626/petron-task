content = open('lead.html').read()

old = """    // Stock items — simple Gondola + Cafe sections
    const stockSections = ['Gondola', 'Cafe'];
    let stockHtml = '';
    for (const sec of stockSections) {
      const key = 'stock||' + sec;
      const items = (stockItems['s1']?.[key] || []).filter(i => i.trim());
      if (!items.length) continue;
      const assignedStaff = stockItems['__assign__']?.[key] || '';
      stockHtml += `<div class="task-assign-row">
        <div style="flex:1">
          <div class="task-assign-row__name">📦 ${sec}</div>
          <div class="task-assign-row__meta">${items.length} item(s): ${items.slice(0,3).join(', ')}${items.length>3?'…':''}</div>
        </div>
        <select onchange="setStockAssign('${key}',this.value)">
          <option value="">— Assign to —</option>
          ${allStaff.map(s=>`<option value="${s.id}" ${assignedStaff===s.id?'selected':''}>${s.name}</option>`).join('')}
        </select>
      </div>`;
    }
    if (stockHtml) {
      html += `<div style="margin-bottom:6px;font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--muted);padding:10px 0 4px">Stocks &amp; Merchandise</div>`;
      html += stockHtml;
    }"""

new = """    // Stock items — individual item assignment
    const stockSections = ['Gondola', 'Cafe'];
    let stockHtml = '';
    for (const sec of stockSections) {
      const key = 'stock||' + sec;
      const items = (stockItems['s1']?.[key] || []).filter(i => i.trim());
      if (!items.length) continue;
      stockHtml += `<div style="margin-bottom:4px;font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--p-blue,#3B82F6);padding:8px 0 2px">📦 ${sec}</div>`;
      items.forEach((item, idx) => {
        const itemKey = key + '||' + idx;
        const assigned = stockItems['__assign__']?.[itemKey] || '';
        stockHtml += `<div class="task-assign-row">
          <div style="flex:1">
            <div class="task-assign-row__name">${item}</div>
          </div>
          <select onchange="setStockAssign('${itemKey}',this.value)">
            <option value="">— Assign to —</option>
            ${allStaff.map(s=>`<option value="${s.id}" ${assigned===s.id?'selected':''}>${s.name}</option>`).join('')}
          </select>
        </div>`;
      });
    }
    if (stockHtml) {
      html += `<div style="margin-bottom:6px;font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--muted);padding:10px 0 4px">Stocks &amp; Merchandise</div>`;
      html += stockHtml;
    }"""

if old in content:
    content = content.replace(old, new)
    print('replaced step 2')
else:
    print('NOT FOUND step 2')

open('lead.html','w').write(content)
