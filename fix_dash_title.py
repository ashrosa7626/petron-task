content = open('dashboard.html').read()

# Fix the title style and make it dynamic like index
old = '''      <div style="position:absolute;left:50%;transform:translateX(-50%);text-align:center;pointer-events:none">
      <div style="font-size:1.5rem;font-weight:800;letter-spacing:-0.5px" id="dashTitle">Safari Dashboard</div>
    </div>'''

new = '''      <div style="position:absolute;left:50%;transform:translateX(-50%);text-align:center;pointer-events:none">
      <div style="font-family:Syne,sans-serif;font-size:1.2rem;font-weight:800;" id="dashTitle"><span style="color:#3B82F6;">Safari</span><span style="color:#E6EDF7;">Dashboard</span></div>
    </div>'''

if old in content:
    content = content.replace(old, new, 1)
    print('title replaced')
else:
    print('NOT FOUND')

# Fix switchBranch to update title with blue/white style
old2 = "document.getElementById('dashTitle').textContent = branch + ' Dashboard';"
new2 = "document.getElementById('dashTitle').innerHTML = '<span style=\"color:#3B82F6\">' + branch + '</span><span style=\"color:#E6EDF7;\">Dashboard</span>';"

if old2 in content:
    content = content.replace(old2, new2, 1)
    print('switchBranch fixed')
else:
    print('switchBranch NOT FOUND')

open('dashboard.html','w').write(content)
