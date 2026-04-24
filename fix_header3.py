content = open('index.html').read()

# Fix header height
content = content.replace(
    '.header {',
    '.header { height:60px; padding: 0 24px;'
)

# Fix branch toggle position - add margin left to avoid sidebar button
content = content.replace(
    '<div style="display:flex;align-items:center;min-width:200px;">',
    '<div style="display:flex;align-items:center;min-width:200px;margin-left:52px;">'
)

# Fix title colors - Safari blue, Tasks white
content = content.replace(
    'Safari<span style="color:#F97316;">Tasks</span>',
    '<span style="color:#3B82F6;">Safari</span><span style="color:#E6EDF7;">Tasks</span>'
)

# Fix switchBranch to update title with blue branch name
content = content.replace(
    "title.innerHTML = branch + '<span>Tasks</span>';",
    "title.innerHTML = '<span style=\"color:#3B82F6\">' + branch + '</span><span style=\"color:#E6EDF7;\">Tasks</span>';"
)
content = content.replace(
    "title.innerHTML = saved + '<span>Tasks</span>';",
    "title.innerHTML = '<span style=\"color:#3B82F6\">' + saved + '</span><span style=\"color:#E6EDF7;\">Tasks</span>';"
)

# Fix "today" color from orange to white
content = content.replace(
    'tasks <em>today?</em>',
    'tasks <em style="color:#E6EDF7;">today?</em>'
)

open('index.html','w').write(content)
print('done')
