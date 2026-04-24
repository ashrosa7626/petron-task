content = open('lead.html').read()

fn = '''
  function showAuthTab(tab) {
    const isLogin = tab === 'login';
    document.getElementById('loginForm').style.display = isLogin ? '' : 'none';
    document.getElementById('signupForm').style.display = isLogin ? 'none' : '';
    document.getElementById('tabLogin').style.background = isLogin ? 'linear-gradient(135deg,#F97316,#fbbf24)' : 'transparent';
    document.getElementById('tabLogin').style.color = isLogin ? '#0B0F1A' : '#94A3B8';
    document.getElementById('tabSignup').style.background = isLogin ? 'transparent' : 'linear-gradient(135deg,#F97316,#fbbf24)';
    document.getElementById('tabSignup').style.color = isLogin ? '#94A3B8' : '#0B0F1A';
  }

  async function doSignup() {
    const name     = document.getElementById('signupName').value.trim();
    const branch   = document.getElementById('signupBranch').value;
    const email    = document.getElementById('signupEmail').value.trim();
    const password = document.getElementById('signupPassword').value;
    const confirm  = document.getElementById('signupConfirm').value;
    const errEl    = document.getElementById('signupError');
    const btn      = document.getElementById('signupBtn');
    errEl.textContent = '';
    if (!name)            { errEl.textContent = 'Please enter your name.'; return; }
    if (!branch)          { errEl.textContent = 'Please select a branch.'; return; }
    if (!email)           { errEl.textContent = 'Please enter your email.'; return; }
    if (password.length < 6) { errEl.textContent = 'Password must be at least 6 characters.'; return; }
    if (password !== confirm) { errEl.textContent = 'Passwords do not match.'; return; }
    setLoading(btn, true);
    const { data, error } = await db.auth.signUp({ email, password });
    if (error) { errEl.textContent = error.message; setLoading(btn, false); return; }
    if (data.user) {
      await db.from('users').insert({ auth_id: data.user.id, name, role: 'lead', branch });
    }
    setLoading(btn, false);
    errEl.style.color = 'var(--success, #22C55E)';
    errEl.textContent = 'Account created! You can now log in.';
    setTimeout(() => showAuthTab('login'), 2000);
  }
'''

content = content.replace('  async function doLogin() {', fn + '\n  async function doLogin() {', 1)
open('lead.html','w').write(content)
print('done')
