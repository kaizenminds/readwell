/**
 * Newsletter Reader v3
 * Once a day it scans new mail, files newsletters out of your Gmail inbox, and
 * serves a reader with highlights, tags, saves and sender controls.
 * Everything is managed from the reader. No Gmail filters needed.
 */

const LABEL = 'Newsletters';
const ARCHIVE_LABEL = 'Reader-Archived';
const SAVED_LABEL = 'Reader-Saved';
const PAGE = 40;
const REMOVE_FROM_INBOX = true;   // filed newsletters leave your Gmail inbox
const MIN_WORDS = 600;            // bulk mail at least this long counts as a newsletter
const BACKFILL_DAYS = 30;         // how far back setup() looks the first time
const SCAN_HOUR = 7;              // daily scan time (hour, IST)
const TIMEZONE = 'Asia/Kolkata';
const CLEAN_DAYS = 5;             // read newsletters older than this are deleted, unless kept

// Newsletter platforms: mail from these is always a newsletter
const PLATFORMS = /(substack\.com|beehiiv\.com|convertkit|ck\.page|kit\.com|ghost\.io|buttondown|mailerlite|letterdrop)/i;
// Shared mail domains: removing a sender here never blocks the whole domain
const SHARED = /(^|\.)(gmail|googlemail|yahoo|outlook|hotmail|live|icloud|me|proton|protonmail|rediffmail)\.[a-z.]+$/i;
// Short bulk mail with these words in the subject is transactional, not a newsletter
const TX_WORDS = /\b(otp|one[- ]time|verification|verify|password|receipt|invoice|order|payment|paid|transaction|statement|delivered|shipped|dispatched|booking|ticket|refund|credited|debited|bill|login|sign[- ]in|security alert|kyc|reset)\b/i;
// Always transactional, however long the email: statements, OTPs, receipts
const TX_STRONG = /\b(otp|one[- ]time password|verification code|statement|e-?statement|invoice|receipt|transaction|credited|debited|kyc|password)\b/i;
// Sender mailboxes that are never newsletters
const TX_SENDERS = /^(alerts?|billing|invoices?|orders?|payments?|statements?|estatements?|e-statements?|ecas|cas|receipts?|transactions?|otp|security|accounts?)[@._-]/i;

const SHEETS = {
  Meta: ['messageId', 'tags', 'updatedAt'],
  Highlights: ['id', 'messageId', 'subject', 'sender', 'text', 'note', 'tags', 'createdAt'],
  Senders: ['key', 'name', 'rule', 'updatedAt', 'fav', 'count', 'lastDate'],
  Candidates: ['email', 'name', 'lastSubject', 'lastDate', 'count', 'kind']
};

function doGet(e) {
  // The reader runs with the owner's Gmail access, so it only opens with the owner's key in the link
  // (?k=...). Personal Gmail accounts don't reveal who is viewing, so the key is the proof.
  const k = e && e.parameter && e.parameter.k;
  if (!isOwner_() && !checkKey_(k)) {
    return HtmlService.createHtmlOutput('<p style="font:15px system-ui;padding:24px">This is a Readwell backend. Open it from the Readwell app, or use your private reader link.</p>')
      .setTitle('Readwell');
  }
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Reader')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function isOwner_() {
  try {
    const me = Session.getEffectiveUser().getEmail(), viewer = Session.getActiveUser().getEmail();
    return !!viewer && viewer === me;
  } catch (e) { return false; }
}

/* ---------- Setup ---------- */

/** Run once from the editor, and again after updating the code. */
function setup() {
  ss_(); label_(LABEL); label_(ARCHIVE_LABEL); label_(SAVED_LABEL);
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'scan')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('scan').timeBased().everyDays(1).atHour(SCAN_HOUR).inTimezone(TIMEZONE).create();

  const props = PropertiesService.getUserProperties();
  if (!props.getProperty('SENDERS_BUILT')) { rebuildSenders_(); props.setProperty('SENDERS_BUILT', '1'); }
  const res = props.getProperty('LAST_SCAN') ? scan() : backfill();
  props.setProperty('LAST_SCAN', String(nowSec_()));
  Logger.log('Filed ' + res.filed + ' newsletters, found ' + res.found + ' new senders. Daily scan at ' + SCAN_HOUR + ':00. Data: ' + ss_().getUrl());
}

/* ---------- Storage ---------- */

let SS_CACHE = null;
function ss_() {
  if (SS_CACHE) return SS_CACHE;
  const props = PropertiesService.getUserProperties();
  const id = props.getProperty('SHEET_ID');
  if (id) {
    try { return (SS_CACHE = SpreadsheetApp.openById(id)); } catch (e) { /* recreate below */ }
  }
  const ss = SpreadsheetApp.create('Newsletter Reader Data');
  const first = ss.getSheets()[0];
  first.setName('Meta');
  first.appendRow(SHEETS.Meta);
  props.setProperty('SHEET_ID', ss.getId());
  return (SS_CACHE = ss);
}

function sheet_(name) {
  const ss = ss_();
  const hdr = SHEETS[name];
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (name === 'Meta') sh.getRange('A:A').setNumberFormat('@');
    if (name === 'Highlights') sh.getRange('A:B').setNumberFormat('@');
    sh.appendRow(hdr);
  }
  else if (sh.getLastColumn() < hdr.length) sh.getRange(1, 1, 1, hdr.length).setValues([hdr]);
  return sh;
}

function label_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

const nowSec_ = () => Math.floor(Date.now() / 1000);

function addr_(from) {
  const m = String(from).match(/<([^>]+)>/);
  return (m ? m[1] : String(from)).trim().toLowerCase();
}

function senderName_(from) {
  const m = String(from).match(/^\s*"?([^"<]*?)"?\s*</);
  return (m && m[1].trim()) || addr_(from);
}

function rootDomain_(d) {
  const p = d.split('.');
  if (p.length <= 2) return d;
  const twoPart = p[p.length - 1].length === 2 && /^(co|com|net|org|gov|ac|edu)$/.test(p[p.length - 2]);
  return p.slice(twoPart ? -3 : -2).join('.');
}

/* ---------- Senders ---------- */

// rule: 'allow' | 'block' | '' (detected automatically). Keys are emails or '@domain'.
function rules_() {
  const v = sheet_('Senders').getDataRange().getValues();
  const map = {};
  for (let i = 1; i < v.length; i++) {
    map[String(v[i][0]).toLowerCase()] = {
      row: i + 1, name: v[i][1], rule: String(v[i][2] || ''),
      fav: v[i][4] === true || v[i][4] === 'TRUE', count: Number(v[i][5] || 0), lastDate: v[i][6]
    };
  }
  return map;
}

function ruleFor_(rules, email) {
  const r = rules[email];
  if (r && r.rule) return r.rule;
  const parts = (email.split('@')[1] || '').split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const d = rules['@' + parts.slice(i).join('.')];
    if (d && d.rule) return d.rule;
  }
  return '';
}

function setRule_(key, name, rule) {
  key = String(key).toLowerCase();
  const r = rules_()[key];
  const sh = sheet_('Senders');
  if (r) {
    sh.getRange(r.row, 2, 1, 3).setValues([[r.name || name || '', rule, new Date()]]);
    if (rule === 'block') sh.getRange(r.row, 5).setValue(false);
  } else {
    sh.appendRow([key, name || '', rule, new Date(), false, 0, '']);
  }
}

function trackSender_(rules, email, name, date) {
  const sh = sheet_('Senders');
  const r = rules[email];
  if (r) {
    r.count = (r.count || 0) + 1;
    sh.getRange(r.row, 6, 1, 2).setValues([[r.count, date]]);
    if (!r.name && name) sh.getRange(r.row, 2).setValue(name);
  } else {
    sh.appendRow([email, name, '', new Date(), false, 1, date]);
    rules[email] = { row: sh.getLastRow(), name: name, rule: '', fav: false, count: 1, lastDate: date };
  }
}

function rebuildSenders_() {
  const rules = rules_();
  const threads = GmailApp.search('label:' + LABEL, 0, 500);
  GmailApp.getMessagesForThreads(threads).forEach(msgs => {
    const m = msgs[msgs.length - 1];
    trackSender_(rules, addr_(m.getFrom()), senderName_(m.getFrom()), m.getDate());
  });
}

function candMap_() {
  const v = sheet_('Candidates').getDataRange().getValues();
  const map = {};
  for (let i = 1; i < v.length; i++) map[String(v[i][0]).toLowerCase()] = { row: i + 1, count: Number(v[i][4] || 0), kind: v[i][5] };
  return map;
}

/** kind: 'likely' (long-form or a newsletter platform) or 'maybe' (short bulk mail, usually promos) */
function noteCandidate_(cands, email, name, subject, date, kind) {
  const sh = sheet_('Candidates');
  const c = cands[email];
  if (c) {
    c.count++;
    if (c.kind === 'likely') kind = 'likely';
    sh.getRange(c.row, 2, 1, 5).setValues([[name, subject, date, c.count, kind]]);
    c.kind = kind;
  } else {
    sh.appendRow([email, name, subject, date, 1, kind]);
    cands[email] = { row: sh.getLastRow(), count: 1, kind: kind };
  }
}

function dropCandidate_(email) {
  const sh = sheet_('Candidates');
  const v = sh.getDataRange().getValues();
  for (let i = v.length - 1; i >= 1; i--) if (v[i][0] === email) sh.deleteRow(i + 1);
}

/* ---------- Detection ---------- */

/** For senders you haven't decided on: 'likely', 'maybe' or 'no'. */
function detect_(m) {
  const email = addr_(m.getFrom());
  const domain = email.split('@')[1] || '';
  const lists = (m.getHeader('List-Unsubscribe') || '') + ' ' + (m.getHeader('List-Id') || '');
  if (PLATFORMS.test(domain) || PLATFORMS.test(lists)) return 'likely';
  if (!lists.trim()) return 'no';                 // not bulk mail: personal or work email
  if (TX_SENDERS.test(email)) return 'no';
  if (TX_STRONG.test(m.getSubject() || '')) return 'no';

  const words = (m.getPlainBody() || '').split(/\s+/).filter(Boolean).length;
  if (words >= MIN_WORDS) return 'likely';        // long-form bulk mail
  if (TX_WORDS.test(m.getSubject() || '')) return 'no';
  return 'maybe';                                 // short bulk mail: usually promos
}

function fileThread_(thread, label) {
  thread.addLabel(label);
  if (REMOVE_FROM_INBOX) thread.moveToArchive();
}

function scanRange_(since, max) {
  const lock = LockService.getUserLock();
  if (!lock.tryLock(5000)) return { filed: 0, found: 0 };
  try {
    const t0 = Date.now();
    const label = label_(LABEL);
    const rules = rules_();
    const cache = CacheService.getUserCache();
    const q = 'after:' + since + ' -label:' + LABEL + ' -in:sent -in:drafts -in:chats';

    const threads = [];
    for (let s = 0; s < max; s += 100) {
      const batch = GmailApp.search(q, s, 100);
      threads.push.apply(threads, batch);
      if (batch.length < 100) break;
    }

    // Added senders: file their mail. Undecided senders: list them for review. Nothing else is touched.
    const cands = candMap_();
    let filed = 0, found = 0;
    for (let i = 0; i < threads.length; i += 50) {
      if (Date.now() - t0 > 270000) break;        // stay under the 6 minute limit
      const chunk = threads.slice(i, i + 50);
      const msgsList = GmailApp.getMessagesForThreads(chunk);
      chunk.forEach((t, j) => {
        const msgs = msgsList[j];
        const m = msgs[msgs.length - 1];
        const key = 's' + m.getId();
        if (cache.get(key)) return;
        cache.put(key, '1', 21600);
        const email = addr_(m.getFrom()), name = senderName_(m.getFrom());
        const rule = ruleFor_(rules, email);
        if (rule === 'allow') { fileThread_(t, label); trackSender_(rules, email, name, m.getDate()); filed++; return; }
        if (rule === 'block') return;
        const kind = detect_(m);
        if (kind === 'no') return;
        if (!cands[email]) found++;
        noteCandidate_(cands, email, name, m.getSubject(), m.getDate(), kind);
      });
    }
    return { filed: filed, found: found };
  } finally {
    lock.releaseLock();
  }
}

/** Runs daily from the trigger (scan, then cleanup). The Check now button calls scan('manual'). */
function scan(mode) {
  const props = PropertiesService.getUserProperties();
  const now = nowSec_();
  const last = Number(props.getProperty('LAST_SCAN') || 0);
  const since = last ? last - 3600 : now - 2 * 86400;
  const res = scanRange_(since, 500);
  props.setProperty('LAST_SCAN', String(now));
  res.cleaned = 0;
  if (mode !== 'manual' && getSettings().autoClean) { try { res.cleaned = cleanupNow(); } catch (e) {} }
  if (res.filed || res.found || res.cleaned) { bust_(); warm_(); }   // next open is instant
  return res;
}

/** The Check now button: scan only, never cleanup. */
function scanNow() { return scan('manual'); }

function backfill() {
  return scanRange_(nowSec_() - BACKFILL_DAYS * 86400, 1000);
}

/* ---------- Reader: messages ---------- */

function readTags_() {
  const v = sheet_('Meta').getDataRange().getValues();
  const map = {};
  for (let i = 1; i < v.length; i++) map[String(v[i][0])] = { row: i + 1, tags: String(v[i][1] || '') };
  return map;
}

/** One round trip at startup: tags, highlights, sender flags and the first page of the inbox. */
function bootstrap() {
  const hit = getBig_(BOOT_KEY);
  if (hit) { hit.cached = true; return hit; }
  return warm_();
}

/* ---------- Fast cache: Google's CacheService (~50 ms) in front of the Sheet + Gmail ---------- */
const BOOT_KEY = 'boot_v1';
function warm_() {
  const b = { state: getState(), list: listMessages('inbox', '', 0, '', []), at: Date.now() };
  putBig_(BOOT_KEY, b);
  return b;
}
function bust_() {
  const c = CacheService.getUserCache(), n = Number(c.get(BOOT_KEY + '_n') || 0), keys = [BOOT_KEY + '_n'];
  for (let i = 0; i < n; i++) keys.push(BOOT_KEY + '_' + i);
  c.removeAll(keys);
}
function putBig_(key, obj) {
  try {
    const s = JSON.stringify(obj), size = 30000, n = Math.ceil(s.length / size), parts = {};
    for (let i = 0; i < n; i++) parts[key + '_' + i] = s.slice(i * size, (i + 1) * size);
    parts[key + '_n'] = String(n);
    CacheService.getUserCache().putAll(parts, 21600);
  } catch (e) { /* cache is best effort */ }
}
function getBig_(key) {
  try {
    const c = CacheService.getUserCache(), n = Number(c.get(key + '_n') || 0);
    if (!n) return null;
    const keys = [];
    for (let i = 0; i < n; i++) keys.push(key + '_' + i);
    const got = c.getAll(keys);
    let s = '';
    for (let i = 0; i < n; i++) { if (got[keys[i]] == null) return null; s += got[keys[i]]; }
    return JSON.parse(s);
  } catch (e) { return null; }
}
/** Small edits update the cached copy in place instead of throwing it away. */
function patchBoot_(fn) {
  const b = getBig_(BOOT_KEY);
  if (!b) return;
  try { fn(b); putBig_(BOOT_KEY, b); } catch (e) { bust_(); }
}

function getState() {
  const props = PropertiesService.getUserProperties();
  if (!props.getProperty('TEXT_IDS')) {         // keep Gmail ids as text, never numbers
    sheet_('Meta').getRange('A:A').setNumberFormat('@');
    sheet_('Highlights').getRange('A:B').setNumberFormat('@');
    props.setProperty('TEXT_IDS', '1');
  }
  if (!props.getProperty('ADD_FLOW')) {         // one time: senders already in the reader count as added
    const sh = sheet_('Senders'), r0 = rules_();
    Object.keys(r0).forEach(k => { if (!r0[k].rule && r0[k].count > 0) sh.getRange(r0[k].row, 3).setValue('allow'); });
    props.setProperty('ADD_FLOW', '1');
  }
  const tags = {};
  sheet_('Meta').getDataRange().getValues().slice(1).forEach(r => { if (r[1]) tags[String(r[0])] = String(r[1]); });
  const rules = rules_(), senders = {};
  Object.keys(rules).forEach(k => { senders[k] = { fav: rules[k].fav, rule: rules[k].rule }; });
  let pending = 0;
  sheet_('Candidates').getDataRange().getValues().slice(1).forEach(r => { if (!ruleFor_(rules, String(r[0]).toLowerCase())) pending++; });
  return { tags: tags, highlights: getHighlights(''), senders: senders, pending: pending, settings: getSettings() };
}

/** Gmail only, no Sheet reads. view: inbox | saved | archive. mode: '' | 'unread' | 'fav'. */
function listMessages(view, query, start, mode, favs) {
  let q;
  if (view === 'archive') q = 'label:' + ARCHIVE_LABEL;
  else if (view === 'saved') q = 'label:' + SAVED_LABEL;
  else q = 'label:' + LABEL + ' -label:' + ARCHIVE_LABEL;

  if (mode === 'unread') q += ' is:unread';
  if (mode === 'fav') {
    if (!favs || !favs.length) return { items: [], more: false };
    q += ' from:(' + favs.join(' OR ') + ')';
  }
  if (query) q += ' ' + query;

  const threads = GmailApp.search(q, start || 0, PAGE);
  const items = [];
  GmailApp.getMessagesForThreads(threads).forEach(msgs => {
    const m = msgs[msgs.length - 1];
    items.push({
      id: m.getId(),
      subject: m.getSubject() || '(no subject)',
      from: senderName_(m.getFrom()),
      email: addr_(m.getFrom()),
      date: m.getDate().getTime(),
      unread: m.isUnread()
    });
  });
  items.sort((a, b) => b.date - a.date);
  return { items: items, more: threads.length === PAGE };
}

/** Bodies for one or more messages. Does not mark anything read. */
function getBodies(ids) {
  const out = {};
  (ids || []).forEach(id => {
    try {
      const m = GmailApp.getMessageById(id);
      const labels = m.getThread().getLabels().map(l => l.getName());
      out[id] = {
        html: m.getBody().replace(/<script[\s\S]*?<\/script>/gi, ''),
        archived: labels.indexOf(ARCHIVE_LABEL) >= 0,
        saved: labels.indexOf(SAVED_LABEL) >= 0
      };
    } catch (e) { /* deleted or moved: skip */ }
  });
  return out;
}

/** Take one email out of the reader and put it back in your inbox. No rule is made. */
function unfileOne(id) {
  bust_();
  const t = GmailApp.getMessageById(id).getThread();
  t.removeLabel(label_(LABEL)); t.removeLabel(label_(ARCHIVE_LABEL)); t.moveToInbox();
  return true;
}

function setUnread(id, on) {
  const m = GmailApp.getMessageById(id);
  if (on) m.markUnread(); else m.markRead();
  patchBoot_(b => b.list.items.forEach(x => { if (x.id === id) x.unread = !!on; }));
  return on;
}

function setArchived(id, on) {
  bust_();
  const thread = GmailApp.getMessageById(id).getThread();
  if (on) thread.addLabel(label_(ARCHIVE_LABEL)); else thread.removeLabel(label_(ARCHIVE_LABEL));
  return on;
}

function setSaved(id, on) {
  const thread = GmailApp.getMessageById(id).getThread();
  if (on) thread.addLabel(label_(SAVED_LABEL)); else thread.removeLabel(label_(SAVED_LABEL));
  return on;
}

/** Moves the email to Gmail Trash (recoverable for 30 days). */
function trashMessage(id) {
  bust_();
  GmailApp.getMessageById(id).getThread().moveToTrash();
  return true;
}

/** Deletes the email from Gmail permanently. It does not go to Trash and cannot be recovered. */
function deleteMessage(id) {
  bust_();
  Gmail.Users.Threads.remove('me', GmailApp.getMessageById(id).getThread().getId());
  dropMeta_([id]);
  return true;
}

/* ---------- Auto-cleanup ---------- */

function getSettings() {
  const p = PropertiesService.getUserProperties();
  return { autoClean: p.getProperty('AUTO_CLEAN') !== 'off', cleanDays: CLEAN_DAYS, scanHour: SCAN_HOUR, sheetUrl: ss_().getUrl() };
}

function setAutoClean(on) {
  PropertiesService.getUserProperties().setProperty('AUTO_CLEAN', on ? 'on' : 'off');
  patchBoot_(b => { if (b.state.settings) b.state.settings.autoClean = !!on; });
  return !!on;
}

/** Read, older than CLEAN_DAYS, and not saved, starred, tagged or highlighted. */
function cleanupList_() {
  const keep = {};
  getHighlights('').forEach(h => { keep[h.messageId] = 1; });
  const tags = readTags_();
  Object.keys(tags).forEach(id => { if (tags[id].tags) keep[id] = 1; });
  const q = 'label:' + LABEL + ' -label:' + SAVED_LABEL + ' -is:unread -is:starred older_than:' + CLEAN_DAYS + 'd';
  const threads = GmailApp.search(q, 0, 200), out = [];
  if (threads.length) GmailApp.getMessagesForThreads(threads).forEach((msgs, i) => {
    if (msgs.some(m => keep[m.getId()])) return;
    const last = msgs[msgs.length - 1];
    out.push({ thread: threads[i], id: last.getId(), subject: last.getSubject() || '(no subject)', from: senderName_(last.getFrom()) });
  });
  return out;
}

function cleanupPreview() {
  const l = cleanupList_();
  return { count: l.length, sample: l.slice(0, 8).map(x => ({ subject: x.subject, from: x.from })) };
}

function cleanupNow() {
  const l = cleanupList_();
  let n = 0;
  l.forEach(x => { try { Gmail.Users.Threads.remove('me', x.thread.getId()); n++; } catch (e) {} });
  if (n) { dropMeta_(l.map(x => x.id)); bust_(); }
  return n;
}

function dropMeta_(ids) {
  const set = {};
  ids.forEach(i => { set[i] = 1; });
  const sh = sheet_('Meta'), v = sh.getDataRange().getValues();
  for (let i = v.length - 1; i >= 1; i--) if (set[String(v[i][0])]) sh.deleteRow(i + 1);
}

/** For misfiled personal mail: blocks this address and sends its mail back to your inbox. */
function notNewsletter(id) {
  bust_();
  const from = GmailApp.getMessageById(id).getFrom();
  const email = addr_(from);
  setRule_(email, senderName_(from), 'block');
  const nl = label_(LABEL), ar = label_(ARCHIVE_LABEL);
  const threads = GmailApp.search('label:' + LABEL + ' from:' + email, 0, 100);
  threads.forEach(t => { t.removeLabel(nl); t.removeLabel(ar); t.moveToInbox(); });
  return threads.length;
}

/* ---------- Reader: senders ---------- */

function getSenders() {
  const rules = rules_();
  const v = sheet_('Candidates').getDataRange().getValues();
  const candidates = [];
  for (let i = 1; i < v.length; i++) {
    if (ruleFor_(rules, String(v[i][0]).toLowerCase())) continue;
    candidates.push({
      email: v[i][0], name: v[i][1], subject: v[i][2],
      date: new Date(v[i][3]).getTime(), count: Number(v[i][4] || 1), kind: v[i][5] || 'maybe'
    });
  }
  candidates.sort((a, b) => ((b.kind === 'likely') - (a.kind === 'likely')) || (b.date - a.date));
  const senders = Object.keys(rules).map(k => {
    const r = rules[k];
    return { key: k, name: r.name, rule: r.rule, fav: r.fav, count: r.count,
             lastDate: r.lastDate ? new Date(r.lastDate).getTime() : 0 };
  }).sort((a, b) => (b.fav - a.fav) || ((a.rule === 'block') - (b.rule === 'block')) || (b.count - a.count));
  return { candidates: candidates.slice(0, 60), senders: senders };
}

function setFav(email, on, name) {
  bust_();
  email = String(email).toLowerCase();
  let r = rules_()[email];
  if (!r) { setRule_(email, name, on ? 'allow' : ''); r = rules_()[email]; }
  const sh = sheet_('Senders');
  sh.getRange(r.row, 5).setValue(!!on);
  if (on && !r.rule) sh.getRange(r.row, 3).setValue('allow');
  return !!on;
}

/** Stops this sender, and the whole company domain unless it's Gmail, Substack etc. */
function removeSender(email, name) {
  bust_();
  email = String(email).toLowerCase();
  const domain = email.split('@')[1] || '';
  setRule_(email, name, 'block');
  let scope = email;
  if (domain && !PLATFORMS.test(domain) && !SHARED.test(domain)) {
    scope = rootDomain_(domain);
    setRule_('@' + scope, name, 'block');
  }
  const nl = label_(LABEL);
  const threads = GmailApp.search('label:' + LABEL + ' from:' + scope, 0, 200);
  threads.forEach(t => t.removeLabel(nl));
  dropCandidate_(email);
  return { scope: scope, count: threads.length };
}

/** Undo a block. Domain rules are deleted; sender rows keep their history. */
function unblock(key) {
  bust_();
  key = String(key).toLowerCase();
  const r = rules_()[key];
  if (!r) return true;
  if (key.charAt(0) === '@') sheet_('Senders').deleteRow(r.row);
  else sheet_('Senders').getRange(r.row, 3).setValue('');
  return true;
}

/** Add a sender: from now on the daily scan files their mail. Pulls in their last 5 days right away
 *  and returns those emails so the reader can show them immediately. */
function allowSender(email, name) {
  bust_();
  email = String(email).toLowerCase();
  setRule_(email, name, 'allow');
  dropCandidate_(email);
  const label = label_(LABEL), rules = rules_();
  const threads = GmailApp.search('from:' + email + ' newer_than:5d -in:sent -in:trash', 0, 50);
  const items = [];
  if (threads.length) GmailApp.getMessagesForThreads(threads).forEach((msgs, i) => {
    const m = msgs[msgs.length - 1];
    fileThread_(threads[i], label);
    trackSender_(rules, email, name || senderName_(m.getFrom()), m.getDate());
    items.push({ id: m.getId(), subject: m.getSubject() || '(no subject)', from: senderName_(m.getFrom()),
                 email: email, date: m.getDate().getTime(), unread: m.isUnread() });
  });
  return { count: items.length, items: items };
}

function ignoreSender(email, name) {
  bust_();
  setRule_(email, name, 'block');
  dropCandidate_(String(email).toLowerCase());
  return true;
}

/** Search all your mail (last 6 months) for things the scan didn't file. */
function findMissed(query) {
  const q = String(query || '').trim();
  if (!q) return [];
  const threads = GmailApp.search(q + ' newer_than:180d -label:' + LABEL + ' -in:sent -in:drafts -in:chats', 0, 30);
  return GmailApp.getMessagesForThreads(threads).map(msgs => {
    const m = msgs[msgs.length - 1];
    return {
      id: m.getId(), from: senderName_(m.getFrom()), email: addr_(m.getFrom()),
      subject: m.getSubject() || '(no subject)', date: m.getDate().getTime(),
      bulk: !!(m.getHeader('List-Unsubscribe') || m.getHeader('List-Id'))
    };
  });
}

/** File one email into the reader without making a rule. */
function fileOne(id) {
  bust_();
  const m = GmailApp.getMessageById(id);
  fileThread_(m.getThread(), label_(LABEL));
  trackSender_(rules_(), addr_(m.getFrom()), senderName_(m.getFrom()), m.getDate());
  return true;
}

/* ---------- Tags ---------- */

function cleanTags_(tags) {
  return String(tags || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    .filter((t, i, a) => a.indexOf(t) === i).join(', ');
}

function setTags(id, tags) {
  tags = cleanTags_(tags);
  const sh = sheet_('Meta');
  const existing = readTags_()[id];
  if (existing) sh.getRange(existing.row, 2, 1, 2).setValues([[tags, new Date()]]);
  else sh.appendRow([id, tags, new Date()]);
  patchBoot_(b => { if (tags) b.state.tags[id] = tags; else delete b.state.tags[id]; });
  return tags;
}

function allTags() {
  const set = {};
  const add = s => String(s || '').split(',').forEach(t => { t = t.trim(); if (t) set[t] = 1; });
  sheet_('Meta').getDataRange().getValues().slice(1).forEach(r => add(r[1]));
  sheet_('Highlights').getDataRange().getValues().slice(1).forEach(r => add(r[6]));
  return Object.keys(set).sort();
}

/* ---------- Highlights ---------- */

function addHighlight(h) {
  const id = Utilities.getUuid();
  sheet_('Highlights').appendRow([
    id, h.messageId, h.subject, h.sender, h.text, h.note || '', cleanTags_(h.tags), new Date()
  ]);
  patchBoot_(b => b.state.highlights.unshift({ id: id, messageId: h.messageId, subject: h.subject, sender: h.sender,
    text: h.text, note: h.note || '', tags: cleanTags_(h.tags), createdAt: Date.now() }));
  return id;
}

function getHighlights(messageId) {
  const v = sheet_('Highlights').getDataRange().getValues();
  const out = [];
  for (let i = 1; i < v.length; i++) {
    if (messageId && String(v[i][1]) !== messageId) continue;
    out.push({
      id: String(v[i][0]), messageId: String(v[i][1]), subject: v[i][2], sender: v[i][3],
      text: v[i][4], note: v[i][5], tags: String(v[i][6] || ''),
      createdAt: new Date(v[i][7]).getTime()
    });
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

function hlRow_(id) {
  const ids = sheet_('Highlights').getRange('A:A').getValues();
  for (let i = 1; i < ids.length; i++) if (String(ids[i][0]) === id) return i + 1;
  return -1;
}

function updateHighlight(id, note, tags) {
  const row = hlRow_(id);
  if (row < 0) throw new Error('Highlight not found');
  tags = cleanTags_(tags);
  sheet_('Highlights').getRange(row, 6, 1, 2).setValues([[note || '', tags]]);
  patchBoot_(b => b.state.highlights.forEach(x => { if (x.id === id) { x.note = note || ''; x.tags = tags; } }));
  return tags;
}

function deleteHighlight(id) {
  const row = hlRow_(id);
  if (row > 0) sheet_('Highlights').deleteRow(row);
  patchBoot_(b => { b.state.highlights = b.state.highlights.filter(x => x.id !== id); });
  return true;
}

/* ---------- API for the Readwell app ----------
 * POST a text/plain body: {"key": "...", "fn": "bootstrap", "args": []}
 * Reply: {"ok": true, "result": ...} or {"ok": false, "error": "..."}
 * Only the functions listed in api_() can be called. Everything else is unreachable.
 */
const API_VERSION = 1;

function api_() {
  return {
    bootstrap, listMessages, getBodies, setUnread, setArchived, setSaved, deleteMessage,
    notNewsletter, unfileOne, getSenders, setFav, removeSender, unblock, allowSender,
    ignoreSender, findMissed, fileOne, setTags, addHighlight, updateHighlight, deleteHighlight,
    scanNow, getSettings, setAutoClean, cleanupPreview, cleanupNow
  };
}

function doPost(e) {
  let req;
  try { req = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json_({ ok: false, error: 'Bad request' }); }
  if (!checkKey_(req.key)) return json_({ ok: false, error: 'Unauthorized' });
  if (req.fn === 'ping') return json_({ ok: true, result: { app: 'readwell', api: API_VERSION } });
  const fns = api_();
  if (!Object.prototype.hasOwnProperty.call(fns, req.fn)) return json_({ ok: false, error: 'Unknown function' });
  try {
    return json_({ ok: true, result: fns[req.fn].apply(null, Array.isArray(req.args) ? req.args : []) });
  } catch (err) {
    console.error('API ' + req.fn + ': ' + (err && err.stack || err));
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function newKey_() { return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''); }

function apiKey_() {
  const p = PropertiesService.getUserProperties();
  let k = p.getProperty('API_KEY');
  if (!k) { k = newKey_(); p.setProperty('API_KEY', k); }
  return k;
}

/** Constant-time compare, so the key can't be guessed one character at a time. */
function checkKey_(k) {
  const real = PropertiesService.getUserProperties().getProperty('API_KEY');
  if (!real || typeof k !== 'string' || k.length !== real.length) return false;
  let diff = 0;
  for (let i = 0; i < real.length; i++) diff |= real.charCodeAt(i) ^ k.charCodeAt(i);
  return diff === 0;
}

/** Run from the editor to print your private key (also part of your reader link: add ?k=KEY). */
function showMyKey() { Logger.log('Your Readwell key: ' + apiKey_()); }

/** Called from Settings in the owner's reader. Never exposed through the API. */
function getApiAccess() { return { key: apiKey_(), api: API_VERSION }; }

function rotateApiKey() {
  const k = newKey_();
  PropertiesService.getUserProperties().setProperty('API_KEY', k);
  return k;
}
