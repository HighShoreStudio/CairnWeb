/* Cairn Web — Roadmap (read-only view of RoadmapWindow): rows of bars over whole months of one year. */
'use strict';

/** The built-in milestone icons: Ionicons 7.4 (the same zip the exe embeds), read on demand. */
const IonIcons = {
  zip: null, cache: new Map(),
  async get(name) {
    if (this.cache.has(name)) return this.cache.get(name);
    try {
      if (!this.zip) {
        const res = await fetch('assets/ionicons.zip');
        this.zip = await JSZip.loadAsync(await res.arrayBuffer());
      }
      const f = this.zip.file(name + '.svg');
      const svg = f ? await f.async('string') : null;
      const m = svg && /<svg[^>]*viewBox="([^"]+)"[^>]*>([\s\S]*)<\/svg>/.exec(svg);
      const v = m ? { viewBox: m[1], inner: m[2] } : null;
      this.cache.set(name, v);
      return v;
    } catch { this.cache.set(name, null); return null; }
  }
};

const RoadmapView = {
  year: null, start: null, months: null, pid: null, collapsed: new Set(),

  mount(content, right) {
    const p = App.project;
    this.p = p;
    this.data = p.roadmap || Roadmap.emptyData();
    if (this.pid !== p.id) {
      this.pid = p.id;
      this.months = Math.min(12, Math.max(1, this.data.months || 6));
      this.collapsed = new Set(this.data.collapsed || []);
      this.today();
    }
    this.label = el('span.lbl');
    const monthsSel = el('select.input', { style: { width: 'auto', minHeight: '2.2em', padding: '.2em 2em .2em .8em' }, onchange: () => { this.months = +monthsSel.value; if (this.start + this.months - 1 > 12) this.start = 13 - this.months; this.render(); } },
      [1, 2, 3, 4, 6, 9, 12].map(n => el('option', { value: n, selected: n === this.months }, n === 1 ? '1 month' : `${n} months`)));
    this.scroller = el('div.rm-scroll.scroll');
    const frame = el('div.rm-frame.glass', this.scroller);
    this.legend = el('div.rm-legend',
      el('span', el('i', { style: { background: 'var(--primary)' } }), 'work'),
      el('span', el('i', { style: { background: 'color-mix(in srgb, var(--primary) 34%, var(--surface))' } }), 'time left / saved'),
      el('span', el('i', { style: { background: 'repeating-linear-gradient(45deg, var(--primary) 0 3px, color-mix(in srgb, var(--primary) 34%, var(--surface)) 3px 6px)' } }), 'delay'),
      el('span', el('i', { style: { background: 'color-mix(in srgb, var(--primary) 34%, var(--surface))', border: '1.5px solid var(--primary)' } }), 'start → finish'),
      el('span.muted', 'Read-only here · tap a bar for details'));
    content.appendChild(el('div.rm',
      el('div.rm-bar',
        el('button.btn.icon', { title: 'Previous month', onclick: () => { this.prev(); this.render(); } }, icon('chevron-back')),
        this.label,
        el('button.btn.icon', { title: 'Next month', onclick: () => { this.next(); this.render(); } }, icon('chevron-forward')),
        el('button.btn', { onclick: () => { this.today(); this.render(); } }, icon('today-outline'), 'Today'),
        el('div.grow'), monthsSel),
      frame, this.legend));
    if (p.roadmapError) UI.toast('roadmap.json cannot be read: showing the tasks only.', 'warning-outline', 4000);
    // Swipe on the timeline: one month per swipe.
    let sx = null, sy = 0;
    this.scroller.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') { sx = e.clientX; sy = e.clientY; } });
    this.scroller.addEventListener('pointerup', e => {
      if (sx == null) return;
      const dx = e.clientX - sx, dy = e.clientY - sy; sx = null;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) { dx < 0 ? this.next() : this.prev(); this.render(dx < 0 ? 1 : -1); }
    });
    this.scroller.addEventListener('pointercancel', () => sx = null);
    this.ro = new ResizeObserver(() => this.render());
    this.ro.observe(this.scroller);
  },

  today() { const t = new Date(); this.year = t.getFullYear(); this.start = Math.min(t.getMonth() + 1, 13 - this.months); },
  next() { if (this.start + this.months - 1 >= 12) { this.year++; this.start = 1; } else this.start++; },
  prev() { if (this.start <= 1) { this.year--; this.start = 13 - this.months; } else this.start--; },
  get from() { return new Date(this.year, this.start - 1, 1); },
  get to() { return new Date(this.year, this.start - 1 + this.months, 1); },

  async render(direction = 0) {
    if (!this.scroller || !document.contains(this.scroller)) { this.ro?.disconnect(); return; }
    const p = this.p, settings = p.info.settings.roadmap;
    const from = this.from, to = this.to;
    this.label.textContent = this.months === 1 ? `${MONTHS_LONG[from.getMonth()]} ${this.year}` : `${MONTHS[from.getMonth()]} – ${MONTHS[addDays(to, -1).getMonth()]} ${this.year}`;
    const rows = Roadmap.build(p.board, this.data, settings, new Date());
    for (const r of rows) r.collapsed = this.collapsed.has(r.key);
    const fs = parseFloat(getComputedStyle(this.scroller).fontSize) || 14;
    const W = this.scroller.clientWidth, headW = Math.round(fs * 9.5), timeH = Math.round(fs * 3), laneH = Math.round(fs * 2.15), barH = Math.round(fs * 1.55), collapsedH = Math.round(fs * 1.9);
    const plotW = Math.max(50, W - headW);
    const days = (to - from) / 86400000;
    const X = d => headW + ((d - from) / 86400000) / days * plotW;
    const dark = UI.isDark();
    const css = getComputedStyle(document.documentElement);
    const surface = css.getPropertyValue('--surface').trim() || '#fff';
    const textC = css.getPropertyValue('--text').trim(), muted = css.getPropertyValue('--muted').trim(), border = css.getPropertyValue('--border').trim();

    // icons of the milestone types
    const iconNames = new Set();
    for (const r of rows) for (const l of r.lanes) for (const b of l) if (b.icon?.startsWith('ion:')) iconNames.add(b.icon.slice(4));
    const icons = new Map();
    await Promise.all([...iconNames].map(async n => icons.set(n, await IonIcons.get(n))));

    let y = timeH;
    const layout = rows.map(r => { const h = r.collapsed ? collapsedH : Math.max(1, r.lanes.length) * laneH + 6; const o = { r, y, h }; y += h + 4; return o; });
    const H = Math.max(y + 8, this.scroller.clientHeight);

    const svg = svgEl('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, style: 'display:block' });
    const defs = svgEl('defs');
    svg.appendChild(defs);
    const patterns = new Map();
    const mix = (hex, amount) => { // amount of the color over the surface
      const c = cssColor(hex, '#888888'), s = surface.startsWith('#') ? surface : '#ffffff';
      const ch = (h, i) => parseInt((h.length === 4 ? h.slice(1).split('').map(x => x + x).join('') : h.slice(1, 7)).slice(i * 2, i * 2 + 2), 16);
      return '#' + [0, 1, 2].map(i => Math.round(ch(c, i) * amount + ch(s, i) * (1 - amount)).toString(16).padStart(2, '0')).join('');
    };
    const stripes = (a, b) => {
      const key = a + '|' + b;
      if (patterns.has(key)) return patterns.get(key);
      const id = 'st' + patterns.size;
      defs.appendChild(svgEl('pattern', { id, width: 8, height: 8, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
        svgEl('rect', { width: 8, height: 8, fill: b }), svgEl('rect', { width: 4, height: 8, fill: a })));
      patterns.set(key, `url(#${id})`);
      return patterns.get(key);
    };

    // row backgrounds + month grid
    layout.forEach((o, i) => svg.appendChild(svgEl('rect', { x: 0, y: o.y - 2, width: W, height: o.h + 4, fill: i % 2 ? 'transparent' : (dark ? 'rgba(255,255,255,.025)' : 'rgba(22,50,79,.03)') })));
    for (let m = 0; m <= this.months; m++) {
      const d = new Date(this.year, this.start - 1 + m, 1), x = X(d);
      svg.appendChild(svgEl('line', { x1: x, x2: x, y1: 0, y2: H, stroke: border, 'stroke-width': 1 }));
      if (m < this.months) {
        const next = new Date(this.year, this.start + m, 1);
        const w = X(next) - x;
        svg.appendChild(svgEl('text', { x: x + 6, y: fs * 1.25, fill: textC, 'font-size': fs * .9, 'font-weight': 700 }, w > fs * 6 ? MONTHS_LONG[d.getMonth()] : MONTHS[d.getMonth()]));
      }
    }
    // weeks (or days when there is room)
    const pxDay = plotW / days;
    if (pxDay * 7 > fs * 1.8) {
      let d = new Date(from); d = addDays(d, (8 - d.getDay()) % 7); // Mondays
      for (; d < to; d = addDays(d, 7)) {
        const x = X(d);
        svg.appendChild(svgEl('line', { x1: x, x2: x, y1: timeH - fs * .7, y2: H, stroke: border, 'stroke-width': .5, 'stroke-dasharray': '2 4' }));
        if (pxDay * 7 > fs * 2.4) svg.appendChild(svgEl('text', { x: x + 3, y: timeH - fs * .45, fill: muted, 'font-size': fs * .68 }, settings.showWeekNumber ? `${d.getDate()} · ${isoWeek(d)}w` : String(d.getDate())));
      }
    }
    svg.appendChild(svgEl('line', { x1: headW, x2: W, y1: timeH, y2: timeH, stroke: border }));

    // bars
    const clipId = (() => { let n = 0; return () => 'cl' + (n++); })();
    for (const o of layout) {
      if (o.r.collapsed) continue;
      o.r.lanes.forEach((lane, li) => {
        const top = o.y + 3 + li * laneH + (laneH - barH) / 2;
        for (const bar of lane) {
          let x0 = Math.max(X(Roadmap.barStart(bar)), headW), x1 = Math.min(X(Roadmap.barEnd(bar)), W);
          if (x1 < headW || x0 > W) continue;
          if (x1 - x0 < 6) x1 = x0 + 6;
          const darkC = cssColor(bar.color, '#1F6F8B'), lightC = mix(bar.color, .34);
          const g = svgEl('g', { class: 'rm-barg', style: 'cursor:pointer' });
          const cid = clipId();
          defs.appendChild(svgEl('clipPath', { id: cid }, svgEl('rect', { x: x0, y: top, width: x1 - x0, height: barH, rx: 4 })));
          const inner = svgEl('g', { 'clip-path': `url(#${cid})` });
          bar.segments.forEach((s, si) => {
            const sx0 = Math.max(X(s.from), x0);
            let sx1 = Math.min(Math.max(X(s.to), sx0), x1);
            if (si === bar.segments.length - 1) sx1 = x1;
            if (sx1 <= sx0) return;
            const fill = s.fill === 'Dark' ? darkC : s.fill === 'Light' || s.fill === 'Outline' ? lightC : s.fill === 'Striped' ? stripes(darkC, lightC)
              : stripes(darkC, cssColor(s.color2, darkC) === darkC ? 'transparent' : cssColor(s.color2, darkC));
            inner.appendChild(svgEl('rect', { x: sx0, y: top, width: sx1 - sx0, height: barH, fill }));
          });
          if (bar.segments.some(s => s.fill === 'Outline')) inner.appendChild(svgEl('rect', { x: x0 + .75, y: top + .75, width: x1 - x0 - 1.5, height: barH - 1.5, rx: 3.5, fill: 'none', stroke: darkC, 'stroke-width': 1.5 }));
          const under = bar.segments.find(s => s.from <= bar.labelFrom && s.to > bar.labelFrom) || bar.segments[0];
          const bg = under.fill === 'Dark' ? darkC : under.fill === 'Light' || under.fill === 'Outline' ? lightC : mix(bar.color, .67);
          const ink = luminance(bg) > 0.58 ? '#000' : '#fff';
          let lx = Math.max(X(bar.labelFrom), x0, headW) + 6;
          if (bar.icon) {
            const ic = bar.icon.startsWith('ion:') ? icons.get(bar.icon.slice(4)) : null;
            const sz = barH - 6;
            if (ic) { const s = svgEl('svg', { x: lx - 1, y: top + 3, width: sz, height: sz, viewBox: ic.viewBox, fill: ink, color: ink, stroke: 'none' }); s.innerHTML = ic.inner; inner.appendChild(s); }
            else inner.appendChild(svgEl('circle', { cx: lx + sz / 2 - 1, cy: top + barH / 2, r: sz / 3, fill: ink }));
            lx += sz + 4;
          }
          if (under.fill === 'Striped' || under.fill === 'Mixed') inner.appendChild(svgEl('rect', { x: lx - 3, y: top + 3, width: Math.min(bar.title.length * fs * .45 + 6, x1 - lx), height: barH - 6, fill: bg, opacity: .6, rx: 2 }));
          inner.appendChild(svgEl('text', { x: lx, y: top + barH / 2, 'dominant-baseline': 'central', fill: ink, 'font-size': fs * .78, 'font-weight': 600 }, bar.title));
          g.appendChild(inner);
          g.addEventListener('click', () => this.details(bar));
          svg.appendChild(g);
        }
      });
    }
    // today
    const now = new Date();
    if (now >= from && now < to) {
      const x = X(now);
      svg.appendChild(svgEl('line', { x1: x, x2: x, y1: timeH - 4, y2: H, stroke: '#F2A541', 'stroke-width': 2 }));
      svg.appendChild(svgEl('circle', { cx: x, cy: timeH - 4, r: 4, fill: '#F2A541' }));
    }
    // row headers on top (left column)
    const headBg = svgEl('rect', { x: 0, y: 0, width: headW, height: H, fill: dark ? 'rgba(15,23,32,.55)' : 'rgba(255,255,255,.55)' });
    svg.appendChild(headBg);
    svg.appendChild(svgEl('line', { x1: headW, x2: headW, y1: 0, y2: H, stroke: border }));
    for (const o of layout) {
      const count = o.r.lanes.reduce((n, l) => n + l.length, 0);
      const g = svgEl('g', { style: 'cursor:pointer' });
      g.appendChild(svgEl('rect', { x: 0, y: o.y - 2, width: headW, height: o.h + 4, fill: 'transparent' }));
      g.appendChild(svgEl('rect', { x: 8, y: o.y + 6, width: 4, height: Math.max(8, Math.min(o.h - 12, laneH - 10)), rx: 2, fill: cssColor(o.r.color, '#888') }));
      const t = svgEl('text', { x: 18, y: o.y + 6 + fs * .7, fill: textC, 'font-size': fs * .82, 'font-weight': 650 }, o.r.title.length > 14 ? o.r.title.slice(0, 13) + '…' : o.r.title);
      g.appendChild(t);
      g.appendChild(svgEl('text', { x: headW - 8, y: o.y + 6 + fs * .7, fill: muted, 'font-size': fs * .7, 'text-anchor': 'end' }, o.r.collapsed ? `▸ ${count}` : String(count)));
      g.addEventListener('click', () => { o.r.collapsed ? this.collapsed.delete(o.r.key) : this.collapsed.add(o.r.key); this.render(); });
      svg.appendChild(g);
    }
    fill(this.scroller, svg);
    if (direction) svg.animate([{ opacity: .3, transform: `translateX(${direction * 30}px)` }, { opacity: 1, transform: 'none' }], { duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)' });
    if (!rows.some(r => r.lanes.length)) this.scroller.appendChild(el('div.small.muted', { style: { position: 'absolute', left: headW + 16 + 'px', top: timeH + 16 + 'px', maxWidth: '24em' } },
      'Nothing to show yet. A task appears with a Start date plus an End or a Finish date (or a Due date while it is in progress); milestones are created in the desktop app.'));
  },

  details(bar) {
    const fmt = d => d ? `${pad2(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : '—';
    const rows = [];
    const row = (k, v) => rows.push(el('div.row', el('span.label', { style: { width: '6em' } }, k), el('span', v)));
    if (bar.kind === 'Milestone') {
      row('Type', bar.type?.name || '—'); row('Start', fmt(parseWall(bar.milestone.start))); row('Release', fmt(parseWall(bar.milestone.end)));
      if (bar.milestone.note) row('Note', bar.milestone.note);
    } else if (bar.kind === 'Custom') {
      row('Start', fmt(parseWall(bar.item.start))); row('Due', fmt(parseWall(bar.item.due))); row('End', fmt(parseWall(bar.item.end)));
      if (bar.item.note) row('Note', bar.item.note);
    } else {
      const c = bar.card;
      row('Column', App.ops.columnOf(c)?.name || '—');
      row('Start', fmt(parseWall(c.startDate))); row('Due', c.dueDate ? formatDue(parseWall(c.dueDate), c.dueHasTime) : '—');
      row('End', c.endDate ? formatDue(parseWall(c.endDate), c.endHasTime) : '—'); row('Finish', fmt(parseWall(c.finishDate)));
    }
    if (bar.segments.some(s => s.fill === 'Striped')) rows.push(el('div.tiny.muted', 'Striped = delay'));
    const s = UI.sheet({ title: bar.title, cls: 'narrow', body: el('div.col', rows),
      foot: bar.kind === 'Card' ? [el('button.btn.primary', { onclick: () => { s.close(); CardEditor.open(bar.card); } }, icon('open-outline'), 'Open card')] : null });
  }
};
