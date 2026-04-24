content = open('index.html').read()
override = """<style>
  html, body { background: #0B0F1A; color: #E6EDF7; }
  .bg-grid { display: none; }
  .page, .wrap, .content { max-width: 100%; width: 100%; }
</style>"""
content = content.replace('</head>', override + '\n</head>')
if 'sidebar.js' not in content:
    content = content.replace('</body>', '<script src="sidebar.js"></script>\n</body>')
open('index.html','w').write(content)
print('done')
