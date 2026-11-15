// Arzt- und Wochenbericht als PDF (A4) aus den Daten des Cockpits
import { Pdf, A4, textWidth } from './pdf.js';

const M = 42;                 // Seitenrand
const CW = A4.w - 2 * M;      // nutzbare Breite
const BOTTOM = A4.h - 52;     // unterhalb davon steht die Fußzeile
const C = {
  text: '#1f2933', muted: '#6b7785', faint: '#9aa5b1', line: '#d5dbe1', box: '#f3f5f8', zebra: '#f7f8fa',
  head: '#15294a', akzent: '#e8644f', morgen: '#1f6fd1', abend: '#e8644f', grenz: '#d4952b', gewicht: '#2f855a', warn: '#c0392b',
};
const WT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const DIENST_KURZ = { nacht: 'Nacht', spaet: 'Spät', tag: 'Tag', frueh: 'Früh' };

/* ---------- kleine Helfer ---------- */
const keyOf = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
const parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return keyOf(d); };
const dm = (k) => { const d = parseKey(k); return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`; };
const dmy = (k) => `${dm(k)}${parseKey(k).getFullYear()}`;
const avg = (a) => { const v = a.filter((x) => x != null && !Number.isNaN(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
const de = (n, dec = 0) => (n == null || Number.isNaN(n) ? '–' : n.toLocaleString('de-DE', { minimumFractionDigits: dec, maximumFractionDigits: dec }));
const signed = (n, dec = 0) => {
  if (n == null) return '–';
  const r = Number(n.toFixed(dec));
  return `${r > 0 ? '+' : r < 0 ? '−' : '±'}${de(Math.abs(r), dec)}`;
};
const bpTxt = (b) => (b && b.sys != null && b.dia != null ? `${b.sys}/${b.dia}` : '–');
const hm = (h) => { if (h == null) return '–'; const m = Math.round(h * 60); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };
function niceRange(min, max, steps = 4) {
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const step = [1, 2, 5, 10, 20, 25, 50, 100].find((s) => span / s <= steps) || 200;
  return { lo: Math.floor(min / step) * step, hi: Math.ceil(max / step) * step, step };
}

/* ---------- Auswertung ---------- */
export function auswerten({ tage, health, dienste, training, settings, from, to, heute }) {
  const keys = [];
  for (let k = from; k <= to; k = addDays(k, 1)) keys.push(k);
  const over = (b) => !!b && ((settings.grenzSys && b.sys > settings.grenzSys) || (settings.grenzDia && b.dia > settings.grenzDia));

  const morgen = keys.map((k) => tage[k]?.bdMorgen).filter((b) => b?.sys != null);
  const abend = keys.map((k) => tage[k]?.bdAbend).filter((b) => b?.sys != null);
  const stat = (arr) => ({ n: arr.length, sys: avg(arr.map((b) => b.sys)), dia: avg(arr.map((b) => b.dia)), puls: avg(arr.map((b) => b.puls)) });
  const alle = [];
  keys.forEach((k) => {
    if (tage[k]?.bdMorgen?.sys != null) alle.push({ k, t: 'morgens', b: tage[k].bdMorgen });
    if (tage[k]?.bdAbend?.sys != null) alle.push({ k, t: 'abends', b: tage[k].bdAbend });
  });
  const max = alle.reduce((m, x) => (!m || x.b.sys > m.b.sys ? x : m), null);
  const min = alle.reduce((m, x) => (!m || x.b.sys < m.b.sys ? x : m), null);
  const ueber = alle.filter((x) => over(x.b)).length;

  const gew = keys.map((k) => ({ k, v: tage[k]?.gewicht ?? health[k]?.gewicht ?? null })).filter((x) => x.v != null);

  // Tabletten: gezählt ab dem ersten Tag mit Einträgen; der heutige Tag nur, wenn schon abgehakt
  const start = keys.find((k) => tage[k] && Object.keys(tage[k]).some((f) => f !== 'datum' && f !== 'aktualisiert'));
  const tab = { morgens: 0, abends: 0, basisM: 0, basisA: 0 };
  if (start) for (const k of keys.filter((x) => x >= start)) {
    const d = tage[k] || {};
    if (k < heute || d.tabletteMorgen) { tab.basisM++; if (d.tabletteMorgen) tab.morgens++; }
    if (k < heute || d.tabletteAbend) { tab.basisA++; if (d.tabletteAbend) tab.abends++; }
  }

  const tKeys = keys.filter((k) => training[k]);
  const tFirst = tKeys.length ? training[tKeys[0]] : null, tLast = tKeys.length ? training[tKeys[tKeys.length - 1]] : null;
  const einheiten = tKeys.reduce((s, k) => s + (training[k].aktivitaeten || []).length, 0);
  const stunden = tKeys.reduce((s, k) => s + (training[k].dauerH || 0), 0);

  const dienstZahl = {};
  keys.forEach((k) => (dienste[k]?.liste || []).forEach((x) => { dienstZahl[x.art] = (dienstZahl[x.art] || 0) + 1; }));

  return {
    keys, over,
    bp: { morgen: stat(morgen), abend: stat(abend), max, min, ueber, n: alle.length },
    gewicht: { werte: gew, avg: avg(gew.map((x) => x.v)), erst: gew[0] || null, letzt: gew[gew.length - 1] || null },
    tab,
    schlaf: avg(keys.map((k) => health[k]?.schlaf?.gesamt ?? null)),
    schlafN: keys.filter((k) => health[k]?.schlaf?.gesamt != null).length,
    ruhepuls: avg(keys.map((k) => health[k]?.ruhepuls ?? null)),
    hrv: avg(keys.map((k) => health[k]?.hrv ?? null)),
    befinden: avg(keys.map((k) => tage[k]?.befinden ?? null)),
    ruecken: avg(keys.map((k) => tage[k]?.ruecken ?? null)),
    training: { einheiten, stunden, ctlStart: tFirst?.ctl ?? null, ctlEnde: tLast?.ctl ?? null, tsbEnde: tLast?.tsb ?? null, vorhanden: tKeys.length > 0 },
    dienstZahl,
    notizen: keys.filter((k) => tage[k]?.notiz).map((k) => ({ k, text: String(tage[k].notiz) })),
  };
}

/* ---------- PDF ---------- */
export async function berichtErstellen(store, settings, tageAnzahl, version) {
  const heute = keyOf(new Date());
  const from = addDays(heute, -(tageAnzahl - 1));
  const [tage, health, dienste, training] = await Promise.all([
    store.getRange(from, heute),
    store.getHealthRange(from, heute).catch(() => ({})),
    store.getDiensteRange(from, heute).catch(() => ({})),
    store.getTrainingRange(from, heute).catch(() => ({})),
  ]);
  const a = auswerten({ tage, health, dienste, training, settings, from, to: heute, heute });
  const pdf = new Pdf();
  let y = 0;

  const ensure = (h) => { if (y + h > BOTTOM) { pdf.addPage(); y = 50; return true; } return false; };
  const section = (title, sub) => {
    ensure(40);
    y += 22;
    pdf.text(M, y, title, { size: 12.5, bold: true, color: C.head });
    if (sub) pdf.text(M + textWidth(title, 12.5, true) + 8, y, sub, { size: 8.5, color: C.muted });
    y += 6;
    pdf.line(M, y, M + CW, y, { color: C.line, w: 0.6 });
    y += 4;
  };

  /* Kopf */
  y = 56;
  pdf.text(M, y, 'Gesundheitsbericht', { size: 21, bold: true, color: C.head });
  pdf.text(M + CW, y - 8, `${dmy(from)} – ${dmy(heute)}`, { size: 10, bold: true, align: 'right' });
  pdf.text(M + CW, y + 5, `${tageAnzahl} Tage · erstellt am ${dmy(heute)}`, { size: 8.5, color: C.muted, align: 'right' });
  if (settings.berichtName) { y += 17; pdf.text(M, y, settings.berichtName, { size: 10.5, color: C.text }); }
  y += 12;
  pdf.rect(M, y, CW, 2, { fill: C.akzent });
  y += 14;

  /* Kennzahlen */
  const bw = (CW - 3 * 8) / 4, bh = 58;
  const boxes = [
    ['Blutdruck morgens', a.bp.morgen.n ? `Ø ${de(a.bp.morgen.sys)}/${de(a.bp.morgen.dia)}` : '–', a.bp.morgen.n ? `${a.bp.morgen.n} Messungen · Puls ${de(a.bp.morgen.puls)}` : 'keine Messungen'],
    ['Blutdruck abends', a.bp.abend.n ? `Ø ${de(a.bp.abend.sys)}/${de(a.bp.abend.dia)}` : '–', a.bp.abend.n ? `${a.bp.abend.n} Messungen · Puls ${de(a.bp.abend.puls)}` : 'keine Messungen'],
    ['Gewicht', a.gewicht.avg != null ? `Ø ${de(a.gewicht.avg, 1)} kg` : '–', a.gewicht.werte.length > 1 ? `${signed(a.gewicht.letzt.v - a.gewicht.erst.v, 1)} kg im Zeitraum` : `${a.gewicht.werte.length} Messung(en)`],
    ['Tabletten', a.tab.basisM + a.tab.basisA ? `${a.tab.morgens + a.tab.abends} von ${a.tab.basisM + a.tab.basisA}` : '–', `morgens ${a.tab.morgens}/${a.tab.basisM} · abends ${a.tab.abends}/${a.tab.basisA}`],
  ];
  boxes.forEach(([t, v, s], i) => {
    const x = M + i * (bw + 8);
    pdf.rect(x, y, bw, bh, { fill: C.box });
    pdf.rect(x, y, 3, bh, { fill: i < 2 ? (i === 0 ? C.morgen : C.abend) : i === 2 ? C.gewicht : C.head });
    pdf.text(x + 11, y + 15, t, { size: 8, color: C.muted });
    pdf.text(x + 11, y + 34, v, { size: 15, bold: true, color: C.text });
    pdf.text(x + 11, y + 48, pdf.fit(s, bw - 16, 7.5), { size: 7.5, color: C.muted });
  });
  y += bh;

  /* Blutdruck */
  section('Blutdruck', 'mmHg · Heimmessung · Balken = systolisch bis diastolisch');
  if (a.bp.n) {
    y += 4;
    bpChart(pdf, M, y, CW, 160, a, tage, settings);
    y += 160 + 12;
    legend(pdf, M, y, [[C.morgen, 'morgens'], [C.abend, 'abends'], ...(settings.grenzSys || settings.grenzDia ? [[C.grenz, `Grenzwert ${settings.grenzSys ?? '–'}/${settings.grenzDia ?? '–'}`, true]] : [])]);
    y += 16;
    const zeilen = [
      `Höchster Wert: ${bpTxt(a.bp.max.b)} am ${dm(a.bp.max.k)} ${a.bp.max.t}   ·   Niedrigster Wert: ${bpTxt(a.bp.min.b)} am ${dm(a.bp.min.k)} ${a.bp.min.t}`,
    ];
    if (settings.grenzSys || settings.grenzDia) zeilen.push(`Über dem Grenzwert: ${a.bp.ueber} von ${a.bp.n} Messungen`);
    for (const z of zeilen) { pdf.text(M, y, z, { size: 9 }); y += 13; }
  } else { y += 14; pdf.text(M, y, 'Im Zeitraum keine Blutdruckmessungen.', { size: 9, color: C.muted }); y += 6; }

  /* Gewicht */
  section('Gewicht', 'kg');
  if (a.gewicht.werte.length) {
    y += 4;
    weightChart(pdf, M, y, CW, 95, a);
    y += 95 + 8;
  } else { y += 14; pdf.text(M, y, 'Im Zeitraum keine Gewichtswerte.', { size: 9, color: C.muted }); y += 6; }

  /* Erholung & Belastung */
  section('Erholung & Belastung', 'Apple Watch · Analytics (nur Radtraining) · Dienstplan');
  const dz = Object.entries(a.dienstZahl).map(([k, n]) => `${n}× ${DIENST_KURZ[k] || k}`).join(', ');
  const kv = [
    ['Schlaf Ø', a.schlaf != null ? `${hm(a.schlaf)} h (${a.schlafN} Nächte)` : '–'],
    ['Ruhepuls Ø', a.ruhepuls != null ? `${de(a.ruhepuls)} bpm` : '–'],
    ['Herzfrequenzvariabilität Ø', a.hrv != null ? `${de(a.hrv)} ms` : '–'],
    ['Befinden Ø (1–5)', a.befinden != null ? de(a.befinden, 1) : '–'],
    ['Radtraining', a.training.vorhanden ? `${a.training.einheiten} Einheiten, ${de(a.training.stunden, 1)} h` : '–'],
    ['Fitness (CTL)', a.training.ctlEnde != null ? `${de(a.training.ctlEnde)} (${signed(a.training.ctlEnde - a.training.ctlStart)} im Zeitraum)` : '–'],
    ['Form (TSB) zuletzt', a.training.tsbEnde != null ? signed(a.training.tsbEnde) : '–'],
    ['Dienste', dz || 'keine'],
  ];
  if (a.ruecken != null) kv.splice(4, 0, ['Rücken Ø (0–10)', de(a.ruecken, 1)]);
  const half = Math.ceil(kv.length / 2), colW = CW / 2;
  ensure(half * 15 + 10);
  y += 14;
  kv.forEach(([k, v], i) => {
    const x = M + (i < half ? 0 : colW), yy = y + (i % half) * 15;
    pdf.text(x, yy, k, { size: 9, color: C.muted });
    pdf.text(x + 128, yy, pdf.fit(v, colW - 140, 9, true), { size: 9, bold: true });
  });
  y += (half - 1) * 15 + 6;

  /* Tageswerte */
  pdf.addPage(); y = 50;
  pdf.text(M, y, 'Tageswerte', { size: 12.5, bold: true, color: C.head });
  pdf.text(M + textWidth('Tageswerte', 12.5, true) + 8, y, 'BD in mmHg · Tabletten M = morgens, A = abends', { size: 8.5, color: C.muted });
  y += 10;
  const cols = [
    ['Datum', 58, 'l'], ['Gewicht', 46, 'r'], ['BD morgens', 62, 'r'], ['Zeit', 36, 'r'], ['Puls', 32, 'r'],
    ['BD abends', 62, 'r'], ['Zeit', 36, 'r'], ['Puls', 32, 'r'], ['Tabl.', 40, 'c'], ['Schlaf', 42, 'r'], ['Dienst', 65, 'l'],
  ];
  const head = () => {
    pdf.rect(M, y, CW, 17, { fill: C.head });
    let x = M;
    for (const [t, w, al] of cols) {
      const tx = al === 'r' ? x + w - 5 : al === 'c' ? x + w / 2 : x + 5;
      pdf.text(tx, y + 11.5, t, { size: 8, bold: true, color: '#ffffff', align: al === 'r' ? 'right' : al === 'c' ? 'center' : 'left' });
      x += w;
    }
    y += 17;
  };
  head();
  a.keys.forEach((k, i) => {
    if (y + 15 > BOTTOM) { pdf.addPage(); y = 50; head(); }
    const d = tage[k] || {}, h = health[k] || {};
    if (i % 2) pdf.rect(M, y, CW, 15, { fill: C.zebra });
    const g = d.gewicht ?? h.gewicht ?? null;
    const tabl = `${d.tabletteMorgen ? 'M' : '–'} ${d.tabletteAbend ? 'A' : '–'}`;
    const dl = (dienste[k]?.liste || []).map((x) => DIENST_KURZ[x.art] || x.art).join(', ');
    const cells = [
      [`${WT[parseKey(k).getDay()]} ${dm(k)}`], [g != null ? de(g, 1) : '–'],
      [bpTxt(d.bdMorgen), a.over(d.bdMorgen)], [d.bdMorgen?.zeit || '–'], [d.bdMorgen?.puls != null ? String(d.bdMorgen.puls) : '–'],
      [bpTxt(d.bdAbend), a.over(d.bdAbend)], [d.bdAbend?.zeit || '–'], [d.bdAbend?.puls != null ? String(d.bdAbend.puls) : '–'],
      [tabl], [hm(h.schlaf?.gesamt ?? null)], [dl || ''],
    ];
    let x = M;
    cells.forEach(([t, warn], ci) => {
      const [, w, al] = cols[ci];
      const tx = al === 'r' ? x + w - 5 : al === 'c' ? x + w / 2 : x + 5;
      const leer = t === '–';
      pdf.text(tx, y + 10.5, pdf.fit(t, w - 8, 8.5, !!warn), { size: 8.5, bold: !!warn, color: warn ? C.warn : leer ? C.faint : C.text, align: al === 'r' ? 'right' : al === 'c' ? 'center' : 'left' });
      x += w;
    });
    y += 15;
  });
  pdf.line(M, y, M + CW, y, { color: C.line });
  if (settings.grenzSys || settings.grenzDia) {
    y += 13;
    pdf.text(M, y, `Rot und fett: über dem Grenzwert ${settings.grenzSys ?? '–'}/${settings.grenzDia ?? '–'} mmHg.`, { size: 8, color: C.muted });
  }

  /* Notizen */
  if (a.notizen.length) {
    section('Notizen');
    y += 6;
    for (const n of a.notizen) {
      const lines = pdf.wrap(n.text, CW - 70, 9);
      ensure(lines.length * 12 + 6);
      y += 8;
      pdf.text(M, y, `${WT[parseKey(n.k).getDay()]} ${dm(n.k)}`, { size: 9, bold: true });
      lines.forEach((l, j) => pdf.text(M + 70, y + j * 12, l, { size: 9 }));
      y += (lines.length - 1) * 12 + 4;
    }
  }

  /* Fußzeilen */
  const n = pdf.pageCount;
  for (let i = 0; i < n; i++) {
    pdf.onPage(i);
    pdf.line(M, A4.h - 38, M + CW, A4.h - 38, { color: C.line });
    pdf.text(M, A4.h - 26, `Gesundheitscockpit ${version} · selbst erfasste Werte (Heimmessung, Apple Health, Analytics) · kein ärztlicher Befund`, { size: 7, color: C.faint });
    pdf.text(M + CW, A4.h - 26, `Seite ${i + 1} von ${n}`, { size: 7, color: C.faint, align: 'right' });
  }

  const blob = pdf.toBlob({ title: `Gesundheitsbericht ${dmy(from)} – ${dmy(heute)}` });
  return { blob, name: `Gesundheitsbericht_${from}_bis_${heute}.pdf` };
}

/* ---------- Diagramme ---------- */
function axes(pdf, x0, y0, w, h, keys, lo, hi, step, L = 30) {
  const n = keys.length;
  const X = (i) => x0 + L + (n <= 1 ? (w - L) / 2 : 6 + (i * (w - L - 12)) / (n - 1));
  const Yv = (v) => y0 + ((hi - v) * (h - 16)) / (hi - lo || 1);
  for (let v = lo; v <= hi + 1e-9; v += step) {
    pdf.line(x0 + L, Yv(v), x0 + w, Yv(v), { color: '#e6eaee', w: 0.5 });
    pdf.text(x0 + L - 5, Yv(v) + 2.5, de(v), { size: 7, color: C.muted, align: 'right' });
  }
  const every = Math.max(1, Math.ceil(n / 10));
  keys.forEach((k, i) => {
    if (i % every && i !== n - 1) return;
    if (i !== n - 1 && n - 1 - i < every) return;
    pdf.text(X(i), y0 + h - 2, dm(k), { size: 7, color: C.muted, align: 'center' });
  });
  return { X, Yv };
}

function bpChart(pdf, x0, y0, w, h, a, tage, settings) {
  const vals = [];
  a.keys.forEach((k) => ['bdMorgen', 'bdAbend'].forEach((f) => { const b = tage[k]?.[f]; if (b?.sys != null) vals.push(b.sys, b.dia); }));
  if (settings.grenzSys) vals.push(settings.grenzSys);
  if (settings.grenzDia) vals.push(settings.grenzDia);
  const { lo, hi, step } = niceRange(Math.min(...vals) - 5, Math.max(...vals) + 5, 5);
  const { X, Yv } = axes(pdf, x0, y0, w, h, a.keys, lo, hi, step);
  for (const g of [settings.grenzSys, settings.grenzDia]) if (g) pdf.line(x0 + 30, Yv(g), x0 + w, Yv(g), { color: C.grenz, w: 0.9, dash: [3, 3] });
  const n = a.keys.length;
  const gap = n <= 1 ? 20 : (w - 42) / (n - 1);
  const off = Math.min(4, gap * 0.22), r = n > 60 ? 1.3 : n > 20 ? 1.8 : 2.4, lw = n > 60 ? 0.9 : 1.6;
  a.keys.forEach((k, i) => {
    [['bdMorgen', C.morgen, -off], ['bdAbend', C.abend, off]].forEach(([f, col, dx]) => {
      const b = tage[k]?.[f];
      if (b?.sys == null || b?.dia == null) return;
      const x = X(i) + dx;
      pdf.line(x, Yv(b.sys), x, Yv(b.dia), { color: col, w: lw });
      pdf.circle(x, Yv(b.sys), r, { fill: col });
      pdf.circle(x, Yv(b.dia), r, { fill: '#ffffff', stroke: col, w: 0.9 });
    });
  });
}

function weightChart(pdf, x0, y0, w, h, a) {
  const pts = a.gewicht.werte;
  const { lo, hi, step } = niceRange(Math.min(...pts.map((p) => p.v)) - 0.3, Math.max(...pts.map((p) => p.v)) + 0.3, 4);
  const { X, Yv } = axes(pdf, x0, y0, w, h, a.keys, lo, hi, step);
  const idx = Object.fromEntries(a.keys.map((k, i) => [k, i]));
  // gleitender 7-Tage-Schnitt
  const first = idx[pts[0].k], last = idx[pts[pts.length - 1].k];
  const line = a.keys.map((k, i) => {
    if (i < first || i > last) return null;
    const win = pts.filter((p) => idx[p.k] <= i && idx[p.k] > i - 7);
    return win.length ? [X(i), Yv(avg(win.map((p) => p.v)))] : null;
  });
  pdf.polyline(line, { color: C.gewicht, w: 1.6 });
  const r = a.keys.length > 60 ? 1.4 : 2.2;
  for (const p of pts) pdf.circle(X(idx[p.k]), Yv(p.v), r, { fill: '#8fd3ae' });
}

function legend(pdf, x, y, items) {
  let cx = x;
  for (const [col, label, dash] of items) {
    if (dash) pdf.line(cx, y - 3, cx + 14, y - 3, { color: col, w: 1, dash: [3, 2] });
    else pdf.rect(cx, y - 7, 8, 8, { fill: col });
    pdf.text(cx + (dash ? 18 : 12), y, label, { size: 8, color: C.muted });
    cx += (dash ? 18 : 12) + textWidth(label, 8) + 16;
  }
}
