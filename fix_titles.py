import re

# Script to inject into each page that sets the document title based on saved branch
title_script = """
<script>
(function() {
  const branch = localStorage.getItem('selectedBranch') || 'Safari';
  const short = branch === 'Nilai Desa Jati' ? 'Nilai' : branch;
  const page = document.title.replace('Petron Tasks', '').replace('–', '').replace('Petron', '').trim();
  const pageName = page || 'Tasks';
  document.title = short + pageName;
})();
</script>"""

files = {
    'index.html': 'Tasks',
    'dashboard.html': 'Dashboard',
    'briefing.html': 'Briefing',
    'lead.html': 'Lead',
    'supervisor.html': 'SignOff',
}

for f, pagename in files.items():
    try:
        content = open(f, encoding='utf-8').read()
        if 'fix_titles' not in content:
            inject = f"""
<script>
(function() {{
  const branch = localStorage.getItem('selectedBranch') || 'Safari';
  const short = branch === 'Nilai Desa Jati' ? 'Nilai' : branch;
  document.title = short + '{pagename}';
}})();
</script>"""
            content = content.replace('</head>', inject + '\n</head>', 1)
            open(f, 'w', encoding='utf-8').write(content)
            print(f'updated: {f}')
    except Exception as e:
        print(f'error {f}: {e}')

print('done')
