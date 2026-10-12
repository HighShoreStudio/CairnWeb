/* Cairn Web — rich text documents (.rtf): RTF → editable HTML and back.
 * The RTF written here is plain "Word-style" RTF that the RichTextBox of the desktop app reads:
 * paragraphs, alignment, bold / italic / underline / strike, size, font, text and highlight colors,
 * bullet and numbered lists, links and PNG / JPEG pictures. Documents with tables, embedded objects
 * or other picture formats stay read-only here, so nothing is lost. */
'use strict';

const Rtf = {
  /** Parses RTF into { paragraphs, unsupported: [reasons] }. */
  parse(rtf) {
    const fonts = {}, colors = [null];
    const unsupported = new Set();
    const paras = [];
    let para = null;
    const newPara = (pp) => { para = { align: pp.align, list: pp.list, indent: pp.li, runs: [] }; };
    const defChar = () => ({ b: false, i: false, u: false, s: false, fs: 24, f: null, cf: 0, hl: 0 });
    const defPara = () => ({ align: 'left', list: null, li: 0 });
    let st = { ch: defChar(), pp: defPara(), dest: null, uc: 1 };
    const stack = [];
    let pendingSkip = 0;
    let field = null;      // { inst, result runs }
    let pict = null;
    let listText = null;
    const lists = {};      // ls -> 'ul' | 'ol'
    let curList = null, curListDef = null;
    newPara(st.pp);

    const emit = text => {
      if (!text) return;
      if (st.dest && !['fonttbl', 'colortbl', 'listtext', 'pict', 'fldinst'].includes(st.dest)) return;
      if (st.dest === 'fonttbl') { st.fontName = (st.fontName || '') + text; return; }
      if (st.dest === 'colortbl') { if (text.includes(';')) { for (let i = 0; i < (text.match(/;/g) || []).length; i++) { colors.push(st.color ? { ...st.color } : null); st.color = null; } } return; }
      if (st.dest === 'listtext') { listText = (listText || '') + text; return; }
      if (st.dest === 'pict') { pict.hex += text.replace(/[^0-9a-fA-F]/g, ''); return; }
      if (st.dest === 'fldinst') { field.inst += text; return; }
      if (st.dest === 'leveltext' || st.dest === 'skip') return;
      const run = { text, b: st.ch.b, i: st.ch.i, u: st.ch.u, s: st.ch.s, size: st.ch.fs / 2, font: st.ch.f != null ? fonts[st.ch.f] : null, color: colors[st.ch.cf] || null, bg: colors[st.ch.hl] || null };
      if (field && st.inFieldResult) run.href = field.href;
      const last = para.runs[para.runs.length - 1];
      if (last && !last.img && ['b', 'i', 'u', 's', 'size', 'font', 'href'].every(k => last[k] === run[k]) && sameColor(last.color, run.color) && sameColor(last.bg, run.bg)) last.text += text;
      else para.runs.push(run);
    };
    const endPara = () => {
      if (para.list == null && listText != null) para.list = /^\s*\d/.test(listText) ? 'ol' : 'ul';
      paras.push(para); listText = null; newPara(st.pp);
    };

    let i = 0;
    const n = rtf.length;
    while (i < n) {
      const c = rtf[i];
      if (c === '{') {
        stack.push(st);
        st = { ch: { ...st.ch }, pp: st.pp, dest: st.dest, uc: st.uc, inFieldResult: st.inFieldResult, groupStart: true };
        i++;
        continue;
      }
      if (c === '}') {
        const closing = st;
        if (closing.dest === 'fonttbl' && closing.fontNo != null && closing.fontName) fonts[closing.fontNo] = closing.fontName.replace(/;\s*$/, '').trim();
        if (closing.dest === 'pict' && closing.isPictRoot) {
          if (pict.type === 'png' || pict.type === 'jpeg') para.runs.push({ img: `data:image/${pict.type};base64,${hexToB64(pict.hex)}`, w: pict.w, h: pict.h });
          else unsupported.add('pictures in a format the browser cannot show');
          pict = null;
        }
        if (closing.isFieldRoot) field = null;
        if (closing.isFldinst) { const m = /HYPERLINK\s+"([^"]*)"/i.exec(field?.inst || ''); if (field) field.href = m ? m[1] : null; }
        st = stack.pop() || st;
        // a paragraph not started yet takes the properties of the group it is really in
        if (!para.runs.length && listText == null && !st.dest) { para.list = st.pp.list; para.align = st.pp.align; para.indent = st.pp.li; }
        i++;
        continue;
      }
      if (c === '\\') {
        const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(rtf.slice(i, i + 48));
        if (m) {
          i += m[0].length;
          const w = m[1], num = m[2] != null ? +m[2] : null, first = st.groupStart; st.groupStart = false;
          if (st.dest === 'skip') continue;
          switch (w) {
            case 'fonttbl': st.dest = 'fonttbl'; break;
            case 'colortbl': st.dest = 'colortbl'; break;
            case 'red': if (st.dest === 'colortbl') (st.color ||= { r: 0, g: 0, b: 0 }).r = num; break;
            case 'green': if (st.dest === 'colortbl') (st.color ||= { r: 0, g: 0, b: 0 }).g = num; break;
            case 'blue': if (st.dest === 'colortbl') (st.color ||= { r: 0, g: 0, b: 0 }).b = num; break;
            case 'f': if (st.dest === 'fonttbl') { st.fontNo = num; st.fontName = ''; } else if (!st.dest) st.ch.f = num; break;
            case 'stylesheet': case 'info': case 'header': case 'footer': case 'headerl': case 'headerr': case 'footerl': case 'footerr': case 'footnote':
            case 'themedata': case 'colorschememapping': case 'datastore': case 'latentstyles': case 'generator': case 'rsidtbl': case 'xmlnstbl':
            case 'mmathPr': case 'filetbl': case 'revtbl': case 'pgdsctbl': case 'pntext': case 'bkmkstart': case 'bkmkend':
              st.dest = 'skip'; break;
            case 'listtable': st.dest = 'listtable'; break;
            case 'list': if (st.dest === 'listtable') { curListDef = { nfc: null }; st.isListDef = true; } break;
            case 'levelnfc': if (curListDef && curListDef.nfc == null) curListDef.nfc = num; break;
            case 'listid': if (st.dest === 'lot') { stack[stack.length - 1].lotId = num; st.lotId = num; break; }
              if (curListDef && st.isListDef) { curListDef.id = num; lists['id' + num] = curListDef.nfc === 23 || curListDef.nfc === 255 ? 'ul' : 'ol'; curListDef = null; } break;
            case 'leveltext': case 'levelnumbers': st.dest = 'skip'; break;
            case 'listoverridetable': st.dest = 'lot'; break;
            case 'listoverride': break;
            case 'ls': if (st.dest === 'lot') { lists['ls' + num] = lists['id' + st.lotId] || 'ul'; break; }
              if (!st.dest) { st.pp = { ...st.pp, list: lists['ls' + num] || lists['id' + num] || 'ul' }; para.list = st.pp.list; } break;
            case 'listtext': st.dest = 'listtext'; break;
            case 'pict': st.dest = 'pict'; st.isPictRoot = true; pict = { hex: '', type: null, w: null, h: null }; break;
            case 'pngblip': if (pict) pict.type = 'png'; break;
            case 'jpegblip': if (pict) pict.type = 'jpeg'; break;
            case 'emfblip': case 'wmetafile': case 'dibitmap': case 'wbitmap': case 'macpict': if (pict) pict.type = 'other'; break;
            case 'picwgoal': if (pict) pict.w = Math.round(num / 15); break;
            case 'pichgoal': if (pict) pict.h = Math.round(num / 15); break;
            case 'field': field = { inst: '', href: null }; st.isFieldRoot = true; break;
            case 'fldinst': st.dest = 'fldinst'; st.isFldinst = true; break;
            case 'fldrslt': st.dest = null; st.inFieldResult = true; break;
            case 'object': case 'trowd': case 'shp': case 'shpgrp': case 'nesttableprops':
              unsupported.add(w === 'trowd' ? 'tables' : 'embedded objects'); if (w !== 'trowd') st.dest = 'skip'; break;
            case 'par': if (!st.dest) endPara(); break;
            case 'line': if (!st.dest) emit('\n'); break;
            case 'tab': emit('\t'); break;
            case 'cell': emit('\t'); break;
            case 'row': if (!st.dest) endPara(); break;
            case 'pard': st.pp = defPara(); if (!st.dest) { para.align = 'left'; para.list = null; para.indent = 0; } break;
            case 'plain': st.ch = defChar(); break;
            case 'ql': st.pp = { ...st.pp, align: 'left' }; para.align = 'left'; break;
            case 'qc': st.pp = { ...st.pp, align: 'center' }; para.align = 'center'; break;
            case 'qr': st.pp = { ...st.pp, align: 'right' }; para.align = 'right'; break;
            case 'qj': st.pp = { ...st.pp, align: 'justify' }; para.align = 'justify'; break;
            case 'li': st.pp = { ...st.pp, li: num || 0 }; para.indent = num || 0; break;
            case 'b': st.ch.b = num !== 0; break;
            case 'i': st.ch.i = num !== 0; break;
            case 'ul': st.ch.u = num !== 0; break;
            case 'ulnone': st.ch.u = false; break;
            case 'strike': st.ch.s = num !== 0; break;
            case 'fs': st.ch.fs = num || 24; break;
            case 'cf': st.ch.cf = num || 0; break;
            case 'highlight': case 'cb': case 'chcbpat': st.ch.hl = num || 0; break;
            case 'uc': st.uc = num ?? 1; break;
            case 'u': emit(String.fromCharCode(num < 0 ? num + 65536 : num)); pendingSkip = st.uc; break;
            case 'emdash': emit('—'); break; case 'endash': emit('–'); break; case 'bullet': emit('•'); break;
            case 'lquote': emit('‘'); break; case 'rquote': emit('’'); break; case 'ldblquote': emit('“'); break; case 'rdblquote': emit('”'); break;
            case 'emspace': case 'enspace': emit(' '); break;
            default: if (first && st.starred) st.dest = 'skip';
          }
          continue;
        }
        const hx = /^\\'([0-9a-fA-F]{2})/.exec(rtf.slice(i, i + 4));
        if (hx) {
          i += 4;
          if (pendingSkip > 0) { pendingSkip--; continue; }
          const b = parseInt(hx[1], 16);
          emit(b >= 0x80 && b < 0xA0 ? CP1252_HIGH[b - 0x80] : String.fromCharCode(b));
          continue;
        }
        const sym = rtf[i + 1];
        i += 2;
        if (sym === '*') { st.starred = true; st.dest = st.dest || null; if (st.groupStart !== false) { /* destination name follows */ } st.pendingStar = true; continue; }
        if (sym === '\\' || sym === '{' || sym === '}') emit(sym);
        else if (sym === '~') emit('\u00A0');
        else if (sym === '-') { /* optional hyphen */ }
        else if (sym === '_') emit('\u2011');
        else if (sym === '\n' || sym === '\r') { if (!st.dest) endPara(); }
        continue;
      }
      if (c === '\r' || c === '\n') { i++; continue; }
      if (pendingSkip > 0) { pendingSkip--; i++; continue; }
      // plain text up to the next control character
      let j = i;
      while (j < n && !'\\{}\r\n'.includes(rtf[j])) j++;
      if (st.pendingStar) { st.pendingStar = false; }
      emit(rtf.slice(i, j));
      i = j;
    }
    if (para.runs.length) paras.push(para);
    // A starred destination we did not recognise was skipped by the keyword handler above.
    return { paragraphs: paras, unsupported: [...unsupported] };
  },

  toHtml(doc) {
    const out = [];
    let openList = null;
    for (const p of doc.paragraphs) {
      const inner = p.runs.map(Rtf.runHtml).join('') || '<br>';
      if (p.list) {
        if (openList !== p.list) { if (openList) out.push(`</${openList}>`); out.push(`<${p.list}>`); openList = p.list; }
        out.push(`<li style="text-align:${p.align}">${inner}</li>`);
        continue;
      }
      if (openList) { out.push(`</${openList}>`); openList = null; }
      const indent = p.indent ? `;margin-left:${Math.round(p.indent / 15)}px` : '';
      out.push(`<p style="text-align:${p.align}${indent}">${inner}</p>`);
    }
    if (openList) out.push(`</${openList}>`);
    return out.join('');
  },
  runHtml(r) {
    if (r.img) return `<img src="${r.img}"${r.w ? ` width="${r.w}"` : ''}${r.h ? ` height="${r.h}"` : ''}>`;
    let t = escapeHtml(r.text).replace(/\t/g, '&emsp;').replace(/\n/g, '<br>');
    const st = [];
    if (r.size && r.size !== 12) st.push(`font-size:${r.size}pt`);
    if (r.font) st.push(`font-family:'${r.font.replace(/'/g, '')}'`);
    if (r.color) st.push(`color:${rgb(r.color)}`);
    if (r.bg) st.push(`background-color:${rgb(r.bg)}`);
    if (st.length) t = `<span style="${st.join(';')}">${t}</span>`;
    if (r.b) t = `<b>${t}</b>`;
    if (r.i) t = `<i>${t}</i>`;
    if (r.u) t = `<u>${t}</u>`;
    if (r.s) t = `<s>${t}</s>`;
    if (r.href) t = `<a href="${escapeHtml(r.href)}">${t}</a>`;
    return t;
  },

  /** The editor content (HTML) → RTF. */
  fromHtml(root) {
    const fonts = ['Segoe UI'], colors = [];
    const fontIndex = f => { f = (f || 'Segoe UI').split(',')[0].replace(/["']/g, '').trim() || 'Segoe UI'; let k = fonts.findIndex(x => x.toLowerCase() === f.toLowerCase()); if (k < 0) { fonts.push(f); k = fonts.length - 1; } return k; };
    const colorIndex = c => { const k = colors.indexOf(c); if (k >= 0) return k + 1; colors.push(c); return colors.length; };
    const paras = [];
    const blockTags = new Set(['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE']);
    let cur = null;
    const startPara = (node, list) => { cur = { align: alignOf(node), list, runs: [], heading: /^H[1-6]$/.test(node?.tagName || '') ? +node.tagName[1] : 0 }; paras.push(cur); };
    const walk = (node, fmt, list) => {
      for (const ch of [...node.childNodes]) {
        if (ch.nodeType === 3) { if (!cur) startPara(node, list); if (ch.nodeValue) cur.runs.push({ text: ch.nodeValue.replace(/\u2003/g, '\t'), ...fmt }); continue; }
        if (ch.nodeType !== 1) continue;
        const tag = ch.tagName;
        if (tag === 'BR') { if (!cur) startPara(node, list); cur.runs.push({ text: '\n', ...fmt }); continue; }
        if (tag === 'IMG') { if (!cur) startPara(node, list); cur.runs.push({ img: ch.src, w: ch.width || ch.naturalWidth, h: ch.height || ch.naturalHeight }); continue; }
        if (tag === 'UL' || tag === 'OL') { cur = null; walk(ch, fmt, tag.toLowerCase()); cur = null; continue; }
        const f = { ...fmt };
        if (tag === 'B' || tag === 'STRONG') f.b = true;
        if (tag === 'I' || tag === 'EM') f.i = true;
        if (tag === 'U') f.u = true;
        if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') f.s = true;
        if (tag === 'A' && ch.getAttribute('href')) f.href = ch.getAttribute('href');
        if (tag === 'FONT') { if (ch.color) f.color = ch.color; if (ch.face) f.font = ch.face; if (ch.size) f.size = [8, 10, 12, 14, 18, 24, 36][+ch.size - 1] || 12; }
        const s = ch.style;
        if (s.fontWeight && (s.fontWeight === 'bold' || +s.fontWeight >= 600)) f.b = true;
        if (s.fontWeight && (s.fontWeight === 'normal' || +s.fontWeight === 400)) f.b = false;
        if (s.fontStyle === 'italic') f.i = true;
        if (/underline/.test(s.textDecoration || s.textDecorationLine)) f.u = true;
        if (/line-through/.test(s.textDecoration || s.textDecorationLine)) f.s = true;
        if (s.color) f.color = s.color;
        if (s.backgroundColor && !/transparent|rgba\(0, 0, 0, 0\)/.test(s.backgroundColor)) f.bg = s.backgroundColor;
        if (s.fontSize) f.size = cssSizeToPt(s.fontSize) || f.size;
        if (s.fontFamily) f.font = s.fontFamily;
        if (blockTags.has(tag)) {
          cur = null;
          startPara(ch, tag === 'LI' ? list : null);
          if (/^H[1-6]$/.test(tag)) { f.b = true; f.size = [0, 20, 16, 14, 12, 12, 12][+tag[1]]; }
          walk(ch, f, list);
          cur = null;
          continue;
        }
        walk(ch, f, list);
      }
    };
    walk(root, { b: false, i: false, u: false, s: false, size: 12, color: null, bg: null, font: null }, null);
    // drop the trailing empty paragraph that contenteditable keeps
    while (paras.length > 1 && !paras[paras.length - 1].runs.some(r => r.img || r.text.trim())) paras.pop();

    const body = [];
    let hasUl = false, hasOl = false;
    for (const p of paras) {
      let line = '\\pard\\plain';
      line += { left: '\\ql', center: '\\qc', right: '\\qr', justify: '\\qj' }[p.align] || '\\ql';
      if (p.list === 'ul') { hasUl = true; line += "\\ls1\\fi-360\\li720 {\\listtext\\f0\\'95\\tab}"; }
      else if (p.list === 'ol') { hasOl = true; line += '\\ls2\\fi-360\\li720 '; }
      else line += ' ';
      for (const r of p.runs) {
        if (r.img) { line += Rtf.pictRtf(r); continue; }
        if (!r.text) continue;
        if (r.text === '\n') { line += '\\line '; continue; }
        let g = '{';
        g += `\\f${fontIndex(r.font)}\\fs${Math.round((r.size || 12) * 2)}`;
        if (r.b) g += '\\b'; if (r.i) g += '\\i'; if (r.u || r.href) g += '\\ul'; if (r.s) g += '\\strike';
        const c = cssToRgb(r.color); if (c) g += `\\cf${colorIndex(c)}`;
        const bg = cssToRgb(r.bg); if (bg) g += `\\highlight${colorIndex(bg)}\\cb${colorIndex(bg)}`;
        g += ' ' + Rtf.escape(r.text) + '}';
        if (r.href) g = `{\\field{\\*\\fldinst{HYPERLINK "${r.href.replace(/[\\{}"]/g, '')}"}}{\\fldrslt${g}}}`;
        line += g;
      }
      body.push(line + '\\par');
    }
    const fonttbl = '{\\fonttbl' + fonts.map((f, k) => `{\\f${k}\\fnil ${f};}`).join('') + '}';
    const colortbl = '{\\colortbl;' + colors.map(c => `\\red${c[0]}\\green${c[1]}\\blue${c[2]};`).join('') + '}';
    let lists = '';
    if (hasUl || hasOl) {
      lists = "{\\*\\listtable{\\list\\listtemplateid1{\\listlevel\\levelnfc23\\leveljc0\\levelfollow0\\levelstartat1{\\leveltext\\'01\\'95;}{\\levelnumbers;}\\fi-360\\li720}\\listid1}" +
        "{\\list\\listtemplateid2{\\listlevel\\levelnfc0\\leveljc0\\levelfollow0\\levelstartat1{\\leveltext\\'02\\'00.;}{\\levelnumbers\\'01;}\\fi-360\\li720}\\listid2}}" +
        '{\\*\\listoverridetable{\\listoverride\\listid1\\listoverridecount0\\ls1}{\\listoverride\\listid2\\listoverridecount0\\ls2}}';
    }
    // numbered paragraphs need their \listtext with the number (readers that ignore lists still show it)
    let n = 0;
    const lines = body.map((l, k) => { if (paras[k].list === 'ol') { n++; return l.replace('\\ls2\\fi-360\\li720 ', `\\ls2\\fi-360\\li720 {\\listtext\\f0 ${n}.\\tab}`); } n = 0; return l; });
    return `{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1${fonttbl}${colortbl}${lists}\\viewkind4\n${lines.join('\n')}\n}`;
  },
  escape(text) {
    let out = '';
    for (const ch of text) {
      const c = ch.codePointAt(0);
      if (ch === '\\' || ch === '{' || ch === '}') out += '\\' + ch;
      else if (ch === '\t') out += '\\tab ';
      else if (c < 0x80) out += ch;
      else if (c < 0x10000) out += `\\u${c > 32767 ? c - 65536 : c}?`;
      else { const s = ch; for (let k = 0; k < s.length; k++) { const u = s.charCodeAt(k); out += `\\u${u > 32767 ? u - 65536 : u}?`; } }
    }
    return out;
  },
  pictRtf(r) {
    const m = /^data:image\/(png|jpe?g);base64,(.*)$/i.exec(r.img || '');
    if (!m) return '';
    const hex = b64ToHex(m[2]);
    const w = Math.max(1, Math.round(r.w || 200)), h = Math.max(1, Math.round(r.h || 150));
    const type = m[1].toLowerCase() === 'png' ? '\\pngblip' : '\\jpegblip';
    return `{\\pict${type}\\picw${w}\\pich${h}\\picwgoal${w * 15}\\pichgoal${h * 15}\n${hex.replace(/(.{128})/g, '$1\n')}}`;
  }
};

function sameColor(a, b) { return (!a && !b) || (a && b && a.r === b.r && a.g === b.g && a.b === b.b); }
function rgb(c) { return `rgb(${c.r},${c.g},${c.b})`; }
function hexToB64(hex) { const b = new Uint8Array(hex.length >> 1); for (let i = 0; i < b.length; i++) b[i] = parseInt(hex.substr(i * 2, 2), 16); return bytesToBase64(b); }
function b64ToHex(b64) { return Array.from(base64ToBytes(b64), x => x.toString(16).padStart(2, '0')).join(''); }
function alignOf(node) { const a = node?.style?.textAlign || node?.getAttribute?.('align') || ''; return ['center', 'right', 'justify'].includes(a) ? a : 'left'; }
function cssToRgb(c) {
  if (!c) return null;
  let m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(c);
  if (m) return m[4] !== undefined && +m[4] === 0 ? null : [+m[1], +m[2], +m[3]];
  m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (m) { const h = m[1].length === 3 ? m[1].split('').map(x => x + x).join('') : m[1]; return [0, 2, 4].map(k => parseInt(h.slice(k, k + 2), 16)); }
  const named = { black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], blue: [0, 0, 255], green: [0, 128, 0], yellow: [255, 255, 0] }[c.trim().toLowerCase()];
  return named || null;
}
function cssSizeToPt(s) {
  const m = /([\d.]+)(px|pt|em|rem)?/.exec(s || ''); if (!m) return null;
  const v = +m[1];
  if (m[2] === 'pt') return v;
  if (m[2] === 'px') return Math.round(v * 0.75 * 2) / 2;
  if (m[2] === 'em' || m[2] === 'rem') return v * 12;
  const kw = { 'x-small': 8, small: 10, medium: 12, large: 14, 'x-large': 18, 'xx-large': 24 }[s]; return kw || null;
}

/** The rich text editor of the Docs area (RichDocEditor): toolbar + white page. */
const RichEditor = {
  mount(body, head, project, full) {
    const { text } = project.text(full);
    let doc;
    try { doc = Rtf.parse(text); } catch (e) { doc = { paragraphs: [], unsupported: ['an unreadable format'] }; }
    const readOnly = doc.unsupported.length > 0;
    const page = el('div.rich-page', { contenteditable: readOnly ? 'false' : 'true', spellcheck: true });
    page.innerHTML = DOMPurify.sanitize(Rtf.toHtml(doc), { ADD_DATA_URI_TAGS: ['img'] }) || '<p><br></p>';
    const wrap = el('div.scroll.rich-wrap', page);
    if (readOnly) {
      body.append(el('div.rich-note', icon('information-circle-outline'), `This document contains ${doc.unsupported.join(' and ')}: it is shown read-only here, edit it in the desktop app.`), wrap);
      return;
    }
    const save = debounce(() => { project.setText(full, Rtf.fromHtml(page), 'utf8'); }, 700);
    page.addEventListener('input', save);
    page.addEventListener('blur', () => save.flush());
    let lastRange = null;
    const keep = () => { const sel = document.getSelection(); if (sel.rangeCount && page.contains(sel.anchorNode)) lastRange = sel.getRangeAt(0).cloneRange(); };
    const refocus = () => { if (document.activeElement !== page) { page.focus(); if (lastRange) { const sel = document.getSelection(); sel.removeAllRanges(); sel.addRange(lastRange); } } };
    const exec = (cmd, val) => { refocus(); document.execCommand('styleWithCSS', false, true); document.execCommand(cmd, false, val); save(); updateState(); };
    const tb = (ic, title, fn) => el('button.btn.icon.small.ghost', { title, onmousedown: e => e.preventDefault(), onclick: fn }, typeof ic === 'string' && ICONS[ic] ? icon(ic) : el('b', ic));
    const sizeSel = el('select.input.rich-size', { title: 'Size', onchange: () => { applySize(+sizeSel.value); } }, [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48].map(s => el('option', { value: s, selected: s === 12 }, s + ' pt')));
    const applySize = pt => {
      refocus();
      document.execCommand('styleWithCSS', false, false);
      document.execCommand('fontSize', false, '7');
      for (const f of page.querySelectorAll('font[size="7"]')) { const sp = document.createElement('span'); sp.style.fontSize = pt + 'pt'; while (f.firstChild) sp.appendChild(f.firstChild); f.replaceWith(sp); }
      save();
    };
    const colorBtn = (ic, title, cmd) => { const b = tb(ic, title, () => UI.colorMenu(b, ['#000000', '#5F6B7A', '#E5484D', '#F76B15', '#F2A541', '#30A46C', '#1F6F8B', '#0091FF', '#5B5BD6', '#8E4EC6', '#D6409F', '#FFFFFF', '#FFF3A3', '#FDDDE0', '#DDF3EA', '#E1E9FF'], null, c => exec(cmd, c || (cmd === 'foreColor' ? '#000000' : 'transparent')), cmd === 'foreColor' ? 'Black' : 'No highlight')); return b; };
    const bold = tb('B', 'Bold', () => exec('bold')), italic = tb('I', 'Italic', () => exec('italic'));
    italic.querySelector('b').style.fontStyle = 'italic';
    const under = tb('U', 'Underline', () => exec('underline')); under.querySelector('b').style.textDecoration = 'underline';
    const strike = tb('S', 'Strikethrough', () => exec('strikeThrough')); strike.querySelector('b').style.textDecoration = 'line-through';
    const updateState = () => { for (const [b, c] of [[bold, 'bold'], [italic, 'italic'], [under, 'underline'], [strike, 'strikeThrough']]) b.classList.toggle('on', document.queryCommandState(c)); };
    document.addEventListener('selectionchange', () => { if (document.contains(page) && page.contains(document.getSelection()?.anchorNode)) { keep(); updateState(); } });
    const toolbar = el('div.rich-toolbar',
      bold, italic, under, strike, sizeSel,
      colorBtn('color-palette-outline', 'Text color', 'foreColor'), colorBtn('color-fill-outline', 'Highlight', 'hiliteColor'),
      el('span.vsep'),
      tb('≡', 'Align left', () => exec('justifyLeft')), tb('☰', 'Center', () => exec('justifyCenter')), tb('⫶', 'Align right', () => exec('justifyRight')),
      el('span.vsep'),
      tb('list-outline', 'Bullets', () => exec('insertUnorderedList')), tb('1.', 'Numbering', () => exec('insertOrderedList')),
      tb('image-outline', 'Picture', async () => {
        const f = await UI.pickFile('image/png,image/jpeg,image/*');
        if (!f) return;
        const url = await imageAsDataUrl(f, 900);
        exec('insertImage', url);
      }),
      tb('link-outline', 'Link', async () => { const u = await UI.prompt('Link', 'Address (https://…)', 'https://'); if (u) exec('createLink', u); }));
    body.append(toolbar, wrap);
    page.addEventListener('paste', e => {
      // pasted HTML from other apps carries a lot of styles: keep plain text unless it's an image
      const items = [...(e.clipboardData?.items || [])];
      const img = items.find(it => it.type.startsWith('image/'));
      e.preventDefault();
      if (img) { imageAsDataUrl(img.getAsFile(), 900).then(u => exec('insertImage', u)); return; }
      document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
    });
  }
};

/** A picture as a PNG/JPEG data URL, scaled down to maxWidth (RTF stores pictures inline). */
async function imageAsDataUrl(file, maxWidth) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const s = Math.min(1, maxWidth / img.naturalWidth);
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return /jpe?g/i.test(file.type) ? c.toDataURL('image/jpeg', .9) : c.toDataURL('image/png');
  } finally { URL.revokeObjectURL(url); }
}
