content = open('index.html').read()

# Replace the root variables with dark theme
old = '''    :root {
      --ink:      #0e0e0e;
      --ink2:     #3a3a3a;
      --muted:    #888;
      --border:   #e0e0e0;
      --bg:       #f5f3ef;
      --surface:  #ffffff;
      --amber:    #e8860a;
      --amber-lt: #fef3e2;
      --amber-dk: #b56500;
      --green:    #1a9e5c;
      --green-lt: #e8f7f0;
      --radius:   16px;
      --shadow:   0 2px 16px rgba(0,0,0,0.07);
      --shadow-lg:0 8px 40px rgba(0,0,0,0.12);
    }'''

new = '''    :root {
      --ink:      #E6EDF7;
      --ink2:     #94A3B8;
      --muted:    #64748B;
      --border:   #1F2A44;
      --bg:       #0B0F1A;
      --surface:  #121826;
      --amber:    #F97316;
      --amber-lt: rgba(249,115,22,0.1);
      --amber-dk: #fbbf24;
      --green:    #22C55E;
      --green-lt: rgba(34,197,94,0.1);
      --radius:   16px;
      --shadow:   0 2px 16px rgba(0,0,0,0.3);
      --shadow-lg:0 8px 40px rgba(0,0,0,0.5);
    }'''

if old in content:
    content = content.replace(old, new)
    print('replaced root variables')
else:
    print('NOT FOUND')

open('index.html','w').write(content)
