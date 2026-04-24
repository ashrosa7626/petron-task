content = open('dashboard.html').read()
old = '<select id="branchSelect" onchange="switchBranch(this.value)"'
new = '<select id="branchSelect" onchange="switchBranch(this.value)" style="margin-left:52px;"'
if old in content:
    content = content.replace(old, new, 1)
    print('replaced')
else:
    print('NOT FOUND')
open('dashboard.html','w').write(content)
