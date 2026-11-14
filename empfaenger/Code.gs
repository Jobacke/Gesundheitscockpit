/**
 * Gesundheitscockpit – Empfänger für Health Auto Export (REST API)
 * ---------------------------------------------------------------
 * Nimmt die JSON-Daten von Health Auto Export entgegen und schreibt sie in Firestore:
 *   users/{UID}/health/{JJJJ-MM-TT}  → Schlaf, Ruhepuls, HRV, Gewicht, Blutdruck-Messungen
 *   users/{UID}/tage/{JJJJ-MM-TT}    → füllt Gewicht und Blutdruck morgens/abends,
 *                                      aber NUR, wenn dort noch nichts von Hand eingetragen ist.
 *
 * Einrichtung: siehe EMPFAENGER.md
 */

const PROJECT_ID = 'gesundheitscockpit';
const UID = 'Kbhtx1MbgMTJDdtdGyfp3DSfIk03';  // Firebase → Authentication → Nutzer → „Nutzer-UID“
const TZ = 'Europe/Berlin';
const MORGEN_BIS_STUNDE = 12;                  // Messungen vor 12 Uhr = morgens, ab 12 Uhr = abends

const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

/* ---------- Web-App ---------- */

function doGet(e) {
  if (!keyOk_(e)) return text_('Kein Zugriff');
  return text_('Gesundheitscockpit-Empfänger läuft.');
}

function doPost(e) {
  if (!keyOk_(e)) return text_('Kein Zugriff');
  try {
    const payload = JSON.parse(e.postData.contents);
    const res = verarbeiten_(payload);
    log_('OK ' + JSON.stringify(res));
    return text_('OK ' + JSON.stringify(res));
  } catch (err) {
    log_('FEHLER ' + err);
    return text_('FEHLER ' + err);
  }
}

/* ---------- Einrichtung (einmal im Editor ausführen) ---------- */

function einrichten() {
  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty('KEY');
  if (!key) {
    key = Utilities.getUuid().replace(/-/g, '');
    props.setProperty('KEY', key);
  }
  if (UID.indexOf('HIER_') === 0) throw new Error('Bitte oben im Code bei UID deine Firebase-Nutzer-UID eintragen.');
  // Test-Schreibzugriff auf Firestore
  patch_(`users/${UID}/health/_test`, { test: 'ok', zeit: new Date().toISOString() });
  Logger.log('✓ Firestore-Zugriff funktioniert.');
  const url = ScriptApp.getService().getUrl();
  Logger.log('URL für Health Auto Export:\n' + (url ? url + '?key=' + key : '(erst bereitstellen, dann erneut ausführen)'));
}

/* ---------- Verarbeitung ---------- */

function verarbeiten_(payload) {
  const metrics = (payload && payload.data && payload.data.metrics) || [];
  const tage = {}; // datum → { health:{}, bd:[] }
  const tag = (d) => (tage[d] = tage[d] || { health: {}, bd: [] });

  metrics.forEach((m) => {
    const name = m.name;
    (m.data || []).forEach((e) => {
      const p = parseDate_(e.date);
      if (!p) return;
      const t = tag(p.datum);
      switch (name) {
        case 'weight_body_mass':
          if (isNum_(e.qty)) t.health.gewicht = round_(e.qty, 1);
          break;
        case 'resting_heart_rate':
          if (isNum_(e.qty)) t.health.ruhepuls = Math.round(e.qty);
          break;
        case 'heart_rate_variability':
          if (isNum_(e.qty)) (t.hrv = t.hrv || []).push(e.qty);
          break;
        case 'blood_pressure':
          if (isNum_(e.systolic) && isNum_(e.diastolic)) {
            t.bd.push({ sys: Math.round(e.systolic), dia: Math.round(e.diastolic), zeit: p.zeit, tagesmittel: p.zeit === '00:00' });
          }
          break;
        case 'sleep_analysis':
          if (isNum_(e.totalSleep) || isNum_(e.deep)) {
            // zusammengefasste Daten (pro Nacht)
            t.health.schlaf = {
              gesamt: round_(e.totalSleep || ((e.core || 0) + (e.deep || 0) + (e.rem || 0) + (e.asleep || 0)), 2),
              tief: round_(e.deep || 0, 2), rem: round_(e.rem || 0, 2), kern: round_(e.core || 0, 2),
              wach: round_(e.awake || 0, 2),
              start: zeitAus_(e.sleepStart || e.inBedStart), ende: zeitAus_(e.sleepEnd || e.inBedEnd),
            };
          } else if (e.value && isNum_(e.qty)) {
            // Einzelphasen: dem Tag des Phasen-Endes zuordnen
            const pe = parseDate_(e.endDate || e.end || e.date) || p;
            const tt = tag(pe.datum);
            const s = (tt.phasen = tt.phasen || { Core: 0, Deep: 0, REM: 0, Awake: 0, Asleep: 0, start: null, ende: null });
            const key = String(e.value);
            s[key] = (s[key] || 0) + e.qty;
            const ps = parseDate_(e.startDate || e.start || e.date);
            if (ps && (!s.start || ps.ts < s.start.ts)) s.start = ps;
            if (!s.ende || pe.ts > s.ende.ts) s.ende = pe;
          }
          break;
      }
    });
  });

  let geschrieben = 0, gefuellt = 0;
  Object.keys(tage).sort().forEach((datum) => {
    const t = tage[datum];
    if (t.hrv) t.health.hrv = Math.round(t.hrv.reduce((a, b) => a + b, 0) / t.hrv.length);
    if (t.phasen && !t.health.schlaf) {
      const s = t.phasen;
      t.health.schlaf = {
        gesamt: round_(s.Core + s.Deep + s.REM + s.Asleep, 2), tief: round_(s.Deep, 2), rem: round_(s.REM, 2),
        kern: round_(s.Core, 2), wach: round_(s.Awake, 2),
        start: s.start ? s.start.zeit : null, ende: s.ende ? s.ende.zeit : null,
      };
    }
    const einzel = t.bd.filter((b) => !b.tagesmittel).sort((a, b) => a.zeit.localeCompare(b.zeit));
    const mittel = t.bd.filter((b) => b.tagesmittel);
    if (einzel.length) t.health.bdMessungen = einzel.map((b) => ({ sys: b.sys, dia: b.dia, zeit: b.zeit }));
    if (mittel.length) t.health.bdTagesmittel = { sys: mittel[0].sys, dia: mittel[0].dia };

    if (Object.keys(t.health).length) {
      patch_(`users/${UID}/health/${datum}`, Object.assign({ datum: datum, aktualisiert: new Date().toISOString() }, t.health));
      geschrieben++;
    }

    // Tagesdokument nur dort ergänzen, wo noch nichts eingetragen ist
    const fill = {};
    const morgen = einzel.filter((b) => Number(b.zeit.slice(0, 2)) < MORGEN_BIS_STUNDE)[0];
    const abendListe = einzel.filter((b) => Number(b.zeit.slice(0, 2)) >= MORGEN_BIS_STUNDE);
    const abend = abendListe[abendListe.length - 1];
    if (t.health.gewicht != null || morgen || abend) {
      const vorhanden = getDoc_(`users/${UID}/tage/${datum}`) || {};
      if (t.health.gewicht != null && vorhanden.gewicht == null) { fill.gewicht = t.health.gewicht; fill.gewichtQuelle = 'Apple Health'; }
      if (morgen && vorhanden.bdMorgen == null) fill.bdMorgen = { sys: morgen.sys, dia: morgen.dia, puls: null, zeit: morgen.zeit, quelle: 'Apple Health' };
      if (abend && vorhanden.bdAbend == null) fill.bdAbend = { sys: abend.sys, dia: abend.dia, puls: null, zeit: abend.zeit, quelle: 'Apple Health' };
      if (Object.keys(fill).length) {
        fill.datum = datum;
        patch_(`users/${UID}/tage/${datum}`, fill);
        gefuellt++;
      }
    }
  });
  return { tage: Object.keys(tage).length, healthDokumente: geschrieben, ergaenzteTage: gefuellt };
}

/* ---------- Firestore (REST) ---------- */

function headers_() {
  return {
    Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
    'x-goog-user-project': PROJECT_ID,
  };
}

function patch_(path, obj) {
  const fields = {};
  Object.keys(obj).forEach((k) => (fields[k] = toValue_(obj[k])));
  const mask = Object.keys(obj).map((k) => 'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&');
  const res = UrlFetchApp.fetch(`${BASE}/${path}?${mask}`, {
    method: 'patch', contentType: 'application/json', headers: headers_(),
    payload: JSON.stringify({ fields: fields }), muteHttpExceptions: true,
  });
  if (res.getResponseCode() >= 300) throw new Error('Firestore ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 400));
}

function getDoc_(path) {
  const res = UrlFetchApp.fetch(`${BASE}/${path}`, { headers: headers_(), muteHttpExceptions: true });
  if (res.getResponseCode() === 404) return null;
  if (res.getResponseCode() >= 300) throw new Error('Firestore ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 400));
  const doc = JSON.parse(res.getContentText());
  const out = {};
  Object.keys(doc.fields || {}).forEach((k) => (out[k] = fromValue_(doc.fields[k])));
  return out;
}

function toValue_(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue_) } };
  const fields = {};
  Object.keys(v).forEach((k) => (fields[k] = toValue_(v[k])));
  return { mapValue: { fields: fields } };
}

function fromValue_(v) {
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue_);
  if ('mapValue' in v) {
    const o = {};
    Object.keys(v.mapValue.fields || {}).forEach((k) => (o[k] = fromValue_(v.mapValue.fields[k])));
    return o;
  }
  return null;
}

/* ---------- Hilfsfunktionen ---------- */

// "2026-11-14 06:41:00 +0100" → { datum: "2026-11-14", zeit: "06:41", ts } in deutscher Zeit
function parseDate_(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})\s*([+-]\d{2}):?(\d{2})/);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7]}:${m[8]}`;
  const d = new Date(iso);
  return { datum: Utilities.formatDate(d, TZ, 'yyyy-MM-dd'), zeit: Utilities.formatDate(d, TZ, 'HH:mm'), ts: d.getTime() };
}
function zeitAus_(s) { const p = parseDate_(s); return p ? p.zeit : null; }
function isNum_(x) { return typeof x === 'number' && isFinite(x); }
function round_(x, n) { const f = Math.pow(10, n); return Math.round(x * f) / f; }
function keyOk_(e) {
  const key = PropertiesService.getScriptProperties().getProperty('KEY');
  return key && e && e.parameter && e.parameter.key === key;
}
function text_(s) { return ContentService.createTextOutput(s).setMimeType(ContentService.MimeType.TEXT); }
function log_(s) {
  const p = PropertiesService.getScriptProperties();
  p.setProperty('LETZTER_EMPFANG', new Date().toISOString() + ' ' + String(s).slice(0, 400));
}

/* ---------- Test mit Beispieldaten (im Editor ausführen) ---------- */

function testMitBeispiel() {
  const heute = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const res = verarbeiten_({ data: { metrics: [
    { name: 'resting_heart_rate', units: 'count/min', data: [{ date: heute + ' 00:00:00 +0100', qty: 55 }] },
    { name: 'heart_rate_variability', units: 'ms', data: [{ date: heute + ' 00:00:00 +0100', qty: 42.4 }] },
  ] } });
  Logger.log(JSON.stringify(res));
}
