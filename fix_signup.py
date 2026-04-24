content = open('lead.html').read()

old = '''<div class="content" id="loginView">
    <div class="login-wrap">
      <div class="login-title">Team Lead Login</div>
      <div class="login-sub">Enter your credentials to manage today's tasks.</div>
      <div class="field"><label>Branch</label>
        <select id="branchSelect">
          <option value="">Select branch...</option>
          <option value="Safari">Safari</option>
          <option value="Nilai Desa Jati">Nilai Desa Jati</option>
        </select>
      </div>
      <div class="field"><label>Email</label><input type="email" id="email" placeholder="lead@petron.com"></div>
      <div class="field"><label>Password</label><input type="password" id="password" placeholder="••••••••"></div>
      <div style="color:var(--danger);font-size:0.85rem;min-height:20px;margin-bottom:12px" id="loginError"></div>
      <button class="btn btn--primary btn--full" id="loginBtn" onclick="doLogin()">Login</button>
    </div>
  </div>'''

new = '''<div class="content" id="loginView">
    <div class="login-wrap">
      <!-- Tab bar -->
      <div style="display:flex;gap:4px;background:#1F2A44;border:1px solid #2A3A5F;border-radius:99px;padding:4px;margin-bottom:24px;">
        <button id="tabLogin" onclick="showAuthTab('login')" style="flex:1;padding:8px;border:none;border-radius:99px;font-family:inherit;font-size:0.88rem;font-weight:600;cursor:pointer;background:linear-gradient(135deg,#F97316,#fbbf24);color:#0B0F1A;transition:all 0.15s;">Login</button>
        <button id="tabSignup" onclick="showAuthTab('signup')" style="flex:1;padding:8px;border:none;border-radius:99px;font-family:inherit;font-size:0.88rem;font-weight:600;cursor:pointer;background:transparent;color:#94A3B8;transition:all 0.15s;">Sign Up</button>
      </div>

      <!-- Login form -->
      <div id="loginForm">
        <div class="login-title">Team Lead Login</div>
        <div class="login-sub">Enter your credentials to manage today\'s tasks.</div>
        <div class="field"><label>Branch</label>
          <select id="branchSelect">
            <option value="">Select branch...</option>
            <option value="Safari">Safari</option>
            <option value="Nilai Desa Jati">Nilai Desa Jati</option>
          </select>
        </div>
        <div class="field"><label>Email</label><input type="email" id="email" placeholder="lead@petron.com"></div>
        <div class="field"><label>Password</label><input type="password" id="password" placeholder="••••••••"></div>
        <div style="color:var(--danger);font-size:0.85rem;min-height:20px;margin-bottom:12px" id="loginError"></div>
        <button class="btn btn--primary btn--full" id="loginBtn" onclick="doLogin()">Login</button>
      </div>

      <!-- Sign up form -->
      <div id="signupForm" style="display:none">
        <div class="login-title">Create Lead Account</div>
        <div class="login-sub">Register a new Team Lead account.</div>
        <div class="field"><label>Full Name</label><input type="text" id="signupName" placeholder="e.g. Ahmad Syafiq"></div>
        <div class="field"><label>Branch</label>
          <select id="signupBranch">
            <option value="">Select branch...</option>
            <option value="Safari">Safari</option>
            <option value="Nilai Desa Jati">Nilai Desa Jati</option>
          </select>
        </div>
        <div class="field"><label>Email</label><input type="email" id="signupEmail" placeholder="lead@petron.com"></div>
        <div class="field"><label>Password</label><input type="password" id="signupPassword" placeholder="Min 6 characters"></div>
        <div class="field"><label>Confirm Password</label><input type="password" id="signupConfirm" placeholder="Repeat password"></div>
        <div style="color:var(--danger);font-size:0.85rem;min-height:20px;margin-bottom:12px" id="signupError"></div>
        <button class="btn btn--primary btn--full" id="signupBtn" onclick="doSignup()">Create Account</button>
      </div>
    </div>
  </div>'''

if old in content:
    content = content.replace(old, new)
    print('replaced login section')
else:
    print('NOT FOUND')

open('lead.html','w').write(content)
