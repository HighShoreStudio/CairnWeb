/* Cairn Web — Documentation area (DocsView): the docs/ folder as a tree, markdown preview and editing. */
'use strict';

const md = new marked.Marked({ gfm: true, breaks: false });
md.use({
  extensions: [{
    name: 'wiki', level: 'inline',
    start(src) { const i = src.indexOf('[['); return i < 0 ? undefined : (i > 0 && src[i - 1] === '!' ? i - 1 : i); },
    tokenizer(src) {
      const m = /^(!?)\[\[([^\]|\n]+?)(?:\\?\|([^\]\n]*))?\]\]/.exec(src);
      if (m) return { type: 'wiki', raw: m[0], embed: !!m[1], target: m[2].trim(), label: (m[3] || '').trim() };
    },
    renderer(t) {
      const target = escapeHtml(t.target);
      if (t.embed) return `<img data-wiki-src="${target}" alt="${escapeHtml(t.label || t.target)}">`;
      return `<a class="wiki" data-wiki="${target}">${escapeHtml(t.label || t.target.replace(/#.*$/, ''))}</a>`;
    }
  }]
});

const DocsView = {
  open: new Set(['']),
  current: null,
  mode: 'preview',
  urls: [],

  mount(content, right, args) {
    const p = App.project;
    this.p = p;
    if (this.pid !== p.id) { this.pid = p.id; this.open = new Set(['']); this.current = null; this.mode = p.info.settings.docs.openInPreview === false ? 'edit' : 'preview'; }
    if (args[0]) {
      const want = args[0];
      const node = Docs.files(p).find(f => Docs.displayPath(f).toLowerCase() === want.toLowerCase() || f.path.toLowerCase() === want.toLowerCase());
      this.current = node ? node.path : null;
      if (!node) UI.toast('Document not found: ' + want, 'alert-circle-outline');
    }
    if (this.current) { let f = Docs.parent(this.current); while (f) { this.open.add(f); f = Docs.parent(f); } }
    this.treeBody = el('div.tree-body.scroll');
    this.pane = el('section.doc-pane.glass');
    content.appendChild(el('div.docs',
      el('aside.tree.glass',
        el('div.tree-head', el('b', 'Documentation'),
          this.graphBtn = el('button.btn.icon.small' + (this.graph ? '.primary' : ''), { title: 'Graph view', onclick: () => { this.graph = !this.graph; this.graphBtn.classList.toggle('primary', this.graph); this.renderTree(); this.renderDoc(); } }, icon('git-network-outline')),
          el('button.btn.icon.small', { title: 'New', onclick: e => this.newMenu(e.currentTarget, '') }, icon('add'))),
        this.treeBody),
      this.pane));
    this.renderTree();
    this.renderDoc();
  },

  newMenu(anchor, folder) {
    UI.menu(anchor, [
      { label: 'New document', icon: 'document-text-outline', onClick: () => this.createDoc(folder) },
      { label: 'New rich text', icon: 'document-outline', onClick: () => this.createRich(folder) },
      { label: 'New folder', icon: 'folder-outline', onClick: () => this.createFolder(folder) }
    ]);
  },

  renderTree() {
    const tree = Docs.tree(this.p);
    const rows = [];
    const walk = (node, depth) => {
      for (const c of node.children) {
        const pad = { paddingLeft: (0.5 + depth * 1.1) + 'em' };
        if (c.kind === 'folder') {
          const isOpen = this.open.has(c.path);
          const row = el('div.tn.folder', { style: pad, onclick: () => { isOpen ? this.open.delete(c.path) : this.open.add(c.path); this.renderTree(); } },
            icon('chevron-forward', 'chev' + (isOpen ? ' open' : '')), icon(isOpen ? 'folder-open-outline' : 'folder-outline'), el('span.nm', c.name));
          UI.longPress(row, () => this.itemMenu(row, c));
          rows.push(row);
          if (isOpen) walk(c, depth + 1);
        } else {
          const ic = { text: 'document-text-outline', rich: 'document-outline', image: 'image-outline', link: 'link-outline', file: 'document-outline' }[c.kind];
          const row = el('div.tn' + (c.path === this.current ? '.sel' : ''), { style: pad, onclick: () => { this.current = c.path; history.replaceState(null, '', `#/p/${this.p.id}/docs/${encodeURIComponent(Docs.displayPath(c))}`); this.renderTree(); this.renderDoc(); } },
            el('span', { style: { width: '.9em' } }), icon(c.isLink ? 'link-outline' : ic), el('span.nm', c.kind === 'text' || c.kind === 'rich' ? Docs.titleOf(c.name) : c.name));
          UI.longPress(row, () => this.itemMenu(row, c));
          rows.push(row);
        }
      }
    };
    walk(tree, 0);
    fill(this.treeBody, ...(rows.length ? rows : [el('div.small.muted', { style: { padding: '.8em' } }, 'No documents yet.')]));
  },

  itemMenu(anchor, node) {
    UI.menu(anchor, [
      { header: node.name },
      node.kind === 'folder' ? { label: 'New document here', icon: 'document-text-outline', onClick: () => this.createDoc(node.path) } : null,
      node.kind === 'folder' ? { label: 'New folder here', icon: 'folder-outline', onClick: () => this.createFolder(node.path) } : null,
      { label: 'Rename', icon: 'create-outline', onClick: () => this.rename(node) },
      { label: 'Move to folder…', icon: 'move-outline', onClick: () => this.moveTo(node) },
      { sep: true },
      { label: 'Delete', icon: 'trash-outline', danger: true, onClick: () => this.remove(node) }
    ], { align: 'left' });
  },

  node(path) { return path == null ? null : Docs.files(this.p).find(f => f.path === path) || null; },

  revokeUrls() { for (const u of this.urls) URL.revokeObjectURL(u); this.urls = []; },
  blobUrl(full) {
    const b = this.p.bytes(full);
    if (!b) return null;
    const u = URL.createObjectURL(new Blob([b], { type: mimeOf(full) }));
    this.urls.push(u);
    return u;
  },

  renderDoc() {
    this.revokeUrls();
    this.graphCanvas?.destroy(); this.graphCanvas = null;
    if (this.graph) { this.renderGraph(); return; }
    const node = this.node(this.current);
    if (!node) {
      fill(this.pane, UI.empty('book-outline', 'Documentation', 'Pick a document on the left, or create one.',
        el('button.btn.primary', { onclick: () => this.createDoc('') }, icon('add'), 'New document')));
      return;
    }
    const full = Docs.ROOT + node.path;
    const head = el('div.doc-head', icon(node.kind === 'text' ? 'document-text-outline' : node.isLink ? 'link-outline' : 'document-outline'),
      el('h2.ellipsis', node.kind === 'text' || node.kind === 'rich' ? Docs.titleOf(node.name) : node.name));
    const body = el('div.doc-body');
    fill(this.pane, head, body);

    if (node.isLink) {
      let target = '';
      try { target = parseJsonBytes(this.p.bytes(full)).target; } catch { }
      body.appendChild(UI.empty('link-outline', 'Linked file', `This document lives outside the project, on the PC:\n${target}\nIt can be opened only from the desktop app.`));
    } else if (node.kind === 'image') {
      body.appendChild(el('div.scroll', el('div.md', el('img', { src: this.blobUrl(full), alt: node.name }))));
    } else if (node.kind === 'rich') {
      head.append(el('span.chip', 'Rich text'), el('button.btn.icon.small', { onclick: e => this.itemMenu(e.currentTarget, node) }, icon('ellipsis-horizontal')));
      RichEditor.mount(body, head, this.p, full);
    } else if (node.kind !== 'text') {
      body.appendChild(UI.empty('document-outline', node.name, `${this.p.bytes(full)?.length || 0} bytes — this kind of file is kept in the project but cannot be shown here.`));
    } else {
      const seg = UI.segmented([{ id: 'preview', label: 'Preview', icon: 'eye-outline' }, { id: 'edit', label: 'Edit', icon: 'create-outline' }], this.mode, m => { this.mode = m; this.renderDoc(); });
      head.append(seg, el('button.btn.icon.small', { onclick: e => this.itemMenu(e.currentTarget, node) }, icon('ellipsis-horizontal')));
      const { text, enc } = this.p.text(full);
      if (this.mode === 'edit') {
        const ta = el('textarea.doc-src', { spellcheck: true, autocapitalize: 'sentences' }, text);
        const save = debounce(() => this.p.setText(full, ta.value, enc), 500);
        ta.addEventListener('input', save);
        ta.addEventListener('blur', () => save.flush());
        body.appendChild(ta);
      } else {
        body.appendChild(el('div.scroll', this.preview(node, text, enc)));
      }
    }
  },

  /** The graph of the documentation (DocsService.BuildGraph + GraphView): tap = select, double tap or Open = open. */
  renderGraph() {
    const model = GraphModel.fromDocs(this.p);
    const host = el('div', { style: { position: 'absolute', inset: 0 } });
    const info = el('div.graph-info.glass');
    info.style.display = 'none';
    const count = el('span.tiny.muted', `${model.nodes.filter(n => !n.ghost).length} documents · ${model.edges.length} links`);
    fill(this.pane, el('div.doc-head', icon('git-network-outline'), el('h2', 'Graph'), count,
      el('button.btn.small', { onclick: () => { this.graph = false; this.graphBtn.classList.remove('primary'); this.renderDoc(); } }, icon('close'), 'Close')),
      el('div.doc-body', host, info));
    if (!model.nodes.length) { host.appendChild(UI.empty('git-network-outline', 'No documents yet', 'Links between documents ([[wiki]] or markdown links) appear here.')); return; }
    const open = n => {
      if (n.ghost) { this.offerCreate(n.label, { path: '' }); return; }
      const node = Docs.files(this.p).find(f => f.path === n.id);
      if (node) { this.graph = false; this.graphBtn.classList.remove('primary'); this.go(node); }
    };
    this.graphCanvas = new GraphCanvas(host, model, {
      colorOf: n => n.ghost ? '#8D8D8D' : groupColor(n.group),
      onOpen: open,
      onSelect: n => {
        if (!n) { info.style.display = 'none'; return; }
        info.style.display = '';
        fill(info, el('b.ellipsis', n.label), el('span.tiny.muted', n.ghost ? 'does not exist yet' : `${n.degree} link${n.degree === 1 ? '' : 's'}${n.group ? ' · ' + n.group : ''}`),
          el('button.btn.small.primary', { onclick: () => open(n) }, icon(n.ghost ? 'add' : 'open-outline'), n.ghost ? 'Create' : 'Open'));
      }
    });
    if (this.current) requestAnimationFrame(() => this.graphCanvas?.select(this.current));
  },

  preview(node, text, enc) {
    const box = el('div.md');
    const html = DOMPurify.sanitize(md.parse(text), { ADD_ATTR: ['data-wiki', 'data-wiki-src', 'target'] });
    box.innerHTML = html;
    const idx = Docs.index(this.p);
    const from = Docs.displayPath(node);
    for (const a of box.querySelectorAll('a')) {
      const wiki = a.getAttribute('data-wiki');
      const href = a.getAttribute('href');
      if (wiki != null) {
        const hit = idx.resolve(from, wiki.replace(/#.*$/, ''), true);
        if (!hit) a.classList.add('ghost');
        a.onclick = e => { e.preventDefault(); hit ? this.go(hit) : this.offerCreate(wiki.replace(/#.*$/, ''), node); };
      } else if (href && !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('#')) {
        let target = href; try { target = decodeURIComponent(href); } catch { }
        const hit = idx.resolve(from, target.replace(/#.*$/, ''), false);
        if (!hit) a.classList.add('ghost');
        a.onclick = e => { e.preventDefault(); if (hit) this.go(hit); else UI.toast('Document not found: ' + target, 'alert-circle-outline'); };
      } else if (href && /^https?:/i.test(href)) { a.target = '_blank'; a.rel = 'noopener'; }
    }
    for (const img of box.querySelectorAll('img')) {
      const src = img.getAttribute('data-wiki-src') || img.getAttribute('src') || '';
      if (/^(https?:|data:)/i.test(src)) continue;
      let s = src; try { s = decodeURIComponent(src); } catch { }
      const full = this.resolveImage(node.path, s);
      if (full) img.src = this.blobUrl(full); else { img.removeAttribute('src'); img.alt = '[image not found: ' + s + ']'; }
    }
    // Task list: tapping a box ticks it in the markdown source.
    const boxes = [...box.querySelectorAll('input[type=checkbox]')];
    boxes.forEach((cb, i) => {
      cb.disabled = false;
      cb.onclick = e => { e.preventDefault(); const updated = DocsView.toggleTask(text, i); if (updated != null) { this.p.setText(Docs.ROOT + node.path, updated, enc); this.renderDoc(); } };
    });
    const back = this.backlinks(node, idx);
    if (back.length) box.appendChild(el('div.backlinks', el('div.label', 'Linked from'), back.map(b => el('span.chip', { onclick: () => this.go(b) }, icon('document-text-outline'), Docs.titleOf(b.name)))));
    return box;
  },

  /** DocsService.ResolveImage: relative to the document, then to the docs folder, then by name anywhere. */
  resolveImage(docPath, source) {
    for (const cand of [Docs.combine(Docs.parent(docPath), source), source.replace(/^\/+/, '')]) {
      const n = Docs.normalize(cand);
      if (n != null && this.p.has(Docs.ROOT + n)) return Docs.ROOT + n;
    }
    const name = Docs.fileName(source.replace(/\\/g, '/')).toLowerCase();
    return this.p.list(Docs.ROOT).find(f => !f.endsWith('/') && Docs.fileName(f).toLowerCase() === name) || null;
  },

  toggleTask(text, n) {
    const lines = text.split('\n');
    let fence = null, k = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (fence) { if (line.trim().startsWith(fence)) fence = null; continue; }
      if (f) { fence = f[1]; continue; }
      const m = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\].*)$/.exec(line);
      if (m) { if (k === n) { lines[i] = m[1] + (m[2] === ' ' ? 'x' : ' ') + m[3]; return lines.join('\n'); } k++; }
    }
    return null;
  },

  backlinks(node, idx) {
    const out = [];
    const target = node.path.toLowerCase();
    for (const f of idx.files) {
      if (f.kind !== 'text' || f.path === node.path) continue;
      const { text } = this.p.text(Docs.ROOT + f.path);
      if (Docs.extractLinks(text).some(l => !l.isImage && idx.resolve(Docs.displayPath(f), l.target, l.isWiki)?.path.toLowerCase() === target)) out.push(f);
    }
    return out;
  },

  go(node) {
    this.current = node.path;
    let f = Docs.parent(node.path); while (f) { this.open.add(f); f = Docs.parent(f); }
    history.replaceState(null, '', `#/p/${this.p.id}/docs/${encodeURIComponent(Docs.displayPath(node))}`);
    this.renderTree(); this.renderDoc();
  },

  async offerCreate(target, fromNode) {
    if (!await UI.confirm(`"${target}" does not exist yet. Create it?`, 'New document', 'Create')) return;
    const folder = target.includes('/') ? Docs.parent(target) : Docs.parent(fromNode.path);
    this.createDoc(folder, Docs.fileName(target));
  },

  async createDoc(folder, presetName) {
    const name = presetName || await UI.prompt('New document', 'Name', 'Untitled', v => Docs.validateName(v));
    if (!name) return;
    if (Docs.validateName(name)) { UI.alert(Docs.validateName(name)); return; }
    let file = Docs.isText(name) ? name : name + '.md';
    file = Docs.uniqueName(this.p, folder, file);
    const path = Docs.combine(folder, file);
    this.p.setText(Docs.ROOT + path, `# ${Docs.titleOf(file)}\n\n`, 'utf8');
    this.open.add(folder);
    this.mode = 'edit';
    this.go({ path, name: file });
  },

  /** DocsService.CreateRichDocument: an empty .rtf as WordPad or Word would create it. */
  async createRich(folder) {
    const name = await UI.prompt('New rich text document', 'Name', 'Untitled', v => Docs.validateName(v));
    if (!name) return;
    const file = Docs.uniqueName(this.p, folder, Docs.isRich(name) ? name : name + '.rtf');
    const path = Docs.combine(folder, file);
    this.p.setText(Docs.ROOT + path, '{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\fnil Segoe UI;}}\\pard\\f0\\fs24\\par}', 'utf8');
    this.open.add(folder);
    this.go({ path, name: file });
  },

  async createFolder(folder) {
    const name = await UI.prompt('New folder', 'Folder name', 'New folder', v => Docs.validateName(v));
    if (!name) return;
    const unique = Docs.uniqueName(this.p, folder, name);
    this.p.setBytes(Docs.ROOT + Docs.combine(folder, unique) + '/', new Uint8Array(0));
    this.open.add(folder); this.open.add(Docs.combine(folder, unique));
    this.renderTree();
  },

  async rename(node) {
    const isDoc = node.kind === 'text' || node.kind === 'rich';
    const v = await UI.prompt('Rename', 'New name', isDoc ? Docs.titleOf(node.name) : node.name, x => Docs.validateName(x));
    if (!v) return;
    let newName = v;
    // A text document keeps its extension when the new name has none.
    if (isDoc && !Docs.isText(newName) && !Docs.isRich(newName)) newName += Docs.ext(node.name);
    if (newName === node.name) return;
    const parent = Docs.parent(node.path);
    if (Docs.uniqueName(this.p, parent, newName) !== newName && newName.toLowerCase() !== node.name.toLowerCase()) { UI.alert('An item with this name already exists.'); return; }
    this.movePath(node, Docs.combine(parent, newName));
  },

  moveTo(node) {
    const folders = [''];
    const walk = n => { for (const c of n.children) if (c.kind === 'folder') { folders.push(c.path); walk(c); } };
    walk(Docs.tree(this.p));
    const allowed = folders.filter(f => f !== Docs.parent(node.path) && !(node.kind === 'folder' && (f === node.path || f.startsWith(node.path + '/'))));
    ItemPicker.open('Move to folder', allowed.map(f => ({ id: f, label: f || 'Documentation (top level)' })), target => {
      const name = node.isLink ? node.name : Docs.fileName(node.path);
      if (Docs.uniqueName(this.p, target, name) !== name) { UI.alert('The folder already contains an item with this name.'); return; }
      this.movePath(node, Docs.combine(target, name));
    });
  },

  /**
   * Moves / renames a document or a folder. Like DocsService.Rename/Move: the links of the other documents
   * follow it, and so do the references of the cards and of the whiteboard elements.
   */
  movePath(node, newDisplay) {
    const p = this.p;
    const before = Docs.index(p);
    const oldDisplay = Docs.displayPath(node);
    const isFolder = node.kind === 'folder';
    const mapPath = dp => {
      if (isFolder) return dp.toLowerCase().startsWith(oldDisplay.toLowerCase() + '/') ? newDisplay + dp.slice(oldDisplay.length) : null;
      return dp.toLowerCase() === oldDisplay.toLowerCase() ? newDisplay : null;
    };
    // 1. rewrite the links that point to a moved document (in every text document)
    const pending = [];
    for (const f of before.files) {
      if (f.kind !== 'text') continue;
      const full = Docs.ROOT + f.path;
      const { text, enc } = p.text(full);
      const fromOld = Docs.displayPath(f);
      const fromNew = mapPath(fromOld) || fromOld;
      const edits = [];
      for (const m of DocsView.linkSpans(text)) {
        const hit = before.resolve(fromOld, m.target, m.isWiki);
        if (!hit) continue;
        const moved = mapPath(Docs.displayPath(hit));
        const targetNew = moved || Docs.displayPath(hit);
        let replacement;
        if (m.isWiki) {
          if (!moved) continue;                                   // wiki links resolve from the docs folder or by name
          const withExt = Docs.isText(m.target) || Docs.isRich(m.target);
          const shown = withExt ? targetNew : Docs.titleOf(targetNew);
          replacement = m.target.includes('/') ? shown : Docs.fileName(shown);
          if (replacement.toLowerCase() === m.target.toLowerCase()) continue;
        } else {
          if (!moved && fromNew === fromOld) continue;
          replacement = Docs.relativeLink(fromNew, targetNew).split('/').map(s => encodeURIComponent(s)).join('/');
        }
        edits.push({ start: m.start, end: m.end, text: replacement + (m.anchor ? '#' + m.anchor : '') });
      }
      if (edits.length) {
        let out = text;
        for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
        pending.push([full, out, enc]);
      }
    }
    for (const [full, out, enc] of pending) p.setText(full, out, enc);
    // 2. move the files
    const prefix = Docs.ROOT + node.path;
    const moves = [];
    for (const key of p.list(Docs.ROOT)) {
      if (isFolder ? (key === prefix + '/' || key.startsWith(prefix + '/')) : key === prefix) {
        const rest = key.slice(prefix.length);
        const newKey = Docs.ROOT + (isFolder ? newDisplay + rest : newDisplay + (node.isLink ? '.link' : ''));
        moves.push([key, newKey]);
      }
    }
    for (const [a, b] of moves) p.rename(a, b);
    // 3. references of cards and whiteboard elements
    const fix = refs => { let ch = false; const out = (refs || []).map(r => { const n = mapPath(r); if (n) { ch = true; return n; } return r; }); return ch ? out : null; };
    let boardChanged = false;
    for (const c of [...p.board.columns.flatMap(c => c.cards), ...p.board.archived]) { const n = fix(c.docRefs); if (n) { c.docRefs = n; boardChanged = true; } }
    if (boardChanged) p.saveBoard();
    for (const { path, data } of p.whiteboards()) {
      let ch = false;
      const walk = list => { for (const e of list || []) { const n = fix(e.docRefs); if (n) { e.docRefs = n; ch = true; } walk(e.children); } };
      walk(data.elements);
      if (ch) p.setJson(path, data);
    }
    if (isFolder) { if (this.open.delete(node.path)) this.open.add(newDisplay); }
    if (this.current && (this.current === node.path || this.current.startsWith(node.path + '/'))) this.current = (isFolder ? newDisplay + this.current.slice(node.path.length) : newDisplay + (node.isLink ? '.link' : ''));
    let f = Docs.parent(newDisplay); while (f) { this.open.add(f); f = Docs.parent(f); }
    this.renderTree(); this.renderDoc();
    UI.toast('Moved — links updated', 'swap-horizontal');
  },

  /** Link targets with their exact position in the text (for rewriting). */
  linkSpans(text) {
    const spans = [];
    const masked = (() => {
      const chars = text.split(''); let pos = 0, fence = null;
      for (const raw of text.split('\n')) {
        const line = raw.replace(/\r$/, ''); const st = /^ {0,3}(`{3,}|~{3,})/.exec(line);
        if (fence) { const t = line.trim(); const closes = t.length >= fence.length && [...t].every(c => c === fence[0]); for (let i = 0; i < line.length; i++) chars[pos + i] = ' '; if (closes) fence = null; }
        else if (st) { fence = st[1]; for (let i = 0; i < line.length; i++) chars[pos + i] = ' '; }
        else for (const m of line.matchAll(/(`+)(?:(?!\1).)+?\1/g)) for (let i = 0; i < m[0].length; i++) chars[pos + m.index + i] = ' ';
        pos += raw.length + 1;
      }
      return chars.join('');
    })();
    for (const m of masked.matchAll(/(!?)\[\[([^\]|\n]+?)(?:\\?\|[^\]\n]*)?\]\]/g)) {
      const start = m.index + m[1].length + 2;
      const raw = m[2]; const lead = raw.length - raw.trimStart().length; const t = raw.trim();
      const hash = t.indexOf('#');
      spans.push({ isWiki: true, start: start + lead, end: start + lead + (hash >= 0 ? hash : t.length), target: hash >= 0 ? t.slice(0, hash) : t, anchor: null });
    }
    for (const m of masked.matchAll(/(!?)\[(?:[^\]\\\n]|\\.)*\]\(\s*(<[^>\n]*>|[^)\s]+)(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*\)/g)) {
      const open = m[0].indexOf('](') + 2;
      let start = m.index + open; while (/\s/.test(text[start])) start++;
      let raw = m[2]; let inner = raw;
      if (raw.startsWith('<') && raw.endsWith('>')) { inner = raw.slice(1, -1); start++; }
      if (/^[a-z][a-z0-9+.-]*:/i.test(inner) || inner.startsWith('#')) continue;
      let dec = inner; try { dec = decodeURIComponent(inner); } catch { }
      const hash = dec.indexOf('#'); const rawHash = inner.indexOf('#');
      spans.push({ isWiki: false, start, end: start + inner.length, target: hash >= 0 ? dec.slice(0, hash) : dec, anchor: rawHash >= 0 ? inner.slice(rawHash + 1) : null });
    }
    return spans;
  },

  /** DocsService.Delete: nothing is destroyed, the item goes to docs/.trash (a link: only the pointer is removed). */
  async remove(node) {
    const isFolder = node.kind === 'folder';
    if (!await UI.confirm(`Delete ${isFolder ? 'the folder' : ''} "${node.name}"?\n\n${node.isLink ? 'Only the link is removed, never the original file.' : 'It is moved to the trash of the documentation (docs/.trash), where it can be recovered on the PC.'}`, 'Delete', 'Delete', true)) return;
    const p = this.p;
    const prefix = Docs.ROOT + node.path;
    const keys = p.list(Docs.ROOT).filter(k => isFolder ? (k === prefix + '/' || k.startsWith(prefix + '/')) : k === prefix);
    const trashName = (() => { const base = Docs.fileName(node.path); let c = base, n = 2; const ext = isFolder ? '' : (base.includes('.') ? base.slice(base.lastIndexOf('.')) : ''); const stem = ext ? base.slice(0, -ext.length) : base;
      while (p.list(Docs.ROOT + '.trash/' + c).length) c = `${stem} ${n++}${ext}`; return c; })();
    for (const k of keys) {
      if (node.isLink) p.remove(k);
      else p.rename(k, Docs.ROOT + '.trash/' + trashName + k.slice(prefix.length));
    }
    // Deleted documents are forgotten by cards and whiteboard elements.
    const gone = d => isFolder ? d.toLowerCase().startsWith(Docs.displayPath(node).toLowerCase() + '/') : d.toLowerCase() === Docs.displayPath(node).toLowerCase();
    let changed = false;
    for (const c of [...p.board.columns.flatMap(c => c.cards), ...p.board.archived]) if (c.docRefs?.some(gone)) { c.docRefs = c.docRefs.filter(d => !gone(d)); if (!c.docRefs.length) delete c.docRefs; changed = true; }
    if (changed) p.saveBoard();
    for (const { path, data } of p.whiteboards()) {
      let ch = false;
      const walk = list => { for (const e of list || []) { if (e.docRefs?.some(gone)) { e.docRefs = e.docRefs.filter(d => !gone(d)); if (!e.docRefs.length) delete e.docRefs; ch = true; } walk(e.children); } };
      walk(data.elements);
      if (ch) p.setJson(path, data);
    }
    if (this.current && (this.current === node.path || this.current.startsWith(node.path + '/'))) this.current = null;
    this.renderTree(); this.renderDoc();
    UI.toast('Moved to the trash', 'trash-outline');
  }
};
