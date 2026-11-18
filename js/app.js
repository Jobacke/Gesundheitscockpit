import { firebaseConfig } from './firebase-config.js';
import { createStore } from './store.js';
import { berichtErstellen } from './bericht.js';

const VERSION = '1.8.0';
const REQUIRE_PASSWORD_KEY = 'gc_require_password';

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

  state.store.onAuth(async (user) => {
    $('#splash').hidden = true;
    if (!user) {
      if (isPasswordRequired() || state.forceLoginScreen) {
        state.user = null;
        $('#app').hidden = true;
        $('#login').hidden = false;
        return;
      }
      state.user = { email: 'backhaus.johannes@gmail.com', uid: 'Kbhtx1MbgMTJDdtdGyfp3DSfIk03', localFallback: true };
    } else {
      state.forceLoginScreen = false;
      state.user = user;
    }
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
    try {
      await state.store.login($('#login-email').value.trim(), $('#login-pass').value);
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
    window.scrollTo(0, 0);
  }));
}

function render() {
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
    <section class="hero">
      <div>
        <div class="date-nav">
          <button class="icon-btn" data-nav="-1" aria-label="Vorheriger Tag">‹</button>
          <label class="date-pick" title="Datum wählen">
            <div class="weekday">${isToday ? 'Heute, ' : ''}${weekday}</div>
            <div class="date">${dateStr}<svg class="cal-ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="3"/><path d="M3 9h18M8 2v4M16 2v4"/></svg></div>
            <input type="date" id="date-input" value="${d}" max="${today}" aria-label="Zu einem Datum springen">
          </label>
          <button class="icon-btn" data-nav="1" aria-label="Nächster Tag" ${isToday ? 'disabled' : ''}>›</button>
        </div>
        ${isToday ? '' : '<button class="today-link" id="to-today">Zurück zu heute</button>'}
      </div>
      <div class="ring" aria-label="Erledigte Aufgaben">
        <svg viewBox="0 0 68 68">
          <defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7cf2c4"/><stop offset="1" stop-color="#0b8a5f"/></linearGradient></defs>
          <circle class="track" cx="34" cy="34" r="28" fill="none" stroke-width="7"/>
          <circle class="bar" id="ring-bar" cx="34" cy="34" r="28" fill="none" stroke-width="7" stroke-dasharray="175.9" stroke-dashoffset="175.9"/>
        </svg>
        <div class="label"><span id="ring-num">0/5</span><small>erledigt</small></div>
      </div>
    </section>

    <div class="streak">
      <span class="chip ${current > 0 ? 'good' : ''}">Serie: <strong>${current}</strong> ${current === 1 ? 'Tag' : 'Tage'} vollständig</span>
    </div>

    ${erholungKarte(d, day, health, dienste, isToday, training)}

    <div class="card" id="card-morgen">
      <div class="card-head">
        <div><h2>Morgens</h2><div class="sub">Wiegen · Blutdruck · Tablette</div></div>
        <span class="badge" id="badge-morgen">0/3</span>
      </div>
      <div class="row">
        <label class="field"><span>Gewicht</span>
          <div class="input-unit"><input id="gewicht" inputmode="decimal" placeholder="z. B. 94,8" autocomplete="off"><em>kg</em></div>
          <div class="bp-time" id="gewicht-info"></div>
        </label>
        ${bpBlock('m', 'Blutdruck morgens')}
        ${toggleBtn('tabletteMorgen', 'Morgentablette genommen')}
        <div class="bp-time" id="tabletteMorgen-info"></div>
      </div>
    </div>

    <div class="card" id="card-abend">
      <div class="card-head">
        <div><h2>Abends</h2><div class="sub">${isToday && hour < 18 ? 'Erinnerung um 18:30 Uhr' : 'Blutdruck · Tablette'}</div></div>
        <span class="badge" id="badge-abend">0/2</span>
      </div>
      <div class="row">
        ${bpBlock('a', 'Blutdruck abends')}
        ${toggleBtn('tabletteAbend', 'Abendtablette genommen')}
        <div class="bp-time" id="tabletteAbend-info"></div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div><h2>Befinden</h2><div class="sub">optional</div></div></div>
      <div class="row">
        <div class="segmented" id="befinden">
          ${BEFINDEN.map((l, i) => `<button data-v="${i + 1}">${l}</button>`).join('')}
        </div>
        <div class="range-wrap">
          <div class="range-head"><span>Rücken (0 = keine Beschwerden, 10 = stark)</span><strong id="ruecken-val">–</strong></div>
          <input type="range" id="ruecken" min="0" max="10" step="1" value="0">
        </div>
        <label class="field"><span>Notiz</span><textarea id="notiz" placeholder="z. B. schlecht geschlafen, Kopfschmerzen, Nachtdienst …"></textarea></label>
      </div>
    </div>
  `;

  // Werte eintragen
  const g = $('#gewicht');
  if (day.gewicht != null) g.value = fmt(day.gewicht);
  const koerper = health[d] || {};
  $('#gewicht-info').textContent = [
    day.gewicht != null && day.gewichtQuelle ? `aus ${day.gewichtQuelle}` : '',
    koerper.koerperfett != null ? `Körperfett ${fmt(koerper.koerperfett)} %` : '',
    koerper.muskelmasse != null ? `Muskelmasse ${fmt(koerper.muskelmasse)} kg` : '',
  ].filter(Boolean).join(' · ');
  if ((koerper.gewichtMessungen || []).length > 1) {
    $('#gewicht-info').textContent += ` — Messungen: ${koerper.gewichtMessungen.map((m) => `${m.zeit} ${fmt(m.gewicht)}`).join(' · ')}`;
  }
  fillBp('m', day.bdMorgen);
  fillBp('a', day.bdAbend);
  fillBpWeitere('m', health[d]?.bdMessungen, day.bdMorgen);
  fillBpWeitere('a', health[d]?.bdMessungen, day.bdAbend);
  setToggle('tabletteMorgen', !!day.tabletteMorgen);
  setToggle('tabletteAbend', !!day.tabletteAbend);
  tabletteInfo('tabletteMorgen', day);
  tabletteInfo('tabletteAbend', day);
  setBefinden(day.befinden);
  setRuecken(day.ruecken);
  $('#notiz').value = day.notiz || '';
  updateProgress(day);

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

  // Tabletten
  for (const key of ['tabletteMorgen', 'tabletteAbend']) {
    $(`[data-toggle="${key}"]`).addEventListener('click', () => {
      const on = !day[key];
      setToggle(key, on);
      day[key + 'Quelle'] = 'Hand'; day[key + 'Zeit'] = null;
      tabletteInfo(key, day);
      save({ [key]: on, [key + 'Quelle']: 'Hand', [key + 'Zeit']: null }, on ? 'Tablette abgehakt' : null);
    });
  }

  // Befinden
  $$('#befinden button').forEach((b) => b.addEventListener('click', () => {
    const v = Number(b.dataset.v);
    const next = day.befinden === v ? null : v;
    setBefinden(next);
    save({ befinden: next });
  }));

  // Rücken
  const r = $('#ruecken');
  r.addEventListener('input', () => { $('#ruecken-val').textContent = r.value; r.classList.remove('unset'); });
  r.addEventListener('change', () => save({ ruecken: Number(r.value) }, 'Rücken gespeichert'));

  // Notiz
  $('#notiz').addEventListener('change', (e) => save({ notiz: e.target.value.trim() }, 'Notiz gespeichert'));
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
function schweissText(sw) {
  const basis = `vorher ${fmt(sw.vor.gewicht)} (${sw.vor.zeit}) → nachher ${fmt(sw.nach.gewicht)} kg (${sw.nach.zeit})`;
  if (sw.verlust <= 0) return `${basis}: kein Gewichtsverlust – gut getrunken`;
  return `${basis}: −${fmt(sw.verlust)} kg ≈ ${fmt(sw.verlust)} l Flüssigkeitsverlust${sw.proStunde ? ` (${fmt(sw.proStunde)} l/h)` : ''}, zzgl. Getrunkenem`;
}
function tsbTxt(t) { return `${t > 0 ? '+' : ''}${fmt(t, 0)}`; }

function ampel(d, q, day, health, dienste, training = {}) {
  const h = health[q] || {};
  const gruende = [];
  const add = (stufe, text) => gruende.push({ stufe, text });
  const { nachNacht, heute } = dienstInfo(d, dienste);
  if (nachNacht) add('gelb', `nach Nachtdienst (${nachNacht.titel.split(' ')[0]}, bis ${nachNacht.ende} Uhr)`);
  heute.forEach((x) => {
    if (x.art === 'nacht') add('gelb', `heute Nachtdienst ab ${x.start} Uhr`);
    else add('info', `heute ${DIENST_NAME[x.art] || 'Dienst'} ${x.start}–${x.ende} Uhr`);
  });

  const sch = h.schlaf?.gesamt;
  if (sch != null) {
    if (sch < 5) add('rot', `nur ${hm(sch)} Schlaf`);
    else if (sch < 6.5) add('gelb', `${hm(sch)} Schlaf`);
    else add('gruen', `${hm(sch)} Schlaf`);
  }
  const rp = h.ruhepuls, rpB = baseline(health, q, 'ruhepuls');
  if (rp != null && rpB != null) {
    const diff = rp - rpB;
    if (diff >= 5) add('rot', `Ruhepuls ${rp} (+${Math.round(diff)} über Ø)`);
    else if (diff >= 3) add('gelb', `Ruhepuls ${rp} (+${Math.round(diff)} über Ø)`);
    else add('gruen', `Ruhepuls ${rp} im Normalbereich`);
  }
  const hrv = h.hrv, hrvB = baseline(health, q, 'hrv');
  if (hrv != null && hrvB != null) {
    const q = hrv / hrvB;
    if (q <= 0.8) add('rot', `HRV ${hrv} ms (${Math.round((1 - q) * 100)} % unter Ø)`);
    else if (q <= 0.9) add('gelb', `HRV ${hrv} ms (${Math.round((1 - q) * 100)} % unter Ø)`);
    else add('gruen', `HRV ${hrv} ms im Normalbereich`);
  }
  const { gestern, form } = trainingInfo(d, training);
  if (form && form.tsb != null) {
    if (form.tsb < -25) add('rot', `Form (TSB) ${tsbTxt(form.tsb)} – stark belastet`);
    else if (form.tsb < -10) add('gelb', `Form (TSB) ${tsbTxt(form.tsb)} – belastet`);
    else add('gruen', `Form (TSB) ${tsbTxt(form.tsb)}`);
  }
  (gestern?.aktivitaeten || []).forEach((a) => add('info', `gestern: ${aktText(a)}`));
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
  const morgenTxt = morgen.length ? `Morgen: ${morgen.map((x) => `${DIENST_NAME[x.art] || 'Dienst'} ${x.start}–${x.ende}`).join(', ')}` : '';
  if (!h) {
    return `<div class="card"><div class="card-head"><div><h2>Erholung</h2><div class="sub">aus Apple Health</div></div></div>
      <div class="empty" style="padding:8px 0">Für diesen Tag sind noch keine Daten aus Health Auto Export angekommen.</div>
      ${morgenTxt ? `<p class="muted small" style="margin:6px 0 0">${morgenTxt}</p>` : ''}</div>`;
  }
  const stand = q !== d ? `Stand: ${q === addDays(d, -1) ? 'gestern' : 'vorgestern'} (${fmtShort(q)}) – die letzte Nacht kommt mit der nächsten Lieferung` : '';
  const a = ampel(d, q, day, health, dienste, training);
  const tr = trainingInfo(d, training);
  const heuteAkt = tr.heute?.aktivitaeten || [];
  const TXT = {
    gruen: ['Gut erholt', 'Training wie geplant möglich.'],
    gelb: ['Eingeschränkt erholt', 'Intensität reduzieren – lieber locker (Z1/Z2).'],
    rot: ['Schlecht erholt', 'Ruhetag oder nur sehr locker.'],
  };
  const s = h.schlaf;
  const pct = (x) => (s && s.gesamt ? Math.round((x / s.gesamt) * 100) : 0);
  const rpB = baseline(health, q, 'ruhepuls'), hrvB = baseline(health, q, 'hrv');
  return `
    <div class="card ampel-card ${a ? 'ampel-' + a.stufe : ''}">
      <div class="card-head">
        <div><h2>Erholung</h2><div class="sub">${stand || 'aus Apple Health'}</div></div>
        ${a ? `<span class="ampel-dot" aria-hidden="true"></span>` : ''}
      </div>
      ${a ? `<div class="ampel-text"><strong>${TXT[a.stufe][0]}</strong> – ${TXT[a.stufe][1]}</div>
      <ul class="ampel-gruende">${a.gruende.map((g) => `<li class="g-${g.stufe}">${escapeHtml(g.text)}</li>`).join('')}</ul>` : ''}
      <div class="kpis">
        <div class="kpi"><b>${hm(s?.gesamt)}</b><span>Schlaf${s?.start ? ` · ${s.start}–${s.ende}` : ''}</span></div>
        <div class="kpi"><b>${h.ruhepuls ?? '–'}</b><span>Ruhepuls${rpB ? ` · Ø ${Math.round(rpB)}` : ''}</span></div>
        <div class="kpi"><b>${h.hrv ?? '–'}</b><span>HRV ms${hrvB ? ` · Ø ${Math.round(hrvB)}` : ''}</span></div>
      </div>
      ${s ? `<div class="sleep-bar" title="Tief ${pct(s.tief)} % · REM ${pct(s.rem)} % · Kern ${pct(s.kern)} %">
          <i style="width:${pct(s.tief)}%;background:#1b6fb5"></i><i style="width:${pct(s.rem)}%;background:#5aa9f0"></i><i style="width:${pct(s.kern)}%;background:#2f3a46"></i></div>
        <div class="chart-legend"><span><i style="background:#1b6fb5"></i>Tief ${pct(s.tief)} %</span><span><i style="background:#5aa9f0"></i>REM ${pct(s.rem)} %</span><span><i style="background:#2f3a46"></i>Kern ${pct(s.kern)} %</span></div>` : ''}
      ${tr.form ? `<div class="kpis">
        <div class="kpi"><b>${fmt(tr.form.ctl, 0)}</b><span>Fitness (CTL)</span></div>
        <div class="kpi"><b>${fmt(tr.form.atl, 0)}</b><span>Ermüdung (ATL)</span></div>
        <div class="kpi"><b>${tsbTxt(tr.form.tsb)}</b><span>Form (TSB)${tr.formVomVortag ? ' · gestern' : ''}</span></div>
      </div>` : ''}
      ${heuteAkt.length ? `<div class="small" style="margin:10px 0 0;color:var(--text)">${d === todayKey() ? 'Heute' : 'An diesem Tag'} trainiert:${heuteAkt.map((x) => {
        const sw = schweiss(x, health[d]?.gewichtMessungen);
        return `<div style="margin-top:4px">${escapeHtml(aktText(x))}${sw ? `<div class="muted" style="margin-top:2px">⚖︎ ${escapeHtml(schweissText(sw))}</div>` : ''}</div>`;
      }).join('')}</div>` : ''}
      ${morgenTxt ? `<p class="small" style="margin:10px 0 0;color:var(--text)">${morgenTxt}</p>` : ''}
      <p class="muted small" style="margin:10px 0 0">Faustregel aus Schlaf, Ruhepuls, HRV, Form und Diensten im Vergleich zu deinen letzten 4 Wochen – dein Tages-Check bleibt maßgeblich.${tr.form ? '' : ' Trainingsdaten kommen aus Analytics, sobald dort abgeglichen wurde.'}</p>
    </div>`;
}

function bpBlock(p, title) {
  return `
    <div class="field">
      <span>${title}</span>
      <div class="bp">
        <label>Sys<input id="${p}-sys" data-bp="${p}" inputmode="numeric" pattern="[0-9]*" placeholder="–" autocomplete="off"></label>
        <label>Dia<input id="${p}-dia" data-bp="${p}" inputmode="numeric" pattern="[0-9]*" placeholder="–" autocomplete="off"></label>
        <label>Puls<input id="${p}-puls" data-bp="${p}" inputmode="numeric" pattern="[0-9]*" placeholder="–" autocomplete="off"></label>
      </div>
      <div class="bp-time" id="${p}-info"></div>
      <div class="bp-time" id="${p}-weitere"></div>
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
  const el = $(`#${p}-info`);
  if (!bp) { el.textContent = ''; return; }
  const parts = [];
  if (bp.zeit) parts.push(`gemessen um ${bp.zeit} Uhr`);
  if (bp.quelle) parts.push(`aus ${bp.quelle}`);
  if (bp.anzahl > 1) parts.push(`Ø aus ${bp.anzahl} Messungen`);
  if (overLimit(bp)) parts.push('⚠︎ über deinem Grenzwert');
  el.textContent = parts.join(' · ');
  el.style.color = overLimit(bp) ? 'var(--warn)' : '';
}
// Weitere Messreihen desselben Halbtags (z. B. nach der Tablette) – der Tageswert ist die erste Messreihe
function fillBpWeitere(p, messungen, bp) {
  const el = $(`#${p}-weitere`);
  if (!el) return;
  const halb = (messungen || []).filter((m) => m.zeit && (Number(m.zeit.slice(0, 2)) < 12) === (p === 'm'));
  const weitere = halb.filter((m) => !(bp && bp.zeit === m.zeit));
  if (!weitere.length) { el.textContent = ''; return; }
  const txt = weitere.map((m) => `${m.zeit} ${m.sys}/${m.dia}${m.puls ? ` · P ${m.puls}` : ''}${m.anzahl > 1 ? ` (Ø ${m.anzahl})` : ''}`).join('  |  ');
  el.textContent = `${bp && bp.zeit && halb.length > weitere.length ? 'Weitere Messungen' : 'Messungen'}: ${txt}`;
}
function toggleBtn(key, label) {
  return `<button class="toggle" data-toggle="${key}" type="button"><span class="dot"></span><span>${label}</span></button>`;
}
function tabletteInfo(key, day) {
  const el = $(`#${key}-info`);
  if (!el) return;
  el.textContent = day[key] && day[key + 'Quelle'] === 'Apple Health'
    ? `aus Apple Health${day[key + 'Zeit'] ? ` · eingenommen um ${day[key + 'Zeit']} Uhr` : ''}` : '';
}
function setToggle(key, on) { $(`[data-toggle="${key}"]`).classList.toggle('on', on); }
function setBefinden(v) { $$('#befinden button').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === v)); }
function setRuecken(v) {
  const r = $('#ruecken');
  if (v == null) { r.value = 0; r.classList.add('unset'); $('#ruecken-val').textContent = '–'; }
  else { r.value = v; r.classList.remove('unset'); $('#ruecken-val').textContent = v; }
}
function updateProgress(day) {
  const s = score(day);
  $('#ring-num').textContent = `${s}/5`;
  $('#ring-bar').style.strokeDashoffset = String(175.9 * (1 - s / 5));
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
    <h1 style="margin:4px 2px 14px">Konstanz</h1>
    <div class="stats">
      <div class="stat"><div class="num">${current}<small>${current === 1 ? 'Tag' : 'Tage'}</small></div><div class="lbl">aktuelle Serie</div></div>
      <div class="stat"><div class="num">${longest}<small>${longest === 1 ? 'Tag' : 'Tage'}</small></div><div class="lbl">längste Serie</div></div>
      <div class="stat"><div class="num">${Math.round((total7 / 35) * 100)}<small>%</small></div><div class="lbl">erledigt, letzte 7 Tage</div></div>
      <div class="stat"><div class="num">${full30}<small>/30</small></div><div class="lbl">Tage komplett (30 T.)</div></div>
    </div>

    <div class="card">
      <div class="card-head"><div><h2>Letzte 7 Tage</h2><div class="sub">ohne heute</div></div></div>
      <div class="quota">
        ${quota.map((q) => `
          <div class="quota-row"><span>${q.label}</span><div class="bar"><i style="width:${(q.n / 7) * 100}%"></i></div><span class="val">${q.n}/7</span></div>`).join('')}
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div><h2>Kalender</h2><div class="sub">13 Wochen · Tag antippen zum Nachtragen</div></div></div>
      <div class="months">${monthLabels.map((m) => `<span>${m}</span>`).join('')}</div>
      <div class="heatmap">
        <div class="wd">${['Mo', '', 'Mi', '', 'Fr', '', 'So'].map((w) => `<span>${w}</span>`).join('')}</div>
        <div class="grid">${cells.join('')}</div>
      </div>
      <div class="legend">0 <i style="background:#22262b"></i><i style="background:#144a37"></i><i style="background:#18684b"></i><i style="background:#1b8a62"></i><i style="background:#22b07c"></i><i style="background:#6ff0bd"></i> 5 Aufgaben</div>
    </div>
    <p class="muted small" style="margin:0 4px">„Komplett“ heißt: gewogen, Blutdruck morgens und abends gemessen, beide Tabletten abgehakt.</p>
  `;

  $$('.heatmap .cell[data-day]').forEach((c) => c.addEventListener('click', () => {
    state.date = c.dataset.day;
    state.tab = 'heute';
    render();
    window.scrollTo(0, 0);
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
    .map((x) => ({ k, x, sw: schweiss(x, health[k]?.gewichtMessungen) })).filter((e) => e.sw)).reverse().slice(0, 10);
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
  const ruecken = keys.map((k) => val(k, (d) => d.ruecken ?? null));

  const { grenzSys, grenzDia } = state.settings;
  const bpText = (s, d) => (s == null || d == null ? '–' : `${Math.round(s)}/${Math.round(d)}`);

  $('#view').innerHTML = `
    <div class="hero" style="margin-bottom:14px">
      <h1>Verlauf</h1>
      <div class="seg-small" id="range">
        ${[30, 90, 180].map((v) => `<button data-v="${v}" class="${v === n ? 'on' : ''}">${v} T.</button>`).join('')}
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h2>Gewicht</h2><span class="sub">kg</span></div>
      ${weights.some((v) => v != null) ? lineChart(keys, [
        { values: weights, color: '#7cf2c4', type: 'dots' },
        { values: wAvg, color: '#22c08a', type: 'line', width: 2.5 },
      ]) : '<div class="empty">Noch keine Gewichtswerte</div>'}
      <div class="chart-legend"><span><i style="background:#7cf2c4"></i>Messung</span><span><i style="background:#22c08a"></i>Ø 7 Tage</span></div>
      <div class="kpis">
        <div class="kpi"><b>${fmt(lastW)}</b><span>zuletzt</span></div>
        <div class="kpi"><b>${fmt(lastAvg)}</b><span>Ø 7 Tage</span></div>
        <div class="kpi"><b>${deltaW == null ? '–' : (deltaW > 0 ? '+' : '') + fmt(deltaW)}</b><span>Veränderung</span></div>
      </div>
    </div>

    ${fett.some((v) => v != null) || muskel.some((v) => v != null) ? `
    <div class="card">
      <div class="card-head"><div><h2>Körperzusammensetzung</h2><div class="sub">Garmin-Waage</div></div></div>
      <div class="sub" style="margin:2px 0 4px">Körperfett in %</div>
      ${lineChart(keys, [
        { values: fett, color: '#f2b84b', type: 'dots' },
        { values: fettAvg, color: '#e8644f', type: 'line', width: 2.5 },
      ], { height: 140 })}
      <div class="sub" style="margin:10px 0 4px">Muskelmasse in kg</div>
      ${lineChart(keys, [
        { values: muskel, color: '#8fc7ff', type: 'dots' },
        { values: muskelAvg, color: '#3d8bfd', type: 'line', width: 2.5 },
      ], { height: 140 })}
      <div class="chart-legend"><span><i style="background:#e8644f"></i>Körperfett Ø 7 Tage</span><span><i style="background:#3d8bfd"></i>Muskelmasse Ø 7 Tage</span></div>
      <div class="kpis" style="grid-template-columns:repeat(2,1fr)">
        <div class="kpi"><b>${fmt(zuletzt(fett))} %</b><span>Körperfett</span></div>
        <div class="kpi"><b>${signedFmt(veraenderung(fettAvg))}</b><span>Veränderung %</span></div>
        <div class="kpi"><b>${fmt(zuletzt(muskel))} kg</b><span>Muskelmasse</span></div>
        <div class="kpi"><b>${signedFmt(veraenderung(muskelAvg))}</b><span>Veränderung kg</span></div>
      </div>
    </div>` : ''}

    <div class="card">
      <div class="card-head"><h2>Blutdruck</h2><span class="sub">mmHg</span></div>
      ${[...mSys, ...aSys].some((v) => v != null) ? lineChart(keys, [
        { values: mSys, color: '#7cf2c4', type: 'dots' },
        { values: aSys, color: '#7cf2c4', type: 'dots', hollow: true },
        { values: mDia, color: '#5aa9f0', type: 'dots' },
        { values: aDia, color: '#5aa9f0', type: 'dots', hollow: true },
        { values: movingAvg(daySys, 7), color: '#7cf2c4', type: 'line', width: 2 },
        { values: movingAvg(dayDia, 7), color: '#5aa9f0', type: 'line', width: 2 },
      ], { thresholds: [grenzSys, grenzDia].filter(Boolean), height: 210 }) : '<div class="empty">Noch keine Blutdruckwerte</div>'}
      <div class="chart-legend">
        <span><i style="background:#7cf2c4"></i>Systolisch</span>
        <span><i style="background:#5aa9f0"></i>Diastolisch</span>
        <span><i style="border:2px solid #98a1a9;background:none;width:9px;height:9px"></i>abends</span>
        ${grenzSys || grenzDia ? '<span>--- Grenzwert</span>' : ''}
      </div>
      <div class="kpis">
        <div class="kpi"><b>${bpText(recent(mSys), recent(mDia))}</b><span>Ø morgens 7 T.</span></div>
        <div class="kpi"><b>${bpText(recent(aSys), recent(aDia))}</b><span>Ø abends 7 T.</span></div>
        <div class="kpi"><b>${recent(puls) == null ? '–' : Math.round(recent(puls))}</b><span>Ø Puls 7 T.</span></div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h2>Belastung</h2><span class="sub">aus Analytics</span></div>
      ${ctl.some((v) => v != null) ? lineChart(keys, [
        { values: tLast, color: '#5a6470', type: 'dots' },
        { values: ctl, color: '#5aa9f0', type: 'line', width: 2.5 },
        { values: atl, color: '#ef6a6a', type: 'line', width: 2 },
      ], { height: 170 }) + lineChart(keys, [
        { values: tsb, color: '#f2b84b', type: 'line', width: 2.5 },
      ], { thresholds: [0, -25], height: 120 }) : '<div class="empty">Noch keine Trainingsdaten – in Analytics den Abgleich einschalten</div>'}
      <div class="chart-legend"><span><i style="background:#5aa9f0"></i>Fitness (CTL)</span><span><i style="background:#ef6a6a"></i>Ermüdung (ATL)</span><span><i style="background:#f2b84b"></i>Form (TSB)</span><span><i style="background:#5a6470"></i>Tageslast</span></div>
      ${schweissListe.length ? `
      <div class="sub" style="margin:14px 0 6px">Flüssigkeitsverlust je Einheit (Waage vorher/nachher)</div>
      <div class="list">${schweissListe.map(({ k, x, sw }) => `
        <div class="schweiss-row"><span>${fmtShort(k)} · ${escapeHtml(x.name || SPORT[x.typ] || 'Training')} · ${x.dauerMin} min</span>
          <strong>${sw.verlust > 0 ? `−${fmt(sw.verlust)} kg${sw.proStunde ? ` · ${fmt(sw.proStunde)} l/h` : ''}` : '± 0'}</strong></div>`).join('')}
      </div>
      <p class="muted small" style="margin:8px 0 0">1 kg Gewichtsverlust ≈ 1 l Flüssigkeit; Getrunkenes während der Einheit kommt noch dazu.</p>` : ''}
    </div>

    <div class="card">
      <div class="card-head"><h2>Schlaf</h2><span class="sub">Stunden</span></div>
      ${schlafH.some((v) => v != null) ? lineChart(keys, [
        { values: schlafH, color: '#5aa9f0', type: 'dots' },
        { values: movingAvg(schlafH, 7), color: '#5aa9f0', type: 'line', width: 2 },
      ], { thresholds: [6.5], height: 160 }) : '<div class="empty">Noch keine Schlafdaten</div>'}
      <div class="kpis">
        <div class="kpi"><b>${hm(avg(schlafH.slice(-7)))}</b><span>Ø 7 Tage</span></div>
        <div class="kpi"><b>${hm(avg(schlafH))}</b><span>Ø Zeitraum</span></div>
        <div class="kpi"><b>${schlafH.filter((v) => v != null && v >= 6.5).length}</b><span>Nächte ≥ 6:30 h</span></div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h2>Ruhepuls &amp; HRV</h2><span class="sub">bpm · ms</span></div>
      ${ruhepuls.some((v) => v != null) ? lineChart(keys, [
        { values: ruhepuls, color: '#ef6a6a', type: 'dots' },
        { values: movingAvg(ruhepuls, 7), color: '#ef6a6a', type: 'line', width: 2 },
      ], { height: 140 }) : '<div class="empty">Noch keine Ruhepuls-Daten</div>'}
      ${hrvs.some((v) => v != null) ? lineChart(keys, [
        { values: hrvs, color: '#b38cf5', type: 'dots' },
        { values: movingAvg(hrvs, 7), color: '#b38cf5', type: 'line', width: 2 },
      ], { height: 140 }) : ''}
      <div class="chart-legend"><span><i style="background:#ef6a6a"></i>Ruhepuls</span><span><i style="background:#b38cf5"></i>HRV</span></div>
    </div>

    <div class="card">
      <div class="card-head"><h2>Rücken</h2><span class="sub">0–10</span></div>
      ${ruecken.some((v) => v != null) ? lineChart(keys, [
        { values: ruecken, color: '#f2b84b', type: 'dots' },
        { values: movingAvg(ruecken, 7), color: '#f2b84b', type: 'line', width: 2 },
      ], { yMin: 0, yMax: 10, height: 150 }) : '<div class="empty">Noch keine Einträge</div>'}
    </div>
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

function niceRange(min, max) {
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const step = [1, 2, 5, 10, 20, 25, 50].find((s) => span / s <= 5) || 100;
  return { lo: Math.floor(min / step) * step, hi: Math.ceil(max / step) * step, step };
}

function lineChart(keys, series, opts = {}) {
  const W = 340, H = opts.height || 180, L = 30, R = 8, T = 10, B = 22;
  const all = series.flatMap((s) => s.values).concat(opts.thresholds || []).filter((v) => v != null);
  const { lo, hi, step } = opts.yMin != null
    ? { lo: opts.yMin, hi: opts.yMax, step: (opts.yMax - opts.yMin) / 5 }
    : niceRange(Math.min(...all), Math.max(...all));
  const n = keys.length;
  const x = (i) => L + (n <= 1 ? 0 : (i * (W - L - R)) / (n - 1));
  const y = (v) => T + ((hi - v) * (H - T - B)) / (hi - lo || 1);

  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">`;
  for (let v = lo; v <= hi + 1e-9; v += step) {
    svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>`;
    svg += `<text x="${L - 5}" y="${y(v) + 3}" text-anchor="end">${Number.isInteger(v) ? v : fmt(v)}</text>`;
  }
  for (const i of [0, Math.floor((n - 1) / 2), n - 1]) {
    svg += `<text x="${x(i)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${fmtShort(keys[i])}</text>`;
  }
  for (const t of opts.thresholds || []) {
    svg += `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="#f2b84b" stroke-width="1.2" stroke-dasharray="4 4"/>`;
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
          ? `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${r}" fill="#1d2024" stroke="${s.color}" stroke-width="1.4" opacity="0.85"/>`
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
    <h1 style="margin:4px 2px 14px">Mehr</h1>

    <div class="card">
      <div class="card-head"><h2>Erinnerungen</h2></div>
      <div class="times">
        <div><span>Morgens: Wiegen, Blutdruck, Morgentablette</span><strong>08:45</strong></div>
        <div><span>Abends: Blutdruck, Abendtablette + Offenes</span><strong>18:30</strong></div>
      </div>
      <p class="hint" style="margin:10px 0 0">Der Empfänger prüft zu diesen Zeiten, was für heute noch fehlt, und schickt dann eine <b>Mail</b>. Ist alles eingetragen, kommt keine Mail (Anleitung: <b>EMPFAENGER.md</b>).</p>
    </div>

    <div class="card">
      <div class="card-head"><h2>Apple Health</h2></div>
      <p class="hint" style="margin:0">Schlaf, Ruhepuls, HRV, Gewicht und Blutdruck kommen automatisch über <b>Health Auto Export</b> (Anleitung: <b>EMPFAENGER.md</b>). Von Hand eingetragene Werte haben immer Vorrang.</p>
    </div>

    <div class="card">
      <div class="card-head"><div><h2>Grenzwerte Blutdruck</h2><div class="sub">optional</div></div></div>
      <div class="bp" style="grid-template-columns:1fr 1fr">
        <label>Systolisch über<input id="grenz-sys" inputmode="numeric" placeholder="z. B. 135" value="${s.grenzSys ?? ''}"></label>
        <label>Diastolisch über<input id="grenz-dia" inputmode="numeric" placeholder="z. B. 85" value="${s.grenzDia ?? ''}"></label>
      </div>
      <p class="hint" style="margin:10px 0 0">Bitte mit deinem Hausarzt festlegen. Werte darüber werden markiert und im Verlauf als Linie gezeigt.</p>
    </div>

    <div class="card">
      <div class="card-head"><div><h2>Bericht als PDF</h2><div class="sub">für die Woche oder den Hausarzt</div></div></div>
      <div class="seg-small" id="bericht-tage" style="margin-bottom:12px">
        ${[7, 14, 30, 90].map((v) => `<button data-v="${v}" class="${v === state.berichtTage ? 'on' : ''}">${v} Tage</button>`).join('')}
      </div>
      <label class="field" style="margin-bottom:12px"><span>Name im Bericht (optional)</span>
        <input id="bericht-name" placeholder="z. B. Johannes Backhaus, geb. 12.07.1963" value="${escapeHtml(s.berichtName || '')}" autocomplete="off" style="width:100%">
      </label>
      <div class="btn-row">
        <button class="btn primary" id="bericht" style="flex:1.4">PDF speichern</button>
        <button class="btn" id="bericht-teilen" style="flex:1">Teilen …</button>
      </div>
      <p class="hint" style="margin:10px 0 0">Enthält Blutdruck (Diagramm, Mittelwerte, Höchstwerte), Gewicht, Tabletten, Schlaf, Ruhepuls, HRV, Radtraining, Dienste und alle Tageswerte. „PDF speichern“ legt den Bericht in „Downloads“ ab, „Teilen …“ öffnet Mail, Nachrichten, Drucken usw.</p>
    </div>

    <div class="card">
      <div class="card-head"><h2>Daten</h2></div>
      <div class="list">
        <button class="btn block" id="export">Alle Daten als CSV exportieren</button>
        ${demo ? `
          <div class="btn-row">
            <button class="btn" id="demo-seed" style="flex:1">Beispieldaten erzeugen</button>
            <button class="btn danger" id="demo-clear" style="flex:1">Demo-Daten löschen</button>
          </div>` : ''}
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div><h2>Konto &amp; Sicherheit</h2><div class="sub">Passwortschutz optional</div></div></div>
      <label style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin:4px 0 12px;cursor:pointer">
        <span>Passwortabfrage beim Start verlangen</span>
        <input type="checkbox" id="require-pass-toggle" ${isPasswordRequired() ? 'checked' : ''} style="width:20px;height:20px">
      </label>
      <p class="muted small" style="margin:0 0 12px">${demo ? 'Demo-Modus: Alle Daten bleiben auf diesem Gerät.' : (state.user?.localFallback ? 'Direktstart aktiv (Johannes) – ohne Passwortabfrage beim Öffnen.' : `Cloud-Sync aktiv als ${escapeHtml(state.user?.email || '')}`)}</p>
      ${demo ? '' : (state.user?.localFallback
        ? '<button class="btn primary block" id="open-login">Mit Cloud-Konto anmelden (Sync)</button>'
        : '<button class="btn danger block" id="logout">Abmelden / Sperren</button>')}
    </div>

    <p class="muted small" style="text-align:center">Gesundheitscockpit ${VERSION}</p>
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
    if (teilen) await dateiTeilen(file, name);
    else { herunterladen(file, name); toast('Bericht in „Downloads“ gespeichert'); }
  } catch (e) {
    console.error(e);
    toast('Bericht konnte nicht erstellt werden', true);
  } finally {
    btn.disabled = false; btn.textContent = label;
  }
}

async function dateiTeilen(file, name) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  herunterladen(file, name);
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
    'Sys abends', 'Dia abends', 'Puls abends', 'Zeit abends', 'Abendtablette', 'Befinden (1-5)', 'Rücken (0-10)', 'Notiz'];
  const rows = keys.map((k) => {
    const d = map[k];
    const bm = d.bdMorgen || {}, ba = d.bdAbend || {};
    return [parseKey(k).toLocaleDateString('de-DE'), n(d.gewicht, 1), n(bm.sys), n(bm.dia), n(bm.puls), bm.zeit || '', d.tabletteMorgen ? 'ja' : '',
      n(ba.sys), n(ba.dia), n(ba.puls), ba.zeit || '', d.tabletteAbend ? 'ja' : '', n(d.befinden), n(d.ruecken), q(d.notiz)].join(';');
  });
  const csv = '﻿' + head.join(';') + '\n' + rows.join('\n');
  const name = `Gesundheitscockpit_${todayKey()}.csv`;
  const file = new File([csv], name, { type: 'text/csv' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

boot();
