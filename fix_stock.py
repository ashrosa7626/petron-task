content = open('lead.html').read()

old = """      html += `<div class="task-select-group">
        <div class="ac-cat-header" onclick="togAc('s1ac-${cat.id}','s1acc-${cat.id}')">
          <span class="ac-cat-name">${cat.name}</span>
          <span class="ac-chev" id="s1acc-${cat.id}">▼</span>
        </div>
        <div class="ac-cat-body" id="s1ac-${cat.id}">${subcatHtml}</div>
      </div>`;"""

new = """      if (!cat.name || !cat.name.toLowerCase().includes('stock')) {
        html += `<div class="task-select-group">
          <div class="ac-cat-header" onclick="togAc('s1ac-${cat.id}','s1acc-${cat.id}')">
            <span class="ac-cat-name">${cat.name}</span>
            <span class="ac-chev" id="s1acc-${cat.id}">▼</span>
          </div>
          <div class="ac-cat-body" id="s1ac-${cat.id}">${subcatHtml}</div>
        </div>`;
      }"""

if old in content:
    content = content.replace(old, new)
    print('replaced')
else:
    print('NOT FOUND')
    
open('lead.html','w').write(content)
