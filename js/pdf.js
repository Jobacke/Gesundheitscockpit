// Kleiner PDF-Baukasten ohne Fremdbibliothek: A4, Helvetica, Linien, Kreise, Text.
// Koordinaten wie am Bildschirm: (0,0) = links oben, Einheit Punkt (1/72 Zoll).

export const A4 = { w: 595.28, h: 841.89 };

// Zeichenbreiten Helvetica (ASCII 32–126, je 1000 Einheiten)
const W_REG = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const W_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

// Unicode → WinAnsi (Standardkodierung der PDF-Grundschriften)
const SPECIAL = { '−': 0x2d, '€': 0x80, '…': 0x85, '•': 0x95, '–': 0x96, '—': 0x97, '‘': 0x91, '’': 0x92, '‚': 0x82, '“': 0x93, '”': 0x94, '„': 0x84, '⌀': 0xd8, '≥': null, '≤': null };
function winAnsi(str) {
  let out = '';
  for (const ch of String(str)) {
    if (ch === '≥') { out += '>='; continue; }
    if (ch === '≤') { out += '<='; continue; }
    if (SPECIAL[ch] != null) { out += String.fromCharCode(SPECIAL[ch]); continue; }
    const c = ch.codePointAt(0);
    out += (c >= 32 && c < 127) || (c >= 0xa0 && c <= 0xff) ? ch : '?';
  }
  return out;
}

const BASE = { 'ä': 'a', 'ö': 'o', 'ü': 'u', 'Ä': 'A', 'Ö': 'O', 'Ü': 'U', 'ß': 'B', 'é': 'e', 'Ø': 'O', '°': 'o', '·': '.', '×': 'x' };
export function textWidth(str, size, bold = false) {
  const tab = bold ? W_BOLD : W_REG;
  let w = 0;
  for (const ch of String(str)) {
    const b = BASE[ch] || ch;
    const c = b.codePointAt(0);
    w += c >= 32 && c <= 126 ? tab[c - 32] : 556;
  }
  return (w * size) / 1000;
}

function rgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => (parseInt(h.slice(i, i + 2), 16) / 255).toFixed(3)).join(' ');
}
const f = (n) => (Math.round(n * 100) / 100).toString();
const esc = (s) => winAnsi(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

export class Pdf {
  constructor() { this.pages = []; this.addPage(); }

  addPage() { this.ops = []; this.pages.push(this.ops); return this; }
  get pageCount() { return this.pages.length; }
  onPage(i) { this.ops = this.pages[i]; return this; }

  Y(y) { return A4.h - y; }

  text(x, y, str, o = {}) {
    const size = o.size || 10, bold = !!o.bold;
    let tx = x;
    if (o.align === 'right') tx = x - textWidth(str, size, bold);
    else if (o.align === 'center') tx = x - textWidth(str, size, bold) / 2;
    this.ops.push(`BT /${bold ? 'F2' : 'F1'} ${f(size)} Tf ${rgb(o.color || '#1f2933')} rg ${f(tx)} ${f(this.Y(y))} Td (${esc(str)}) Tj ET`);
    return this;
  }

  // Text auf Breite kürzen (mit …)
  fit(str, maxW, size, bold = false) {
    if (textWidth(str, size, bold) <= maxW) return str;
    let s = String(str);
    while (s.length > 1 && textWidth(s + '…', size, bold) > maxW) s = s.slice(0, -1);
    return s + '…';
  }

  // Zeilenumbruch auf Breite
  wrap(str, maxW, size, bold = false) {
    const lines = [];
    let cur = '';
    for (const word of String(str).split(/\s+/)) {
      const t = cur ? `${cur} ${word}` : word;
      if (textWidth(t, size, bold) <= maxW || !cur) cur = t;
      else { lines.push(cur); cur = word; }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  line(x1, y1, x2, y2, o = {}) {
    this.ops.push(`q ${rgb(o.color || '#c9d1d9')} RG ${f(o.w || 0.6)} w ${o.dash ? `[${o.dash.join(' ')}] 0 d` : ''} ${f(x1)} ${f(this.Y(y1))} m ${f(x2)} ${f(this.Y(y2))} l S Q`);
    return this;
  }

  polyline(pts, o = {}) {
    const segs = [];
    let cur = [];
    for (const p of pts) { if (p) cur.push(p); else if (cur.length) { segs.push(cur); cur = []; } }
    if (cur.length) segs.push(cur);
    for (const s of segs) {
      if (s.length < 2) continue;
      const path = s.map((p, i) => `${f(p[0])} ${f(this.Y(p[1]))} ${i ? 'l' : 'm'}`).join(' ');
      this.ops.push(`q ${rgb(o.color || '#000000')} RG ${f(o.w || 1.2)} w 1 j 1 J ${path} S Q`);
    }
    return this;
  }

  rect(x, y, w, h, o = {}) {
    const paint = o.fill && o.stroke ? 'B' : o.fill ? 'f' : 'S';
    this.ops.push(`q ${o.fill ? rgb(o.fill) + ' rg' : ''} ${o.stroke ? rgb(o.stroke) + ' RG' : ''} ${f(o.w || 0.6)} w ${f(x)} ${f(this.Y(y + h))} ${f(w)} ${f(h)} re ${paint} Q`);
    return this;
  }

  circle(cx, cy, r, o = {}) {
    const k = 0.5523 * r, y = this.Y(cy);
    const p = `${f(cx + r)} ${f(y)} m ${f(cx + r)} ${f(y + k)} ${f(cx + k)} ${f(y + r)} ${f(cx)} ${f(y + r)} c `
      + `${f(cx - k)} ${f(y + r)} ${f(cx - r)} ${f(y + k)} ${f(cx - r)} ${f(y)} c `
      + `${f(cx - r)} ${f(y - k)} ${f(cx - k)} ${f(y - r)} ${f(cx)} ${f(y - r)} c `
      + `${f(cx + k)} ${f(y - r)} ${f(cx + r)} ${f(y - k)} ${f(cx + r)} ${f(y)} c`;
    const paint = o.fill && o.stroke ? 'B' : o.fill ? 'f' : 'S';
    this.ops.push(`q ${o.fill ? rgb(o.fill) + ' rg' : ''} ${o.stroke ? rgb(o.stroke) + ' RG' : ''} ${f(o.w || 0.8)} w ${p} ${paint} Q`);
    return this;
  }

  toBlob(meta = {}) {
    const objs = [];
    const add = (s) => { objs.push(s); return objs.length; };
    const catalog = add(null), pagesId = add(null);
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const kids = [];
    for (const ops of this.pages) {
      const body = ops.join('\n');
      const c = add(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`);
      kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${c} 0 R >>`));
    }
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
    const info = add(`<< /Title (${esc(meta.title || 'Bericht')}) /Producer (Gesundheitscockpit) >>`);

    let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
    const offs = [];
    objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    out += offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF`;
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
    return new Blob([bytes], { type: 'application/pdf' });
  }
}
