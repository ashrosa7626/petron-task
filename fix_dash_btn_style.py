content = open('dashboard.html').read()

old = '''<select id="branchSelect" onchange="switchBranch(this.value)"
      style="margin-left:52px;padding:7px 12px;background:#1F2A44;border:1px solid #2A3A5F;border-radius:99px;color:#E6EDF7;font-family:var(--font);font-size:0.85rem;font-weight:600;outline:none;cursor:pointer;min-width:150px">'''

new = '''<select id="branchSelect" onchange="switchBranch(this.value)"
      style="margin-left:52px;appearance:none;-webkit-appearance:none;background:#1F2A44;color:#E6EDF7;border:1px solid #2A3A5F;border-radius:99px;padding:7px 32px 7px 14px;font-family:inherit;font-size:0.82rem;font-weight:600;cursor:pointer;outline:none;">'''

if old in content:
    content = content.replace(old, new, 1)
    print('replaced')
else:
    print('NOT FOUND')

open('dashboard.html','w').write(content)
