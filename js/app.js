import { firebaseConfig } from './firebase-config.js';
import { createStore } from './store.js';

const VERSION = '1.0.0';

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

/* ---------- Start ---------- */
async function boot() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
  }

  try {
    state.store = await createStore(firebaseConfig);
  } catch (e) {
    console.error(e);
    $('#splash p').textContent = 'Verbindung fehlgeschlagen – bitte später erneut öffnen.';
    return;
  }
  if (state.store.mode === 'demo') $('#demo-banner').hidden = false;

  bindLogin();
  bindTabs();

  state.store.onAuth(async (user) => {
    state.user = user;
    $('#splash').hidden = true;
    if (!user) {
      $('#app').hidden = true;
      $('#login').hidden = false;
      return;
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
  const [day, range] = await Promise.all([
    state.store.getDay(d),
    state.store.getRange(addDays(today, -200), today),
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
          <div>
            <div class="weekday">${isToday ? 'Heute, ' : ''}${weekday}</div>
            <div class="date">${dateStr}</div>
          </div>
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

    <div class="card" id="card-morgen">
      <div class="card-head">
        <div><h2>Morgens</h2><div class="sub">Wiegen · Blutdruck · Tablette</div></div>
        <span class="badge" id="badge-morgen">0/3</span>
      </div>
      <div class="row">
        <label class="field"><span>Gewicht</span>
          <div class="input-unit"><input id="gewicht" inputmode="decimal" placeholder="z. B. 94,8" autocomplete="off"><em>kg</em></div>
        </label>
        ${bpBlock('m', 'Blutdruck morgens')}
        ${toggleBtn('tabletteMorgen', 'Morgentablette genommen')}
      </div>
    </div>

    <div class="card" id="card-abend">
      <div class="card-head">
        <div><h2>Abends</h2><div class="sub">${isToday && hour < 18 ? 'Erinnerung um 18:00 Uhr' : 'Blutdruck · Tablette'}</div></div>
        <span class="badge" id="badge-abend">0/2</span>
      </div>
      <div class="row">
        ${bpBlock('a', 'Blutdruck abends')}
        ${toggleBtn('tabletteAbend', 'Abendtablette genommen')}
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
  fillBp('m', day.bdMorgen);
  fillBp('a', day.bdAbend);
  setToggle('tabletteMorgen', !!day.tabletteMorgen);
  setToggle('tabletteAbend', !!day.tabletteAbend);
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
    if (v == null) { save({ gewicht: null }, 'Gewicht entfernt'); return; }
    if (!inRange(v, LIMITS.gewicht)) { g.classList.add('invalid'); toast('Gewicht bitte prüfen', true); return; }
    g.value = fmt(round1(v));
    g.classList.add('saved');
    save({ gewicht: round1(v) }, 'Gewicht gespeichert');
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
      save({ [key]: on }, on ? 'Tablette abgehakt' : null);
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

function bpBlock(p, title) {
  return `
    <div class="field">
      <span>${title}</span>
      <div class="bp">
        <label>Sys<input id="${p}-sys" data-bp="${p}" inputmode="numeric" pattern="[0-9]*" placeholder="128" autocomplete="off"></label>
        <label>Dia<input id="${p}-dia" data-bp="${p}" inputmode="numeric" pattern="[0-9]*" placeholder="82" autocomplete="off"></label>
        <label>Puls<input id="${p}-puls" data-bp="${p}" inputmode="numeric" pattern="[0-9]*" placeholder="60" autocomplete="off"></label>
      </div>
      <div class="bp-time" id="${p}-info"></div>
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
  if (overLimit(bp)) parts.push('⚠︎ über deinem Grenzwert');
  el.textContent = parts.join(' · ');
  el.style.color = overLimit(bp) ? 'var(--warn)' : '';
}
function toggleBtn(key, label) {
  return `<button class="toggle" data-toggle="${key}" type="button"><span class="dot"></span><span>${label}</span></button>`;
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
  const map = await state.store.getRange(from, today);
  const keys = Array.from({ length: n }, (_, i) => addDays(from, i));
  const val = (k, f) => f(map[k] || {});

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
        <div><span>Normaler Tag</span><strong>06:30</strong></div>
        <div><span>Nach Nachtdienst</span><strong>08:00</strong></div>
        <div><span>Abendrunde + Abendtablette</span><strong>18:00</strong></div>
      </div>
      <p class="hint" style="margin:10px 0 0">Die Erinnerungen kommen über iOS-Kurzbefehle-Automationen (Anleitung: <b>KURZBEFEHLE.md</b>). Um 18 Uhr wird zusätzlich ans Wiegen erinnert, falls heute noch kein Gewicht in Apple Health ist.</p>
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
      <div class="card-head"><h2>Konto</h2></div>
      <p class="muted small" style="margin:0 0 12px">${demo ? 'Demo-Modus: Es ist noch kein Firebase-Projekt eingetragen. Alle Daten bleiben auf diesem Gerät.' : `Angemeldet als ${escapeHtml(state.user?.email || '')}`}</p>
      ${demo ? '' : '<button class="btn danger block" id="logout">Abmelden</button>'}
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
  $('#export').addEventListener('click', exportCsv);
  $('#logout')?.addEventListener('click', () => state.store.logout());
  $('#demo-seed')?.addEventListener('click', () => { state.store.seed(); toast('Beispieldaten erzeugt'); });
  $('#demo-clear')?.addEventListener('click', () => { state.store.clear(); toast('Demo-Daten gelöscht'); });
}

function escapeHtml(s) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

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
