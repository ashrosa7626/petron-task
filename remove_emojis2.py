import re

files = ['briefing.html', 'dashboard.html', 'index.html', 'lead.html', 'supervisor.html', 'sidebar.js']

# More comprehensive emoji pattern
emoji_pattern = re.compile(
    u"[\U00010000-\U0010FFFF"
    u"\u2600-\u27BF"
    u"\u2B00-\u2BFF"
    u"\u2300-\u23FF"
    u"\u2700-\u27BF"
    u"\uFE00-\uFE0F"
    u"\u200d"
    u"]+",
    flags=re.UNICODE
)

for f in files:
    try:
        content = open(f, encoding='utf-8').read()
        cleaned = emoji_pattern.sub('', content)
        open(f, 'w', encoding='utf-8').write(cleaned)
        print(f'cleaned: {f}')
    except Exception as e:
        print(f'error {f}: {e}')

print('all done')
