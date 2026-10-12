/* Cairn Web — Whiteboard (read-only view of WhiteboardCanvas): pan, pinch-zoom, tap an element to see its references. */
'use strict';

const WhiteboardView = {
  boardId: null, pid: null, view: null, selected: null,

  mount(content, right, args) {
    const p = App.project;
    this.p = p;
    const boards = p.whiteboards();
    if (this.pid !== p.id) { this.pid = p.id; this.boardId = null; this.views = {}; }
    if (args[0]) this.boardId = args[0];
    if (!boards.some(b => b.data.id === this.boardId)) this.boardId = (boards.find(b => b.data.elements?.length) || boards[0])?.data.id || null;
    this.selected = args[1] || null;
    this.root = el('div.wb');
    content.appendChild(this.root);
    if (!boards.length) {
      this.root.appendChild(UI.empty('easel-outline', 'No whiteboards', 'Whiteboards are drawn in the desktop app. Export the project from the PC and import it here to see them.'));
      return;
    }
    const sel = el('select.input', { style: { width: 'auto', minHeight: '2.2em', maxWidth: '14em' }, onchange: () => { this.boardId = sel.value; this.selected = null; history.replaceState(null, '', `#/p/${p.id}/whiteboard/${encodeURIComponent(sel.value)}`); this.draw(true); } },
      boards.map(b => el('option', { value: b.data.id, selected: b.data.id === this.boardId }, b.data.name || 'Whiteboard')));
    this.canvas = el('div.wb-canvas');
    this.zoomLabel = el('span.small.muted', { style: { minWidth: '3.2em', textAlign: 'center' } });
    this.root.append(this.canvas,
      el('div.wb-tools.glass', icon('easel-outline'), sel, el('span.tiny.muted', { style: { padding: '0 .4em' } }, 'read-only')),
      el('div.wb-zoom.glass',
        el('button.btn.icon.small.ghost', { title: 'Zoom out', onclick: () => this.zoomBy(1 / 1.25) }, icon('remove')),
        this.zoomLabel,
        el('button.btn.icon.small.ghost', { title: 'Zoom in', onclick: () => this.zoomBy(1.25) }, icon('add')),
        el('button.btn.icon.small.ghost', { title: 'Fit', onclick: () => this.fit(true) }, icon('expand-outline'))));
    this.bindGestures();
    this.urls?.forEach(u => URL.revokeObjectURL(u));
    this.urls = [];
    requestAnimationFrame(() => this.draw(!this.views[this.boardId]));
    if (!this.themeHooked) { this.themeHooked = true; App.on('theme', () => setTimeout(() => this.canvas && document.contains(this.canvas) && this.draw(false), 50)); }
  },

  get data() { return this.p.whiteboards().find(b => b.data.id === this.boardId)?.data; },

  imageUrl(name) {
    this.imgCache ||= new Map();
    const key = this.p.id + '/' + name;
    if (this.imgCache.has(key)) return this.imgCache.get(key);
    const b = this.p.bytes('whiteboards/images/' + name);
    const u = b ? URL.createObjectURL(new Blob([b], { type: mimeOf(name) })) : null;
    this.imgCache.set(key, u);
    return u;
  },

  draw(fit) {
    const data = this.data;
    if (!data || !this.canvas) return;
    const svg = svgEl('svg', { width: 10, height: 10 });
    const world = svgEl('g');
    svg.appendChild(world);
    const cons = svgEl('g'), elems = svgEl('g'), over = svgEl('g');
    world.append(cons, elems, over);
    for (const e of data.elements || []) elems.appendChild(this.visual(e, true));
    for (const c of data.connectors || []) {
      const a = (data.elements || []).find(e => e.id === c.fromId), b = (data.elements || []).find(e => e.id === c.toId);
      if (!a || !b) continue;
      const s = Wb.edgePoint(a, Wb.center(b)), t = Wb.edgePoint(b, Wb.center(a));
      const color = cssColor(c.color);
      const line = svgEl('line', { x1: s.x, y1: s.y, x2: t.x, y2: t.y, 'stroke-width': c.thickness || 1, 'stroke-linecap': 'round' });
      line.style.stroke = color || 'var(--text)';
      cons.appendChild(line);
      if (c.arrow) {
        let dx = t.x - s.x, dy = t.y - s.y; const len = Math.hypot(dx, dy);
        if (len > 1) {
          dx /= len; dy /= len; const nx = -dy, ny = dx, size = 7 + (c.thickness || 1) * 2.5;
          const pts = [[t.x, t.y], [t.x - dx * size + nx * size * .45, t.y - dy * size + ny * size * .45], [t.x - dx * size - nx * size * .45, t.y - dy * size - ny * size * .45]];
          const head = svgEl('polygon', { points: pts.map(p => p.join(',')).join(' ') });
          head.style.fill = color || 'var(--text)';
          cons.appendChild(head);
        }
      }
    }
    this.over = over;
    this.world = world;
    this.svg = svg;
    fill(this.canvas, svg);
    svg.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250 });
    if (fit || !this.views[this.boardId]) this.fit(false);
    else this.apply();
    if (this.selected) { const e = (data.elements || []).find(x => x.id === this.selected); if (e) { this.select(e); this.focusOn(e); } else this.selected = null; }
  },

  /** The visual of an element, like BuildVisual: a box rotated around its center. */
  visual(e, top) {
    const kind = Wb.kind(e);
    const w = e.width || 1, h = e.height || 1;
    const g = svgEl('g', { transform: `translate(${e.x || 0},${e.y || 0}) rotate(${e.rotation || 0},${w / 2},${h / 2})` });
    if (top) g.dataset.eid = e.id;
    const stroke = cssColor(e.stroke), fill = cssColor(e.fill);
    const shape = node => {
      node.setAttribute('stroke-width', e.strokeWidth ?? 2);
      node.setAttribute('stroke-linejoin', 'round'); node.setAttribute('stroke-linecap', 'round');
      node.style.stroke = stroke || 'var(--text)';
      node.style.fill = fill || 'none';
      g.appendChild(node);
      // invisible, thicker copy: easy to tap
      const hit = node.cloneNode(); hit.style.stroke = 'transparent'; hit.style.fill = fill || e.closed || ['Rectangle', 'Ellipse', 'Triangle', 'Polygon'].includes(kind) ? 'transparent' : 'none';
      hit.setAttribute('stroke-width', Math.max((e.strokeWidth ?? 2) + 10, 14)); g.appendChild(hit);
    };
    switch (kind) {
      case 'Text': {
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
        fo.appendChild(div);
        g.appendChild(svgEl('rect', { width: w, height: h, fill: 'transparent' }));
        g.appendChild(fo);
        break;
      }
      case 'Image': {
        const url = e.image ? this.imageUrl(e.image) : null;
        if (url) g.appendChild(svgEl('image', { href: url, width: w, height: h, preserveAspectRatio: 'none' }));
        else {
          const r = svgEl('rect', { width: w, height: h, fill: 'none', stroke: 'var(--danger)' }); g.appendChild(r);
          const t = svgEl('text', { x: w / 2, y: h / 2, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 11 }, 'image not found'); t.style.fill = 'var(--muted)'; g.appendChild(t);
        }
        g.appendChild(svgEl('rect', { width: w, height: h, fill: 'transparent' }));
        break;
      }
      case 'Group': {
        const inner = svgEl('g', { transform: `scale(${e.refWidth > 0 ? w / e.refWidth : 1},${e.refHeight > 0 ? h / e.refHeight : 1})` });
        for (const c of e.children || []) inner.appendChild(this.visual(c, false));
        g.appendChild(svgEl('rect', { width: w, height: h, fill: 'transparent' }));
        g.appendChild(inner);
        break;
      }
      case 'Rectangle': shape(svgEl('rect', { width: w, height: h })); break;
      case 'Ellipse': shape(svgEl('ellipse', { cx: w / 2, cy: h / 2, rx: w / 2, ry: h / 2 })); break;
      case 'Triangle': shape(svgEl('polygon', { points: `${w / 2},0 ${w},${h} 0,${h}` })); break;
      default: {
        let pts = Wb.points(e.points).map(p => [p.x * w, p.y * h]);
        if (pts.length < 2) pts = [[0, 0], [w, h]];
        const closed = kind === 'Polygon' || e.closed;
        shape(svgEl(closed ? 'polygon' : 'polyline', { points: pts.map(p => p.join(',')).join(' ') }));
      }
    }
    if (top && (e.favorite || e.cardRefs?.length || e.docRefs?.length)) {
      const badge = svgEl('g', { transform: `translate(${w - 2},-6)` });
      if (e.favorite) {
        const star = svgEl('path', { d: 'M0,-7 2.1,-2.2 7,-2.2 3,1 4.4,6 0,3 -4.4,6 -3,1 -7,-2.2 -2.1,-2.2Z', stroke: '#000', 'stroke-width': .8 });
        star.style.fill = 'var(--star)'; badge.appendChild(star);
      }
      if (e.cardRefs?.length || e.docRefs?.length) {
        const dot = svgEl('circle', { cx: e.favorite ? -12 : 0, cy: 0, r: 3.5 }); dot.style.fill = 'var(--selection)'; badge.appendChild(dot);
      }
      g.appendChild(badge);
    }
    return g;
  },

  // ---------------------------------------------------------------- view transform
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
    const b = this.extent(), pad = 40;
    const k = Math.min(4, Math.max(.05, Math.min((r.width - pad * 2) / Math.max(1, b.x2 - b.x1), (r.height - pad * 2 - 30) / Math.max(1, b.y2 - b.y1))));
    const target = { k, x: r.width / 2 - (b.x1 + b.x2) / 2 * k, y: r.height / 2 + 15 - (b.y1 + b.y2) / 2 * k };
    this.animateTo(target, animate);
  },
  focusOn(e) {
    const r = this.canvas.getBoundingClientRect();
    const b = Wb.bounds(e), v = this.views[this.boardId];
    const k = Math.max(v.k, Math.min(1.5, (r.width * .5) / Math.max(1, b.x2 - b.x1)));
    this.animateTo({ k, x: r.width / 2 - (b.x1 + b.x2) / 2 * k - (r.width > 600 ? 120 : 0), y: r.height / 2 - (b.y1 + b.y2) / 2 * k }, true);
  },
  animateTo(target, animate) {
    const from = this.views[this.boardId];
    if (!animate || !from) { this.views[this.boardId] = target; this.apply(); return; }
    const t0 = performance.now(), dur = 380;
    const step = t => {
      const u = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - u, 3);
      this.views[this.boardId] = { k: from.k + (target.k - from.k) * e, x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e };
      this.apply();
      if (u < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  },
  zoomBy(f, cx, cy) {
    const v = this.views[this.boardId]; if (!v) return;
    const r = this.canvas.getBoundingClientRect();
    cx ??= r.width / 2; cy ??= r.height / 2;
    const k = Math.min(6, Math.max(.05, v.k * f));
    this.views[this.boardId] = { k, x: cx - (cx - v.x) * (k / v.k), y: cy - (cy - v.y) * (k / v.k) };
    this.apply();
  },

  bindGestures() {
    const c = this.canvas;
    const pts = new Map();
    let last = null, moved = 0, downTarget = null, lastTap = 0;
    c.addEventListener('pointerdown', e => {
      c.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved = 0; downTarget = e.target; last = null;
    });
    c.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId)) return;
      const prev = pts.get(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const v = this.views[this.boardId]; if (!v) return;
      if (pts.size === 1) {
        const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
        moved += Math.abs(dx) + Math.abs(dy);
        this.views[this.boardId] = { ...v, x: v.x + dx, y: v.y + dy };
        this.apply();
      } else if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const r = c.getBoundingClientRect();
        const mid = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top }, dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (last) {
          const f = dist / last.dist;
          const k = Math.min(6, Math.max(.05, v.k * f));
          this.views[this.boardId] = { k, x: mid.x - (last.mid.x - v.x) * (k / v.k), y: mid.y - (last.mid.y - v.y) * (k / v.k) };
          this.apply();
        }
        last = { mid, dist }; moved += 100;
      }
    });
    const up = e => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (pts.size < 2) last = null;
      if (pts.size === 0 && moved < 8 && e.type === 'pointerup') {
        const now = Date.now();
        if (now - lastTap < 300) { this.fit(true); lastTap = 0; return; }
        lastTap = now;
        const g = downTarget?.closest?.('[data-eid]');
        const e2 = g && (this.data.elements || []).find(x => x.id === g.dataset.eid);
        if (e2) this.select(e2); else this.select(null);
      }
    };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', e => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      if (e.ctrlKey || Math.abs(e.deltaY) > Math.abs(e.deltaX) && !e.shiftKey && e.deltaMode === 0 && Math.abs(e.deltaY) >= 50) this.zoomBy(Math.exp(-e.deltaY / 400), e.clientX - r.left, e.clientY - r.top);
      else { const v = this.views[this.boardId]; this.views[this.boardId] = { ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }; this.apply(); }
    }, { passive: false });
  },

  select(e) {
    this.selected = e?.id || null;
    fill(this.over);
    this.root.querySelector('.wb-panel')?.remove();
    if (!e) return;
    const w = e.width, h = e.height;
    this.over.appendChild(svgEl('rect', { class: 'wb-sel', x: -4, y: -4, width: w + 8, height: h + 8, transform: `translate(${e.x},${e.y}) rotate(${e.rotation || 0},${w / 2},${h / 2})`, rx: 4 }));
    const p = this.p, ops = App.ops;
    const kind = Wb.kind(e);
    const cards = (e.cardRefs || []).map(id => ops.index.find(id) || p.board.archived.find(c => c.id === id)).filter(Boolean);
    const docs = e.docRefs || [];
    const panel = el('div.wb-panel.glass.scroll',
      el('div.row', el('b.grow', kind === 'Text' ? 'Text' : kind), e.favorite ? el('span.chip', { style: { background: 'var(--star)', color: '#000' } }, icon('star'), 'Favorite') : null,
        el('button.btn.icon.small.ghost', { onclick: () => this.select(null) }, icon('close'))),
      e.text ? el('div.small', { style: { whiteSpace: 'pre-wrap', maxHeight: '6em', overflow: 'auto' } }, e.text) : null,
      el('div.label', 'References'),
      !cards.length && !docs.length ? el('div.tiny.muted', 'No tasks or documents linked to this element.') : null,
      cards.map(c => el('button.listrow', { style: { border: 0, cursor: 'pointer', textAlign: 'left' }, onclick: () => this.openCard(c) },
        icon('grid-outline'), el('span.grow.ellipsis', c.title), el('span.tiny.muted', ops.columnOf(c)?.name || 'archived'))),
      docs.map(d => el('button.listrow', { style: { border: 0, cursor: 'pointer', textAlign: 'left' }, onclick: () => App.go(`#/p/${p.id}/docs/${encodeURIComponent(d)}`) },
        icon('document-text-outline'), el('span.grow.ellipsis', Docs.titleOf(Docs.fileName(d))))));
    this.root.appendChild(panel);
    history.replaceState(null, '', `#/p/${p.id}/whiteboard/${encodeURIComponent(this.boardId)}/${encodeURIComponent(e.id)}`);
  },

  /** Task from the panel: the Kanban with the card highlighted (filters reset if they hide it), as in the exe. */
  openCard(card) {
    const col = App.ops.columnOf(card);
    if (!col) { UI.toast('This card is archived.', 'archive-outline'); return; }
    if (!Filter.columnVisible(BoardView.filter, col.id) || !Filter.matches(BoardView.filter, card, col.isDone)) BoardView.filter = Filter.empty();
    App.go(`#/p/${App.project.id}/board`);
    setTimeout(() => BoardView.render(card.id), 80);
  }
};
