content = open('lead.html').read()

old = "    for (const cat of tree) {\n      const isStock = cat.name?.toLowerCase().includes('stock');"
new = "    for (const cat of tree) {\n      const isStock = cat.name && cat.name.toLowerCase().includes('stock');\n      if (isStock) continue;"

if old in content:
    content = content.replace(old, new, 1)
    print('replaced')
else:
    print('NOT FOUND')

open('lead.html','w').write(content)
