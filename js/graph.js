/* Cairn Web — force-directed graph (Services/GraphLayout.cs) and its canvas view (Views/GraphView.cs).
 * Used by the Documentation graph and by the Whiteboard graph. */
'use strict';

class GraphModel {
  constructor() { this.nodes = []; this.edges = []; this.alpha = 1; this.byId = new Map(); }
  static REPULSION = 5200; static SPRING = 95; static STRENGTH = 0.045; static GRAVITY = 0.012; static DAMPING = 0.78; static MIN_ALPHA = 0.004;
  add(id, label, group = '', ghost = false, color = null) {
    const n = { id, label, group, ghost, color, degree: 0, starred: false, dot: false, x: 0, y: 0, vx: 0, vy: 0, pinned: false, neighbors: [] };
    this.nodes.push(n); this.byId.set(id, n); return n;
  }
  find(id) { return this.byId.get(id) || null; }
  connect(a, b) {
    const na = this.find(a), nb = this.find(b);
    if (!na || !nb || na === nb || na.neighbors.includes(nb)) return false;
    this.edges.push([na, nb]); na.neighbors.push(nb); nb.neighbors.push(na);
    na.degree = na.neighbors.length; nb.degree = nb.neighbors.length;
    return true;
  }
  static radius(n) { return 5 + Math.min(13, Math.sqrt(n.degree) * 3); }
  /** Sunflower spiral, the most connected nodes in the middle: the same graph always opens with the same shape. */
  seed() {
    const ordered = this.nodes.slice().sort((a, b) => b.degree - a.degree || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const golden = 2.399963229728653;
    ordered.forEach((n, i) => { const r = 34 * Math.sqrt(i + .5); n.x = r * Math.cos(i * golden); n.y = r * Math.sin(i * golden); n.vx = n.vy = 0; });
    this.alpha = 1;
  }
  reheat(a = .35) { this.alpha = Math.max(this.alpha, a); }
  get settled() { return this.alpha < GraphModel.MIN_ALPHA; }
  step() {
    if (this.settled || !this.nodes.length) return false;
    const N = this.nodes, a0 = this.alpha;
    for (let i = 0; i < N.length; i++) {
      const a = N[i];
      for (let j = i + 1; j < N.length; j++) {
        const b = N[j];
        let dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
        if (d2 < .01) { dx = .1 * ((i + j) % 2 === 0 ? 1 : -1); dy = .1; d2 = dx * dx + dy * dy; }
        const d = Math.sqrt(d2), f = GraphModel.REPULSION / d2 * a0, fx = dx / d * f, fy = dy / d * f;
        a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
      }
    }
    for (const [A, B] of this.edges) {
      const dx = B.x - A.x, dy = B.y - A.y, d = Math.sqrt(dx * dx + dy * dy);
      if (d < .01) continue;
      const len = GraphModel.SPRING + GraphModel.radius(A) + GraphModel.radius(B);
      const f = (d - len) * GraphModel.STRENGTH * a0, fx = dx / d * f, fy = dy / d * f;
      A.vx += fx; A.vy += fy; B.vx -= fx; B.vy -= fy;
    }
    for (const n of N) {
      n.vx -= n.x * GraphModel.GRAVITY * a0; n.vy -= n.y * GraphModel.GRAVITY * a0;
      n.vx *= GraphModel.DAMPING; n.vy *= GraphModel.DAMPING;
      if (n.pinned) { n.vx = n.vy = 0; continue; }
      const sp = Math.hypot(n.vx, n.vy);
      if (sp > 40) { n.vx *= 40 / sp; n.vy *= 40 / sp; }
      n.x += n.vx; n.y += n.vy;
    }
    this.alpha *= .985;
    return !this.settled;
  }
  run(ticks) { for (let i = 0; i < ticks && this.step(); i++); }
  bounds() {
    if (!this.nodes.length) return { l: -100, t: -100, r: 100, b: 100 };
    const r = GraphModel.radius;
    return { l: Math.min(...this.nodes.map(n => n.x - r(n))), t: Math.min(...this.nodes.map(n => n.y - r(n))), r: Math.max(...this.nodes.map(n => n.x + r(n))), b: Math.max(...this.nodes.map(n => n.y + r(n))) };
  }
  hit(x, y, tol = 4) {
    for (let i = this.nodes.length - 1; i >= 0; i--) { const n = this.nodes[i], r = GraphModel.radius(n) + tol; if ((x - n.x) ** 2 + (y - n.y) ** 2 <= r * r) return n; }
    return null;
  }

  /** DocsService.BuildGraph: one node per document, one edge per pair linked by a link; missing wiki targets are ghosts. */
  static fromDocs(project) {
    const g = new GraphModel();
    const idx = Docs.index(project);
    const docs = idx.files.filter(f => f.kind === 'text' || f.kind === 'rich');
    const nodes = new Map();
    for (const d of docs) { const slash = d.path.indexOf('/'); nodes.set(d.path.toLowerCase(), g.add(d.path, Docs.titleOf(d.name), slash < 0 ? '' : d.path.slice(0, slash))); }
    const seen = new Set();
    for (const d of docs.filter(x => x.kind === 'text' && !x.isLink)) {
      const { text } = project.text(Docs.ROOT + d.path);
      for (const l of Docs.extractLinks(text)) {
        if (l.isImage) continue;
        const hit = idx.resolve(Docs.displayPath(d), l.target, l.isWiki);
        let id;
        if (hit) { if (hit.kind !== 'text' && hit.kind !== 'rich') continue; id = hit.path; }
        else {
          if (!l.isWiki) continue;
          id = '?' + l.target.trim().toLowerCase();
          if (!nodes.has(id)) nodes.set(id, g.add(id, Docs.fileName(l.target.trim()), '', true));
        }
        if (id.toLowerCase() === d.path.toLowerCase()) continue;
        const key = [d.path.toLowerCase(), id.toLowerCase()].sort().join('\n');
        if (seen.has(key)) continue;
        seen.add(key);
        g.connect(nodes.get(d.path.toLowerCase()).id, nodes.get(id.toLowerCase()).id);
      }
    }
    g.seed();
    return g;
  }

  /** WhiteboardGraph.Build: the elements linked by connectors, plus favorites, elements with references and those asked for. */
  static fromWhiteboard(data, alsoShow = new Set()) {
    const g = new GraphModel();
    const linked = new Set();
    for (const c of data.connectors || []) { linked.add(c.fromId); linked.add(c.toId); }
    const counters = {};
    for (const e of data.elements || []) {
      const label = GraphModel.labelOf(e, counters);
      const refs = !!(e.cardRefs?.length || e.docRefs?.length);
      if (!linked.has(e.id) && !e.favorite && !refs && !alsoShow.has(e.id)) continue;
      const n = g.add(e.id, label, Wb.kind(e), false, e.fill ?? e.stroke ?? null);
      n.starred = !!e.favorite; n.dot = refs;
    }
    for (const c of data.connectors || []) g.connect(c.fromId, c.toId);
    g.seed();
    return g;
  }
  static labelOf(e, counters) {
    const first = el => el.text?.trim() ? el.text : (el.children || []).map(first).find(Boolean) || null;
    const t = first(e);
    if (t && t.trim()) { const line = t.trim().split('\n')[0].trim(); return line.length > 36 ? line.slice(0, 36) + '…' : line; }
    const k = Wb.kind(e);
    const kind = k === 'Stroke' ? 'Drawing' : k === 'Polyline' ? (e.closed ? 'Shape' : 'Polyline') : k;
    if (!counters) return kind;
    counters[kind] = (counters[kind] || 0) + 1;
    return `${kind} ${counters[kind]}`;
  }
}

/** The canvas that draws a GraphModel: drag nodes, pan, pinch / wheel zoom, tap = select. */
class GraphCanvas {
  constructor(host, model, { onSelect, onOpen, colorOf } = {}) {
    this.host = host; this.model = model; this.onSelect = onSelect; this.onOpen = onOpen; this.colorOf = colorOf;
    this.canvas = el('canvas', { style: { position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' } });
    host.appendChild(this.canvas);
    this.view = null; this.selected = null; this.hover = null;
    model.run(260);
    this.ro = new ResizeObserver(() => { this.resize(); if (!this.view) this.fit(); this.draw(); });
    this.ro.observe(host);
    this.bind();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }
  destroy() { cancelAnimationFrame(this.raf); this.ro.disconnect(); }
  resize() {
    const r = this.host.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    this.w = r.width; this.h = r.height;
    this.canvas.width = Math.max(1, r.width * dpr); this.canvas.height = Math.max(1, r.height * dpr);
    this.dpr = dpr;
  }
  fit() {
    const b = this.model.bounds(), pad = 40;
    const k = Math.min(2.2, Math.max(.15, Math.min((this.w - pad * 2) / Math.max(1, b.r - b.l), (this.h - pad * 2) / Math.max(1, b.b - b.t))));
    this.view = { k, x: this.w / 2 - (b.l + b.r) / 2 * k, y: this.h / 2 - (b.t + b.b) / 2 * k };
  }
  toWorld(sx, sy) { return { x: (sx - this.view.x) / this.view.k, y: (sy - this.view.y) / this.view.k }; }
  loop() {
    if (!document.contains(this.canvas)) { this.destroy(); return; }
    const moving = this.model.step();
    if (moving || this.dirty) { this.draw(); this.dirty = false; }
    this.raf = requestAnimationFrame(this.loop);
  }
  select(id, center = false) {
    this.selected = id ? this.model.find(id) : null;
    if (center && this.selected) { this.view.x = this.w / 2 - this.selected.x * this.view.k - (this.w > 600 ? 120 : 0); this.view.y = this.h / 2 - this.selected.y * this.view.k; }
    this.dirty = true;
  }
  bind() {
    const c = this.canvas, pts = new Map();
    let drag = null, moved = 0, last = null, lastTap = 0;
    const local = e => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    c.addEventListener('pointerdown', e => {
      c.setPointerCapture(e.pointerId);
      const p = local(e); pts.set(e.pointerId, p); moved = 0;
      if (pts.size === 1) {
        const w = this.toWorld(p.x, p.y);
        const n = this.model.hit(w.x, w.y, 6 / this.view.k);
        drag = n ? { node: n } : { pan: true };
        if (n) { n.pinned = true; }
      } else { drag = null; last = null; }
    });
    c.addEventListener('pointermove', e => {
      const p = local(e);
      if (!pts.has(e.pointerId)) {
        const w = this.toWorld(p.x, p.y); const h = this.model.hit(w.x, w.y, 4 / this.view.k);
        if (h !== this.hover) { this.hover = h; this.dirty = true; c.style.cursor = h ? 'pointer' : 'grab'; }
        return;
      }
      const prev = pts.get(e.pointerId); pts.set(e.pointerId, p);
      if (pts.size === 2) {
        const [a, b] = [...pts.values()], mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (last) this.zoomAt(dist / last.dist, mid.x, mid.y, mid.x - last.mid.x, mid.y - last.mid.y);
        last = { mid, dist }; moved += 100; return;
      }
      moved += Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y);
      if (drag?.node && moved > 4) { const w = this.toWorld(p.x, p.y); drag.node.x = w.x; drag.node.y = w.y; this.model.reheat(.3); this.dirty = true; }
      else if (drag?.pan) { this.view.x += p.x - prev.x; this.view.y += p.y - prev.y; this.dirty = true; }
    });
    const up = e => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (pts.size < 2) last = null;
      if (drag?.node) drag.node.pinned = false;
      if (pts.size === 0 && moved < 8 && e.type === 'pointerup') {
        const now = Date.now(), dbl = now - lastTap < 320; lastTap = now;
        const n = drag?.node || null;
        this.selected = n; this.dirty = true;
        this.onSelect?.(n);
        if (dbl && n) this.onOpen?.(n);
        if (dbl && !n) { this.fit(); this.dirty = true; }
      }
      drag = null;
    };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', e => { e.preventDefault(); const p = local(e); this.zoomAt(Math.exp(-e.deltaY / 400), p.x, p.y, 0, 0); }, { passive: false });
  }
  zoomAt(f, cx, cy, dx, dy) {
    const v = this.view, k = Math.min(5, Math.max(.1, v.k * f));
    this.view = { k, x: cx - (cx - v.x) * (k / v.k) + dx, y: cy - (cy - v.y) * (k / v.k) + dy };
    this.dirty = true;
  }
  draw() {
    if (!this.view) return;
    const ctx = this.canvas.getContext('2d'), css = getComputedStyle(document.documentElement);
    const text = css.getPropertyValue('--text').trim(), muted = css.getPropertyValue('--muted').trim(), border = css.getPropertyValue('--border').trim();
    const sel = css.getPropertyValue('--selection').trim(), star = css.getPropertyValue('--star').trim();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    const { k, x, y } = this.view;
    ctx.save(); ctx.translate(x, y); ctx.scale(k, k);
    const focus = this.selected || this.hover;
    const near = focus ? new Set([focus, ...focus.neighbors]) : null;
    ctx.lineWidth = 1.2 / k;
    for (const [a, b] of this.model.edges) {
      const hot = focus && (a === focus || b === focus);
      ctx.strokeStyle = hot ? sel : muted; ctx.globalAlpha = near && !hot ? .2 : (hot ? 1 : .5);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const showLabels = k > .55;
    for (const n of this.model.nodes) {
      const r = GraphModel.radius(n);
      ctx.globalAlpha = (near && !near.has(n) ? .35 : 1) * (n.ghost ? .45 : 1);
      ctx.fillStyle = this.colorOf ? this.colorOf(n) : '#1F6F8B';
      ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2); ctx.fill();
      if (n === this.selected) { ctx.lineWidth = 3 / k; ctx.strokeStyle = sel; ctx.stroke(); }
      if (n.dot) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(n.x, n.y, Math.max(1.8, r * .3), 0, Math.PI * 2); ctx.fill(); }
      if (n.starred) GraphCanvas.star(ctx, n.x + r * .75, n.y - r * .75, Math.max(5, r * .55), star, k);
      if (showLabels || n === focus) {
        ctx.fillStyle = n.ghost ? muted : text;
        ctx.font = `${n === focus ? 600 : 500} ${12 / Math.max(k, .6)}px -apple-system, system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(n.label, n.x, n.y + r + 4 / k);
      }
    }
    ctx.restore();
  }
  static star(ctx, cx, cy, r, color, k) {
    ctx.save(); ctx.globalAlpha = 1; ctx.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * .45 : r; ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
    ctx.closePath(); ctx.fillStyle = color; ctx.fill(); ctx.lineWidth = .9 / k; ctx.strokeStyle = '#000'; ctx.stroke(); ctx.restore();
  }
}

/** Stable colors per group (folder of the docs, kind of the whiteboard element). */
const GraphColors = ['#1F6F8B', '#F2A541', '#30A46C', '#8E4EC6', '#E5484D', '#2E86AB', '#D6409F', '#7CB518', '#5B5BD6', '#12A594'];
function groupColor(group) { let h = 0; for (const ch of group || '') h = (h * 31 + ch.charCodeAt(0)) >>> 0; return group ? GraphColors[1 + h % (GraphColors.length - 1)] : GraphColors[0]; }
