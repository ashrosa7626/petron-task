import re

files = ['briefing.html', 'dashboard.html', 'index.html', 'lead.html', 'supervisor.html', 'sidebar.js']

emoji_pattern = re.compile("["
    u"\U0001F600-\U0001F64F"
    u"\U0001F300-\U0001F5FF"
    u"\U0001F680-\U0001F9FF"
    u"\U0001F1E0-\U0001F1FF"
    u"\U00002600-\U000027BF"
    u"\U0001FA00-\U0001FA6F"
    u"\U0001FA70-\U0001FAFF"
    u"\U00002702-\U000027B0"
    u"\u23cf\u23e9\u231a\u23f0\u23f3"
    u"\u26aa\u26ab\u26bd\u26be"
    u"\u2614\u2615\u2648-\u2653"
    u"\u26f2\u26f3\u26f5\u26aa\u26ab"
    u"\u2702\u2705\u2708-\u270d\u270f"
    "]+", flags=re.UNICODE)

for f in files:
    try:
        content = open(f, encoding='utf-8').read()
        cleaned = emoji_pattern.sub('', content)
        open(f, 'w', encoding='utf-8').write(cleaned)
        print(f'cleaned: {f}')
    except Exception as e:
        print(f'error {f}: {e}')
