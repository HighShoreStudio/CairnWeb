/* Cairn Web — storage: IndexedDB in the browser, zip files to move a project to and from the desktop app.
 *
 * A project is kept exactly as the desktop app keeps it on disk: a set of files with their relative
 * paths (project.json, kanban.json, accounts.json, roadmap.json, whiteboards/..., docs/..., backups/...).
 * Files the web app does not understand are stored untouched and go back into the zip as they came. */
'use strict';

const DB_NAME = 'cairn-web';
let _db = null;

function idb() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('projects', { keyPath: 'id' });
      db.createObjectStore('files', { keyPath: ['pid', 'path'] }).createIndex('pid', 'pid');
      db.createObjectStore('kv', { keyPath: 'k' });
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}
function tx(stores, mode, fn) {
  return idb().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Storage transaction aborted'));
    result = fn(...[].concat(stores).map(s => t.objectStore(s)));
  }));
}
const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

const KV = {
  async get(k, def = null) { const db = await idb(); const r = await reqP(db.transaction('kv').objectStore('kv').get(k)); return r ? r.v : def; },
  set(k, v) { return tx('kv', 'readwrite', s => s.put({ k, v })); }
};

// ------------------------------------------------------------------ accounts (the "global archive" of this browser)
// Same shape as Models/Account.cs. Passwords: PBKDF2-HMAC-SHA256, 210 000 iterations, 16-byte salt,
// 32-byte hash, base64 — identical to Services/PasswordHasher.cs, so a hash made here verifies in the exe.

const PBKDF2_ITERATIONS = 210000;

async function pbkdf2(password, salt, iterations, bytes = 32) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password || ''), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, bytes * 8);
  return new Uint8Array(bits);
}
async function setPassword(account, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  account.iterations = PBKDF2_ITERATIONS;
  account.passwordSalt = bytesToBase64(salt);
  account.passwordHash = bytesToBase64(await pbkdf2(password, salt, PBKDF2_ITERATIONS));
}
async function verifyPassword(account, password) {
  if (!account.passwordHash || !account.passwordSalt) return false;
  try {
    const expected = base64ToBytes(account.passwordHash);
    const actual = await pbkdf2(password, base64ToBytes(account.passwordSalt), account.iterations > 0 ? account.iterations : PBKDF2_ITERATIONS, expected.length);
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ actual[i];
    return diff === 0 && actual.length === expected.length;
  } catch { return false; }
}

const Accounts = {
  list: [],
  current: null,
  async load() {
    this.list = await KV.get('accounts', []);
    const id = await KV.get('session');
    this.current = this.list.find(a => a.id === id) || null;
  },
  save() { return KV.set('accounts', this.list); },
  find(id) { return this.list.find(a => a.id === id) || null; },
  byName(name) { return this.list.find(a => a.username.toLowerCase() === String(name).trim().toLowerCase()) || null; },
  validate(username, email, ignoreId) {
    username = (username || '').trim();
    if (username.length < 3 || username.length > 32) return 'The username must be 3 to 32 characters long.';
    const other = this.byName(username);
    if (other && other.id !== ignoreId) return 'This username is already used on this device.';
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return 'The e-mail address is not valid.';
    return null;
  },
  validatePassword(pw) { return (pw || '').length < 6 ? 'The password must be at least 6 characters long.' : null; },
  async create(username, password, email, color, image) {
    const a = { id: uid(), username: username.trim(), email: email?.trim() || null, avatarColor: color || '#1F6F8B',
      passwordHash: '', passwordSalt: '', iterations: 0, createdAt: utcNow() };
    if (image) a.avatarImage = image;
    await setPassword(a, password);
    this.list.push(a);
    await this.save();
    return a;
  },
  /** AccountService.Import: an account that comes from a project becomes known on this device. */
  async import(projectAccount) {
    let a = this.find(projectAccount.id);
    if (!a) { a = JSON.parse(JSON.stringify(projectAccount)); delete a.sessionTokenHashes; this.list.push(a); await this.save(); }
    return a;
  },
  async login(account) { this.current = account; await KV.set('session', account.id); },
  async logout() { this.current = null; await KV.set('session', null); },
  async remove(account) { this.list = this.list.filter(a => a.id !== account.id); if (this.current?.id === account.id) await this.logout(); await this.save(); },
  /** Account.CloneForProject: no session tokens. */
  clone(a) {
    const c = { id: a.id, username: a.username, email: a.email ?? null, avatarColor: a.avatarColor };
    if (a.avatarImage) c.avatarImage = a.avatarImage;
    Object.assign(c, { passwordHash: a.passwordHash, passwordSalt: a.passwordSalt, iterations: a.iterations, createdAt: a.createdAt });
    return c;
  }
};

// ------------------------------------------------------------------ projects

const Store = {
  async listProjects() {
    const db = await idb();
    const list = await reqP(db.transaction('projects').objectStore('projects').getAll());
    return list.sort((a, b) => (b.lastOpenedAt || '').localeCompare(a.lastOpenedAt || '') || a.name.localeCompare(b.name));
  },
  async getMeta(id) { const db = await idb(); return reqP(db.transaction('projects').objectStore('projects').get(id)); },
  putMeta(meta) { return tx('projects', 'readwrite', s => s.put(meta)); },
  async loadFiles(pid) {
    const db = await idb();
    const rows = await reqP(db.transaction('files').objectStore('files').index('pid').getAll(pid));
    const map = new Map();
    for (const r of rows) map.set(r.path, r.data instanceof Uint8Array ? r.data : new Uint8Array(r.data));
    return map;
  },
  writeFiles(pid, put, del) {
    return tx('files', 'readwrite', s => {
      for (const [path, data] of put) s.put({ pid, path, data });
      for (const path of del) s.delete([pid, path]);
    });
  },
  async replaceProject(meta, files) {
    await this.deleteProject(meta.id);
    await tx(['projects', 'files'], 'readwrite', (p, f) => {
      p.put(meta);
      for (const [path, data] of files) f.put({ pid: meta.id, path, data });
    });
  },
  async deleteProject(pid) {
    const db = await idb();
    const keys = await reqP(db.transaction('files').objectStore('files').index('pid').getAllKeys(pid));
    await tx(['projects', 'files'], 'readwrite', (p, f) => { p.delete(pid); for (const k of keys) f.delete(k); });
  }
};

function metaFrom(info, files, extra = {}) {
  let cards = 0, columns = 0, members = 0;
  try { const b = parseJsonBytes(files.get('kanban.json')); columns = b.columns.length; cards = b.columns.reduce((n, c) => n + c.cards.length, 0); } catch { }
  try { members = parseJsonBytes(files.get('accounts.json')).accounts.length; } catch { }
  return Object.assign({ id: info.id, name: info.name, description: info.description || '', color: info.color, icon: info.icon || null,
    cards, columns, members, updatedAt: utcNow() }, extra);
}

// ------------------------------------------------------------------ zip

const SKIP_IN_ZIP = p => /(^|\/)(__MACOSX|\.git)(\/|$)/.test(p) || /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/i.test(p) || p.endsWith('.tmp');

/** Reads a project zip made by Cairn Web, or a project folder compressed on the PC (at the root or inside one folder). */
async function readProjectZip(blob) {
  let zip;
  try { zip = await JSZip.loadAsync(blob); }
  catch { throw new Error('This file is not a valid zip archive.'); }
  const names = Object.keys(zip.files).filter(n => !zip.files[n].dir).map(n => n.replace(/\\/g, '/'));
  const candidates = names.filter(n => /(^|\/)project\.json$/.test(n) && !SKIP_IN_ZIP(n))
    .sort((a, b) => a.split('/').length - b.split('/').length);
  if (!candidates.length) throw new Error('No project.json found in the zip: it does not contain a Cairn project.');
  const prefix = candidates[0].slice(0, candidates[0].length - 'project.json'.length);
  const files = new Map();
  for (const name of Object.keys(zip.files)) {
    const entry = zip.files[name];
    const norm = name.replace(/\\/g, '/');
    if (!norm.startsWith(prefix)) continue;
    const rel = norm.slice(prefix.length);
    if (!rel || SKIP_IN_ZIP(rel)) continue;
    // Folders are kept as "path/" entries, so empty folders (docs) survive the trip.
    if (entry.dir) files.set(rel.endsWith('/') ? rel : rel + '/', new Uint8Array(0));
    else files.set(rel, await entry.async('uint8array'));
  }
  let info;
  try { info = parseJsonBytes(files.get('project.json')); }
  catch { throw new Error('project.json is not readable.'); }
  if (!info || !info.id) throw new Error('project.json has no project id.');
  if (!files.has('kanban.json')) files.set('kanban.json', jsonBytes(Model.defaultBoard()));
  return { info, files };
}

async function buildProjectZip(files) {
  const zip = new JSZip();
  const date = new Date();
  for (const [path, data] of [...files].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (SKIP_IN_ZIP(path)) continue;
    if (path.endsWith('/')) zip.folder(path.slice(0, -1));
    else zip.file(path, data, { date, binary: true });
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 }, mimeType: 'application/zip' });
}

// ------------------------------------------------------------------ a project opened in memory

class Project {
  constructor(id, files) {
    this.id = id;
    this.files = files;          // path -> Uint8Array
    this._json = new Map();      // path -> parsed object (kept in sync with files on flush)
    this.dirty = new Set();
    this.removed = new Set();
    this.listeners = new Set();
    this.saveSoon = debounce(() => this.flush(), 350);
  }

  static async open(id) {
    const files = await Store.loadFiles(id);
    if (!files.has('project.json')) throw new Error('This project is damaged: project.json is missing.');
    const p = new Project(id, files);
    p.info = p.json('project.json');
    p.board = p.json('kanban.json', () => Model.defaultBoard());
    Model.migrateBoard(p.board);
    Model.normalizeBoard(p.board);
    p.accounts = p.json('accounts.json', () => ({ version: 1, accounts: [] }));
    p.accounts.accounts ||= [];
    p.info.settings = Model.normalizeSettings(p.info.settings);
    try { p.roadmap = p.json('roadmap.json', () => null); }
    catch { p.roadmap = null; p.roadmapError = true; }
    return p;
  }

  has(path) { return this.files.has(path); }
  bytes(path) { return this.files.get(path) || null; }
  json(path, fallback) {
    if (this._json.has(path)) return this._json.get(path);
    const b = this.files.get(path);
    let v;
    if (!b) v = fallback ? fallback() : null;
    else v = parseJsonBytes(b);
    if (v != null) this._json.set(path, v);
    return v;
  }
  setJson(path, value) { this._json.set(path, value); if (!this.files.has(path)) this.files.set(path, new Uint8Array(0)); this.touch(path); }
  touch(path) { this.dirty.add(path); this.removed.delete(path); this.saveSoon(); this.emit(path); }
  text(path) { return decodeText(this.files.get(path)); }
  setText(path, text, enc = 'utf8') { this._json.delete(path); this.files.set(path, encodeText(text, enc)); this.touch(path); }
  setBytes(path, bytes) { this._json.delete(path); this.files.set(path, bytes); this.touch(path); }
  remove(path) { this.files.delete(path); this._json.delete(path); this.dirty.delete(path); this.removed.add(path); this.saveSoon(); this.emit(path); }
  rename(from, to) { const b = this.files.get(from); if (!b) return; this.files.set(to, b); this._json.delete(from); this.remove(from); this.dirty.add(to); this.saveSoon(); }
  list(prefix = '') { return [...this.files.keys()].filter(p => p.startsWith(prefix)); }

  saveBoard() { this.touch('kanban.json'); }
  saveInfo() { this.touch('project.json'); }
  saveAccounts() { for (const a of this.accounts.accounts) delete a.sessionTokenHashes; this.touch('accounts.json'); }

  /** ProjectService.Backup: copy of kanban.json in backups/, newest 5 kept, nothing when identical to the last one. */
  backup() {
    this.flushJson();
    const source = this.files.get('kanban.json');
    if (!source) return;
    const list = this.list('backups/').filter(p => /^backups\/kanban-.*\.json$/.test(p)).sort().reverse();
    const latest = list[0] && this.files.get(list[0]);
    if (latest && latest.length === source.length && latest.every((b, i) => b === source[i])) return;
    const d = new Date();
    const name = `backups/kanban-${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}-${pad2(d.getMinutes())}-${pad2(d.getSeconds())}.json`;
    this.setBytes(name, source.slice());
    if (!this.files.has('backups/.gitkeep')) this.setBytes('backups/.gitkeep', new Uint8Array(0));
    for (const old of [name, ...list].sort().reverse().slice(5)) this.remove(old);
  }

  flushJson() {
    for (const path of this.dirty) if (this._json.has(path)) this.files.set(path, jsonBytes(this._json.get(path)));
  }

  async flush() {
    if (!this.dirty.size && !this.removed.size) return;
    this.flushJson();
    const put = [...this.dirty].filter(p => this.files.has(p)).map(p => [p, this.files.get(p)]);
    const del = [...this.removed];
    this.dirty.clear(); this.removed.clear();
    try {
      await Store.writeFiles(this.id, put, del);
      const meta = await Store.getMeta(this.id);
      await Store.putMeta(metaFrom(this.info, this.files, { lastOpenedAt: meta?.lastOpenedAt || utcNow(), importedAt: meta?.importedAt, exportedAt: meta?.exportedAt }));
    } catch (e) {
      for (const [p] of put) this.dirty.add(p);
      for (const p of del) this.removed.add(p);
      UI.toast('Not saved: ' + (e.message || e), 'warning-outline');
    }
  }

  async exportBlob() { await this.flush(); this.flushJson(); return buildProjectZip(this.files); }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(path) { for (const fn of this.listeners) try { fn(path); } catch (e) { console.error(e); } }

  // ---------------------------------------------------------------- whiteboards (read-only here)
  whiteboards() {
    const out = [];
    for (const path of this.list('whiteboards/')) {
      if (!/^whiteboards\/board-[^/]+\.json$/.test(path)) continue;
      try { const data = this.json(path); if (data) out.push({ path, data }); } catch { /* unreadable: skipped, like the exe */ }
    }
    return out.sort((a, b) => (a.data.name || '').localeCompare(b.data.name || '', undefined, { sensitivity: 'base' }));
  }
  member(id) { return this.accounts.accounts.find(a => a.id === id) || null; }
}

/** Creates a project like ProjectService.Create (default board, owner as the first member). */
async function createProject(name, description, color, icon, owner) {
  const info = Model.newProjectInfo(name, description, color, icon, owner);
  const files = new Map();
  files.set('project.json', jsonBytes(info));
  files.set('kanban.json', jsonBytes(Model.defaultBoard()));
  files.set('accounts.json', jsonBytes({ version: 1, accounts: [Accounts.clone(owner)] }));
  files.set('.gitkeep', new Uint8Array(0));
  files.set('backups/.gitkeep', new Uint8Array(0));
  await Store.replaceProject(metaFrom(info, files, { lastOpenedAt: utcNow() }), files);
  return info.id;
}

/** Shares (phone) or downloads (computer) a file. */
async function deliverFile(blob, filename, preferShare) {
  const file = new File([blob], filename, { type: blob.type || 'application/zip' });
  if (preferShare && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return 'shared'; }
    catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
  }
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename, style: { display: 'none' } });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return 'downloaded';
}
