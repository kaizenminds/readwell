"""Builds app/index.html from backend/Index.html.

The reader UI is written once (backend/Index.html). The installable app is the same UI with:
- a fetch transport to the user's own backend instead of google.script.run
- a connect screen and one-tap connect links
- PWA bits: manifest, icons, service worker
- app-only settings (daily scan time, disconnect)
Run from the repo root: python3 tools/build_app.py
"""
import re, pathlib

SRC = pathlib.Path('backend/Index.html')
OUT = pathlib.Path('app/index.html')
v = SRC.read_text()

def rep(a, b):
    global v
    n = v.count(a)
    assert n == 1, 'anchor found %d times: %r' % (n, a[:80])
    v = v.replace(a, b)

# --- head: charset first, then PWA metadata
rep('<html>\n<head>\n', '<html lang="en">\n<head>\n<meta charset="utf-8">\n')
rep('<meta name="theme-color" content="#0e1014">', '''<meta name="theme-color" content="#0e1014">
<title>Readwell</title>
<meta name="description" content="A calm reader for your email newsletters. Runs in your own Google account.">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" type="image/png" href="icons/icon-192.png">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Readwell">''')

# --- connect screen styles
rep('a.btn{text-decoration:none;display:inline-block}', '''a.btn{text-decoration:none;display:inline-block}
.connect{position:fixed;inset:0;z-index:90;background:var(--bg);display:none;align-items:center;justify-content:center;padding:24px 16px;overflow:auto}
body.need-connect .connect{display:flex}
body.need-connect .shell,body.need-connect .tabbar{visibility:hidden}
.cbox{width:420px;max-width:100%;text-align:center}
.cbox .mark{width:64px;height:64px;border-radius:18px;margin:0 auto 18px}
.cbox .mark svg{width:32px;height:32px}
.cbox h1{margin:0 0 6px;font-size:28px;letter-spacing:-.03em}
.cbox .tag{color:var(--muted);margin:0 0 26px}
.cbox .wide{display:block;width:100%;text-align:center;padding:12px 16px;font-size:15px}
.cmsg{display:none;margin:0 0 16px;padding:10px 12px;border-radius:10px;background:var(--accent-bg);color:var(--accent2);font-size:13px;text-align:left}
.cbox details{margin-top:18px;text-align:left;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 14px}
.cbox summary{cursor:pointer;color:var(--ink2);font-weight:500}
.cbox label{display:block;font-size:12px;color:var(--muted);margin:12px 0 0}
.cbox label input{display:block;width:100%;margin-top:4px;padding:9px 11px;border-radius:9px;border:1px solid var(--line2);background:var(--bg);outline:none}
.cbox label input:focus{border-color:var(--accent)}
.cbox details .btn{margin-top:14px}
.cfoot{margin-top:22px;font-size:12px;color:var(--faint)}
.hoursel{padding:6px 10px;border-radius:8px;border:1px solid var(--line2);background:var(--bg);color:var(--ink)}''')

# --- brand
rep('<span>Reader</span></div>', '<span>Readwell</span></div>')

# --- connect screen markup
rep('<div id="toast"></div>', '''<div id="toast"></div>
<div class="connect" id="connect"><div class="cbox">
  <div class="mark"><svg viewBox="0 0 24 24"><path d="M7 4h10v16l-5-4-5 4z"/></svg></div>
  <h1>Readwell</h1>
  <p class="tag">A calm place to read your newsletters. It runs inside your own Google account, so your mail never leaves it.</p>
  <div class="cmsg" id="cmsg"></div>
  <a class="btn primary wide" href="setup.html">Set up Readwell (about 5 minutes)</a>
  <details id="cmanual"><summary>I already set it up</summary>
    <label>Backend link<input id="curl" placeholder="https://script.google.com/macros/s/.../exec" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
    <label>Key<input id="ckey" placeholder="64 letters and numbers" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
    <button class="btn primary wide" id="cbtn">Connect</button>
  </details>
  <div class="cfoot">Tip: the Open Readwell button in your Readwell email fills this in for you.</div>
</div></div>''')

# --- transport: fetch to the user's backend
rep('''function call(showBar, fn, args) {
  if (showBar) { S.pending++; $('#bar').classList.add('on'); }
  return new Promise((res, rej) => {
    const done = () => { if (showBar && --S.pending <= 0) { S.pending = 0; $('#bar').classList.remove('on'); } };
    google.script.run
      .withSuccessHandler(r => { done(); res(r); })
      .withFailureHandler(e => { done(); toast('Something went wrong: ' + ((e && e.message) || e)); rej(e); })[fn](...args);
  });
}''', '''/* ---------- Connection to the user's own backend ---------- */
const CONN = 'rw_conn';
function getConn() { try { return JSON.parse(localStorage.getItem(CONN) || 'null'); } catch (e) { return null; } }
function setConn(c) { try { if (c) localStorage.setItem(CONN, JSON.stringify(c)); else localStorage.removeItem(CONN); } catch (e) {} }
async function rawCall(conn, fn, args) {
  let r;
  try {
    r = await fetch(conn.url, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ key: conn.key, fn: fn, args: args || [] }) });
  } catch (e) { const err = new Error(navigator.onLine === false ? 'You are offline' : 'Could not reach your backend'); err.code = 'Network'; throw err; }
  let j;
  try { j = await r.json(); } catch (e) { const err = new Error('Your backend did not answer'); err.code = 'BadReply'; throw err; }
  if (!j.ok) { const err = new Error(j.error || 'Request failed'); err.code = j.error; throw err; }
  return j.result;
}
function call(showBar, fn, args) {
  const conn = getConn();
  if (!conn) { showConnect(); return Promise.reject(new Error('Not connected')); }
  if (showBar) { S.pending++; $('#bar').classList.add('on'); }
  const done = () => { if (showBar && --S.pending <= 0) { S.pending = 0; $('#bar').classList.remove('on'); } };
  return rawCall(conn, fn, args).then(r => { done(); return r; }, e => {
    done();
    if (e.code === 'Unauthorized') showConnect('This device\\u2019s key no longer works. Tap the button in your newest Readwell email.');
    else toast(e.code === 'Network' || e.code === 'BadReply' ? e.message : 'Something went wrong: ' + e.message);
    throw e;
  });
}''')

# --- settings: schedule picker instead of fixed IST text
rep("""  const st = S.settings || { autoClean: true, cleanDays: 5, scanHour: 7 };""",
"""  const st = S.settings || { autoClean: false, cleanDays: 5, scanHour: 7 };
  const hours = Array.from({ length: 24 }, (_, h) => '<option value="' + h + '"' + (h === st.scanHour ? ' selected' : '') + '>' +
    (h % 12 || 12) + ':00 ' + (h < 12 ? 'AM' : 'PM') + '</option>').join('');""")
rep("""    '<div class="card"><h4>' + ico('refresh') + 'Daily scan</h4><p class="hint">Runs every day at ' + st.scanHour + ':00 IST. It files new issues from your added senders and lists new senders for you to review.</p>' +
      '<button class="btn scanbtn">Check now</button></div>' +""",
"""    '<div class="card"><h4>' + ico('refresh') + 'Daily scan</h4><p class="hint">Files new issues from your added senders and lists new senders for you to review.</p>' +
      '<div class="row" style="justify-content:flex-start;align-items:center">Every day at <select id="hoursel" class="hoursel">' + hours + '</select>' +
      '<span style="color:var(--muted);font-size:12px">' + esc(st.tz || '') + '</span><button class="btn scanbtn">Check now</button></div></div>' +""")

# --- settings: this device card instead of the backend's key card
rep("""    '<div class="card"><h4>' + ico('sparkle') + 'Readwell app <span class="badge">Beta</span></h4><p class="hint">The installable Readwell app connects to this backend with a private key. Keep it secret: anyone with the key and your API link can read your newsletters.</p>' +
      '<div class="row" style="justify-content:flex-start"><button class="btn" id="keybtn">Show my app key</button><button class="btn" id="rotbtn">Make a new key</button></div>' +
      '<div class="preview" id="keybox"></div></div>' +""",
"""    '<div class="card"><h4>' + ico('sparkle') + 'This device</h4><p class="hint">Connected to your own Readwell backend. Lost a phone? Run rotateApiKey in your script: every device is signed out at once.</p>' +
      '<div class="row" style="justify-content:flex-start"><button class="btn" id="discbtn">Disconnect this device</button></div></div>' +""")
rep("""  const showKey = k => {
    const b = $('#keybox'); b.style.display = 'block';
    b.innerHTML = '<div style="font-family:ui-monospace,Menlo,monospace;word-break:break-all;user-select:all;color:var(--ink)">' + esc(k) + '</div><div class="hint" style="margin:8px 0 0">Tap the key to select it, then copy.</div>';
  };
  $('#keybtn').onclick = async () => { try { const r = await run('getApiAccess'); showKey(r.key); } catch (e) {} };
  $('#rotbtn').onclick = async () => {
    const ok = await confirmBox('Make a new key?', 'The old key stops working right away. Any device using it will need the new one.', 'Make new key');
    if (!ok) return;
    try { const k = await run('rotateApiKey'); showKey(k); toast('New key made'); } catch (e) {}
  };""",
"""  $('#hoursel').onchange = () => {
    const h = Number($('#hoursel').value);
    S.settings = Object.assign({}, st, { scanHour: h }); saveState();
    toast('Daily scan moved to ' + $('#hoursel').selectedOptions[0].textContent);
    bg('setSchedule', h, st.tz || deviceTz());
  };
  $('#discbtn').onclick = async () => {
    const ok = await confirmBox('Disconnect this device?', 'Readwell forgets your backend link and key on this device. Your mail and highlights are not touched.', 'Disconnect');
    if (!ok) return;
    clearLocal(); setConn(null); keepHash(null);
    location.reload();
  };""")

# --- start: connect screen, one-tap links, service worker
start_old = v[v.index('/* ---------- Start: instant from this browser, then refresh quietly ---------- */'):v.index('</script>\n</body>')]
assert start_old.count('(function start()') == 1
rep(start_old, '''/* ---------- Connect ---------- */
const deviceTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; } };
function clearLocal() { try { Object.keys(localStorage).filter(k => k.indexOf('nr_') === 0).forEach(k => localStorage.removeItem(k)); } catch (e) {} }
function connectMsg(t) { $('#cmsg').textContent = t || ''; $('#cmsg').style.display = t ? 'block' : 'none'; }
function showConnect(m) { document.body.classList.add('need-connect'); if (m) connectMsg(m); }
const LINK_RE = /^https:\\/\\/script\\.google\\.com\\/macros\\/(u\\/\\d+\\/)?s\\/[\\w-]+\\/exec$/;

async function connectWith(url, key) {
  url = String(url || '').trim(); key = String(key || '').trim().toLowerCase();
  showConnect();
  const fail = t => { connectMsg(t); $('#cmanual').open = true; $('#curl').value = url; $('#ckey').value = key; };
  if (!LINK_RE.test(url)) return fail('That backend link doesn\\u2019t look right. It starts with https://script.google.com/macros/s/ and ends with /exec.');
  if (!/^[0-9a-f]{64}$/.test(key)) return fail('The key should be 64 letters and numbers.');
  connectMsg('Connecting to your backend\\u2026');
  $('#cbtn').disabled = true;
  try {
    const r = await rawCall({ url: url, key: key }, 'ping');
    if (!r || r.app !== 'readwell') throw new Error('Not a Readwell backend');
  } catch (e) {
    $('#cbtn').disabled = false;
    return fail(e.code === 'Unauthorized' ? 'Your backend refused this key. Tap the button in your newest Readwell email instead.'
      : e.code === 'Network' ? 'Could not reach your backend. Check you are online and that it is deployed with access set to Anyone.'
      : 'That link didn\\u2019t answer like a Readwell backend. Check it is the Web app link from your deployment.');
  }
  $('#cbtn').disabled = false;
  clearLocal();
  setConn({ url: url, key: key, tzSynced: false });
  keepHash(getConn());
  document.body.classList.remove('need-connect'); connectMsg('');
  toast('Connected. Welcome to Readwell');
  boot();
}
$('#cbtn').onclick = () => connectWith($('#curl').value, $('#ckey').value);

/* ---------- Start: instant from this device, then refresh quietly ---------- */
function boot() {
  const cachedState = cacheGet('state');
  if (cachedState) applyState(cachedState);
  const cached = cacheGet('inbox');
  if (cached) { S.items = cached; renderList(); }
  run('bootstrap').then(r => {
    applyState(r.state); saveState();
    if (S.view === 'inbox' && !S.mode) {
      S.items = r.list.items; S.more = r.list.more; S.start = 40;
      cacheSet('inbox', S.items);
      renderList();
      if (S.cur) {                                   // opened something before startup finished
        renderSide();
        const doc = frame.contentDocument;
        if (doc && doc.__nr) (S.hls[S.cur.id] || []).forEach(h => {
          if (!doc.querySelector('mark[data-id="' + h.id + '"]')) markSaved(doc, h);
        });
      }
    }
    // First time on this device: move the daily scan to this device's timezone
    const c = getConn(), tz = deviceTz(), st = r.state.settings;
    if (c && !c.tzSynced && tz && st) {
      if (st.tz !== tz) { S.settings = Object.assign({}, st, { tz: tz }); saveState(); bg('setSchedule', st.scanHour, tz); }
      c.tzSynced = true; setConn(c);
    }
    prefetch();
  }).catch(() => {});
}

/* The connect details stay in the address (after the #, which never leaves the device), so the
   connection travels when the page moves: from Gmail's built-in browser to Safari, to the Home
   Screen, to another tab. Each of those has its own storage on iPhone. Inside the installed app
   the address is cleaned, since it no longer needs to travel. */
const standalone = () => { try { return navigator.standalone === true || matchMedia('(display-mode: standalone)').matches; } catch (e) { return false; } };
// Only iPhone and iPad need this: there, Gmail's browser, Safari and the Home Screen app each keep
// separate storage. Everywhere else the address is cleaned, so the key never shows or gets shared.
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function keepHash(c) {
  const clean = location.pathname + location.search;
  history.replaceState(null, '', c && isIOS() && !standalone() ? clean + '#connect=' + encodeURIComponent(c.url) + '&key=' + c.key : clean);
}
function connectFromHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (!h.get('connect')) return false;
  const c = getConn(), url = String(h.get('connect') || '').trim(), key = String(h.get('key') || '').trim().toLowerCase();
  if (c && c.url === url && c.key === key) { keepHash(c); return false; }   // already connected with these details
  connectWith(url, key);
  return true;
}
window.addEventListener('hashchange', connectFromHash);   // connect link opened while the app is already open
(function start() {
  if (connectFromHash()) return;
  if (!getConn()) { showConnect(); return; }
  keepHash(getConn());
  boot();
})();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
''')

assert 'google.script.run' not in v
OUT.write_text(v)
print('built', OUT, len(v))
