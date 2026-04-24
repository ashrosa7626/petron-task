content = open('supervisor.html').read()

old = """    if (!user || !['supervisor', 'lead'].includes(user.role)) {
      await db.auth.signOut();
      document.getElementById('loginError').textContent = 'Access denied. Supervisor accounts only.';
      return;
    }"""

new = """    if (!user) {
      await db.auth.signOut();
      document.getElementById('loginError').textContent = 'Account not found in system. Contact admin.';
      setLoading(btn, false);
      return;
    }
    if (!['supervisor', 'lead'].includes(user.role)) {
      await db.auth.signOut();
      document.getElementById('loginError').textContent = 'Access denied. Role: ' + user.role;
      setLoading(btn, false);
      return;
    }"""

if old in content:
    content = content.replace(old, new, 1)
    print('replaced')
else:
    print('NOT FOUND')

open('supervisor.html','w').write(content)
