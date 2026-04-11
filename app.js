const SUPABASE_URL = 'https://vwffiuciogthfzekkkkz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ3ZmZpdWNpb2d0aGZ6ZWtra2t6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NzcwMTAsImV4cCI6MjA5MTQ1MzAxMH0.OTEyOMn1fmUNV7pR51KMOLsMTNAfytt62uGS_AkQXyw';

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function today() {
  return new Date().toISOString().split('T')[0];
}

function formatTime(isoString) {
  if (!isoString) return '';
  return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = `toast toast--${type} toast--show`;
  setTimeout(() => t.classList.remove('toast--show'), 3000);
}

function setLoading(btnEl, loading) {
  if (!btnEl) return;
  btnEl.disabled = loading;
  btnEl.style.opacity = loading ? '0.6' : '1';
}
