content = open('index.html').read()

old = """  if (typeof loadStaff === 'function') loadStaff();
  if (typeof initPage === 'function') initPage();
  location.reload();
}"""

new = """  if (typeof loadStaff === 'function') loadStaff();
  if (typeof init === 'function') init();
}"""

if old in content:
    content = content.replace(old, new)
    print('replaced')
else:
    print('NOT FOUND')

open('index.html','w').write(content)
