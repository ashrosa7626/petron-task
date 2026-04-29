const SUPABASE_URL = 'https://vwffiuciogthfzekkkkz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ3ZmZpdWNpb2d0aGZ6ZWtra2t6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NzcwMTAsImV4cCI6MjA5MTQ1MzAxMH0.OTEyOMn1fmUNV7pR51KMOLsMTNAfytt62uGS_AkQXyw';

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function today() {
  // Use Malaysia time (UTC+8). The operational day starts at 7am MYT,
  // so before 7am we return the previous date (night shift belongs to yesterday).
  const myt = new Date(Date.now() + 8 * 60 * 60 * 1000); // shift to MYT
  if (myt.getUTCHours() < 7) myt.setUTCDate(myt.getUTCDate() - 1);
  const y = myt.getUTCFullYear();
  const m = String(myt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(myt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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
