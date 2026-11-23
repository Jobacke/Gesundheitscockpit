import { firebaseConfig } from './firebase-config.js';
import { createStore } from './store.js';
import { berichtErstellen } from './bericht.js';

const VERSION = '1.9.3';
const REQUIRE_PASSWORD_KEY = 'gc_require_password';
const AUTO_AUTH_KEY = 'gc_auto_auth_v1';

// Falls das Board die gespeicherte Anmeldung direkt im URL-Hash (#board_gc_auth=...) übergibt, sofort synchron sichern
try {
  if (typeof window !== 'undefined' && window.location.hash.includes('board_gc_auth=')) {
    const m = window.location.hash.match(/board_gc_auth=([^&]+)/);
    if (m && m[1]) {
      localStorage.setItem(AUTO_AUTH_KEY, decodeURIComponent(m[1]));
      history.replaceState(null, '', location.pathname + location.search);
    }
  }
} catch {}

function saveAutoAuth(email, pass) {
  try {
    const raw = btoa(unescape(encodeURIComponent(JSON.stringify({ email, pass }))));
    localStorage.setItem(AUTO_AUTH_KEY, raw);
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'board-storage-set', key: AUTO_AUTH_KEY, value: raw }, '*');
    }
  } catch {}
}

function loadAutoAuth() {
  try {
    const raw = localStorage.getItem(AUTO_AUTH_KEY);
    if (!raw) return null;
    return JSON.parse(decodeURIComponent(escape(atob(raw))));
  } catch {
    return null;
  }
}

function clearAutoAuth() {
  try {
    localStorage.removeItem(AUTO_AUTH_KEY);
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'board-storage-remove', key: AUTO_AUTH_KEY }, '*');
    }
  } catch {}
}

function isPasswordRequired() {
  try { return localStorage.getItem(REQUIRE_PASSWORD_KEY) === '1'; } catch { return false; }
}
function setPasswordRequired(val) {
  try {
    if (val) localStorage.setItem(REQUIRE_PASSWORD_KEY, '1');
    else localStorage.removeItem(REQUIRE_PASSWORD_KEY);
  } catch {}
}

// Die fünf täglichen Aufgaben, aus denen sich die Konstanz berechnet
const TASKS = [
  { key: 'gewicht', label: 'Wiegen' },
  { key: 'bdMorgen', label: 'Blutdruck morgens' },
  { key: 'tabletteMorgen', label: 'Morgentablette' },
  { key: 'bdAbend', label: 'Blutdruck abends' },
  { key: 'tabletteAbend', label: 'Abendtablette' },
];
const MORNING = ['gewicht', 'bdMorgen', 'tabletteMorgen'];
const EVENING = ['bdAbend', 'tabletteAbend'];
const BEFINDEN = ['schlecht', 'mäßig', 'okay', 'gut', 'sehr gut'];
const RING = 2 * Math.PI * 23; // Umfang des Fortschrittsrings

const LIMITS = {
  gewicht: [30, 250], sys: [60, 260], dia: [30, 160], puls: [30, 220],
};

const state = {
  store: null,
  user: null,
  tab: 'heute',
  date: todayKey(),
  lastToday: todayKey(),
  settings: {},
  verlaufTage: 30,
  berichtTage: 14,
};

/* ---------- Hilfsfunktionen ---------- */
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

function keyOf(dt) {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
function todayKey() { return keyOf(new Date()); }
function parseKey(k) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(k, n) { const d = parseKey(k); d.setDate(d.getDate() + n); return keyOf(d); }
function weekdayIdx(k) { return (parseKey(k).getDay() + 6) % 7; } // Mo = 0
function fmtShort(k) { const d = parseKey(k); return `${d.getDate()}.${d.getMonth() + 1}.`; }
function nowTime() { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }

function num(v) {
  if (v == null) return null;
  const s = String(v).trim().replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
function inRange(v, [lo, hi]) { return v != null && !Number.isNaN(v) && v >= lo && v <= hi; }
function fmt(n, dec = 1) {
  if (n == null || Number.isNaN(n)) return '–';
  return n.toLocaleString('de-DE', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function round1(x) { return Math.round(x * 10) / 10; }
function avg(arr) { const a = arr.filter((v) => v != null && !Number.isNaN(v)); return a.length ? a.reduce((s, v) => s + v, 0) / a.length : null; }

function isDone(day, key) {
  if (!day) return false;
  if (key.startsWith('tablette')) return !!day[key];
  return day[key] != null && day[key] !== '';
}
function score(day, keys = TASKS.map((t) => t.key)) { return keys.filter((k) => isDone(day, k)).length; }

let toastTimer;
function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('err', err);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), err ? 3500 : 1600);
}

function saveErr(e) {
  console.error(e);
  toast('Speichern fehlgeschlagen', true);
}

function overLimit(bp) {
  const { grenzSys, grenzDia } = state.settings;
  if (!bp) return false;
  return (grenzSys && bp.sys > grenzSys) || (grenzDia && bp.dia > grenzDia);
}

/* ---------- Update-Hinweis ---------- */
const vNum = (v) => String(v).split('.').map((n) => parseInt(n, 10) || 0);
const isNewer = (a, b) => { const x = vNum(a), y = vNum(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
function startUpdateCheck() {
  if (location.protocol === 'file:') return;
  if (/[?&]v=/.test(location.search)) history.replaceState(null, '', location.pathname + location.hash);
  let last = 0;
  const check = async () => {
    if (Date.now() - last < 60000) return;
    last = Date.now();
    try {
      const r = await fetch('js/app.js?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return;
      const m = (await r.text()).match(/const VERSION = '([^']+)'/);
      if (m && isNewer(m[1], VERSION)) showUpdateBanner(m[1]);
    } catch { /* offline – später erneut */ }
  };
  check();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  window.addEventListener('focus', check);
  setInterval(check, 10 * 60 * 1000);
}
function showUpdateBanner(neu) {
  if ($('#update-banner')) return;
  const b = document.createElement('div');
  b.id = 'update-banner';
  b.className = 'update-banner';
  b.setAttribute('role', 'status');
  b.innerHTML = `<span>Neue Version ${neu} verfügbar</span><button type="button">↻ Neu laden</button>`;
  b.querySelector('button').onclick = async () => {
    b.querySelector('button').disabled = true;
    try { const regs = await navigator.serviceWorker?.getRegistrations?.(); for (const g of (regs || [])) await g.update(); } catch { /* egal */ }
    try { const ks = await caches.keys(); await Promise.all(ks.map((k) => caches.delete(k))); } catch { /* egal */ }
    location.replace(location.pathname + '?v=' + encodeURIComponent(neu) + location.hash);
  };
  document.body.appendChild(b);
}

/* ---------- Start ---------- */
async function boot() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
  }
  startUpdateCheck();

  try {
    state.store = await createStore(firebaseConfig);
  } catch (e) {
    console.error(e);
    $('#splash p').textContent = 'Verbindung fehlgeschlagen – bitte später erneut öffnen.';
    return;
  }
  if (state.store.mode === 'demo') $('#demo-banner').hidden = false;
  $('#app-version').textContent = 'v' + VERSION;

  bindLogin();
  bindTabs();

  // Falls die App im Board-Cockpit (iframe) läuft, gespeicherte Sitzung vom Board anfordern
  if (window.parent && window.parent !== window) {
    window.addEventListener('message', async (ev) => {
      if (ev.data && ev.data.type === 'board-storage-value' && ev.data.key === AUTO_AUTH_KEY && ev.data.value) {
        try {
          localStorage.setItem(AUTO_AUTH_KEY, ev.data.value);
          if (!state.user && !isPasswordRequired() && !state.forceLoginScreen) {
            const creds = loadAutoAuth();
            if (creds && creds.email && creds.pass) {
              await state.store.login(creds.email, creds.pass);
            }
          }
        } catch {}
      }
    });
    window.parent.postMessage({ type: 'board-storage-get', key: AUTO_AUTH_KEY }, '*');
  }

  let autoLoginAttempted = false;
  state.store.onAuth(async (user) => {
    if (!user && !autoLoginAttempted && !isPasswordRequired() && !state.forceLoginScreen) {
      autoLoginAttempted = true;
      const creds = loadAutoAuth();
      if (creds && creds.email && creds.pass) {
        try {
          await state.store.login(creds.email, creds.pass);
          return;
        } catch (e) {
          console.warn('Auto-Login fehlgeschlagen:', e);
        }
      }
    }
    $('#splash').hidden = true;
    // Ohne echte Firebase-Sitzung blockiert Firestore den Abruf der Health-Auto-Export-Daten.
    // Daher bei fehlender Sitzung einmalig anmelden (wird danach für den automatischen Direktstart gespeichert!).
    if (!user || state.forceLoginScreen || (isPasswordRequired() && !sessionStorage.getItem('gc_session_unlocked'))) {
      state.user = user;
      $('#app').hidden = true;
      $('#login').hidden = false;
      const emailEl = $('#login-email');
      if (emailEl && !emailEl.value) emailEl.value = 'johannes@vjbackhaus.com';
      return;
    }
    state.user = user;
    $('#login').hidden = true;
    $('#app').hidden = false;
    try { state.settings = await state.store.getSettings(); } catch { state.settings = {}; }
    render();
  });

  // Nach Mitternacht oder beim Zurückkehren in die App automatisch auf „heute“ springen
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !state.user) return;
    const t = todayKey();
    if (t !== state.lastToday) {
      if (state.date === state.lastToday) state.date = t;
      state.lastToday = t;
      render();
    }
  });
}

function bindLogin() {
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#login-error').textContent = '';
    const email = $('#login-email').value.trim();
    const pass = $('#login-pass').value;
    try {
      state.forceLoginScreen = false;
      sessionStorage.setItem('gc_session_unlocked', '1');
      await state.store.login(email, pass);
      saveAutoAuth(email, pass);
    } catch (err) {
      console.warn(err);
      $('#login-error').textContent = 'Anmeldung fehlgeschlagen. E-Mail oder Passwort prüfen.';
    }
  });
  $('#login-skip')?.addEventListener('click', async () => {
    state.forceLoginScreen = false;
    setPasswordRequired(false);
    state.user = { email: 'backhaus.johannes@gmail.com', uid: 'Kbhtx1MbgMTJDdtdGyfp3DSfIk03', localFallback: true };
    $('#login').hidden = true;
    $('#app').hidden = false;
    try { state.settings = await state.store.getSettings(); } catch { state.settings = {}; }
    render();
  });
  $('#login-reset').addEventListener('click', async () => {
    const email = $('#login-email').value.trim();
    if (!email) { $('#login-error').textContent = 'Bitte zuerst die E-Mail-Adresse eintragen.'; return; }
    try {
      await state.store.resetPassword(email);
      $('#login-error').textContent = 'E-Mail zum Zurücksetzen wurde verschickt.';
    } catch {
      $('#login-error').textContent = 'Das hat nicht geklappt.';
    }
  });
}

function bindTabs() {
  $$('.tabbar button').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.tab === 'heute' && state.tab === 'heute') state.date = todayKey();
    state.tab = b.dataset.tab;
    render();
    $('#view').scrollTop = 0;
  }));
}

function render() {
  $('#view').classList.remove('dicht');
  $$('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === state.tab));
  const views = { heute: renderHeute, konstanz: renderKonstanz, verlauf: renderVerlauf, mehr: renderMehr };
  views[state.tab]().catch((e) => {
    console.error(e);
    $('#view').innerHTML = '<div class="empty">Daten konnten nicht geladen werden.</div>';
  });
}

/* ---------- Heute ---------- */
async function renderHeute() {
  const d = state.date;
  const today = todayKey();
  const isToday = d === today;
  const [day, range, health, dienste, training] = await Promise.all([
    state.store.getDay(d),
    state.store.getRange(addDays(today, -200), today),
    state.store.getHealthRange(addDays(d, -35), d).catch(() => ({})),
    state.store.getDiensteRange(addDays(d, -1), addDays(d, 1)).catch(() => ({})),
    state.store.getTrainingRange(addDays(d, -2), d).catch(() => ({})),
  ]);
  const { current } = streaks(range, today);
  const dt = parseKey(d);
  const weekday = dt.toLocaleDateString('de-DE', { weekday: 'long' });
  const dateStr = dt.toLocaleDateString('de-DE', { day: 'numeric', month: 'long' });
  const hour = new Date().getHours();

  $('#view').innerHTML = `
    <header class="top">
      <div>
        <div class="date-nav">
          <button class="icon-btn" data-nav="-1" aria-label="Vorheriger Tag">‹</button>
          <label class="date-pick" title="Datum wählen">
            <div class="weekday">${isToday ? `Heute, ${weekday} · Serie <b>${current}</b>` : weekday}</div>
            <div class="date">${dateStr}</div>
            <input type="date" id="date-input" value="${d}" max="${today}" aria-label="Zu einem Datum springen">
          </label>
          <button class="icon-btn" data-nav="1" aria-label="Nächster Tag" ${isToday ? 'disabled' : ''}>›</button>
        </div>
        ${isToday ? '' : '<button class="today-link" id="to-today">Zurück zu heute</button>'}
      </div>
      <div class="ring" aria-label="Erledigte Aufgaben">
        <svg viewBox="0 0 56 56">
          <defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4b740"/><stop offset=".55" stop-color="#f38b4a"/><stop offset="1" stop-color="#ee6352"/></linearGradient></defs>
          <circle class="track" cx="28" cy="28" r="23" fill="none" stroke-width="6"/>
          <circle class="bar" id="ring-bar" cx="28" cy="28" r="23" fill="none" stroke-width="6" stroke-dasharray="${RING}" stroke-dashoffset="${RING}"/>
        </svg>
        <div class="label"><span id="ring-num">0/5</span></div>
      </div>
    </header>

    ${erholungKarte(d, day, health, dienste, isToday, training)}

    <section class="card">
      <div class="half">
        <div class="half-head"><div><h2 style="display:inline">Morgens</h2></div><span class="badge" id="badge-morgen">0/3</span></div>
        <div class="mrow">
          <span class="lbl">Gewicht</span>
          <div class="inline"><div class="input-unit"><input id="gewicht" inputmode="decimal" placeholder="–" autocomplete="off" aria-label="Gewicht in kg"><em>kg</em></div><span class="side" id="gewicht-side"></span></div>
          <div class="info" id="gewicht-info"></div>
        </div>
        ${bpRow('m')}
        ${tabRow('tabletteMorgen')}
      </div>
      <div class="half">
        <div class="half-head"><div><h2 style="display:inline">Abends</h2>${isToday && hour < 18 ? '<span class="sub">Erinnerung 18:30</span>' : ''}</div><span class="badge" id="badge-abend">0/2</span></div>
        ${bpRow('a')}
        ${tabRow('tabletteAbend')}
      </div>
      <div class="half">
      <div class="segmented" id="befinden" aria-label="Befinden">
        ${BEFINDEN.map((l, i) => `<button data-v="${i + 1}" type="button">${l}</button>`).join('')}
      </div>
      <div class="note" id="note"><textarea id="notiz" rows="1" aria-label="Notiz" placeholder="Notiz, z.B. Kopfschmerz, Rücken, Dienst..."></textarea><div class="note-preview" id="note-preview" aria-hidden="true"></div></div>
      </div>
    </section>
  `;

  // Werte eintragen
  const g = $('#gewicht');
  if (day.gewicht != null) g.value = fmt(day.gewicht);
  const koerper = health[d] || {};
  $('#gewicht-side').innerHTML = [
    koerper.koerperfett != null ? `Fett ${fmt(koerper.koerperfett)} %` : '',
    koerper.muskelmasse != null ? `Muskeln ${fmt(koerper.muskelmasse)} kg` : '',
  ].filter(Boolean).join('<br>');
  $('#gewicht-info').textContent = (koerper.gewichtMessungen || []).length > 1
    ? koerper.gewichtMessungen.map((m) => `${m.zeit} ${fmt(m.gewicht)}`).join('  ·  ') : '';
  fillBp('m', day.bdMorgen);
  fillBp('a', day.bdAbend);
  fillBpWeitere('m', health[d]?.bdMessungen, day.bdMorgen);
  fillBpWeitere('a', health[d]?.bdMessungen, day.bdAbend);
  tabletteAnzeigen('tabletteMorgen', day, health[d], isToday);
  tabletteAnzeigen('tabletteAbend', day, health[d], isToday);
  setBefinden(day.befinden);
  $('#notiz').value = day.notiz || '';
  notizZeigen();
  updateProgress(day);
  einpassen();
  requestAnimationFrame(einpassen); // nach dem ersten Zeichnen (Schriften, Ränder für Dynamic Island) noch einmal prüfen
  setTimeout(einpassen, 400);

  // Navigation
  $$('[data-nav]').forEach((b) => b.addEventListener('click', () => {
    const next = addDays(d, Number(b.dataset.nav));
    if (next > today) return;
    state.date = next;
    renderHeute();
  }));
  $('#to-today')?.addEventListener('click', () => { state.date = today; renderHeute(); });
  const di = $('#date-input');
  di.addEventListener('change', () => {
    const v = di.value;
    if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
    state.date = v > today ? today : v;
    renderHeute();
  });
  di.addEventListener('click', () => { try { di.showPicker?.(); } catch { /* iOS öffnet von selbst */ } });

  const save = (patch, msg) => {
    Object.assign(day, patch);
    updateProgress(day);
    state.store.saveDay(d, patch).catch(saveErr);
    if (msg) toast(msg);
  };

  // Gewicht
  g.addEventListener('change', () => {
    const v = num(g.value);
    g.classList.remove('invalid', 'saved');
    $('#gewicht-info').textContent = '';
    if (v == null) { save({ gewicht: null, gewichtQuelle: null }, 'Gewicht entfernt'); return; }
    if (!inRange(v, LIMITS.gewicht)) { g.classList.add('invalid'); toast('Gewicht bitte prüfen', true); return; }
    g.value = fmt(round1(v));
    g.classList.add('saved');
    save({ gewicht: round1(v), gewichtQuelle: null }, 'Gewicht gespeichert');
  });

  // Blutdruck
  for (const [p, field] of [['m', 'bdMorgen'], ['a', 'bdAbend']]) {
    $$(`[data-bp="${p}"]`).forEach((inp) => inp.addEventListener('change', () => {
      const sysEl = $(`#${p}-sys`), diaEl = $(`#${p}-dia`), pulsEl = $(`#${p}-puls`);
      const sys = num(sysEl.value), dia = num(diaEl.value), puls = num(pulsEl.value);
      [sysEl, diaEl, pulsEl].forEach((e) => e.classList.remove('invalid', 'saved'));
      if (sys == null && dia == null && puls == null) { save({ [field]: null }, 'Blutdruck entfernt'); fillBpInfo(p, null); return; }
      let ok = true;
      if (sys != null && !inRange(sys, LIMITS.sys)) { sysEl.classList.add('invalid'); ok = false; }
      if (dia != null && !inRange(dia, LIMITS.dia)) { diaEl.classList.add('invalid'); ok = false; }
      if (puls != null && !inRange(puls, LIMITS.puls)) { pulsEl.classList.add('invalid'); ok = false; }
      if (ok && sys != null && dia != null && sys <= dia) { sysEl.classList.add('invalid'); diaEl.classList.add('invalid'); ok = false; }
      if (!ok) { toast('Blutdruck bitte prüfen', true); return; }
      if (sys == null || dia == null) return; // warten, bis beide Werte da sind
      const prev = day[field];
      const bp = { sys: Math.round(sys), dia: Math.round(dia), puls: puls == null ? null : Math.round(puls), zeit: prev?.zeit || (isToday ? nowTime() : null) };
      [sysEl, diaEl].forEach((e) => e.classList.add('saved'));
      if (puls != null) pulsEl.classList.add('saved');
      save({ [field]: bp }, 'Blutdruck gespeichert');
      fillBpInfo(p, bp);
    }));
  }

  // Tabletten: keine Eingabe – kommen ausschließlich aus Apple Health (Empfänger)

  // Befinden
  $$('#befinden button').forEach((b) => b.addEventListener('click', () => {
    const v = Number(b.dataset.v);
    const next = day.befinden === v ? null : v;
    setBefinden(next);
    save({ befinden: next });
  }));

  // Notiz: beim Antippen aufklappen und mitwachsen, beim Verlassen wieder einzeilig mit „…“
  const nt = $('#notiz');
  const wachsen = () => { nt.style.height = 'auto'; nt.style.height = nt.scrollHeight + 2 + 'px'; };
  nt.addEventListener('focus', () => { $('#note').classList.add('open'); wachsen(); });
  nt.addEventListener('input', wachsen);
  nt.addEventListener('blur', () => { $('#note').classList.remove('open'); nt.style.height = ''; nt.scrollTop = 0; notizZeigen(); });
  nt.addEventListener('change', (e) => save({ notiz: e.target.value.trim() }, 'Notiz gespeichert'));
}

/* ---------- Erholung (Daten aus Apple Health über den Empfänger) ---------- */
function hm(h) {
  if (h == null) return '–';
  const min = Math.round(h * 60);
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')} h`;
}

function baseline(health, d, key, tage = 28) {
  const vals = [];
  for (let i = 1; i <= tage; i++) {
    const v = health[addDays(d, -i)]?.[key];
    if (v != null) vals.push(v);
  }
  return vals.length >= 5 ? avg(vals) : null;
}

const STUFE = { gruen: 0, gelb: 1, rot: 2 };
const DIENST_NAME = { nacht: 'Nachtdienst', spaet: 'Spätdienst', tag: 'Tagdienst', frueh: 'Frühdienst' };

function dienstInfo(d, dienste) {
  const nachNacht = (dienste[addDays(d, -1)]?.liste || []).find((x) => x.art === 'nacht' && x.endeDatum === d);
  const heute = dienste[d]?.liste || [];
  const morgen = dienste[addDays(d, 1)]?.liste || [];
  return { nachNacht, heute, morgen };
}

// d = angezeigter Tag, q = Tag, aus dem die Health-Werte stammen (meist d, morgens evtl. gestern)
function trainingInfo(d, training) {
  // Form zu Tagesbeginn: Wert des Tages – sonst vom Vortag
  const heute = training[d], gestern = training[addDays(d, -1)];
  const form = heute || gestern || null;
  return { heute, gestern, form, formVomVortag: !heute && !!gestern };
}
const SPORT = { VirtualRide: 'Zwift', Ride: 'Rad', Run: 'Lauf', VirtualRun: 'Lauf (virtuell)', Walk: 'Gehen', Hike: 'Wandern', WeightTraining: 'Kraft', Workout: 'Training' };
function aktText(a) {
  const teile = [`${a.dauerMin} min`];
  if (a.wattNp || a.wattAvg) teile.push(`${a.wattNp || a.wattAvg} W`);
  if (a.hfAvg) teile.push(`Ø ${a.hfAvg} bpm`);
  if (a.last != null) teile.push(`Last ${a.last}`);
  return `${a.name || SPORT[a.typ] || 'Training'} · ${teile.join(' · ')}`;
}
// Gewicht vor/nach einer Trainingseinheit aus den Waagen-Messungen des Tages (Garmin)
function minuten(hhmm) { if (!hhmm) return null; const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; }
function schweiss(a, messungen) {
  const start = minuten(a.start);
  if (start == null || !messungen || messungen.length < 2) return null;
  const ende = start + (a.dauerMin || 0);
  const ms = messungen.map((m) => ({ ...m, t: minuten(m.zeit) })).filter((m) => m.t != null).sort((x, y) => x.t - y.t);
  const vor = ms.filter((m) => m.t <= start + 5 && m.t >= start - 150).pop();
  const nach = ms.find((m) => m.t >= ende - 5 && m.t <= ende + 180);
  if (!vor || !nach || vor === nach) return null;
  const verlust = round1(vor.gewicht - nach.gewicht);
  const stunden = (a.dauerMin || 0) / 60;
  return { vor, nach, verlust, proStunde: stunden > 0.25 && verlust > 0 ? round1(verlust / stunden) : null };
}
// Kurzform für die Erholungstafel: Name, Dauer, Last – passt in eine Zeile
function aktKurz(a) {
  return [a.name || SPORT[a.typ] || 'Training', `${a.dauerMin} min`, a.last != null ? `Last ${a.last}` : ''].filter(Boolean).join(' · ');
}
function schweissText(sw) {
  const basis = `vorher ${fmt(sw.vor.gewicht)} (${sw.vor.zeit}) → nachher ${fmt(sw.nach.gewicht)} kg (${sw.nach.zeit})`;
  if (sw.verlust <= 0) return `${basis}: kein Gewichtsverlust – gut getrunken`;
  return `${basis}: −${fmt(sw.verlust)} kg ≈ ${fmt(sw.verlust)} l Flüssigkeitsverlust${sw.proStunde ? ` (${fmt(sw.proStunde)} l/h)` : ''}, zzgl. Getrunkenem`;
}
function tsbTxt(t) { return `${t > 0 ? '+' : ''}${fmt(t, 0)}`; }

function ampel(d, q, day, health, dienste, training = {}) {
  const h = health[q] || {};
  const gruende = [];
  const add = (stufe, text, feld = null) => gruende.push({ stufe, text, feld });
  const { nachNacht, heute } = dienstInfo(d, dienste);
  if (nachNacht) add('gelb', `nach Nachtdienst (${nachNacht.titel.split(' ')[0]}, bis ${nachNacht.ende} Uhr)`);
  heute.forEach((x) => {
    if (x.art === 'nacht') add('gelb', `heute Nachtdienst ab ${x.start} Uhr`);
    else add('info', `heute ${DIENST_NAME[x.art] || 'Dienst'} ${x.start}–${x.ende} Uhr`);
  });

  const sch = h.schlaf?.gesamt;
  if (sch != null) {
    if (sch < 5) add('rot', `nur ${hm(sch)} Schlaf`, 'schlaf');
    else if (sch < 6.5) add('gelb', `${hm(sch)} Schlaf`, 'schlaf');
    else add('gruen', `${hm(sch)} Schlaf`, 'schlaf');
  }
  const rp = h.ruhepuls, rpB = baseline(health, q, 'ruhepuls');
  if (rp != null && rpB != null) {
    const diff = rp - rpB;
    if (diff >= 5) add('rot', `Ruhepuls ${rp} (+${Math.round(diff)} über Ø)`, 'ruhepuls');
    else if (diff >= 3) add('gelb', `Ruhepuls ${rp} (+${Math.round(diff)} über Ø)`, 'ruhepuls');
    else add('gruen', `Ruhepuls ${rp} im Normalbereich`, 'ruhepuls');
  }
  const hrv = h.hrv, hrvB = baseline(health, q, 'hrv');
  if (hrv != null && hrvB != null) {
    const q = hrv / hrvB;
    if (q <= 0.8) add('rot', `HRV ${hrv} ms (${Math.round((1 - q) * 100)} % unter Ø)`, 'hrv');
    else if (q <= 0.9) add('gelb', `HRV ${hrv} ms (${Math.round((1 - q) * 100)} % unter Ø)`, 'hrv');
    else add('gruen', `HRV ${hrv} ms im Normalbereich`, 'hrv');
  }
  const { gestern, form } = trainingInfo(d, training);
  if (form && form.tsb != null) {
    if (form.tsb < -25) add('rot', `Form (TSB) ${tsbTxt(form.tsb)} – stark belastet`, 'tsb');
    else if (form.tsb < -10) add('gelb', `Form (TSB) ${tsbTxt(form.tsb)} – belastet`, 'tsb');
    else add('gruen', `Form (TSB) ${tsbTxt(form.tsb)}`, 'tsb');
  }
  (gestern?.aktivitaeten || []).forEach((a) => add('info', `gestern: ${aktKurz(a)}`));
  const bp = day.bdMorgen || (h.bdTagesmittel ? { ...h.bdTagesmittel } : null);
  if (bp && overLimit(bp)) add('gelb', `Blutdruck ${bp.sys}/${bp.dia} über deinem Grenzwert`);

  if (!gruende.some((g) => g.stufe !== 'info')) return null;
  const stufe = gruende.reduce((m, g) => ((STUFE[g.stufe] ?? -1) > STUFE[m] ? g.stufe : m), 'gruen');
  return { stufe, gruende };
}

function erholungKarte(d, day, health, dienste, isToday, training = {}) {
  // Heute noch nichts da (z. B. früh morgens)? Dann die letzten Werte von gestern/vorgestern zeigen.
  let q = d;
  if (!health[d] && isToday) q = [addDays(d, -1), addDays(d, -2)].find((k) => health[k]) || d;
  const h = health[q];
  const { morgen } = dienstInfo(d, dienste);
  const morgenTxt = morgen.length ? `Morgen ${morgen.map((x) => `${DIENST_NAME[x.art] || 'Dienst'} ${x.start}–${x.ende}`).join(', ')}` : '';
  if (!h) {
    return `<section class="card recovery">
      <div class="verdict"><strong>Erholung</strong><span class="src">Apple Health</span></div>
      <div class="advice" style="margin-bottom:0">Für diesen Tag sind noch keine Daten angekommen.</div>
      ${morgenTxt ? `<ul class="notes"><li>${escapeHtml(morgenTxt)}</li></ul>` : ''}</section>`;
  }
  const stand = q !== d ? `Stand ${q === addDays(d, -1) ? 'gestern' : 'vorgestern'}, ${fmtShort(q)}` : 'Apple Health';
  const a = ampel(d, q, day, health, dienste, training);
  const tr = trainingInfo(d, training);
  const heuteAkt = tr.heute?.aktivitaeten || [];
  const TXT = {
    gruen: ['Gut erholt', 'Training wie geplant möglich.'],
    gelb: ['Eingeschränkt erholt', 'Intensität reduzieren – lieber locker (Z1/Z2).'],
    rot: ['Schlecht erholt', 'Ruhetag oder nur sehr locker.'],
  };
  const stufeVon = (feld) => a?.gruende.find((g) => g.feld === feld)?.stufe || '';
  const s = h.schlaf;
  const pct = (x) => (s && s.gesamt ? Math.round((x / s.gesamt) * 100) : 0);
  const rpB = baseline(health, q, 'ruhepuls'), hrvB = baseline(health, q, 'hrv');
  const schlafWert = s?.gesamt != null ? hm(s.gesamt).replace(' h', '<small>h</small>') : '–';

  const notizen = (a?.gruende || []).filter((g) => !g.feld).map((g) => `<li class="n-${g.stufe}">${escapeHtml(g.text)}</li>`);
  heuteAkt.forEach((x) => {
    const sw = schweiss(x, health[d]?.gewichtMessungen);
    notizen.push(`<li class="n-info"><span>${d === todayKey() ? 'heute' : 'trainiert'}: ${escapeHtml(aktKurz(x))}${sw ? ` · ${sw.verlust > 0 ? `−${fmt(sw.verlust)} kg` : '± 0 kg'}` : ''}</span></li>`);
  });
  if (morgenTxt) notizen.push(`<li class="n-info">${escapeHtml(morgenTxt)}</li>`);

  return `
    <section class="card recovery ${a ? 's-' + a.stufe : ''}">
      <div class="verdict"><strong>${a ? TXT[a.stufe][0] : 'Erholung'}</strong><span class="src">${stand}</span></div>
      <div class="advice">${a ? TXT[a.stufe][1] : 'Noch zu wenige Vergleichswerte für eine Einschätzung.'}</div>
      <div class="gauges">
        <div class="gauge g-${stufeVon('schlaf')}"><b>${schlafWert}</b><span>Schlaf${s?.start ? ` ${s.start}–${s.ende}` : ''}</span>${s && s.gesamt ? `<div class="sleep-bar" title="Tief ${pct(s.tief)} % · REM ${pct(s.rem)} % · Kern ${pct(s.kern)} %" aria-label="Tief ${pct(s.tief)} %, REM ${pct(s.rem)} %, Kern ${pct(s.kern)} %"><i style="width:${pct(s.tief)}%;background:#3f6fd8"></i><i style="width:${pct(s.rem)}%;background:#8fb6ff"></i><i style="width:${pct(s.kern)}%;background:#33466f"></i></div>` : ''}</div>
        <div class="gauge g-${stufeVon('ruhepuls')}"><b>${h.ruhepuls ?? '–'}<small>bpm</small></b><span>Ruhepuls${rpB ? ` · Ø ${Math.round(rpB)}` : ''}</span></div>
        <div class="gauge g-${stufeVon('hrv')}"><b>${h.hrv ?? '–'}<small>ms</small></b><span>HRV${hrvB ? ` · Ø ${Math.round(hrvB)}` : ''}</span></div>
      </div>
      ${tr.form ? `<div class="formline"><span>Fitness <b>${fmt(tr.form.ctl, 0)}</b></span><span>Ermüdung <b>${fmt(tr.form.atl, 0)}</b></span><span class="g-${stufeVon('tsb')}">Form <b>${tsbTxt(tr.form.tsb)}</b>${tr.formVomVortag ? ' (gestern)' : ''}</span></div>` : ''}
      ${notizen.length ? `<ul class="notes">${notizen.join('')}</ul>` : ''}
    </section>`;
}

function bpRow(p) {
  return `
    <div class="mrow">
      <span class="lbl">Blutdruck<small id="${p}-zeit"></small></span>
      <div class="bp">
        <input id="${p}-sys" data-bp="${p}" inputmode="numeric" pattern="[0-9]*" placeholder="Sys" autocomplete="off" aria-label="Systolisch">
        <input id="${p}-dia" data-bp="${p}" inputmode="numeric" pattern="[0-9]*" placeholder="Dia" autocomplete="off" aria-label="Diastolisch">
        <input id="${p}-puls" data-bp="${p}" inputmode="numeric" pattern="[0-9]*" placeholder="Puls" autocomplete="off" aria-label="Puls">
      </div>
      <div class="info" id="${p}-info"></div>
      <div class="info" id="${p}-weitere"></div>
    </div>`;
}
function fillBp(p, bp) {
  if (!bp) { fillBpInfo(p, null); return; }
  $(`#${p}-sys`).value = bp.sys ?? '';
  $(`#${p}-dia`).value = bp.dia ?? '';
  $(`#${p}-puls`).value = bp.puls ?? '';
  fillBpInfo(p, bp);
}
function fillBpInfo(p, bp) {
  const el = $(`#${p}-info`), zeit = $(`#${p}-zeit`);
  const ueber = !!(bp && overLimit(bp));
  zeit.textContent = bp ? [bp.zeit, bp.anzahl > 1 ? `Ø ${bp.anzahl}×` : ''].filter(Boolean).join(' · ') : '';
  el.textContent = ueber ? `${bp.sys}/${bp.dia} liegt über deinem Grenzwert` : '';
  el.classList.toggle('warn', ueber);
  [`#${p}-sys`, `#${p}-dia`].forEach((id) => $(id).classList.toggle('over', ueber));
}
// Weitere Messreihen desselben Halbtags (z. B. nach der Tablette) – der Tageswert ist die erste Messreihe
function fillBpWeitere(p, messungen, bp) {
  const el = $(`#${p}-weitere`);
  if (!el) return;
  const halb = (messungen || []).filter((m) => m.zeit && (Number(m.zeit.slice(0, 2)) < 12) === (p === 'm'));
  const weitere = halb.filter((m) => !(bp && bp.zeit === m.zeit));
  if (!weitere.length) { el.textContent = ''; return; }
  const txt = weitere.map((m) => `${m.zeit} ${m.sys}/${m.dia}${m.puls ? ` P ${m.puls}` : ''}${m.anzahl > 1 ? ` (Ø ${m.anzahl})` : ''}`).join('  ·  ');
  el.textContent = `${bp && bp.zeit && halb.length > weitere.length ? 'Weitere' : 'Messungen'}: ${txt}`;
}

// Tablette: reine Anzeige. Abgehakt wird nur über Apple Health (Health Auto Export → Empfänger).
function tabRow(key) {
  return `
    <div class="mrow">
      <span class="lbl">Tablette</span>
      <div><span class="pill" id="${key}-pill"><span class="tick" aria-hidden="true"></span><span id="${key}-txt"></span></span></div>
    </div>`;
}
function tabletteAnzeigen(key, day, h, isToday) {
  const pill = $(`#${key}-pill`), txt = $(`#${key}-txt`);
  if (!pill) return;
  const morgens = key === 'tabletteMorgen';
  const eintraege = (h?.medikamente || []).filter((m) => (m.geplant || m.zeit) && (Number((m.geplant || m.zeit).slice(0, 2)) < 12) === morgens);
  const ausgelassen = eintraege.some((m) => /skip|ausgelassen/i.test(m.status || ''));
  pill.classList.remove('on', 'skip');
  if (day[key]) {
    pill.classList.add('on');
    const zeit = day[key + 'Zeit'];
    const quelle = day[key + 'Quelle'];
    txt.innerHTML = `genommen${zeit ? ` ${zeit}` : ''} <span class="src">${quelle === 'Apple Health' ? 'Health' : quelle === 'Hand' ? 'von Hand' : ''}</span>`;
  } else if (ausgelassen) {
    pill.classList.add('skip');
    txt.innerHTML = 'in Health ausgelassen';
  } else {
    txt.innerHTML = isToday ? 'offen <span class="src">in Health eintragen</span>' : 'nicht in Health erfasst';
  }
}
// „Heute“ soll ohne Scrollen auf den Bildschirm passen. Reicht der Platz nicht
// (z. B. viele Zusatzzeilen an Trainingstagen), wird die Ansicht enger gesetzt.
function einpassen() {
  const v = $('#view');
  if (!v) return;
  v.classList.remove('dicht');
  if (state.tab === 'heute' && v.scrollHeight > v.clientHeight + 1) v.classList.add('dicht');
}
window.addEventListener('resize', () => { if (state.tab === 'heute' && !document.activeElement?.matches?.('input, textarea')) einpassen(); });

function notizZeigen() {
  const nt = $('#notiz'), box = $('#note');
  if (!nt || !box) return;
  const t = nt.value.trim().replace(/\s*\n\s*/g, ' · ');
  $('#note-preview').textContent = t;
  box.classList.toggle('has-text', !!t);
}
function setBefinden(v) { $$('#befinden button').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === v)); }
function updateProgress(day) {
  const s = score(day);
  $('#ring-num').textContent = `${s}/5`;
  $('#ring-bar').style.strokeDashoffset = String(RING * (1 - s / 5));
  const m = score(day, MORNING), a = score(day, EVENING);
  const bm = $('#badge-morgen'), ba = $('#badge-abend');
  bm.textContent = `${m}/3`; bm.classList.toggle('done', m === 3);
  ba.textContent = `${a}/2`; ba.classList.toggle('done', a === 2);
}

/* ---------- Konstanz ---------- */
function streaks(map, today) {
  const full = (k) => score(map[k]) === TASKS.length;
  let k = today;
  if (!full(k)) k = addDays(k, -1);
  let current = 0;
  while (map[k] && full(k)) { current++; k = addDays(k, -1); }
  const keys = Object.keys(map).sort();
  let longest = 0, run = 0, prev = null;
  for (const key of keys) {
    if (full(key)) {
      run = prev && addDays(prev, 1) === key ? run + 1 : 1;
      prev = key;
      longest = Math.max(longest, run);
    } else { run = 0; prev = null; }
  }
  return { current, longest: Math.max(longest, current) };
}

async function renderKonstanz() {
  const today = todayKey();
  const WEEKS = 13;
  const thisMonday = addDays(today, -weekdayIdx(today));
  const start = addDays(thisMonday, -7 * (WEEKS - 1));
  const from = addDays(today, -200) < start ? addDays(today, -200) : start;
  const map = await state.store.getRange(from, today);
  const { current, longest } = streaks(map, today);

  // Letzte 7 Tage ohne heute
  const last7 = Array.from({ length: 7 }, (_, i) => addDays(today, -1 - i));
  const quota = TASKS.map((t) => ({ ...t, n: last7.filter((k) => isDone(map[k], t.key)).length }));
  const total7 = quota.reduce((s, q) => s + q.n, 0);
  const last30 = Array.from({ length: 30 }, (_, i) => addDays(today, -1 - i));
  const full30 = last30.filter((k) => score(map[k]) === TASKS.length).length;

  // Heatmap
  const cells = [];
  const monthLabels = [];
  for (let w = 0; w < WEEKS; w++) {
    const monday = addDays(start, 7 * w);
    if (w % 4 === 0) monthLabels.push(parseKey(monday).toLocaleDateString('de-DE', { month: 'short' }));
    for (let i = 0; i < 7; i++) {
      const k = addDays(monday, i);
      if (k > today) { cells.push(`<span class="cell future"></span>`); continue; }
      const s = score(map[k]);
      cells.push(`<button class="cell ${s ? 'l' + s : ''} ${k === today ? 'today' : ''}" data-day="${k}" title="${fmtShort(k)}: ${s}/5" aria-label="${fmtShort(k)}: ${s} von 5"></button>`);
    }
  }

  $('#view').innerHTML = `
    <header class="page-head"><h1>Konstanz</h1></header>
    <div class="stats">
      <div class="stat"><div class="num">${current}<small>T.</small></div><div class="lbl">Serie</div></div>
      <div class="stat"><div class="num">${longest}<small>T.</small></div><div class="lbl">Rekord</div></div>
      <div class="stat"><div class="num">${Math.round((total7 / 35) * 100)}<small>%</small></div><div class="lbl">Quote 7 T.</div></div>
      <div class="stat"><div class="num">${full30}<small>/30</small></div><div class="lbl">komplett</div></div>
    </div>

    <section class="card">
      <div class="card-head"><h2>Letzte 7 Tage</h2><span class="sub">ohne heute</span></div>
      <div class="quota">
        ${quota.map((q) => `
          <div class="quota-row"><span>${q.label}</span><div class="bar"><i style="width:${(q.n / 7) * 100}%"></i></div><span class="val">${q.n}/7</span></div>`).join('')}
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2>13 Wochen</h2><span class="sub">Tag antippen zum Ansehen</span></div>
      <div class="months">${monthLabels.map((m) => `<span>${m}</span>`).join('')}</div>
      <div class="heatmap">
        <div class="wd">${['Mo', '', 'Mi', '', 'Fr', '', 'So'].map((w) => `<span>${w}</span>`).join('')}</div>
        <div class="grid">${cells.join('')}</div>
      </div>
      <div class="legend">0 <i style="background:var(--well)"></i><i style="background:#2a2a3a"></i><i style="background:#4b3a2c"></i><i style="background:#7a5528"></i><i style="background:#b47c2c"></i><i style="background:var(--gold)"></i> 5</div>
    </section>
    <p class="foot">Komplett heißt: gewogen, Blutdruck morgens und abends gemessen, beide Tabletten in Apple Health protokolliert.</p>
  `;

  $$('.heatmap .cell[data-day]').forEach((c) => c.addEventListener('click', () => {
    state.date = c.dataset.day;
    state.tab = 'heute';
    render();
    $('#view').scrollTop = 0;
  }));
}

/* ---------- Verlauf ---------- */
async function renderVerlauf() {
  const today = todayKey();
  const n = state.verlaufTage;
  const from = addDays(today, -(n - 1));
  const [map, health, training] = await Promise.all([
    state.store.getRange(from, today),
    state.store.getHealthRange(from, today).catch(() => ({})),
    state.store.getTrainingRange(from, today).catch(() => ({})),
  ]);
  const ctl = keys0(from, n).map((k) => training[k]?.ctl ?? null);
  const atl = keys0(from, n).map((k) => training[k]?.atl ?? null);
  const tsb = keys0(from, n).map((k) => training[k]?.tsb ?? null);
  const tLast = keys0(from, n).map((k) => (training[k] ? training[k].last || null : null));
  const schweissListe = keys0(from, n).flatMap((k) => (training[k]?.aktivitaeten || [])
    .map((x) => ({ k, x, sw: schweiss(x, health[k]?.gewichtMessungen) })).filter((e) => e.sw)).reverse().slice(0, 5);
  const keys = Array.from({ length: n }, (_, i) => addDays(from, i));
  const val = (k, f) => f(map[k] || {});
  const hval = (k, f) => f(health[k] || {});
  const schlafH = keys.map((k) => hval(k, (h) => h.schlaf?.gesamt ?? null));
  const ruhepuls = keys.map((k) => hval(k, (h) => h.ruhepuls ?? null));
  const hrvs = keys.map((k) => hval(k, (h) => h.hrv ?? null));
  const fett = keys.map((k) => hval(k, (h) => h.koerperfett ?? null));
  const muskel = keys.map((k) => hval(k, (h) => h.muskelmasse ?? null));
  const fettAvg = movingAvg(fett, 7), muskelAvg = movingAvg(muskel, 7);
  const zuletzt = (arr) => [...arr].reverse().find((v) => v != null) ?? null;
  const veraenderung = (avgArr) => {
    const a = avgArr.find((v) => v != null), b = zuletzt(avgArr);
    return a != null && b != null ? b - a : null;
  };
  const signedFmt = (v) => (v == null ? '–' : (v > 0 ? '+' : '') + fmt(v));

  const weights = keys.map((k) => val(k, (d) => d.gewicht ?? null));
  const wAvg = movingAvg(weights, 7);
  const lastW = [...weights].reverse().find((v) => v != null) ?? null;
  const firstAvg = wAvg.find((v) => v != null) ?? null;
  const lastAvg = [...wAvg].reverse().find((v) => v != null) ?? null;
  const deltaW = firstAvg != null && lastAvg != null ? lastAvg - firstAvg : null;

  const mSys = keys.map((k) => val(k, (d) => d.bdMorgen?.sys ?? null));
  const mDia = keys.map((k) => val(k, (d) => d.bdMorgen?.dia ?? null));
  const aSys = keys.map((k) => val(k, (d) => d.bdAbend?.sys ?? null));
  const aDia = keys.map((k) => val(k, (d) => d.bdAbend?.dia ?? null));
  const daySys = keys.map((_, i) => avg([mSys[i], aSys[i]]));
  const dayDia = keys.map((_, i) => avg([mDia[i], aDia[i]]));
  const recent = (arr) => avg(arr.slice(-7));
  const puls = keys.map((k) => val(k, (d) => avg([d.bdMorgen?.puls, d.bdAbend?.puls])));

  const { grenzSys, grenzDia } = state.settings;
  const bpText = (s, d) => (s == null || d == null ? '–' : `${Math.round(s)}/${Math.round(d)}`);

  const C = { gold: '#f4b740', ember: '#f38b4a', coral: '#ee6352', blue: '#6ea8f5', sky: '#8fb6ff', violet: '#b49af5', ok: '#4fcf9e', grey: '#4a5878' };
  $('#view').innerHTML = `
    <header class="page-head">
      <h1>Verlauf</h1>
      <div class="seg-small" id="range">
        ${[30, 90, 180].map((v) => `<button data-v="${v}" class="${v === n ? 'on' : ''}">${v} T.</button>`).join('')}
      </div>
    </header>

    <section class="card">
      <div class="card-head"><h2>Gewicht</h2><span class="sub">kg · Punkte Messung, Linie Ø 7 Tage</span></div>
      ${weights.some((v) => v != null) ? lineChart(keys, [
        { values: weights, color: C.gold, type: 'dots' },
        { values: wAvg, color: C.ember, type: 'line', width: 2.5 },
      ], { height: 130 }) : '<div class="empty">Noch keine Gewichtswerte</div>'}
      <div class="kpis">
        <div class="kpi"><b>${fmt(lastW)}</b><span>zuletzt</span></div>
        <div class="kpi"><b>${fmt(lastAvg)}</b><span>Ø 7 Tage</span></div>
        <div class="kpi"><b>${deltaW == null ? '–' : (deltaW > 0 ? '+' : '') + fmt(deltaW)}</b><span>Veränderung</span></div>
      </div>
    </section>

    ${fett.some((v) => v != null) || muskel.some((v) => v != null) ? `
    <section class="card">
      <div class="card-head"><h2>Körperzusammensetzung</h2><span class="sub">Garmin-Waage</span></div>
      <div class="chart-sub">Körperfett %</div>
      ${lineChart(keys, [
        { values: fett, color: C.ember, type: 'dots' },
        { values: fettAvg, color: C.coral, type: 'line', width: 2.2 },
      ], { height: 96 })}
      <div class="chart-sub">Muskelmasse kg</div>
      ${lineChart(keys, [
        { values: muskel, color: C.sky, type: 'dots' },
        { values: muskelAvg, color: C.blue, type: 'line', width: 2.2 },
      ], { height: 96 })}
      <div class="kpis">
        <div class="kpi"><b>${fmt(zuletzt(fett))} %</b><span>Fett ${signedFmt(veraenderung(fettAvg))}</span></div>
        <div class="kpi"><b>${fmt(zuletzt(muskel))} kg</b><span>Muskeln ${signedFmt(veraenderung(muskelAvg))}</span></div>
      </div>
    </section>` : ''}

    <section class="card">
      <div class="card-head"><h2>Blutdruck</h2><span class="sub">mmHg</span></div>
      ${[...mSys, ...aSys].some((v) => v != null) ? lineChart(keys, [
        { values: mSys, color: C.coral, type: 'dots' },
        { values: aSys, color: C.coral, type: 'dots', hollow: true },
        { values: mDia, color: C.blue, type: 'dots' },
        { values: aDia, color: C.blue, type: 'dots', hollow: true },
        { values: movingAvg(daySys, 7), color: C.coral, type: 'line', width: 2 },
        { values: movingAvg(dayDia, 7), color: C.blue, type: 'line', width: 2 },
      ], { thresholds: [grenzSys, grenzDia].filter(Boolean), height: 160 }) : '<div class="empty">Noch keine Blutdruckwerte</div>'}
      <div class="chart-legend">
        <span><i style="background:${C.coral}"></i>systolisch</span>
        <span><i style="background:${C.blue}"></i>diastolisch</span>
        <span><i style="border:1.5px solid var(--muted);background:none;width:7px;height:7px"></i>abends</span>
        ${grenzSys || grenzDia ? `<span style="color:var(--gold)">- - Grenzwert</span>` : ''}
      </div>
      <div class="kpis">
        <div class="kpi"><b>${bpText(recent(mSys), recent(mDia))}</b><span>Ø morgens 7 T.</span></div>
        <div class="kpi"><b>${bpText(recent(aSys), recent(aDia))}</b><span>Ø abends 7 T.</span></div>
        <div class="kpi"><b>${recent(puls) == null ? '–' : Math.round(recent(puls))}</b><span>Ø Puls 7 T.</span></div>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Belastung</h2><span class="sub">Radtraining aus Analytics</span></div>
      ${ctl.some((v) => v != null) ? lineChart(keys, [
        { values: tLast, color: C.grey, type: 'dots' },
        { values: ctl, color: C.blue, type: 'line', width: 2.4 },
        { values: atl, color: C.coral, type: 'line', width: 1.8 },
      ], { height: 120 }) + lineChart(keys, [
        { values: tsb, color: C.gold, type: 'line', width: 2.2 },
      ], { thresholds: [0, -25], height: 80 }) : '<div class="empty">Noch keine Trainingsdaten</div>'}
      <div class="chart-legend"><span><i style="background:${C.blue}"></i>Fitness CTL</span><span><i style="background:${C.coral}"></i>Ermüdung ATL</span><span><i style="background:${C.gold}"></i>Form TSB</span><span><i style="background:${C.grey}"></i>Tageslast</span></div>
      ${schweissListe.length ? `
      <div class="chart-sub" style="margin-top:10px">Flüssigkeitsverlust je Einheit (1 kg ≈ 1 l)</div>
      <div>${schweissListe.map(({ k, x, sw }) => `
        <div class="schweiss-row"><span>${fmtShort(k)} ${escapeHtml(x.name || SPORT[x.typ] || 'Training')}, ${x.dauerMin} min</span>
          <strong>${sw.verlust > 0 ? `−${fmt(sw.verlust)} kg${sw.proStunde ? ` · ${fmt(sw.proStunde)} l/h` : ''}` : '± 0'}</strong></div>`).join('')}
      </div>` : ''}
    </section>

    <section class="card">
      <div class="card-head"><h2>Schlaf</h2><span class="sub">Stunden · Linie 6:30 h</span></div>
      ${schlafH.some((v) => v != null) ? lineChart(keys, [
        { values: schlafH, color: C.sky, type: 'dots' },
        { values: movingAvg(schlafH, 7), color: C.blue, type: 'line', width: 2 },
      ], { thresholds: [6.5], height: 110 }) : '<div class="empty">Noch keine Schlafdaten</div>'}
      <div class="kpis">
        <div class="kpi"><b>${hm(avg(schlafH.slice(-7)))}</b><span>Ø 7 Tage</span></div>
        <div class="kpi"><b>${hm(avg(schlafH))}</b><span>Ø Zeitraum</span></div>
        <div class="kpi"><b>${schlafH.filter((v) => v != null && v >= 6.5).length}</b><span>Nächte ≥ 6:30</span></div>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Ruhepuls &amp; HRV</h2><span class="sub">bpm · ms</span></div>
      ${ruhepuls.some((v) => v != null) ? lineChart(keys, [
        { values: ruhepuls, color: C.coral, type: 'dots' },
        { values: movingAvg(ruhepuls, 7), color: C.coral, type: 'line', width: 2 },
      ], { height: 96 }) : '<div class="empty">Noch keine Ruhepuls-Daten</div>'}
      ${hrvs.some((v) => v != null) ? lineChart(keys, [
        { values: hrvs, color: C.violet, type: 'dots' },
        { values: movingAvg(hrvs, 7), color: C.violet, type: 'line', width: 2 },
      ], { height: 96 }) : ''}
      <div class="chart-legend"><span><i style="background:${C.coral}"></i>Ruhepuls</span><span><i style="background:${C.violet}"></i>HRV</span></div>
    </section>
  `;

  $$('#range button').forEach((b) => b.addEventListener('click', () => {
    state.verlaufTage = Number(b.dataset.v);
    renderVerlauf();
  }));
}

function keys0(from, n) { return Array.from({ length: n }, (_, i) => addDays(from, i)); }

function movingAvg(values, win) {
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - win + 1), i + 1).filter((v) => v != null);
    return slice.length ? slice.reduce((s, v) => s + v, 0) / slice.length : null;
  });
}

function niceRange(min, max, maxSteps = 5) {
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const step = [0.5, 1, 2, 5, 10, 20, 25, 50].find((s) => span / s <= maxSteps) || 100;
  return { lo: Math.floor(min / step) * step, hi: Math.ceil(max / step) * step, step };
}

function lineChart(keys, series, opts = {}) {
  const W = 340, H = opts.height || 140, L = 28, R = 6, T = 8, B = 18;
  const all = series.flatMap((s) => s.values).concat(opts.thresholds || []).filter((v) => v != null);
  const { lo, hi, step } = opts.yMin != null
    ? { lo: opts.yMin, hi: opts.yMax, step: (opts.yMax - opts.yMin) / 5 }
    : niceRange(Math.min(...all), Math.max(...all), H < 120 ? 3 : 4);
  const n = keys.length;
  const x = (i) => L + (n <= 1 ? 0 : (i * (W - L - R)) / (n - 1));
  const y = (v) => T + ((hi - v) * (H - T - B)) / (hi - lo || 1);

  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">`;
  for (let v = lo; v <= hi + 1e-9; v += step) {
    svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>`;
    svg += `<text x="${L - 5}" y="${y(v) + 3}" text-anchor="end">${Number.isInteger(v) ? v : fmt(v)}</text>`;
  }
  for (const i of [0, Math.floor((n - 1) / 2), n - 1]) {
    svg += `<text x="${x(i)}" y="${H - 4}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${fmtShort(keys[i])}</text>`;
  }
  for (const t of opts.thresholds || []) {
    svg += `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="#f4b740" stroke-width="1" stroke-dasharray="3 4" opacity=".7"/>`;
  }
  const r = n > 120 ? 1.8 : n > 45 ? 2.4 : 3.2;
  for (const s of series) {
    if (s.type === 'line') {
      let d = '';
      s.values.forEach((v, i) => { if (v != null) d += `${d ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`; });
      if (d) svg += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2}" stroke-linejoin="round" stroke-linecap="round" opacity="0.9"/>`;
    } else {
      s.values.forEach((v, i) => {
        if (v == null) return;
        svg += s.hollow
          ? `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${r}" fill="#121e34" stroke="${s.color}" stroke-width="1.4" opacity="0.85"/>`
          : `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${r}" fill="${s.color}" opacity="0.55"/>`;
      });
    }
  }
  return svg + '</svg>';
}

/* ---------- Mehr ---------- */
async function renderMehr() {
  const demo = state.store.mode === 'demo';
  const s = state.settings;
  $('#view').innerHTML = `
    <header class="page-head"><h1>Mehr</h1></header>

    <section class="card">
      <div class="card-head"><h2>Erinnerungen per Mail</h2><span class="sub">nur wenn etwas fehlt</span></div>
      <div class="times">
        <div><span>Wiegen, Blutdruck, Morgentablette</span><strong>08:45</strong></div>
        <div><span>Blutdruck, Abendtablette und Offenes</span><strong>18:30</strong></div>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Datenquellen</h2></div>
      <div class="times">
        <div><span>Gewicht, Körperfett, Muskeln</span><strong style="color:var(--muted)">Garmin</strong></div>
        <div><span>Schlaf, Ruhepuls, HRV, Blutdruck</span><strong style="color:var(--muted)">Apple Health</strong></div>
        <div><span>Tabletten (nur von dort)</span><strong style="color:var(--muted)">Apple Health</strong></div>
        <div><span>Radtraining</span><strong style="color:var(--muted)">Analytics</strong></div>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Grenzwerte Blutdruck</h2><span class="sub">mit dem Hausarzt festlegen</span></div>
      <div class="bp" style="grid-template-columns:1fr 1fr">
        <label>Systolisch über<input id="grenz-sys" inputmode="numeric" placeholder="z. B. 135" value="${s.grenzSys ?? ''}"></label>
        <label>Diastolisch über<input id="grenz-dia" inputmode="numeric" placeholder="z. B. 85" value="${s.grenzDia ?? ''}"></label>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Bericht als PDF</h2><span class="sub">für den Hausarzt</span></div>
      <div class="seg-small" id="bericht-tage" style="margin-bottom:10px">
        ${[7, 14, 30, 90].map((v) => `<button data-v="${v}" class="${v === state.berichtTage ? 'on' : ''}">${v} Tage</button>`).join('')}
      </div>
      <label class="field" style="margin-bottom:10px"><span>Name im Bericht</span>
        <input id="bericht-name" placeholder="z. B. Johannes Backhaus, geb. 12.07.1963" value="${escapeHtml(s.berichtName || '')}" autocomplete="off">
      </label>
      <div class="btn-row">
        <button class="btn primary" id="bericht" style="flex:1.4">PDF speichern</button>
        <button class="btn" id="bericht-teilen" style="flex:1">Teilen …</button>
      </div>
      ${IST_IOS ? '<p class="hint">„PDF speichern“ öffnet das iOS-Menü – dort „In Dateien sichern“ wählen.</p>' : ''}
    </section>

    <section class="card">
      <div class="card-head"><h2>Daten</h2></div>
      <div class="list">
        <button class="btn block" id="export">Alle Daten als CSV exportieren</button>
        ${demo ? `
          <div class="btn-row">
            <button class="btn" id="demo-seed" style="flex:1">Beispieldaten erzeugen</button>
            <button class="btn danger" id="demo-clear" style="flex:1">Demo-Daten löschen</button>
          </div>` : ''}
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Konto</h2></div>
      <label class="switch-row">
        <span>Passwort beim Start abfragen</span>
        <input type="checkbox" id="require-pass-toggle" ${isPasswordRequired() ? 'checked' : ''}>
      </label>
      <p class="hint" style="margin:0 0 10px">${demo ? 'Demo-Modus: Alle Daten bleiben auf diesem Gerät.' : (state.user?.localFallback ? 'Direktstart ohne Passwort aktiv.' : `Angemeldet als ${escapeHtml(state.user?.email || '')}`)}</p>
      ${demo ? '' : (state.user?.localFallback
        ? '<button class="btn primary block" id="open-login">Mit Cloud-Konto anmelden</button>'
        : '<button class="btn danger block" id="logout">Abmelden</button>')}
    </section>

    <p class="foot" style="text-align:center">Gesundheitscockpit ${VERSION}</p>
  `;

  for (const [id, key] of [['grenz-sys', 'grenzSys'], ['grenz-dia', 'grenzDia']]) {
    $(`#${id}`).addEventListener('change', (e) => {
      const v = num(e.target.value);
      if (Number.isNaN(v) || (v != null && (v < 40 || v > 250))) { e.target.classList.add('invalid'); return; }
      e.target.classList.remove('invalid');
      state.settings = { ...state.settings, [key]: v == null ? null : Math.round(v) };
      state.store.saveSettings(state.settings).catch(saveErr);
      toast('Grenzwert gespeichert');
    });
  }
  $$('#bericht-tage button').forEach((b) => b.addEventListener('click', () => {
    state.berichtTage = Number(b.dataset.v);
    $$('#bericht-tage button').forEach((x) => x.classList.toggle('on', x === b));
  }));
  $('#bericht-name').addEventListener('change', (e) => {
    state.settings = { ...state.settings, berichtName: e.target.value.trim() || null };
    state.store.saveSettings(state.settings).catch(saveErr);
    toast('Name gespeichert');
  });
  $('#bericht').addEventListener('click', () => berichtAusgeben(false));
  $('#bericht-teilen').addEventListener('click', () => berichtAusgeben(true));
  $('#export').addEventListener('click', exportCsv);
  $('#require-pass-toggle')?.addEventListener('change', (e) => {
    const active = e.target.checked;
    setPasswordRequired(active);
    toast(active ? 'Passwortabfrage beim Start aktiviert' : 'Passwortabfrage beim Start deaktiviert');
  });
  $('#open-login')?.addEventListener('click', () => {
    state.forceLoginScreen = true;
    $('#app').hidden = true;
    $('#login').hidden = false;
  });
  $('#logout')?.addEventListener('click', () => {
    state.forceLoginScreen = true;
    sessionStorage.removeItem('gc_session_unlocked');
    state.store.logout();
  });
  $('#demo-seed')?.addEventListener('click', () => { state.store.seed(); toast('Beispieldaten erzeugt'); });
  $('#demo-clear')?.addEventListener('click', () => { state.store.clear(); toast('Demo-Daten gelöscht'); });
}

function escapeHtml(s) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

async function berichtAusgeben(teilen) {
  const btn = $(teilen ? '#bericht-teilen' : '#bericht');
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Wird erstellt …';
  try {
    const { blob, name } = await berichtErstellen(state.store, state.settings, state.berichtTage, `v${VERSION}`);
    const file = new File([blob], name, { type: 'application/pdf' });
    await dateiAusgeben(file, { teilen, was: 'Bericht' });
  } catch (e) {
    console.error(e);
    toast('Bericht konnte nicht erstellt werden', true);
  } finally {
    btn.disabled = false; btn.textContent = label;
  }
}

// iPhone/iPad: Downloads per Link (download-Attribut) funktionieren in der Home-Bildschirm-App nicht –
// iOS zeigt dann nur eine Vorschau („In … öffnen“) und sichert statt der Datei bloß den Link.
// Deshalb dort immer das Teilen-Menü mit der echten Datei („In Dateien sichern“, Mail, Drucken …).
const IST_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const kannDateiTeilen = (file) => !!(navigator.canShare && navigator.canShare({ files: [file] }));

async function dateiAusgeben(file, { teilen = false, was = 'Datei' } = {}) {
  const ueberMenue = kannDateiTeilen(file) && (teilen || IST_IOS);
  if (!ueberMenue) {
    herunterladen(file, file.name);
    toast(`${was} in „Downloads“ gespeichert`);
    return;
  }
  try {
    await navigator.share({ files: [file], title: file.name });
  } catch (e) {
    if (e.name === 'AbortError') return; // selbst abgebrochen
    // Meist NotAllowedError: Das Erstellen hat zu lange gedauert, iOS verlangt für das
    // Teilen-Menü einen frischen Tipp. Also fertige Datei mit eigenem Knopf anbieten.
    console.warn('Teilen ohne frischen Tipp nicht erlaubt', e);
    dateiBereitAnzeigen(file, was);
  }
}

function dateiBereitAnzeigen(file, was) {
  $('#datei-bereit')?.remove();
  const box = document.createElement('div');
  box.id = 'datei-bereit';
  box.className = 'datei-bereit';
  box.innerHTML = `
    <div class="datei-bereit-panel" role="dialog" aria-label="${escapeHtml(was)} ist fertig">
      <strong>${escapeHtml(was)} ist fertig</strong>
      <span class="muted small">${escapeHtml(file.name)}</span>
      <button class="btn primary block" data-a="teilen">${IST_IOS ? 'Sichern / Teilen …' : 'Teilen …'}</button>
      <button class="btn block" data-a="zu">Schließen</button>
    </div>`;
  const zu = () => box.remove();
  box.addEventListener('click', (e) => { if (e.target === box) zu(); });
  box.querySelector('[data-a="zu"]').addEventListener('click', zu);
  box.querySelector('[data-a="teilen"]').addEventListener('click', () => {
    // direkt im Tipp aufrufen – kein await davor, sonst verweigert iOS wieder
    navigator.share({ files: [file], title: file.name })
      .then(zu)
      .catch((e) => {
        if (e.name === 'AbortError') return;
        console.error(e);
        zu();
        herunterladen(file, file.name);
      });
  });
  document.body.appendChild(box);
}

function herunterladen(file, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

async function exportCsv() {
  const map = await state.store.getRange('2000-01-01', todayKey());
  const keys = Object.keys(map).sort();
  if (!keys.length) { toast('Noch keine Daten vorhanden'); return; }
  const n = (v, dec = 0) => (v == null ? '' : v.toLocaleString('de-DE', { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: false }));
  const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const head = ['Datum', 'Gewicht (kg)', 'Sys morgens', 'Dia morgens', 'Puls morgens', 'Zeit morgens', 'Morgentablette',
    'Sys abends', 'Dia abends', 'Puls abends', 'Zeit abends', 'Abendtablette', 'Befinden (1-5)', 'Notiz'];
  const rows = keys.map((k) => {
    const d = map[k];
    const bm = d.bdMorgen || {}, ba = d.bdAbend || {};
    return [parseKey(k).toLocaleDateString('de-DE'), n(d.gewicht, 1), n(bm.sys), n(bm.dia), n(bm.puls), bm.zeit || '', d.tabletteMorgen ? 'ja' : '',
      n(ba.sys), n(ba.dia), n(ba.puls), ba.zeit || '', d.tabletteAbend ? 'ja' : '', n(d.befinden), q(d.notiz)].join(';');
  });
  const csv = '﻿' + head.join(';') + '\n' + rows.join('\n');
  const name = `Gesundheitscockpit_${todayKey()}.csv`;
  const file = new File([csv], name, { type: 'text/csv' });
  await dateiAusgeben(file, { teilen: true, was: 'Export' });
}

boot();
