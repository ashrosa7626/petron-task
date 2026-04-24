content = open('supervisor.html').read()

old = '''</div>
    <div id="supNav" style="display:none;gap:12px;align-items:center" class="flex">
      <span class="text-sm text-muted" id="supName"></span>
      <button class="btn btn--ghost btn--sm" onclick="logout()">Logout</button>
    </div>
  </div>'''

new = '''  <div id="supNav" style="display:flex;gap:12px;align-items:center;min-width:160px;justify-content:flex-end;">
    <button class="btn btn--ghost btn--sm" onclick="logout()">Logout</button>
  </div>
</div>'''

if old in content:
    content = content.replace(old, new)
    print('replaced')
else:
    print('NOT FOUND')

open('supervisor.html','w').write(content)
