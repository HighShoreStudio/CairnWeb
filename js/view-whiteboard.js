/* Cairn Web — Whiteboard (WhiteboardCanvas + WhiteboardViewModel): draw, select, move, resize, rotate,
 * connect, merge, references, undo/redo, several boards, and the Graph view of the linked elements.
 * Same file format as the exe: whiteboards/board-{id}.json + whiteboards/images/. */
'use strict';

const WB_COLORS = ['#000000', '#5F6B7A', '#9AA5B1', '#FFFFFF', '#E5484D', '#F76B15', '#F2A541', '#FFE08A',
  '#7CB518', '#30A46C', '#12A594', '#1F6F8B', '#0091FF', '#5B5BD6', '#8E4EC6', '#D6409F',
  '#FDECEC', '#FDF1DC', '#E6F4D7', '#DDF3EA', '#E3F0F4', '#E1E9FF', '#EFE5FA', '#16324F'];
const WB_THICK = [1, 2, 3, 4, 6, 8, 12, 16];
const WB_CTHICK = [0.5, 1, 1.5, 2, 3, 4, 6];
const WB_FONTS = [10, 12, 14, 16, 20, 24, 32, 48, 64];
const NOTE_COLOR = '#FFE08A';
const WB_MIN = 8;

const WB_TOOLS = [
  { id: 'select', icon: 'navigate-outline', name: 'Select', hint: 'Tap to select · drag to move · long press to add to the selection · long press on empty space to select an area' },
  { id: 'pan', icon: 'hand-left-outline', name: 'Pan', hint: 'Drag to move around · pinch to zoom' },
  { id: 'text', icon: 'text-outline', name: 'Text', hint: 'Tap where the text goes' },
  { id: 'note', icon: 'reader-outline', name: 'Note', hint: 'Tap to add a sticky note' },
  { id: 'pen', icon: 'brush-outline', name: 'Pen', hint: 'Draw freehand' },
  { id: 'line', icon: 'remove-outline', name: 'Line', hint: 'Drag from start to end' },
  { id: 'rect', icon: 'square-outline', name: 'Rectangle', hint: 'Drag to draw · tap for a default size' },
  { id: 'ellipse', icon: 'ellipse-outline', name: 'Ellipse', hint: 'Drag to draw · tap for a default size' },
  { id: 'triangle', icon: 'triangle-outline', name: 'Triangle', hint: 'Drag to draw · tap for a default size' },
  { id: 'polyline', icon: 'git-commit-outline', name: 'Polyline', hint: 'Tap the points · double tap or Done to finish' },
  { id: 'polygon', icon: 'shapes-outline', name: 'Polygon', hint: 'Tap the corners · double tap or Done to close' },
  { id: 'connector', icon: 'share-social-outline', name: 'Connect', hint: 'Tap an element, then the one to link it to' }
];

const WhiteboardView = {
  pid: null, boardId: null, views: {}, tool: 'select',
  style: { stroke: null, fill: null, width: 2, font: 16, cthick: 1, arrow: false },
  sel: new Set(), selConn: null, undoStack: [], redoStack: [], graphMode: false, alsoShow: new Set(),

  // ================================================================== mount
  mount(content, right, args) {
    const p = App.project;
    this.p = p;
    if (this.pid !== p.id) { this.pid = p.id; this.boardId = null; this.views = {}; this.graphMode = false; this.imgCache = new Map(); }
    const boards = p.whiteboards();
    if (args[0] && args[0] !== this.boardId) { this.boardId = args[0]; this.resetHistory(); }
    if (!boards.some(b => b.data.id === this.boardId)) { this.boardId = (boards.find(b => b.data.elements?.length) || boards[0])?.data.id || null; this.resetHistory(); }
    this.sel = new Set(args[1] ? [args[1]] : []); this.selConn = null;
    this.root = el('div.wb');
    content.appendChild(this.root);
    right.prepend(el('button.btn' + (this.graphMode ? '.primary' : ''), { title: 'Graph view', onclick: () => this.toggleGraph() }, icon('git-network-outline'), el('span.lbl', 'Graph')));
    if (!this.themeHooked) { this.themeHooked = true; App.on('theme', () => setTimeout(() => this.root && document.contains(this.root) && (this.graphMode ? this.renderGraph() : this.draw()), 60)); }
    if (!boards.length) {
      this.root.appendChild(UI.empty('easel-outline', 'No whiteboards yet', 'A whiteboard is a free canvas for notes, shapes and diagrams.',
        el('button.btn.primary', { onclick: () => this.newBoard() }, icon('add'), 'New whiteboard')));
      return;
    }
    this.build();
  },

  get entry() { return this.p.whiteboards().find(b => b.data.id === this.boardId) || null; },
  get data() { return this.entry?.data || null; },
  resetHistory() { this.undoStack = []; this.redoStack = []; this.alsoShow = new Set(); },

  build() {
    this.root.replaceChildren();
    if (this.graphMode) { this.buildGraph(); return; }
    this.canvas = el('div.wb-canvas');
    this.root.appendChild(this.canvas);
    this.svg = svgEl('svg', { width: 10, height: 10 });
    this.world = svgEl('g');
    this.consLayer = svgEl('g'); this.elemLayer = svgEl('g'); this.overLayer = svgEl('g');
    this.world.append(this.consLayer, this.elemLayer, this.overLayer);
    this.svg.appendChild(this.world);
    this.canvas.appendChild(this.svg);

    this.boardBtn = el('button.btn', { onclick: e => this.boardMenu(e.currentTarget) }, icon('easel-outline'), el('span.ellipsis', { style: { maxWidth: '9em' } }, this.data.name || 'Whiteboard'), icon('chevron-down'));
    this.undoBtn = el('button.btn.icon.small.ghost', { title: 'Undo', onclick: () => this.undo() }, icon('return-up-back-outline'));
    this.redoBtn = el('button.btn.icon.small.ghost', { title: 'Redo', onclick: () => this.redo() }, icon('return-up-forward-outline'));
    this.root.appendChild(el('div.wb-tools.glass', this.boardBtn, this.undoBtn, this.redoBtn));

    this.zoomLabel = el('span.small.muted', { style: { minWidth: '3.2em', textAlign: 'center' } });
    this.root.appendChild(el('div.wb-zoom.glass',
      el('button.btn.icon.small.ghost', { title: 'Zoom out', onclick: () => this.zoomBy(1 / 1.25) }, icon('remove')),
      this.zoomLabel,
      el('button.btn.icon.small.ghost', { title: 'Zoom in', onclick: () => this.zoomBy(1.25) }, icon('add')),
      el('button.btn.icon.small.ghost', { title: 'Fit', onclick: () => this.fit(true) }, icon('expand-outline'))));

    this.toolbar = el('div.wb-toolbar.glass');
    this.stylebar = el('div.wb-stylebar.glass');
    this.root.append(this.toolbar, this.stylebar);
    this.renderToolbar();
    this.bindGestures();
    requestAnimationFrame(() => {
      this.draw();
      if (!this.views[this.boardId]) this.fit(false); else this.apply();
      const focus = this.sel.size === 1 ? this.find([...this.sel][0]) : null;
      if (focus) this.focusOn(focus);
      this.refreshUi();
    });
  },

  // ================================================================== data helpers
  find(id) { return (this.data?.elements || []).find(e => e.id === id) || null; },
  all(list) { return walkAll(list === undefined ? this.data.elements : list); },
  selected() { return this.data.elements.filter(e => this.sel.has(e.id)); },

  snapshot() {
    this.undoStack.push(JSON.stringify({ elements: this.data.elements, connectors: this.data.connectors }));
    if (this.undoStack.length > 80) this.undoStack.shift();
    this.redoStack = [];
  },
  discardSnapshot() { this.undoStack.pop(); },
  commit(redraw = true) {
    this.p.setJson(this.entry.path, this.data);
    if (redraw) this.draw();
    this.refreshUi();
  },
  /** WhiteboardLinks.CarryReferences: references are not part of the history (they also live in tasks, docs, other boards). */
  restore(json) {
    const current = new Map(this.all().map(e => [e.id, e]));
    const state = JSON.parse(json);
    const restoredAll = this.all(state.elements);
    const linkedHere = new Set();
    for (const e of restoredAll) if (current.has(e.id)) for (const c of current.get(e.id).cardRefs || []) linkedHere.add(c);
    const elsewhere = this.cardsOnOtherBoards();
    for (const e of restoredAll) {
      const now = current.get(e.id);
      if (now) { if (now.cardRefs) e.cardRefs = [...now.cardRefs]; else delete e.cardRefs; if (now.docRefs) e.docRefs = [...now.docRefs]; else delete e.docRefs; }
      else if (e.cardRefs) { e.cardRefs = e.cardRefs.filter(c => !linkedHere.has(c) && !elsewhere.has(c)); if (!e.cardRefs.length) delete e.cardRefs; }
    }
    this.data.elements = state.elements; this.data.connectors = state.connectors;
  },
  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(JSON.stringify({ elements: this.data.elements, connectors: this.data.connectors }));
    this.restore(this.undoStack.pop());
    this.cleanSelection(); this.commit();
  },
  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(JSON.stringify({ elements: this.data.elements, connectors: this.data.connectors }));
    this.restore(this.redoStack.pop());
    this.cleanSelection(); this.commit();
  },
  cleanSelection() {
    for (const id of [...this.sel]) if (!this.find(id)) this.sel.delete(id);
    if (this.selConn && !this.data.connectors.some(c => c.id === this.selConn)) this.selConn = null;
  },
  cardsOnOtherBoards() {
    const s = new Set();
    for (const b of this.p.whiteboards()) if (b.data.id !== this.boardId) for (const e of this.all(b.data.elements)) for (const c of e.cardRefs || []) s.add(c);
    return s;
  },

  // ================================================================== rendering
  draw() {
    if (!this.elemLayer) return;
    this.consLayer.replaceChildren(); this.elemLayer.replaceChildren();
    this.nodes = new Map();
    for (const e of this.data.elements) { const g = this.visual(e, true); this.nodes.set(e.id, g); this.elemLayer.appendChild(g); }
    this.drawConnectors();
    this.drawOverlay();
  },
  redrawElement(e) {
    const old = this.nodes.get(e.id); const g = this.visual(e, true);
    if (old) old.replaceWith(g); else this.elemLayer.appendChild(g);
    this.nodes.set(e.id, g);
  },
  moveVisual(e) { this.nodes.get(e.id)?.setAttribute('transform', `translate(${e.x},${e.y}) rotate(${e.rotation || 0},${e.width / 2},${e.height / 2})`); },

  drawConnectors() {
    this.consLayer.replaceChildren();
    for (const c of this.data.connectors || []) {
      const a = this.find(c.fromId), b = this.find(c.toId);
      if (!a || !b) continue;
      const s = Wb.edgePoint(a, Wb.center(b)), t = Wb.edgePoint(b, Wb.center(a));
      const selected = c.id === this.selConn;
      const color = selected ? 'var(--selection)' : cssColor(c.color) || 'var(--text)';
      const line = svgEl('line', { x1: s.x, y1: s.y, x2: t.x, y2: t.y, 'stroke-width': (c.thickness || 1) + (selected ? 1.5 : 0), 'stroke-linecap': 'round' });
      line.style.stroke = color;
      this.consLayer.appendChild(line);
      if (c.arrow) {
        let dx = t.x - s.x, dy = t.y - s.y; const len = Math.hypot(dx, dy);
        if (len > 1) {
          dx /= len; dy /= len; const nx = -dy, ny = dx, size = 7 + (c.thickness || 1) * 2.5;
          const head = svgEl('polygon', { points: [[t.x, t.y], [t.x - dx * size + nx * size * .45, t.y - dy * size + ny * size * .45], [t.x - dx * size - nx * size * .45, t.y - dy * size - ny * size * .45]].map(p => p.join(',')).join(' ') });
          head.style.fill = color; this.consLayer.appendChild(head);
        }
      }
      const hit = svgEl('line', { x1: s.x, y1: s.y, x2: t.x, y2: t.y, 'stroke-width': Math.max((c.thickness || 1) + 12, 16) });
      hit.style.stroke = 'transparent'; hit.dataset.cid = c.id;
      this.consLayer.appendChild(hit);
    }
  },

  /** Like BuildVisual: a box rotated around its center; groups scale their children from RefWidth x RefHeight. */
  visual(e, top) {
    const kind = Wb.kind(e);
    const w = e.width || 1, h = e.height || 1;
    const g = svgEl('g', { transform: `translate(${e.x || 0},${e.y || 0}) rotate(${e.rotation || 0},${w / 2},${h / 2})` });
    if (top) g.dataset.eid = e.id;
    const stroke = cssColor(e.stroke), fill = cssColor(e.fill);
    const shape = node => {
      node.setAttribute('stroke-width', e.strokeWidth ?? 2);
      node.setAttribute('stroke-linejoin', 'round'); node.setAttribute('stroke-linecap', 'round');
      node.style.stroke = stroke || 'var(--text)'; node.style.fill = fill || 'none';
      g.appendChild(node);
      const hit = node.cloneNode(); hit.style.stroke = 'transparent';
      hit.style.fill = fill || e.closed || ['Rectangle', 'Ellipse', 'Triangle', 'Polygon'].includes(kind) ? 'transparent' : 'none';
      hit.setAttribute('stroke-width', Math.max((e.strokeWidth ?? 2) + 10, 16)); g.appendChild(hit);
    };
    switch (kind) {
      case 'Text': {
        g.appendChild(svgEl('rect', { width: w, height: h, fill: 'transparent' }));
        const fo = svgEl('foreignObject', { x: 0, y: 0, width: w, height: Math.max(h, 2000) });
        fo.style.overflow = 'visible'; fo.style.pointerEvents = 'none';
        const div = document.createElement('div');
        div.className = 'wb-text';
        div.style.fontSize = (e.fontSize > 0 ? e.fontSize : 16) + 'px';
        div.style.minHeight = h + 'px';
        div.style.height = 'auto';
        if (fill) div.style.background = fill;
        div.style.color = stroke || (fill ? readableOn(e.fill) : 'var(--text)');
        div.textContent = e.text || '';
        fo.appendChild(div); g.appendChild(fo);
        break;
      }
      case 'Image': {
        const url = e.image ? this.imageUrl(e.image) : null;
        if (url) g.appendChild(svgEl('image', { href: url, width: w, height: h, preserveAspectRatio: 'none' }));
        else {
          const r = svgEl('rect', { width: w, height: h, fill: 'none' }); r.style.stroke = 'var(--danger)'; g.appendChild(r);
          const t = svgEl('text', { x: w / 2, y: h / 2, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 11 }, 'image not found'); t.style.fill = 'var(--muted)'; g.appendChild(t);
        }
        g.appendChild(svgEl('rect', { width: w, height: h, fill: 'transparent' }));
        break;
      }
      case 'Group': {
        g.appendChild(svgEl('rect', { width: w, height: h, fill: 'transparent' }));
        const inner = svgEl('g', { transform: `scale(${e.refWidth > 0 ? w / e.refWidth : 1},${e.refHeight > 0 ? h / e.refHeight : 1})` });
        for (const c of e.children || []) inner.appendChild(this.visual(c, false));
        g.appendChild(inner);
        break;
      }
      case 'Rectangle': shape(svgEl('rect', { width: w, height: h })); break;
      case 'Ellipse': shape(svgEl('ellipse', { cx: w / 2, cy: h / 2, rx: w / 2, ry: h / 2 })); break;
      case 'Triangle': shape(svgEl('polygon', { points: `${w / 2},0 ${w},${h} 0,${h}` })); break;
      default: {
        let pts = Wb.points(e.points).map(p => [p.x * w, p.y * h]);
        if (pts.length < 2) pts = [[0, 0], [w, h]];
        shape(svgEl(kind === 'Polygon' || e.closed ? 'polygon' : 'polyline', { points: pts.map(p => p.join(',')).join(' ') }));
      }
    }
    if (top && (e.favorite || e.cardRefs?.length || e.docRefs?.length)) {
      const badge = svgEl('g', { transform: `translate(${w - 2},-6)` });
      if (e.favorite) { const st = svgEl('path', { d: 'M0,-7 2.1,-2.2 7,-2.2 3,1 4.4,6 0,3 -4.4,6 -3,1 -7,-2.2 -2.1,-2.2Z', stroke: '#000', 'stroke-width': .8 }); st.style.fill = 'var(--star)'; badge.appendChild(st); }
      if (e.cardRefs?.length || e.docRefs?.length) { const dot = svgEl('circle', { cx: e.favorite ? -12 : 0, cy: 0, r: 3.5 }); dot.style.fill = 'var(--selection)'; badge.appendChild(dot); }
      g.appendChild(badge);
    }
    return g;
  },

  imageUrl(name) {
    const key = this.p.id + '/' + name;
    if (this.imgCache.has(key)) return this.imgCache.get(key);
    const b = this.p.bytes('whiteboards/images/' + name);
    const u = b ? URL.createObjectURL(new Blob([b], { type: mimeOf(name) })) : null;
    this.imgCache.set(key, u);
    return u;
  },

  /** Selection frames and, for one element, the resize and rotation handles (sized for fingers). */
  drawOverlay() {
    if (!this.overLayer) return;
    this.overLayer.replaceChildren();
    const k = this.views[this.boardId]?.k || 1;
    const els = this.selected();
    for (const e of els) {
      const r = svgEl('rect', { class: 'wb-sel', x: -4, y: -4, width: e.width + 8, height: e.height + 8, rx: 4, transform: `translate(${e.x},${e.y}) rotate(${e.rotation || 0},${e.width / 2},${e.height / 2})` });
      this.overLayer.appendChild(r);
    }
    if (this.connectFrom) {
      const e = this.find(this.connectFrom);
      if (e) this.overLayer.appendChild(svgEl('rect', { class: 'wb-sel solid', x: -6, y: -6, width: e.width + 12, height: e.height + 12, rx: 6, transform: `translate(${e.x},${e.y}) rotate(${e.rotation || 0},${e.width / 2},${e.height / 2})` }));
    }
    if (this.marquee) {
      const m = this.marquee;
      this.overLayer.appendChild(svgEl('rect', { class: 'wb-marquee', x: Math.min(m.x1, m.x2), y: Math.min(m.y1, m.y2), width: Math.abs(m.x2 - m.x1), height: Math.abs(m.y2 - m.y1) }));
    }
    if (this.preview) this.overLayer.appendChild(this.preview);
    if (els.length !== 1 || this.tool !== 'select') return;
    const e = els[0], hs = 11 / k;
    const g = svgEl('g', { transform: `translate(${e.x},${e.y}) rotate(${e.rotation || 0},${e.width / 2},${e.height / 2})` });
    for (const hx of [-1, 0, 1]) for (const hy of [-1, 0, 1]) {
      if (!hx && !hy) continue;
      if (Wb.kind(e) === 'Text' && hy !== 0) continue;
      const cx = (hx + 1) / 2 * e.width, cy = (hy + 1) / 2 * e.height;
      const c = svgEl('circle', { class: 'wb-handle', cx, cy, r: hs / 2 + 1.5 / k, 'stroke-width': 1.5 / k });
      c.dataset.handle = `${hx},${hy}`;
      g.appendChild(c);
      const big = svgEl('circle', { cx, cy, r: hs * 1.3, fill: 'transparent' }); big.dataset.handle = `${hx},${hy}`; g.appendChild(big);
    }
    const ry = -28 / k;
    g.appendChild(svgEl('line', { x1: e.width / 2, y1: 0, x2: e.width / 2, y2: ry, class: 'wb-sel', 'stroke-dasharray': 'none' }));
    const rot = svgEl('circle', { class: 'wb-handle rot', cx: e.width / 2, cy: ry, r: hs / 2 + 2 / k, 'stroke-width': 1.5 / k }); rot.dataset.handle = 'rot'; g.appendChild(rot);
    const rotBig = svgEl('circle', { cx: e.width / 2, cy: ry, r: hs * 1.4, fill: 'transparent' }); rotBig.dataset.handle = 'rot'; g.appendChild(rotBig);
    this.overLayer.appendChild(g);
  },

  // ================================================================== view transform
  apply() {
    const v = this.views[this.boardId];
    if (!v || !this.world) return;
    this.world.setAttribute('transform', `translate(${v.x},${v.y}) scale(${v.k})`);
    this.zoomLabel.textContent = Math.round(v.k * 100) + '%';
    this.canvas.style.backgroundSize = `${24 * v.k}px ${24 * v.k}px`;
    this.canvas.style.backgroundPosition = `${v.x}px ${v.y}px`;
  },
  extent() {
    const els = this.data?.elements || [];
    if (!els.length) return { x1: 0, y1: 0, x2: 400, y2: 300 };
    const bs = els.map(Wb.bounds);
    return { x1: Math.min(...bs.map(b => b.x1)), y1: Math.min(...bs.map(b => b.y1)), x2: Math.max(...bs.map(b => b.x2)), y2: Math.max(...bs.map(b => b.y2)) };
  },
  fit(animate) {
    const r = this.canvas.getBoundingClientRect();
    const b = this.extent(), pad = 50;
    const k = Math.min(2, Math.max(.05, Math.min((r.width - pad * 2) / Math.max(1, b.x2 - b.x1), (r.height - pad * 2 - 60) / Math.max(1, b.y2 - b.y1))));
    this.animateTo({ k, x: r.width / 2 - (b.x1 + b.x2) / 2 * k, y: r.height / 2 - 10 - (b.y1 + b.y2) / 2 * k }, animate);
  },
  focusOn(e) {
    const r = this.canvas.getBoundingClientRect(), b = Wb.bounds(e), v = this.views[this.boardId];
    const k = Math.max(v.k, Math.min(1.5, (r.width * .45) / Math.max(1, b.x2 - b.x1)));
    this.animateTo({ k, x: r.width / 2 - (b.x1 + b.x2) / 2 * k - (r.width > 600 ? 110 : 0), y: r.height / 2 - (b.y1 + b.y2) / 2 * k }, true);
  },
  animateTo(target, animate) {
    const from = this.views[this.boardId];
    if (!animate || !from) { this.views[this.boardId] = target; this.apply(); this.drawOverlay(); return; }
    const t0 = performance.now(), dur = 380;
    const step = t => {
      const u = Math.min(1, (t - t0) / dur), q = 1 - Math.pow(1 - u, 3);
      this.views[this.boardId] = { k: from.k + (target.k - from.k) * q, x: from.x + (target.x - from.x) * q, y: from.y + (target.y - from.y) * q };
      this.apply();
      if (u < 1) requestAnimationFrame(step); else this.drawOverlay();
    };
    requestAnimationFrame(step);
  },
  zoomBy(f, cx, cy) {
    const v = this.views[this.boardId]; if (!v) return;
    const r = this.canvas.getBoundingClientRect();
    cx ??= r.width / 2; cy ??= r.height / 2;
    const k = Math.min(6, Math.max(.05, v.k * f));
    this.views[this.boardId] = { k, x: cx - (cx - v.x) * (k / v.k), y: cy - (cy - v.y) * (k / v.k) };
    this.apply(); this.drawOverlay();
  },
  toWorld(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect(), v = this.views[this.boardId];
    return { x: (clientX - r.left - v.x) / v.k, y: (clientY - r.top - v.y) / v.k };
  },

  // ================================================================== gestures
  bindGestures() {
    const c = this.canvas;
    const pts = new Map();
    let pinch = null, act = null, lastTap = { t: 0, id: null }, lpTimer = 0;
    const cancelLp = () => clearTimeout(lpTimer);

    c.addEventListener('pointerdown', e => {
      if (e.button > 0 && e.pointerType === 'mouse') { if (e.button === 1) act = { kind: 'pan', last: { x: e.clientX, y: e.clientY } }; return; }
      c.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) { cancelLp(); this.abortAction(act); act = null; pinch = null; return; }
      const w = this.toWorld(e.clientX, e.clientY);
      const handle = e.target.closest?.('[data-handle]')?.dataset.handle;
      const eid = e.target.closest?.('[data-eid]')?.dataset.eid;
      const cid = e.target.closest?.('[data-cid]')?.dataset.cid;
      act = { kind: null, start: w, client: { x: e.clientX, y: e.clientY }, last: { x: e.clientX, y: e.clientY }, eid, cid, moved: 0, pointerType: e.pointerType };
      const tool = this.tool;
      if (tool === 'pan') { act.kind = 'pan'; return; }
      if (tool === 'select') {
        if (handle && this.sel.size === 1) {
          const el1 = this.find([...this.sel][0]);
          this.snapshot();
          act.kind = handle === 'rot' ? 'rotate' : 'resize';
          act.el = el1; act.h = handle.split(',').map(Number);
          return;
        }
        if (eid) {
          act.kind = 'maybe-move';
          lpTimer = setTimeout(() => { if (act && act.kind === 'maybe-move' && act.moved < 8) { act.kind = 'done'; this.toggleSelect(eid); navigator.vibrate?.(10); } }, 480);
          return;
        }
        act.kind = 'maybe-pan';
        lpTimer = setTimeout(() => { if (act && act.kind === 'maybe-pan' && act.moved < 8) { act.kind = 'marquee'; this.marquee = { x1: w.x, y1: w.y, x2: w.x, y2: w.y }; navigator.vibrate?.(10); this.drawOverlay(); } }, 480);
        return;
      }
      if (tool === 'connector') { act.kind = 'tap'; return; }
      if (tool === 'text' || tool === 'note') { act.kind = 'tap'; return; }
      if (tool === 'polyline' || tool === 'polygon') { act.kind = 'tap'; return; }
      if (tool === 'pen') { act.kind = 'pen'; act.points = [w]; return; }
      act.kind = 'shape';
    });

    c.addEventListener('pointermove', e => {
      if (act?.kind === 'pan' && !pts.has(e.pointerId) && e.pointerType === 'mouse') { this.panBy(e.clientX - act.last.x, e.clientY - act.last.y); act.last = { x: e.clientX, y: e.clientY }; return; }
      if (!pts.has(e.pointerId)) { if (this.polyPoints) this.previewPoly(this.toWorld(e.clientX, e.clientY)); return; }
      const prev = pts.get(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        const [a, b] = [...pts.values()], r = c.getBoundingClientRect();
        const mid = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top }, dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) {
          const v = this.views[this.boardId], k = Math.min(6, Math.max(.05, v.k * dist / pinch.dist));
          this.views[this.boardId] = { k, x: mid.x - (pinch.mid.x - v.x) * (k / v.k), y: mid.y - (pinch.mid.y - v.y) * (k / v.k) };
          this.apply();
        }
        pinch = { mid, dist };
        return;
      }
      if (!act) return;
      const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      act.moved += Math.abs(dx) + Math.abs(dy);
      const w = this.toWorld(e.clientX, e.clientY);
      switch (act.kind) {
        case 'pan': this.panBy(dx, dy); break;
        case 'maybe-pan': if (act.moved > 8) { cancelLp(); act.kind = 'pan'; this.panBy(e.clientX - act.client.x, e.clientY - act.client.y); } break;
        case 'maybe-move':
          if (act.moved > 6) {
            cancelLp();
            if (!this.sel.has(act.eid)) { this.sel = new Set([act.eid]); this.selConn = null; this.refreshUi(); }
            this.snapshot(); act.kind = 'move'; act.prevW = act.start;
            this.moveSelection(w.x - act.start.x, w.y - act.start.y); act.prevW = w;
          }
          break;
        case 'move': this.moveSelection(w.x - act.prevW.x, w.y - act.prevW.y); act.prevW = w; break;
        case 'resize': this.resize(act.el, act.h[0], act.h[1], w, e.shiftKey); break;
        case 'rotate': {
          const ctr = Wb.center(act.el);
          let ang = Math.atan2(w.y - ctr.y, w.x - ctr.x) * 180 / Math.PI + 90;
          if (!e.shiftKey) { const snap = Math.round(ang / 15) * 15; if (Math.abs(snap - ang) < 4) ang = snap; }
          act.el.rotation = Math.round((((ang % 360) + 360) % 360) * 100) / 100;
          this.moveVisual(act.el); this.drawConnectors(); this.drawOverlay();
          break;
        }
        case 'marquee': this.marquee.x2 = w.x; this.marquee.y2 = w.y; this.drawOverlay(); break;
        case 'pen': act.points.push(w); this.previewPen(act.points); break;
        case 'shape': this.previewShape(act.start, w, e.shiftKey); break;
      }
    });

    const up = e => {
      if (act?.kind === 'pan' && e.pointerType === 'mouse' && !pts.has(e.pointerId)) { act = null; return; }
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      cancelLp();
      if (pts.size > 0) return;
      pinch = null;
      if (!act) return;
      const a = act; act = null;
      const w = this.toWorld(e.clientX, e.clientY);
      const cancelled = e.type === 'pointercancel';
      const tap = a.moved < 8 && !cancelled;
      const now = Date.now(), dbl = tap && now - lastTap.t < 330 && lastTap.id === (a.eid || null);
      if (tap) lastTap = { t: now, id: a.eid || null };
      switch (a.kind) {
        case 'maybe-move':
          if (dbl && a.eid) { const el1 = this.find(a.eid); if (el1 && Wb.kind(el1) === 'Text') { this.editText(el1); break; } }
          this.sel = new Set([a.eid]); this.selConn = null; this.drawConnectors(); this.refreshUi();
          break;
        case 'maybe-pan':
          if (tap && a.cid) { this.sel.clear(); this.selConn = a.cid; this.drawConnectors(); this.refreshUi(); break; }
          if (tap) { if (dbl) this.fit(true); this.sel.clear(); this.selConn = null; this.drawConnectors(); this.refreshUi(); }
          break;
        case 'move': this.commit(false); this.drawOverlay(); break;
        case 'resize': case 'rotate': this.commit(); break;
        case 'marquee': {
          const m = this.marquee; this.marquee = null;
          const box = { x1: Math.min(m.x1, m.x2), y1: Math.min(m.y1, m.y2), x2: Math.max(m.x1, m.x2), y2: Math.max(m.y1, m.y2) };
          this.sel = new Set(this.data.elements.filter(el1 => { const b = Wb.bounds(el1); return b.x1 >= box.x1 && b.y1 >= box.y1 && b.x2 <= box.x2 && b.y2 <= box.y2; }).map(el1 => el1.id));
          this.selConn = null; this.refreshUi();
          break;
        }
        case 'pen': this.preview = null; if (!cancelled) this.finishPen(a.points); else this.drawOverlay(); break;
        case 'shape': this.preview = null; if (!cancelled) this.finishShape(a.start, w, tap, e.shiftKey); else this.drawOverlay(); break;
        case 'tap':
          if (!tap) break;
          if (this.tool === 'text' || this.tool === 'note') this.createText(w, this.tool === 'note');
          else if (this.tool === 'connector') this.connectTap(a.eid);
          else if (this.tool === 'polyline' || this.tool === 'polygon') { if (dbl && this.polyPoints?.length >= 2) this.finishPoly(); else this.addPolyPoint(w); }
          break;
      }
    };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', e => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      if (e.ctrlKey || (Math.abs(e.deltaY) >= 50 && !e.shiftKey && e.deltaMode === 0 && Math.abs(e.deltaX) < 1)) this.zoomBy(Math.exp(-e.deltaY / 400), e.clientX - r.left, e.clientY - r.top);
      else this.panBy(-e.deltaX, -e.deltaY);
    }, { passive: false });
    if (!this.keysHooked) {
      this.keysHooked = true;
      document.addEventListener('keydown', e => {
        if (!this.canvas || !document.contains(this.canvas) || this.graphMode || e.target.closest?.('input,textarea,[contenteditable]') || UI._stack.length) return;
        const mod = e.ctrlKey || e.metaKey;
        if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); }
        else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); this.redo(); }
        else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); this.duplicate(); }
        else if (e.key === 'Delete' || e.key === 'Backspace') { if (this.sel.size || this.selConn) { e.preventDefault(); this.deleteSelection(); } }
        else if (e.key === 'Escape') { this.polyPoints = null; this.connectFrom = null; this.preview = null; this.sel.clear(); this.selConn = null; this.drawConnectors(); this.refreshUi(); }
        else if (e.key === 'Enter' && this.polyPoints) this.finishPoly();
      });
    }
  },
  abortAction(act) {
    if (!act) return;
    if (['move', 'resize', 'rotate'].includes(act.kind)) { this.restore(this.undoStack.pop()); this.draw(); }
    if (act.kind === 'marquee') this.marquee = null;
    this.preview = null; this.drawOverlay();
  },
  panBy(dx, dy) { const v = this.views[this.boardId]; this.views[this.boardId] = { ...v, x: v.x + dx, y: v.y + dy }; this.apply(); },

  toggleSelect(id) {
    if (this.sel.has(id)) this.sel.delete(id); else this.sel.add(id);
    this.selConn = null; this.refreshUi();
  },
  moveSelection(dx, dy) {
    for (const e of this.selected()) { e.x = Math.round((e.x + dx) * 100) / 100; e.y = Math.round((e.y + dy) * 100) / 100; this.moveVisual(e); }
    this.drawConnectors(); this.drawOverlay();
  },
  /** WhiteboardOps.Resize: the opposite side stays where it is, also when the element is rotated. */
  resize(e, hx, hy, mouse, keepAspect) {
    const anchorWorld = Wb.toWorld(e, { x: -hx * e.width / 2, y: -hy * e.height / 2 });
    const d = Wb.rotate({ x: mouse.x - anchorWorld.x, y: mouse.y - anchorWorld.y }, -(e.rotation || 0));
    let nw = hx ? Math.max(WB_MIN, d.x * hx) : e.width, nh = hy ? Math.max(WB_MIN, d.y * hy) : e.height;
    if ((keepAspect || Wb.kind(e) === 'Image') && hx && hy && e.width > 0 && e.height > 0) { const s = Math.max(nw / e.width, nh / e.height); nw = e.width * s; nh = e.height * s; }
    const r = Wb.rotate({ x: hx * nw / 2, y: hy * nh / 2 }, e.rotation || 0);
    const cx = anchorWorld.x + r.x, cy = anchorWorld.y + r.y;
    const round = v => Math.round(v * 100) / 100;
    e.width = round(nw); e.height = round(nh); e.x = round(cx - nw / 2); e.y = round(cy - nh / 2);
    this.redrawElement(e); this.drawConnectors(); this.drawOverlay();
  },

  // ================================================================== creation
  /** StyleNew: the current stroke / fill / thickness on a new element. */
  styleNew(e) {
    const s = this.style;
    if (s.stroke) e.stroke = s.stroke;
    const k = e.kind;
    if (k === 'Text') { e.fontSize = s.font; e.strokeWidth = 0; }
    else if (k === 'Image') { delete e.stroke; e.strokeWidth = 0; }
    else if (['Rectangle', 'Ellipse', 'Triangle', 'Polygon'].includes(k)) { e.strokeWidth = s.width; if (s.fill) e.fill = s.fill; }
    else e.strokeWidth = s.width;
  },
  newElement(kind, x, y, w, h, extra = {}) {
    // Same property order as WbElement
    const e = { id: uid(12), kind, x: r2(x), y: r2(y), width: r2(w), height: r2(h), rotation: 0 };
    Object.assign(e, extra);
    this.styleNew(e);
    if (e.strokeWidth == null) e.strokeWidth = 2;
    return WhiteboardView.ordered(e);
  },
  /** Keeps the property order of WbElement (readable diffs). */
  ordered(e) {
    const order = ['id', 'kind', 'x', 'y', 'width', 'height', 'rotation', 'stroke', 'strokeWidth', 'fill', 'closed', 'points', 'text', 'fontSize', 'image', 'children', 'refWidth', 'refHeight', 'favorite', 'cardRefs', 'docRefs'];
    const o = {}; for (const k of order) if (e[k] !== undefined && e[k] !== null) o[k] = e[k];
    for (const k of Object.keys(e)) if (!(k in o) && e[k] != null) o[k] = e[k];
    return o;
  },
  addElement(e, select = true) {
    this.snapshot();
    this.data.elements.push(e);
    if (select) { this.sel = new Set([e.id]); this.selConn = null; }
    this.commit();
  },
  fromPoints(kind, points) {
    let l = Math.min(...points.map(p => p.x)), t = Math.min(...points.map(p => p.y)), r = Math.max(...points.map(p => p.x)), b = Math.max(...points.map(p => p.y));
    if (r - l < 1) { const c = (l + r) / 2; l = c - .5; r = c + .5; }
    if (b - t < 1) { const c = (t + b) / 2; t = c - .5; b = c + .5; }
    const w = r - l, h = b - t;
    const pts = points.map(p => `${fmt4((p.x - l) / w)},${fmt4((p.y - t) / h)}`).join(' ');
    return this.newElement(kind, l, t, w, h, { points: pts });
  },
  previewShape(a, b, shift) {
    const tool = this.tool;
    let g;
    if (tool === 'line') {
      if (shift) b = snapAngle(a, b);
      g = svgEl('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    } else {
      let x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
      if (shift) { const s = Math.max(w, h); w = h = s; if (tool === 'triangle') h = w * Math.sqrt(3) / 2; }
      g = tool === 'ellipse' ? svgEl('ellipse', { cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2 }) : tool === 'triangle' ? svgEl('polygon', { points: `${x + w / 2},${y} ${x + w},${y + h} ${x},${y + h}` }) : svgEl('rect', { x, y, width: w, height: h });
    }
    g.setAttribute('class', 'wb-preview'); g.setAttribute('stroke-width', this.style.width);
    g.style.stroke = cssColor(this.style.stroke) || 'var(--text)';
    g.style.fill = tool !== 'line' && this.style.fill ? cssColor(this.style.fill) : 'none';
    this.preview = g; this.drawOverlay();
  },
  finishShape(a, b, tap, shift) {
    const tool = this.tool;
    if (tool === 'line') {
      if (tap) b = { x: a.x + 160, y: a.y };
      if (shift) b = snapAngle(a, b);
      this.addElement(this.fromPoints('Line', [a, b]));
      return;
    }
    let x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    if (tap || (w < 6 && h < 6)) { w = 140; h = tool === 'triangle' ? 121 : 90; x = a.x - w / 2; y = a.y - h / 2; }
    else if (shift) { const s = Math.max(w, h); w = h = s; if (tool === 'triangle') h = w * Math.sqrt(3) / 2; }
    this.addElement(this.newElement({ rect: 'Rectangle', ellipse: 'Ellipse', triangle: 'Triangle' }[tool], x, y, Math.max(WB_MIN, w), Math.max(WB_MIN, h)));
  },
  previewPen(points) {
    const g = svgEl('polyline', { class: 'wb-preview', points: points.map(p => `${p.x},${p.y}`).join(' '), 'stroke-width': this.style.width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    g.style.stroke = cssColor(this.style.stroke) || 'var(--text)'; g.style.fill = 'none';
    this.preview = g; this.drawOverlay();
  },
  finishPen(points) {
    if (points.length < 2) { this.drawOverlay(); return; }
    const k = this.views[this.boardId].k;
    const simple = rdp(points, .6 / k);
    this.addElement(this.fromPoints('Stroke', simple), false);
  },
  addPolyPoint(w) {
    this.polyPoints ||= [];
    this.polyPoints.push(w);
    this.previewPoly(w);
    this.refreshUi();
  },
  previewPoly(cursor) {
    const pts = [...(this.polyPoints || [])];
    if (!pts.length) return;
    if (cursor) pts.push(cursor);
    const g = svgEl(this.tool === 'polygon' && pts.length > 2 ? 'polygon' : 'polyline', { class: 'wb-preview', points: pts.map(p => `${p.x},${p.y}`).join(' '), 'stroke-width': this.style.width });
    g.style.stroke = cssColor(this.style.stroke) || 'var(--text)';
    g.style.fill = this.tool === 'polygon' && this.style.fill ? cssColor(this.style.fill) : 'none';
    this.preview = g; this.drawOverlay();
  },
  finishPoly() {
    const pts = this.polyPoints || [];
    this.polyPoints = null; this.preview = null;
    if (pts.length >= 2) this.addElement(this.fromPoints(this.tool === 'polygon' && pts.length >= 3 ? 'Polygon' : 'Polyline', pts));
    else this.drawOverlay();
    this.refreshUi();
  },
  createText(at, note) {
    const font = this.style.font;
    const e = note
      ? this.newElement('Text', at.x - 90, at.y - 20, 180, 130, { text: '', fill: NOTE_COLOR })
      : this.newElement('Text', at.x, at.y - (font * 1.35 + 12) / 2, 240, font * 1.35 + 12, { text: '' });
    if (note) { delete e.stroke; e.fill = NOTE_COLOR; }
    this.editText(e, true);
  },
  /** Text editing in a sheet (comfortable with the phone keyboard). Empty text: the element goes away. */
  editText(e, isNew = false) {
    const ta = el('textarea.input', { rows: 5, style: { fontSize: '16px' }, placeholder: 'Type the text…' }, e.text || '');
    let font = e.fontSize > 0 ? e.fontSize : this.style.font;
    const sizes = el('div.pick');
    const renderSizes = () => fill(sizes, ...WB_FONTS.map(f => el('button.chip' + (f === font ? '.sel' : ''), { onclick: () => { font = f; renderSizes(); } }, String(f))));
    renderSizes();
    let saved = false;
    const s = UI.sheet({ title: isNew ? 'New text' : 'Edit text', cls: 'mid',
      body: el('div.col', ta, el('div.field', el('label', 'Size'), sizes)),
      foot: [el('button.btn.ghost', { onclick: () => s.close() }, 'Cancel'), el('button.btn.primary', { onclick: () => { saved = true; s.close(); } }, icon('checkmark'), 'Done')],
      onClose: () => {
        if (!saved) { if (isNew) this.tool = 'select', this.renderToolbar(); return; }
        const text = ta.value.replace(/\s+$/, '');
        if (!text) {
          if (!isNew) { this.snapshot(); this.deleteIds([e.id]); this.commit(); }
          return;
        }
        if (!isNew) this.snapshot();
        e.text = text; e.fontSize = font;
        e.height = r2(Math.max(isNew ? e.height : 0, font * 1.35 + 12, measureText(text, e.width, font)));
        if (isNew) { this.data.elements.push(WhiteboardView.ordered(e)); this.snapshotBeforeAdd?.(); this.undoStack.push(this.pendingSnap); }
        if (isNew) this.sel = new Set([e.id]);
        this.tool = 'select'; this.renderToolbar();
        this.commit();
      } });
    if (isNew) this.pendingSnap = JSON.stringify({ elements: this.data.elements, connectors: this.data.connectors });
    setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 420);
  },
  async addImage() {
    const file = await UI.pickFile('image/*');
    if (!file) return;
    let bytes = new Uint8Array(await file.arrayBuffer());
    let ext = (file.name.match(/\.(png|jpe?g|gif|webp|bmp)$/i)?.[1] || '').toLowerCase().replace('jpeg', 'jpg');
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); }).catch(() => null);
    if (!img) { UI.alert('This file is not a picture that can be shown.'); return; }
    if (!ext) { // HEIC and others: stored as PNG
      const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight; cv.getContext('2d').drawImage(img, 0, 0);
      bytes = new Uint8Array(await (await new Promise(r => cv.toBlob(r, 'image/png'))).arrayBuffer()); ext = 'png';
    }
    const name = uid(16) + '.' + ext;
    this.p.setBytes('whiteboards/images/' + name, bytes);
    const scale = Math.min(1, 400 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
    const r = this.canvas.getBoundingClientRect(), c = this.toWorld(r.left + r.width / 2, r.top + r.height / 2);
    this.tool = 'select'; this.renderToolbar();
    this.addElement(this.newElement('Image', c.x - w / 2, c.y - h / 2, w, h, { image: name }));
  },
  connectTap(eid) {
    if (!eid) { this.connectFrom = null; this.drawOverlay(); return; }
    if (!this.connectFrom) { this.connectFrom = eid; this.drawOverlay(); UI.toast('Now tap the element to link it to', 'share-social-outline', 1500); return; }
    if (eid === this.connectFrom) { this.connectFrom = null; this.drawOverlay(); return; }
    const from = this.connectFrom; this.connectFrom = null;
    if (this.data.connectors.some(c => (c.fromId === from && c.toId === eid) || (c.fromId === eid && c.toId === from))) { UI.toast('These two elements are already connected.', 'information-circle-outline'); this.drawOverlay(); return; }
    this.snapshot();
    const con = { id: uid(12), fromId: from, toId: eid, thickness: this.style.cthick };
    if (this.style.arrow) con.arrow = true;
    this.data.connectors.push(con);
    this.sel.clear(); this.selConn = con.id;
    this.commit();
    UI.toast('Connected', 'share-social-outline', 1200);
  },

  // ================================================================== operations on the selection
  deleteIds(ids) {
    const s = new Set(ids);
    this.data.elements = this.data.elements.filter(e => !s.has(e.id));
    this.data.connectors = this.data.connectors.filter(c => !s.has(c.fromId) && !s.has(c.toId));
  },
  deleteSelection() {
    if (!this.sel.size && !this.selConn) return;
    this.snapshot();
    if (this.selConn) this.data.connectors = this.data.connectors.filter(c => c.id !== this.selConn);
    this.deleteIds([...this.sel]);
    this.sel.clear(); this.selConn = null;
    this.commit();
  },
  duplicate() {
    if (!this.sel.size) return;
    this.snapshot();
    const map = new Map(), copies = [];
    for (const o of this.selected()) {
      const c = cloneNewIds(o); c.x = r2(c.x + 24); c.y = r2(c.y + 24);
      map.set(o.id, c.id); copies.push(c);
    }
    this.data.elements.push(...copies);
    for (const con of this.data.connectors.slice()) if (map.has(con.fromId) && map.has(con.toId)) {
      const n = { id: uid(12), fromId: map.get(con.fromId), toId: map.get(con.toId), thickness: con.thickness };
      if (con.color) n.color = con.color; if (con.arrow) n.arrow = true;
      this.data.connectors.push(n);
    }
    this.sel = new Set(copies.map(c => c.id));
    this.commit();
  },
  reorder(front) {
    if (!this.sel.size) return;
    this.snapshot();
    const moved = this.selected(), rest = this.data.elements.filter(e => !this.sel.has(e.id));
    this.data.elements = front ? [...rest, ...moved] : [...moved, ...rest];
    this.commit();
  },
  toggleFavorite() {
    const els = this.selected(); if (!els.length) return;
    const on = !els.every(e => e.favorite);
    for (const e of els) { if (on) e.favorite = true; else delete e.favorite; reorderInPlace(e); this.redrawElement(e); }
    this.commit(false); this.drawOverlay();
  },
  disconnect() {
    const s = this.sel; if (!s.size) return;
    this.snapshot();
    this.data.connectors = this.data.connectors.filter(c => !s.has(c.fromId) && !s.has(c.toId));
    this.commit();
  },
  /** WhiteboardOps.Group ("Merge"). */
  merge() {
    const members = this.selected();
    if (members.length < 2) return;
    this.snapshot();
    const bs = members.map(Wb.bounds);
    const l = Math.min(...bs.map(b => b.x1)), t = Math.min(...bs.map(b => b.y1)), r = Math.max(...bs.map(b => b.x2)), b = Math.max(...bs.map(b => b.y2));
    const w = Math.max(1, r - l), h = Math.max(1, b - t);
    for (const m of members) { m.x = r2(m.x - l); m.y = r2(m.y - t); }
    const group = { id: uid(12), kind: 'Group', x: r2(l), y: r2(t), width: r2(w), height: r2(h), rotation: 0, strokeWidth: 0, children: members, refWidth: r2(w), refHeight: r2(h) };
    if (members.some(m => m.favorite)) group.favorite = true;
    const cards = [...new Set(members.flatMap(m => m.cardRefs || []))], docs = uniqCI(members.flatMap(m => m.docRefs || []));
    if (cards.length) group.cardRefs = cards; if (docs.length) group.docRefs = docs;
    const index = this.data.elements.indexOf(members[members.length - 1]);
    this.data.elements.splice(index + 1, 0, group);
    this.data.elements = this.data.elements.filter(e => !members.includes(e));
    const ids = new Set(members.map(m => m.id)), kept = [];
    for (const c of this.data.connectors) {
      if (ids.has(c.fromId)) c.fromId = group.id;
      if (ids.has(c.toId)) c.toId = group.id;
      if (c.fromId === c.toId) continue;
      if (kept.some(k => (k.fromId === c.fromId && k.toId === c.toId) || (k.fromId === c.toId && k.toId === c.fromId))) continue;
      kept.push(c);
    }
    this.data.connectors = kept;
    this.sel = new Set([group.id]);
    this.commit();
    UI.toast(`Merged ${members.length} elements into one.`, 'git-merge-outline');
  },
  /** WhiteboardOps.Ungroup ("Split"): everything gets back what was its own. */
  split() {
    const groups = this.selected().filter(e => Wb.kind(e) === 'Group');
    if (!groups.length) return;
    this.snapshot();
    const released = [];
    for (const g of groups) {
      const sx = g.refWidth > 0 ? g.width / g.refWidth : 1, sy = g.refHeight > 0 ? g.height / g.refHeight : 1;
      const kids = g.children || [];
      for (const ch of kids) {
        const local = { x: (ch.x + ch.width / 2) * sx - g.width / 2, y: (ch.y + ch.height / 2) * sy - g.height / 2 };
        const ctr = Wb.toWorld(g, local);
        ch.width = r2(ch.width * sx); ch.height = r2(ch.height * sy);
        ch.x = r2(ctr.x - ch.width / 2); ch.y = r2(ctr.y - ch.height / 2);
        ch.rotation = normAngle((ch.rotation || 0) + (g.rotation || 0));
        ch.strokeWidth = Math.round((ch.strokeWidth || 0) * Math.sqrt(Math.abs(sx * sy)) * 100) / 100;
        if (ch.fontSize > 0) ch.fontSize = Math.round(ch.fontSize * sy * 10) / 10;
      }
      if (kids.length) {
        const gc = g.cardRefs || [], gd = g.docRefs || [];
        for (const ch of kids) {
          if (ch.favorite && !g.favorite) delete ch.favorite;
          setRefs(ch, 'cardRefs', (ch.cardRefs || []).filter(c => gc.includes(c)));
          setRefs(ch, 'docRefs', (ch.docRefs || []).filter(d => gd.some(x => x.toLowerCase() === d.toLowerCase())));
        }
        const heir = kids[0];
        if (g.favorite && !kids.some(c => c.favorite)) heir.favorite = true;
        const ownedC = new Set(kids.flatMap(c => c.cardRefs || [])), ownedD = new Set(kids.flatMap(c => (c.docRefs || []).map(d => d.toLowerCase())));
        kids.forEach((ch, i) => { if (i > 0 && ch.cardRefs) setRefs(ch, 'cardRefs', ch.cardRefs.filter(id => !kids.slice(0, i).some(o => o.cardRefs?.includes(id)))); });
        setRefs(heir, 'cardRefs', [...new Set([...(heir.cardRefs || []), ...gc.filter(id => !ownedC.has(id))])]);
        setRefs(heir, 'docRefs', uniqCI([...(heir.docRefs || []), ...gd.filter(d => !ownedD.has(d.toLowerCase()))]));
      }
      const idx = this.data.elements.indexOf(g);
      this.data.elements.splice(idx, 1, ...kids.map(k => WhiteboardView.ordered(k)));
      this.data.connectors = this.data.connectors.filter(c => c.fromId !== g.id && c.toId !== g.id);
      released.push(...kids.map(k => k.id));
    }
    this.sel = new Set(released);
    this.commit();
  },
  /** A style control changed: applied to the selection (one undo step) and kept for the next elements. */
  applyStyle(key, value) {
    this.style[key] = value;
    if (this.selConn && ['stroke', 'cthick', 'arrow'].includes(key)) {
      const c = this.data.connectors.find(x => x.id === this.selConn);
      if (c) {
        this.snapshot();
        if (key === 'stroke') { if (value) c.color = value; else delete c.color; }
        if (key === 'cthick') c.thickness = value;
        if (key === 'arrow') { if (value) c.arrow = true; else delete c.arrow; }
        this.commit(false); this.drawConnectors();
      }
    } else if (this.sel.size) {
      this.snapshot();
      for (const e of this.selected()) {
        const k = Wb.kind(e);
        if (key === 'stroke' && k !== 'Image') { if (value) e.stroke = value; else delete e.stroke; }
        if (key === 'fill' && k !== 'Image' && k !== 'Group') { if (value) e.fill = value; else delete e.fill; }
        if (key === 'width' && !['Text', 'Image', 'Group'].includes(k)) e.strokeWidth = value;
        if (key === 'font' && k === 'Text') { e.fontSize = value; e.height = r2(Math.max(value * 1.35 + 12, measureText(e.text || '', e.width, value))); }
        reorderInPlace(e);
        this.redrawElement(e);
      }
      this.commit(false); this.drawConnectors(); this.drawOverlay();
    }
    this.renderStylebar();
  },

  // ================================================================== references (WhiteboardLinks)
  linkCard(e, cardId) {
    for (const x of this.all()) if (x.cardRefs?.includes(cardId)) { x.cardRefs = x.cardRefs.filter(c => c !== cardId); if (!x.cardRefs.length) delete x.cardRefs; }
    (e.cardRefs ||= []).push(cardId);
    reorderInPlace(e);
    // a task belongs to one element only: the other boards forget it
    for (const b of this.p.whiteboards()) {
      if (b.data.id === this.boardId) continue;
      let ch = false;
      for (const x of this.all(b.data.elements)) if (x.cardRefs?.includes(cardId)) { x.cardRefs = x.cardRefs.filter(c => c !== cardId); if (!x.cardRefs.length) delete x.cardRefs; ch = true; }
      if (ch) this.p.setJson(b.path, b.data);
    }
    this.commitRefs(e);
  },
  unlinkCard(e, cardId) { e.cardRefs = (e.cardRefs || []).filter(c => c !== cardId); if (!e.cardRefs.length) delete e.cardRefs; this.commitRefs(e); },
  linkDoc(e, path) { if ((e.docRefs || []).some(d => d.toLowerCase() === path.toLowerCase())) return; (e.docRefs ||= []).push(path); reorderInPlace(e); this.commitRefs(e); },
  unlinkDoc(e, path) { e.docRefs = (e.docRefs || []).filter(d => d.toLowerCase() !== path.toLowerCase()); if (!e.docRefs.length) delete e.docRefs; this.commitRefs(e); },
  commitRefs(e) {
    this.p.setJson(this.entry.path, this.data);
    if (!this.graphMode) { this.redrawElement(e); this.drawOverlay(); this.refreshUi(); }
    else { this.renderGraph(e.id); }
  },
  refsBlock(e) {
    const ops = App.ops, p = this.p;
    const cards = (e.cardRefs || []).map(id => ({ id, card: ops.index.find(id) || p.board.archived.find(c => c.id === id) }));
    const box = el('div.col', { style: { gap: '.3em' } });
    box.append(el('div.label', 'References'));
    for (const { id, card } of cards) box.appendChild(el('div.listrow',
      icon('grid-outline'), el('button.btn.ghost.small.grow', { style: { justifyContent: 'flex-start', color: card ? 'var(--link)' : 'var(--muted)' }, onclick: () => card && this.openCard(card) }, el('span.ellipsis', card ? card.title : 'deleted task')),
      el('button.btn.icon.small.ghost', { title: 'Remove', onclick: () => this.unlinkCard(e, id) }, icon('close'))));
    for (const d of e.docRefs || []) box.appendChild(el('div.listrow',
      icon('document-text-outline'), el('button.btn.ghost.small.grow', { style: { justifyContent: 'flex-start', color: 'var(--link)' }, onclick: () => App.go(`#/p/${p.id}/docs/${encodeURIComponent(d)}`) }, el('span.ellipsis', Docs.titleOf(Docs.fileName(d)))),
      el('button.btn.icon.small.ghost', { title: 'Remove', onclick: () => this.unlinkDoc(e, d) }, icon('close'))));
    box.appendChild(el('div.row',
      el('button.btn.small', { onclick: () => {
        const cands = [...ops.index.cards.values()].filter(c => !(e.cardRefs || []).includes(c.id));
        ItemPicker.open('Link a task', cands.map(c => ({ id: c.id, label: c.title, hint: ops.columnOf(c)?.name })), id => this.linkCard(e, id));
      } }, icon('add'), 'Task'),
      el('button.btn.small', { onclick: () => {
        const files = Docs.files(p).filter(f => !(e.docRefs || []).some(r => r.toLowerCase() === Docs.displayPath(f).toLowerCase()));
        ItemPicker.open('Link a document', files.map(f => ({ id: Docs.displayPath(f), label: Docs.titleOf(f.name), hint: Docs.parent(f.path) || 'docs' })), id => this.linkDoc(e, id));
      } }, icon('add'), 'Document')));
    return box;
  },
  openCard(card) {
    const col = App.ops.columnOf(card);
    if (!col) { UI.toast('This card is archived.', 'archive-outline'); return; }
    if (!Filter.columnVisible(BoardView.filter, col.id) || !Filter.matches(BoardView.filter, card, col.isDone)) BoardView.filter = Filter.empty();
    App.go(`#/p/${App.project.id}/board`);
    setTimeout(() => BoardView.render(card.id), 80);
  },

  // ================================================================== toolbars and panels
  setTool(id) {
    if (this.polyPoints && id !== this.tool) this.finishPoly();
    this.tool = id; this.connectFrom = null; this.preview = null;
    if (id !== 'select') { this.sel.clear(); this.selConn = null; }
    this.renderToolbar(); this.drawConnectors(); this.refreshUi();
    const t = WB_TOOLS.find(x => x.id === id);
    if (t && id !== 'select') UI.toast(t.hint, t.icon, 2200);
  },
  renderToolbar() {
    if (!this.toolbar) return;
    fill(this.toolbar,
      ...WB_TOOLS.map(t => el('button.btn.icon.small' + (this.tool === t.id ? '.primary' : '.ghost'), { title: t.name, onclick: () => this.setTool(t.id) }, icon(t.icon))),
      el('span.vsep'),
      el('button.btn.icon.small.ghost', { title: 'Picture', onclick: () => this.addImage() }, icon('image-outline')));

  },
  refreshUi() {
    if (!this.root || !document.contains(this.root) || this.graphMode) return;
    this.drawOverlay();
    if (this.undoBtn) { this.undoBtn.disabled = !this.undoStack.length; this.redoBtn.disabled = !this.redoStack.length; }
    this.boardBtn?.querySelector('.ellipsis') && (this.boardBtn.querySelector('.ellipsis').textContent = this.data.name || 'Whiteboard');
    this.renderStylebar();
    this.renderPanel();
  },
  renderStylebar() {
    if (!this.stylebar) return;
    const s = this.style;
    // Show what is selected
    const one = this.sel.size === 1 ? this.find([...this.sel][0]) : null;
    const con = this.selConn ? this.data.connectors.find(c => c.id === this.selConn) : null;
    const cur = { stroke: con ? con.color ?? null : one ? one.stroke ?? null : s.stroke, fill: one ? one.fill ?? null : s.fill, width: one && one.strokeWidth ? one.strokeWidth : s.width, font: one?.fontSize || s.font, cthick: con?.thickness ?? s.cthick, arrow: con ? !!con.arrow : s.arrow };
    const drawingTool = !['select', 'pan', 'connector'].includes(this.tool);
    const visible = drawingTool || this.sel.size || this.selConn || this.tool === 'connector' || this.polyPoints;
    this.stylebar.style.display = visible ? '' : 'none';
    if (!visible) return;
    const swatchBtn = (label, key, value, allowNone, noneLabel) => {
      const b = el('button.btn.small', { onclick: () => UI.colorMenu(b, WB_COLORS, value, v => this.applyStyle(key, v), noneLabel) },
        el('span.dot', { style: { background: value ? cssColor(value) : 'transparent', border: '1.5px solid var(--muted)', width: '1em', height: '1em' } }), label);
      return b;
    };
    const items = [];
    const kind = one ? Wb.kind(one) : null;
    const isConn = !!con || this.tool === 'connector';
    if (isConn) {
      items.push(swatchBtn('Color', 'stroke', cur.stroke, true, 'Automatic'));
      items.push(UI.numberMenu('Width', WB_CTHICK, cur.cthick, v => this.applyStyle('cthick', v)));
      items.push(el('button.btn.small' + (cur.arrow ? '.primary' : ''), { onclick: () => this.applyStyle('arrow', !cur.arrow) }, '→ Arrow'));
    } else {
      items.push(swatchBtn(kind === 'Text' || this.tool === 'text' ? 'Text' : 'Stroke', 'stroke', cur.stroke, true, 'Automatic'));
      if (!['line', 'pen', 'polyline'].includes(this.tool) && !['Line', 'Stroke', 'Polyline', 'Image', 'Group'].includes(kind)) items.push(swatchBtn('Fill', 'fill', cur.fill, true, 'No fill'));
      if ((drawingTool && !['text', 'note'].includes(this.tool)) || (kind && !['Text', 'Image', 'Group'].includes(kind)) || (this.sel.size > 1)) items.push(UI.numberMenu('Width', WB_THICK, cur.width, v => this.applyStyle('width', v)));
      if (['text', 'note'].includes(this.tool) || kind === 'Text' || (this.sel.size > 1 && this.selected().some(e => Wb.kind(e) === 'Text'))) items.push(UI.numberMenu('Size', WB_FONTS, cur.font, v => this.applyStyle('font', v)));
    }
    if (this.polyPoints) items.push(el('button.btn.small.primary', { onclick: () => this.finishPoly() }, icon('checkmark'), 'Done'), el('button.btn.small.ghost', { onclick: () => { this.polyPoints = null; this.preview = null; this.drawOverlay(); this.refreshUi(); } }, 'Cancel'));
    fill(this.stylebar, ...items);
  },
  renderPanel() {
    this.root.querySelector('.wb-panel')?.remove();
    const els = this.selected();
    const con = this.selConn ? this.data.connectors.find(c => c.id === this.selConn) : null;
    if (!els.length && !con) return;
    const act = (ic, label, fn, cls = '') => el('button.btn.small' + cls, { onclick: fn, title: label }, icon(ic), el('span', label));
    let body;
    if (con) {
      body = [el('div.row', el('b.grow', 'Connector'), el('button.btn.icon.small.ghost', { onclick: () => { this.selConn = null; this.drawConnectors(); this.refreshUi(); } }, icon('close'))),
        el('div.wb-actions', act('trash-outline', 'Delete', () => this.deleteSelection(), '.danger'))];
    } else {
      const one = els.length === 1 ? els[0] : null;
      const kind = one ? Wb.kind(one) : null;
      const fav = els.every(e => e.favorite);
      const hasCon = this.data.connectors.some(c => this.sel.has(c.fromId) || this.sel.has(c.toId));
      body = [
        el('div.row', el('b.grow.ellipsis', one ? GraphModel.labelOf(one) : `${els.length} elements`),
          el('button.btn.icon.small.ghost', { onclick: () => { this.sel.clear(); this.refreshUi(); } }, icon('close'))),
        el('div.wb-actions',
          kind === 'Text' ? act('create-outline', 'Edit text', () => this.editText(one)) : null,
          act(fav ? 'star' : 'star-outline', fav ? 'Unstar' : 'Favorite', () => this.toggleFavorite()),
          act('duplicate-outline', 'Duplicate', () => this.duplicate()),
          act('arrow-up-outline', 'Front', () => this.reorder(true)),
          act('arrow-down-outline', 'Back', () => this.reorder(false)),
          els.length >= 2 ? act('git-merge-outline', 'Merge', () => this.merge()) : null,
          els.some(e => Wb.kind(e) === 'Group') ? act('cut-outline', 'Split', () => this.split()) : null,
          hasCon ? act('unlink-outline', 'Disconnect', () => this.disconnect()) : null,
          one ? act('git-network-outline', 'In graph', () => { this.alsoShow.add(one.id); this.toggleGraph(one.id); }) : null,
          act('trash-outline', 'Delete', () => this.deleteSelection(), '.danger')),
        one ? this.refsBlock(one) : null];
    }
    const panel = el('div.wb-panel.glass.scroll', ...body.flat().filter(Boolean));
    this.root.appendChild(panel);
  },

  // ================================================================== boards
  boardMenu(anchor) {
    const boards = this.p.whiteboards();
    UI.menu(anchor, [
      { header: 'Whiteboards' },
      ...boards.map(b => ({ label: b.data.name || 'Whiteboard', icon: 'easel-outline', checked: b.data.id === this.boardId, onClick: () => this.openBoard(b.data.id) })),
      { sep: true },
      { label: 'New whiteboard', icon: 'add', onClick: () => this.newBoard() },
      { label: 'Rename', icon: 'create-outline', onClick: () => this.renameBoard() },
      { label: 'Delete this whiteboard', icon: 'trash-outline', danger: true, onClick: () => this.deleteBoard() }
    ], { align: 'left' });
  },
  openBoard(id) {
    if (this.polyPoints) this.finishPoly();
    this.boardId = id; this.sel.clear(); this.selConn = null; this.resetHistory();
    history.replaceState(null, '', `#/p/${this.p.id}/whiteboard/${encodeURIComponent(id)}`);
    this.build();
  },
  async newBoard() {
    const name = await UI.prompt('New whiteboard', 'Name', 'Whiteboard');
    if (!name) return;
    const data = { version: 1, id: uid(8), name: name.trim(), elements: [], connectors: [] };
    this.p.setJson(`whiteboards/board-${data.id}.json`, data);
    this.boardId = data.id; this.resetHistory(); this.sel.clear();
    history.replaceState(null, '', `#/p/${this.p.id}/whiteboard/${data.id}`);
    App.route();
  },
  async renameBoard() {
    const name = await UI.prompt('Rename whiteboard', 'Name', this.data.name);
    if (!name) return;
    this.data.name = name.trim(); this.commit(false); this.refreshUi();
  },
  async deleteBoard() {
    if (!await UI.confirm(`Delete the whiteboard '${this.data.name}'? It cannot be undone.\n\nThe tasks and documents linked to its elements are not touched.`, 'Delete whiteboard', 'Delete', true)) return;
    const used = new Set(); for (const b of this.p.whiteboards()) if (b.data.id !== this.boardId) for (const e of this.all(b.data.elements)) if (e.image) used.add(e.image);
    const mine = this.all().filter(e => e.image).map(e => e.image);
    this.p.remove(this.entry.path);
    for (const img of mine) if (!used.has(img)) this.p.remove('whiteboards/images/' + img);
    this.boardId = null; this.resetHistory();
    App.go(`#/p/${this.p.id}/whiteboard`, true);
  },

  // ================================================================== graph view of the board
  toggleGraph(focusId) {
    if (this.polyPoints) this.finishPoly();
    this.graphMode = !this.graphMode || !!focusId;
    if (focusId) this.graphMode = true;
    this.graphFocus = focusId || null;
    App.route();
  },
  buildGraph() {
    const head = el('div.wb-tools.glass',
      el('button.btn', { onclick: e => this.boardMenu(e.currentTarget) }, icon('easel-outline'), el('span.ellipsis', { style: { maxWidth: '9em' } }, this.data.name || 'Whiteboard'), icon('chevron-down')),
      el('span.small.muted', { style: { padding: '0 .5em' } }, 'Graph'));
    this.graphHost = el('div.graph-host');
    this.root.append(this.graphHost, head);
    this.renderGraph(this.graphFocus);
  },
  renderGraph(selectId) {
    if (!this.graphHost) return;
    this.graphCanvas?.destroy();
    this.graphHost.replaceChildren();
    const model = GraphModel.fromWhiteboard(this.data, this.alsoShow);
    this.root.querySelector('.wb-panel')?.remove();
    if (!model.nodes.length) {
      this.graphHost.appendChild(UI.empty('git-network-outline', 'Nothing to show', 'The graph shows the elements linked with the Connect tool, the favorites and the elements with references.'));
      return;
    }
    const prev = this.graphView;
    this.graphCanvas = new GraphCanvas(this.graphHost, model, {
      colorOf: n => { const c = cssColor(n.color); return c && luminance(n.color) < .8 && luminance(n.color) > .08 ? c : groupColor(n.group); },
      onSelect: n => this.graphPanel(n ? this.find(n.id) : null),
      onOpen: n => this.showOnBoard(n.id)
    });
    if (prev && !selectId) this.graphCanvas.view = prev;
    this.graphView = null;
    if (selectId) { requestAnimationFrame(() => { this.graphCanvas.select(selectId, true); this.graphPanel(this.find(selectId)); }); }
  },
  graphPanel(e) {
    this.root.querySelector('.wb-panel')?.remove();
    if (!e) return;
    const k = 1;
    const b = Wb.bounds(e), w = b.x2 - b.x1, h = b.y2 - b.y1, pad = 10;
    const mini = svgEl('svg', { viewBox: `${b.x1 - pad} ${b.y1 - pad} ${w + pad * 2} ${h + pad * 2}`, style: 'width:100%;height:7em;display:block' });
    mini.appendChild(this.visual(e, false)); void k;
    const panel = el('div.wb-panel.glass.scroll',
      el('div.row', el('b.grow.ellipsis', GraphModel.labelOf(e)),
        el('button.btn.icon.small.ghost', { title: e.favorite ? 'Remove from favorites' : 'Add to favorites', onclick: () => { if (e.favorite) delete e.favorite; else e.favorite = true; this.commitRefs(e); } }, icon(e.favorite ? 'star' : 'star-outline')),
        el('button.btn.icon.small.ghost', { onclick: () => { this.graphCanvas.select(null); panel.remove(); } }, icon('close'))),
      el('div.wb-mini', mini),
      el('button.btn.small', { onclick: () => this.showOnBoard(e.id) }, icon('locate-outline'), 'Show on the board'),
      this.refsBlock(e));
    this.root.appendChild(panel);
    this.graphView = this.graphCanvas?.view;
  },
  showOnBoard(id) {
    this.graphMode = false; this.sel = new Set([id]);
    history.replaceState(null, '', `#/p/${this.p.id}/whiteboard/${encodeURIComponent(this.boardId)}/${encodeURIComponent(id)}`);
    App.route();
  }
};

// ------------------------------------------------------------------ helpers
const r2 = v => Math.round(v * 100) / 100;
function reorderInPlace(e) { const o = WhiteboardView.ordered(e); for (const k of Object.keys(e)) delete e[k]; Object.assign(e, o); return e; }
function walkAll(list, out = []) { for (const e of list || []) { out.push(e); walkAll(e.children, out); } return out; }
const fmt4 = v => String(Math.round(v * 10000) / 10000);
function normAngle(d) { d %= 360; if (d < 0) d += 360; return Math.round(d * 100) / 100; }
function uniqCI(list) { const seen = new Set(), out = []; for (const x of list) if (!seen.has(x.toLowerCase())) { seen.add(x.toLowerCase()); out.push(x); } return out; }
function setRefs(e, key, list) { if (list && list.length) e[key] = list; else delete e[key]; }
function snapAngle(a, b) { const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy), ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * (Math.PI / 12); return { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len }; }
function cloneNewIds(e) {
  const c = JSON.parse(JSON.stringify(e));
  const walk = x => { x.id = uid(12); delete x.cardRefs; for (const ch of x.children || []) walk(ch); };
  walk(c); return c;
}
/** Ramer–Douglas–Peucker (WhiteboardOps.Simplify). */
function rdp(points, tol) {
  if (points.length < 3) return points.slice();
  const keep = new Array(points.length).fill(false); keep[0] = keep[points.length - 1] = true;
  const dist = (p, a, b) => { const abx = b.x - a.x, aby = b.y - a.y, l2 = abx * abx + aby * aby; if (l2 < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y); const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2)); return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t)); };
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [f, l] = stack.pop(); let max = 0, idx = -1;
    for (let i = f + 1; i < l; i++) { const d = dist(points[i], points[f], points[l]); if (d > max) { max = d; idx = i; } }
    if (idx < 0 || max <= tol) continue;
    keep[idx] = true; stack.push([f, idx], [idx, l]);
  }
  return points.filter((_, i) => keep[i]);
}
/** Height of a text element: the text wraps inside the width (padding 6/8 like the exe). */
function measureText(text, width, font) {
  const d = el('div.wb-text', { style: { position: 'absolute', visibility: 'hidden', left: '-9999px', top: 0, width: width + 'px', fontSize: font + 'px', height: 'auto' } }, text || ' ');
  document.body.appendChild(d);
  const h = d.offsetHeight;
  d.remove();
  return h;
}
