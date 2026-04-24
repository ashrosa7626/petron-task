content = open('lead.html').read()

old = '''      <!-- Tab bar -->
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
      </div>'''

new = '''      <!-- Login form -->
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
        <button onclick="showAuthTab('signup')" style="width:100%;margin-top:10px;padding:11px;border:2px solid #E6EDF7;border-radius:10px;background:transparent;color:#E6EDF7;font-family:inherit;font-size:0.88rem;font-weight:700;cursor:pointer;transition:all 0.15s;" onmouseover="this.style.background='#E6EDF7';this.style.color='#0B0F1A'" onmouseout="this.style.background='transparent';this.style.color='#E6EDF7'">Sign Up</button>
      </div>'''

if old in content:
    content = content.replace(old, new)
    print('replaced')
else:
    print('NOT FOUND')

open('lead.html','w').write(content)
