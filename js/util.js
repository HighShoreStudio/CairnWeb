/* Cairn Web — small helpers shared by every file. */
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** el('div.card.glass', {onclick, style:{...}, dataset:{...}, html}, children...) */
function el(spec, props, ...children) {
  if (props instanceof Node || typeof props === 'string' || Array.isArray(props)) { children.unshift(props); props = null; }
  const m = spec.match(/^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i);
  const node = document.createElement((m && m[1]) || 'div');
  if (m && m[2]) for (const part of m[2].match(/[.#][\w-]+/g)) {
    if (part[0] === '.') node.classList.add(part.slice(1)); else node.id = part.slice(1);
  }
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'class') node.className += ' ' + v;
    else if (k in node && typeof v !== 'string') node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  appendAll(node, children);
  return node;
}
/** Replaces the children; null / false entries are skipped. */
function fill(node, ...children) { node.textContent = ''; return appendAll(node, children); }
function appendAll(node, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}
function svgEl(tag, attrs, ...children) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, v);
  for (const c of children.flat()) if (c != null) node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
}

function icon(name, cls = '') {
  const span = document.createElement('span');
  span.className = 'ico ' + cls;
  span.innerHTML = `<svg viewBox="0 0 512 512" aria-hidden="true">${ICONS[name] || ICONS['ellipse-outline']}</svg>`;
  return span;
}

/** Same shape as Guid.NewGuid().ToString("N") in the desktop app. */
function uid(len = 32) {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('').slice(0, len);
}

function debounce(fn, ms) {
  let t = 0;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = () => { clearTimeout(t); fn(); };
  return d;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** "My Game!" -> "my-game" (ProjectService.Slug). */
function slug(name) {
  let s = '';
  for (const ch of String(name || '').trim().toLowerCase()) {
    if (/[\p{L}\p{N}]/u.test(ch)) s += ch;
    else if (s.length && !s.endsWith('-')) s += '-';
  }
  s = s.replace(/^-+|-+$/g, '');
  return s || 'project';
}

function initials(name) {
  if (!name || !name.trim()) return '?';
  const parts = name.split(/[ ._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  const single = parts.length === 1 ? parts[0] : name.trim();
  return single.slice(0, 2).toUpperCase();
}

// ------------------------------------------------------------------ colors

const PALETTE = ['#1F6F8B', '#16324F', '#2E86AB', '#3E9A8E', '#30A46C', '#7CB518', '#F2A541', '#F76B15',
  '#E5484D', '#D6409F', '#8E4EC6', '#5B5BD6', '#0091FF', '#12A594', '#8D8D8D', '#5F6B7A'];
const PRIORITIES = ['None', 'Low', 'Medium', 'High', 'Urgent'];
const PRIORITY_COLOR = { Low: '#3E9A8E', Medium: '#2E86AB', High: '#F2A541', Urgent: '#E5484D', None: '#C5CCD3' };

/** WPF accepts #RGB, #RRGGBB and #AARRGGBB; CSS wants #RRGGBBAA. */
function cssColor(hex, fallback = null) {
  if (typeof hex !== 'string' || hex[0] !== '#') return fallback;
  const h = hex.slice(1);
  if (!/^[0-9a-f]+$/i.test(h)) return fallback;
  if (h.length === 3 || h.length === 6) return '#' + h;
  if (h.length === 8) return '#' + h.slice(2) + h.slice(0, 2);
  return fallback;
}
function luminance(hex) {
  const c = cssColor(hex, '#888888').slice(1);
  const full = c.length === 3 ? c.split('').map(x => x + x).join('') : c.slice(0, 6);
  const r = parseInt(full.slice(0, 2), 16), g = parseInt(full.slice(2, 4), 16), b = parseInt(full.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}
function readableOn(hex) { return luminance(hex) > 0.55 ? '#000000' : '#FFFFFF'; }

// ------------------------------------------------------------------ dates
// The desktop app stores "wall clock" dates (DateTimeKind.Unspecified: "2026-05-02T18:30:00") for
// due/end/start/finish dates, and UTC instants ("...Z") for createdAt / activity. Both are kept
// as strings here: a value that is not edited is written back exactly as it was read.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad2 = n => String(n).padStart(2, '0');

/** Wall clock string -> local Date (a "Z" value is converted from UTC; an offset is ignored, as the exe shows it in the PC time zone). */
function parseWall(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  if (!m) { const d = new Date(s); return isNaN(d) ? null : d; }
  if (m[7] === 'Z') return new Date(s);
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
}
function wallString(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}
function dateOnlyString(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T00:00:00`; }
/** UTC instant, like DateTime.UtcNow. */
function utcNow() { return new Date().toISOString(); }
function parseInstant(s) { if (!s) return null; const d = /Z$|[+-]\d{2}:\d{2}$/.test(s) ? new Date(s) : parseWall(s); return isNaN(d) ? null : d; }
function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function sameDay(a, b) { return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
/** <input type=date> value <-> Date */
function toDateInput(d) { return d ? `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` : ''; }
function toTimeInput(d) { return d ? `${pad2(d.getHours())}:${pad2(d.getMinutes())}` : ''; }
function fromDateInput(v) { if (!v) return null; const [y, m, d] = v.split('-').map(Number); return new Date(y, m - 1, d); }

/** CardViewModel.FormatDue: "Oct 12" / "Oct 12, 2027" (+ " 18:30"). */
function formatDue(d, hasTime) {
  if (!d) return '';
  let t = d.getFullYear() === new Date().getFullYear() ? `${MONTHS[d.getMonth()]} ${d.getDate()}` : `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  return hasTime ? `${t} ${pad2(d.getHours())}:${pad2(d.getMinutes())}` : t;
}
function formatStamp(d) { return d ? `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}` : ''; }
function relTime(d) {
  if (!d) return '';
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return formatStamp(d).slice(0, 10);
}
function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

// ------------------------------------------------------------------ text files
// DocsService.ReadText: a byte-order mark decides; otherwise UTF-8 when valid, else Windows "ANSI".

const CP1252_HIGH = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F\u0090‘’“”•–—˜™š›œ\u009DžŸ';

function decodeText(bytes) {
  if (!bytes) return { text: '', enc: 'utf8' };
  if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), enc: 'utf8bom' };
  if (bytes[0] === 0xFF && bytes[1] === 0xFE) return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), enc: 'utf16le' };
  if (bytes[0] === 0xFE && bytes[1] === 0xFF) return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), enc: 'utf16be' };
  try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), enc: 'utf8' }; }
  catch { /* not UTF-8 */ }
  let text = '';
  for (const b of bytes) text += b >= 0x80 && b < 0xA0 ? CP1252_HIGH[b - 0x80] : String.fromCharCode(b);
  return { text, enc: 'ansi' };
}
function encodeText(text, enc = 'utf8') {
  if (enc === 'ansi') {
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c < 0x80 || (c >= 0xA0 && c <= 0xFF)) { out[i] = c; continue; }
      const k = CP1252_HIGH.indexOf(text[i]);
      if (k < 0) return encodeText(text, 'utf8'); // not representable: the exe reads valid UTF-8 just as well
      out[i] = 0x80 + k;
    }
    return out;
  }
  if (enc === 'utf16le' || enc === 'utf16be') {
    const out = new Uint8Array(2 + text.length * 2);
    out[0] = enc === 'utf16le' ? 0xFF : 0xFE; out[1] = enc === 'utf16le' ? 0xFE : 0xFF;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (enc === 'utf16le') { out[2 + i * 2] = c & 255; out[3 + i * 2] = c >> 8; } else { out[2 + i * 2] = c >> 8; out[3 + i * 2] = c & 255; }
    }
    return out;
  }
  const body = new TextEncoder().encode(text);
  if (enc !== 'utf8bom') return body;
  const out = new Uint8Array(body.length + 3);
  out.set([0xEF, 0xBB, 0xBF]); out.set(body, 3);
  return out;
}
/** JsonFile.Save: indented (2 spaces), camelCase, UTF-8 without BOM, trailing newline. */
function jsonBytes(value) { return new TextEncoder().encode(JSON.stringify(value, null, 2) + '\n'); }
function parseJsonBytes(bytes) {
  const { text } = decodeText(bytes);
  return JSON.parse(text);
}

function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function base64ToBytes(b64) {
  const s = atob(b64); const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
function mimeOf(path) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  return { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', tif: 'image/tiff', tiff: 'image/tiff' }[ext] || 'application/octet-stream';
}

/** Resizes an image file to a square PNG (128 px), like the profile picture / project icon crop of the exe. */
async function squarePng(file, size = 128) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    const c = document.createElement('canvas'); c.width = c.height = size;
    c.getContext('2d').drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
    return c.toDataURL('image/png').split(',')[1];
  } finally { URL.revokeObjectURL(url); }
}
