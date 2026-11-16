/**
 * Gesundheitscockpit – Empfänger für Health Auto Export (REST API)
 * ---------------------------------------------------------------
 * Nimmt die JSON-Daten von Health Auto Export entgegen und schreibt sie in Firestore:
 *   users/{UID}/health/{JJJJ-MM-TT}  → Schlaf, Ruhepuls, HRV, Gewicht, Blutdruck-Messungen
 *   users/{UID}/dienste/{JJJJ-MM-TT} → Dienste aus dem Kalender „Familie“ (Nacht/Spät/Tag/Früh)
 *   users/{UID}/training/{JJJJ-MM-TT}→ Trainingslast, CTL/ATL/TSB und Aktivitäten (von Analytics gesendet)
 *   users/{UID}/tage/{JJJJ-MM-TT}    → füllt Gewicht und Blutdruck morgens/abends,
 *                                      aber NUR, wenn dort noch nichts von Hand eingetragen ist.
 *
 * Einrichtung: siehe EMPFAENGER.md
 */

const PROJECT_ID = 'gesundheitscockpit';
const UID = 'Kbhtx1MbgMTJDdtdGyfp3DSfIk03';  // Firebase → Authentication → Nutzer → „Nutzer-UID“
const TZ = 'Europe/Berlin';
const MORGEN_BIS_STUNDE = 12;                  // Messungen vor 12 Uhr = morgens, ab 12 Uhr = abends
const KALENDER = 'Familie';                    // Kalender mit dem Dienstplan
const DIENST_TAGE_ZURUECK = 10, DIENST_TAGE_VOR = 7;

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
    if (payload && payload.typ === 'training') {
      const r = trainingSpeichern_(payload);
      log_('OK Training ' + JSON.stringify(r));
      return text_('OK ' + JSON.stringify(r));
    }
    const res = verarbeiten_(payload);
    try { res.dienste = dienstAktualisieren(); } catch (err) { res.dienste = 'Fehler: ' + err; }
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
  // Dienste aus dem Kalender + Zeitsteuerung alle 3 Stunden
  Logger.log('✓ Dienste übertragen: ' + dienstAktualisieren() + ' Tage');
  if (!ScriptApp.getProjectTriggers().some((t) => t.getHandlerFunction() === 'dienstAktualisieren')) {
    ScriptApp.newTrigger('dienstAktualisieren').timeBased().everyHours(3).create();
    Logger.log('✓ Zeitsteuerung für Dienste angelegt (alle 3 Stunden).');
  }
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

/* ---------- Training aus Analytics ---------- */

// payload = { typ:'training', quelle, version, einstellungen, tage:[{datum,last,ctl,atl,tsb,acwr,dauerH}], aktivitaeten:[{datum,start,name,typ,dauerMin,...,last}] }
function trainingSpeichern_(payload) {
  const tage = payload.tage || [];
  const proTag = {};
  (payload.aktivitaeten || []).forEach((a) => { (proTag[a.datum] = proTag[a.datum] || []).push(a); });
  const jetzt = new Date().toISOString();
  tage.forEach((t) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t.datum || '')) return;
    patch_(`users/${UID}/training/${t.datum}`, {
      datum: t.datum,
      last: num_(t.last), ctl: num_(t.ctl), atl: num_(t.atl), tsb: num_(t.tsb), acwr: num_(t.acwr), dauerH: num_(t.dauerH),
      aktivitaeten: (proTag[t.datum] || []).map((a) => ({
        start: String(a.start || ''), name: String(a.name || '').slice(0, 120), typ: String(a.typ || ''),
        dauerMin: num_(a.dauerMin), distanzKm: num_(a.distanzKm), hfAvg: num_(a.hfAvg), hfMax: num_(a.hfMax),
        wattAvg: num_(a.wattAvg), wattNp: num_(a.wattNp), last: num_(a.last),
      })),
      quelle: String(payload.quelle || 'Analytics') + ' ' + String(payload.version || ''),
      aktualisiert: jetzt,
    });
  });
  return { tage: tage.length, aktivitaeten: (payload.aktivitaeten || []).length };
}
function num_(x) { return typeof x === 'number' && isFinite(x) ? x : null; }

/* ---------- Dienste aus dem Kalender ---------- */

// Liest den Kalender und schreibt je Tag users/{UID}/dienste/{Datum} = { datum, liste: [...] }
function dienstAktualisieren() {
  const cal = CalendarApp.getCalendarsByName(KALENDER)[0];
  if (!cal) throw new Error(`Kalender „${KALENDER}“ nicht gefunden`);
  const heute = new Date();
  const von = new Date(heute.getTime() - DIENST_TAGE_ZURUECK * 864e5);
  const bis = new Date(heute.getTime() + (DIENST_TAGE_VOR + 1) * 864e5);
  const tage = {};
  for (let t = new Date(von); t <= bis; t = new Date(t.getTime() + 864e5)) {
    tage[Utilities.formatDate(t, TZ, 'yyyy-MM-dd')] = [];
  }
  cal.getEvents(von, bis).forEach((ev) => {
    if (ev.isAllDayEvent() || !istDienst_(ev)) return;
    const s = ev.getStartTime(), e = ev.getEndTime();
    const datum = Utilities.formatDate(s, TZ, 'yyyy-MM-dd');
    if (!tage[datum]) return;
    tage[datum].push({
      titel: ev.getTitle(),
      art: dienstArt_(ev.getTitle(), s, e),
      start: Utilities.formatDate(s, TZ, 'HH:mm'),
      ende: Utilities.formatDate(e, TZ, 'HH:mm'),
      endeDatum: Utilities.formatDate(e, TZ, 'yyyy-MM-dd'),
    });
  });
  Object.keys(tage).forEach((datum) => {
    tage[datum].sort((a, b) => a.start.localeCompare(b.start));
    patch_(`users/${UID}/dienste/${datum}`, { datum: datum, liste: tage[datum], aktualisiert: new Date().toISOString() });
  });
  return Object.keys(tage).length;
}

function istDienst_(ev) {
  const t = ev.getTitle() || '', ort = ev.getLocation() || '';
  return /schicht|dienst/i.test(t) || /^R[A-Z]{1,3}\b/.test(t) || /wache/i.test(ort);
}

function dienstArt_(titel, s, e) {
  if (/RN[MH]|nacht/i.test(titel)) return 'nacht';
  const sd = Utilities.formatDate(s, TZ, 'yyyy-MM-dd'), ed = Utilities.formatDate(e, TZ, 'yyyy-MM-dd');
  const h = Number(Utilities.formatDate(s, TZ, 'H'));
  if (sd !== ed || h >= 18) return 'nacht';
  if (h >= 12) return 'spaet';
  if (h < 7) return 'frueh';
  return 'tag';
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

/* ---------- Erinnerungs-Mails (08:45 und 18:30) ---------- */
// Läuft alle 15 Minuten (Zeitsteuerung aus erinnerungEinrichten). Ab 08:45 bzw. 18:30 wird einmal pro Tag
// geprüft, was im Cockpit für heute noch fehlt – nur dann geht eine Mail raus.
// Empfänger: Skripteigenschaft MAIL_AN (falls gesetzt), sonst das Google-Konto, dem dieses Skript gehört.

const COCKPIT_URL = 'https://cockpit.vjbackhaus.de';
const ERINNERUNG = [
  { name: 'morgens', ab: 8 * 60 + 45, felder: ['gewicht', 'bdMorgen', 'tabletteMorgen'] },
  { name: 'abends', ab: 18 * 60 + 30, felder: ['gewicht', 'bdMorgen', 'tabletteMorgen', 'bdAbend', 'tabletteAbend'] },
];
const ERINNERUNG_FENSTER_MIN = 120;   // wird der Zeitpunkt verpasst, holt das Skript ihn bis zu 2 Stunden später nach
const AUFGABE = {
  gewicht: 'Wiegen', bdMorgen: 'Blutdruck morgens', tabletteMorgen: 'Morgentablette',
  bdAbend: 'Blutdruck abends', tabletteAbend: 'Abendtablette',
};

function erinnerungEinrichten() {
  const da = ScriptApp.getProjectTriggers().some((t) => t.getHandlerFunction() === 'erinnerungPruefen');
  if (!da) ScriptApp.newTrigger('erinnerungPruefen').timeBased().everyMinutes(15).create();
  Logger.log(da ? '✓ Zeitsteuerung für Erinnerungen war schon vorhanden.' : '✓ Zeitsteuerung für Erinnerungen angelegt (alle 15 Minuten, Mails ab 08:45 und 18:30).');
  Logger.log('Mails gehen an: ' + empfaenger_());
  erinnerungTesten();
}

// Schickt sofort eine Test-Mail mit dem aktuellen Stand (unabhängig von der Uhrzeit)
function erinnerungTesten() {
  const datum = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const fehlt = fehlend_(datum, ERINNERUNG[1].felder);
  mailSenden_(datum, fehlt.length ? fehlt : ['(Test) – heute ist schon alles eingetragen'], 'Test');
  Logger.log('✓ Test-Mail gesendet. Fehlt heute: ' + (fehlt.map((f) => AUFGABE[f]).join(', ') || 'nichts'));
}

function erinnerungPruefen() {
  const jetzt = new Date();
  const datum = Utilities.formatDate(jetzt, TZ, 'yyyy-MM-dd');
  const minuten = Number(Utilities.formatDate(jetzt, TZ, 'H')) * 60 + Number(Utilities.formatDate(jetzt, TZ, 'm'));
  const props = PropertiesService.getScriptProperties();
  // Spätesten fälligen Zeitpunkt nehmen (abends vor morgens)
  const slot = ERINNERUNG.slice().reverse().find((s) => minuten >= s.ab && minuten < s.ab + ERINNERUNG_FENSTER_MIN);
  if (!slot) return;
  const merker = 'ERINNERUNG_' + slot.name.toUpperCase();
  if (props.getProperty(merker) === datum) return;   // heute schon geprüft
  const fehlt = fehlend_(datum, slot.felder);
  props.setProperty(merker, datum);
  if (fehlt.length) mailSenden_(datum, fehlt, slot.name);
  props.setProperty('LETZTE_ERINNERUNG', `${new Date().toISOString()} ${slot.name}: ${fehlt.length ? 'Mail – fehlt ' + fehlt.join(', ') : 'alles erledigt, keine Mail'}`);
}

function fehlend_(datum, felder) {
  const t = getDoc_(`users/${UID}/tage/${datum}`) || {};
  const erledigt = {
    gewicht: t.gewicht != null,
    bdMorgen: !!(t.bdMorgen && t.bdMorgen.sys != null),
    tabletteMorgen: t.tabletteMorgen === true,
    bdAbend: !!(t.bdAbend && t.bdAbend.sys != null),
    tabletteAbend: t.tabletteAbend === true,
  };
  return felder.filter((f) => !erledigt[f]);
}

function empfaenger_() {
  return PropertiesService.getScriptProperties().getProperty('MAIL_AN') || Session.getEffectiveUser().getEmail();
}

function mailSenden_(datum, fehlt, art) {
  const namen = fehlt.map((f) => AUFGABE[f] || f);
  const tag = Utilities.formatDate(new Date(datum + 'T12:00:00'), TZ, 'dd.MM.');
  const betreff = (art === 'Test' ? '[Test] ' : '') + `Gesundheitscockpit heute (${tag}) noch unvollständig`;
  const text = `Für heute (${tag}) fehlt im Gesundheitscockpit noch:\n\n${namen.map((n) => '• ' + n).join('\n')}\n\nZum Eintragen: ${COCKPIT_URL}\n\n` +
    'Hinweis: Gewicht und Blutdruck kommen über Apple Health mit etwas Verzögerung an. Hast du gerade erst gemessen, ist die Mail vermutlich schon erledigt.';
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:520px;color:#1f2933">
    <h2 style="color:#15294a;margin:0 0 6px">Noch offen für heute (${tag})</h2>
    <p style="margin:0 0 14px;color:#6b7785">Gesundheitscockpit – Erinnerung ${art === 'Test' ? '(Test)' : art}</p>
    <ul style="padding-left:20px;font-size:16px;line-height:1.7;margin:0 0 18px">${namen.map((n) => `<li><b>${n}</b></li>`).join('')}</ul>
    <a href="${COCKPIT_URL}" style="display:inline-block;background:#e8644f;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Cockpit öffnen</a>
    <p style="margin:18px 0 0;font-size:12px;color:#9aa5b1">Gewicht und Blutdruck kommen über Apple Health mit etwas Verzögerung an. Hast du gerade erst gemessen, ist diese Mail vermutlich schon erledigt.</p>
  </div>`;
  MailApp.sendEmail({ to: empfaenger_(), subject: betreff, body: text, htmlBody: html, name: 'Gesundheitscockpit' });
}
