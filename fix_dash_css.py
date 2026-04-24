content = open('dashboard.html').read()
old = '    #dashTitle { color:var(--p-text) !important; font-size:1.4rem !important; }'
new = '    #dashTitle { }'
if old in content:
    content = content.replace(old, new, 1)
    print('replaced')
else:
    print('NOT FOUND')
open('dashboard.html','w').write(content)
