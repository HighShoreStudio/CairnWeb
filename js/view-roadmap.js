/* Cairn Web — Roadmap (RoadmapWindow): rows of bars over whole months of one year; milestones and
 * custom tasks created and edited here, rows collapsed / reordered, settings and milestone types. */
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
  t0: null, span: null, pid: null, collapsed: new Set(),
  DAY: 86400000, MIN_SPAN: 7, MAX_SPAN: 731,

  mount(content, right) {
    const p = App.project;
    this.p = p;
    this.data = p.roadmap || Roadmap.emptyData();
    this.data.milestones ||= []; this.data.items ||= []; this.data.tagOrder ||= []; this.data.collapsed ||= [];
    if (this.pid !== p.id) {
      this.pid = p.id;
      this.span = Math.min(12, Math.max(1, this.data.months || 6)) * 30.44;
      this.collapsed = new Set(this.data.collapsed || []);
      this.t0 = this.todayStart();
    }
    this.label = el('span.rm-label');
    this.monthsSel = el('select.input', { style: { width: 'auto', minHeight: '2.2em', padding: '.2em 2em .2em .8em' }, title: 'Time shown (pinch or mouse wheel to zoom)',
      onchange: () => { this.zoomTo(+this.monthsSel.value * 30.44, null, true); } },
      [1, 2, 3, 4, 6, 9, 12, 18, 24].map(n => el('option', { value: n }, n === 1 ? '1 month' : `${n} months`)));
    this.scroller = el('div.rm-scroll.scroll');
    const frame = el('div.rm-frame.glass', this.scroller);
    this.legend = el('div.rm-legend',
      el('span', el('i', { style: { background: 'var(--primary)' } }), 'work'),
      el('span', el('i', { style: { background: 'color-mix(in srgb, var(--primary) 34%, var(--surface))' } }), 'time left / saved'),
      el('span', el('i', { style: { background: 'repeating-linear-gradient(45deg, var(--primary) 0 3px, color-mix(in srgb, var(--primary) 34%, var(--surface)) 3px 6px)' } }), 'delay'),
      el('span', el('i', { style: { background: 'color-mix(in srgb, var(--primary) 34%, var(--surface))', border: '1.5px solid var(--primary)' } }), 'start → finish'),
      el('span.muted', matchMedia('(pointer: coarse)').matches
        ? 'Drag to move in time · pinch to zoom · tap a bar to edit it, an empty spot to add'
        : 'Wheel to zoom · drag (wheel button or left) to move in time · Shift+wheel scrolls the rows · click a bar to edit it'));
    content.appendChild(el('div.rm',
      el('div.rm-bar',
        this.label,
        el('button.btn', { onclick: () => this.goToday() }, icon('today-outline'), 'Today'),
        el('div.grow'),
        el('button.btn', { onclick: () => this.editMilestone(null, this.defaultDate()) }, icon('flag-outline'), el('span.lbl', 'Milestone')),
        el('button.btn', { onclick: () => this.editItem(null, this.defaultDate()) }, icon('add'), el('span.lbl', p.info.settings.roadmap.customName || 'Custom')),
        this.monthsSel,
        el('button.btn.icon', { title: 'Roadmap settings', onclick: () => RoadmapSettingsSheet.open() }, icon('settings-outline'))),
      frame, this.legend));
    if (p.roadmapError) UI.toast('roadmap.json cannot be read: showing the tasks only.', 'warning-outline', 4000);
    this.bindGestures();
    this.ro = new ResizeObserver(() => this.render());
    this.ro.observe(this.scroller);
  },

  save() {
    this.data.collapsed = [...this.collapsed];
    this.data.months = this.months;
    if (this.p.roadmapError && this.p.has('roadmap.json')) {
      // RoadmapService.SetAsideUnreadable: the unreadable file is kept, never replaced.
      const d = new Date(), stamp = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
      this.p.rename('roadmap.json', 'roadmap.json.unreadable-' + stamp);
      this.p.roadmapError = false;
    }
    if (!this.p.roadmap) this.p.roadmap = this.data;
    this.p.setJson('roadmap.json', this.data);
  },
  /** The months of the desktop toolbar (1–12): the nearest to the time shown, kept in roadmap.json. */
  get months() { return Math.min(12, Math.max(1, Math.round(this.span / 30.44))); },
  /** New items start today when today is on screen, otherwise at the start of the visible period. */
  defaultDate() { const t = startOfDay(new Date()); return t >= this.from && t < this.to ? t : startOfDay(this.from); },
  get from() { return new Date(this.t0); },
  get to() { return new Date(this.t0 + this.span * this.DAY); },

  // ------------------------------------------------------------------ free scrolling and zoom
  /** Where "Today" puts the timeline: from the first of the month, or with today in the middle when zoomed in. */
  todayStart() {
    const now = Date.now(), t = new Date();
    return Math.max(+new Date(t.getFullYear(), t.getMonth(), 1), now - this.span * this.DAY * .5);
  },
  goToday() { this.animateTo(this.todayStart(), this.span); },
  animateTo(t0, span) {
    cancelAnimationFrame(this.anim);
    const a0 = this.t0, s0 = this.span, start = performance.now(), dur = matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 420;
    const step = now => {
      const k = Math.min(1, (now - start) / dur), e = 1 - Math.pow(1 - k, 3);
      this.t0 = a0 + (t0 - a0) * e; this.span = s0 + (span - s0) * e;
      this.render();
      if (k < 1) this.anim = requestAnimationFrame(step); else this.zoomed();
    };
    this.anim = requestAnimationFrame(step);
  },
  headWidth(fs, W) { return Math.round(fs * (W < fs * 34 ? 6.6 : 9.5)); },
  plot() { const fs = parseFloat(getComputedStyle(this.scroller).fontSize) || 14, headW = this.headWidth(fs, this.scroller.clientWidth); return { headW, plotW: Math.max(50, this.scroller.clientWidth - headW), left: this.scroller.getBoundingClientRect().left }; },
  /** Time under a screen x. */
  timeAt(clientX) { const { headW, plotW, left } = this.plot(); return this.t0 + (clientX - left - headW) / plotW * this.span * this.DAY; },
  /** Zoom keeping the moment under clientX in place (null = the middle of the timeline). */
  zoomTo(span, clientX, animate = false) {
    span = Math.min(this.MAX_SPAN, Math.max(this.MIN_SPAN, span));
    const { headW, plotW, left } = this.plot();
    const x = clientX == null ? left + headW + plotW / 2 : clientX;
    const at = this.timeAt(x), frac = (x - left - headW) / plotW;
    const t0 = at - frac * span * this.DAY;
    if (animate) { this.animateTo(t0, span); return; }
    this.t0 = t0; this.span = span;
    this.queue(); this.zoomed();
  },
  panBy(dxPx) { const { plotW } = this.plot(); this.t0 -= dxPx / plotW * this.span * this.DAY; this.queue(); },
  queue() { if (this.pending) return; this.pending = requestAnimationFrame(() => { this.pending = 0; this.render(); }); },
  /** After a zoom: the months menu shows the nearest choice, roadmap.json keeps the months for the desktop app. */
  zoomed() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { if (this.data.months !== this.months) this.save(); }, 600);
  },

  bindGestures() {
    const sc = this.scroller, pts = new Map();
    let mode = null, last = null, down = null, pinch = null, moved = false, vel = 0, lastT = 0;
    const mid = () => { const [a, b] = [...pts.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) || 1 }; };
    sc.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
      if (e.button === 1) e.preventDefault();   // no browser autoscroll with the wheel button
      cancelAnimationFrame(this.anim); cancelAnimationFrame(this.glide);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      sc.setPointerCapture?.(e.pointerId);
      if (pts.size === 1) { mode = 'pan'; last = down = { x: e.clientX, y: e.clientY }; moved = false; vel = 0; lastT = performance.now(); }
      else if (pts.size === 2) { mode = 'pinch'; const m = mid(); pinch = { d: m.d, span: this.span, at: this.timeAt(m.x), y: m.y }; moved = true; }
    });
    sc.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (mode === 'pan' && pts.size === 1) {
        const dx = e.clientX - last.x, dy = e.clientY - last.y;
        if (!moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) return;
        moved = true; sc.classList.add('panning');
        const now = performance.now();
        vel = dx / Math.max(1, now - lastT); lastT = now;
        this.panBy(dx);
        sc.scrollTop -= dy;
        last = { x: e.clientX, y: e.clientY };
      } else if (mode === 'pinch' && pts.size >= 2) {
        const m = mid();
        const span = Math.min(this.MAX_SPAN, Math.max(this.MIN_SPAN, pinch.span * pinch.d / m.d));
        const { headW, plotW, left } = this.plot();
        this.span = span;
        this.t0 = pinch.at - (m.x - left - headW) / plotW * span * this.DAY;   // the moment under the fingers stays under them
        sc.scrollTop -= m.y - pinch.y; pinch.y = m.y;
        this.queue();
      }
    });
    const end = e => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (mode === 'pinch') { this.zoomed(); if (pts.size === 1) { mode = 'pan'; last = [...pts.values()][0]; vel = 0; } else mode = null; return; }
      sc.classList.remove('panning');
      mode = null;
      if (moved) {
        this.justPanned = true; setTimeout(() => this.justPanned = false, 60);
        // a flick keeps the timeline moving for a moment
        if (e.pointerType !== 'mouse' && Math.abs(vel) > .25 && performance.now() - lastT < 80) {
          let v = vel * 16;
          const glide = () => { v *= .93; if (Math.abs(v) < .4) return; this.panBy(v); this.glide = requestAnimationFrame(glide); };
          this.glide = requestAnimationFrame(glide);
        }
      }
    };
    sc.addEventListener('pointerup', end);
    sc.addEventListener('pointercancel', end);
    // a drag is not a click on a bar or on an empty spot
    sc.addEventListener('click', e => { if (this.justPanned) { e.stopPropagation(); e.preventDefault(); } }, true);
    sc.addEventListener('auxclick', e => e.preventDefault());
    sc.addEventListener('wheel', e => {
      e.preventDefault();
      cancelAnimationFrame(this.anim); cancelAnimationFrame(this.glide);
      const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const dx = e.deltaX * k, dy = e.deltaY * k;
      if (e.shiftKey && !e.ctrlKey) { sc.scrollTop += dy || dx; return; }
      if (!e.ctrlKey && Math.abs(dx) > Math.abs(dy)) { this.panBy(-dx); return; }   // touchpad: two fingers sideways
      this.zoomTo(this.span * Math.exp(dy * (e.ctrlKey ? .01 : .0012)), e.clientX);
    }, { passive: false });
  },

  render() {
    if (!this.scroller || !document.contains(this.scroller)) { this.ro?.disconnect(); return; }
    const p = this.p, settings = p.info.settings.roadmap;
    const from = this.from, to = this.to, last = new Date(+to - 1);
    this.label.textContent = from.getMonth() === last.getMonth() && from.getFullYear() === last.getFullYear()
      ? `${MONTHS_LONG[from.getMonth()]} ${from.getFullYear()}`
      : `${MONTHS[from.getMonth()]} ${from.getFullYear()} – ${MONTHS[last.getMonth()]} ${last.getFullYear()}`;
    const choices = [...this.monthsSel.options].map(o => +o.value);
    const nearest = choices.reduce((a, b) => Math.abs(b * 30.44 - this.span) < Math.abs(a * 30.44 - this.span) ? b : a);
    if (+this.monthsSel.value !== nearest) this.monthsSel.value = String(nearest);
    const rows = Roadmap.build(p.board, this.data, settings, new Date());
    for (const r of rows) r.collapsed = this.collapsed.has(r.key);
    const fs = parseFloat(getComputedStyle(this.scroller).fontSize) || 14;
    const W = this.scroller.clientWidth, headW = this.headWidth(fs, W), timeH = Math.round(fs * 3), laneH = Math.round(fs * 2.15), barH = Math.round(fs * 1.55), collapsedH = Math.round(fs * 1.9);
    const plotW = Math.max(50, W - headW);
    const days = this.span;
    const X = d => headW + ((d - from) / 86400000) / days * plotW;
    const dark = UI.isDark();
    const css = getComputedStyle(document.documentElement);
    const surface = css.getPropertyValue('--surface').trim() || '#fff';
    const textC = css.getPropertyValue('--text').trim(), muted = css.getPropertyValue('--muted').trim(), border = css.getPropertyValue('--border').trim();

    // icons of the milestone types (loaded once, then drawn on the next frame)
    const icons = new Map(); let missing = false;
    for (const r of rows) for (const l of r.lanes) for (const b of l) if (b.icon?.startsWith('ion:')) {
      const n = b.icon.slice(4);
      if (IonIcons.cache.has(n)) icons.set(n, IonIcons.cache.get(n)); else { missing = true; IonIcons.get(n).then(() => this.queue()); }
    }
    void missing;

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

    // row backgrounds
    layout.forEach((o, i) => {
      const bg = svgEl('rect', { x: 0, y: o.y - 2, width: W, height: o.h + 4, fill: i % 2 ? 'rgba(0,0,0,0)' : (dark ? 'rgba(255,255,255,.025)' : 'rgba(22,50,79,.03)') });
      bg.addEventListener('click', ev => {
        const x = ev.clientX - svg.getBoundingClientRect().left;
        if (x < headW) return;
        const at = startOfDay(new Date(+from + (x - headW) / plotW * days * 86400000));
        this.emptyMenu(ev, at, o.r);
      });
      svg.appendChild(bg);
    });
    // months: a line at every first of the month, the name (and the year in January / at the left edge) when there is room
    const pxDay = plotW / days;
    for (let d = new Date(from.getFullYear(), from.getMonth(), 1); d < to; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      const x = X(d), xe = X(next);
      if (d >= from) svg.appendChild(svgEl('line', { x1: x, x2: x, y1: 0, y2: H, stroke: border, 'stroke-width': d.getMonth() === 0 ? 2 : 1 }));
      const tx = Math.max(x, headW) + 6, room = xe - tx - 4;
      if (room < fs * 1.6) continue;
      const year = d.getMonth() === 0 || x < headW;
      const longName = MONTHS_LONG[d.getMonth()], shortName = MONTHS[d.getMonth()];
      const label = room > fs * (year ? 9 : 6) ? longName + (year ? ` ${d.getFullYear()}` : '')
        : room > fs * (year ? 5 : 2.6) ? shortName + (year ? ` ${String(d.getFullYear()).slice(year && room < fs * 6 ? 2 : 0)}` : '')
        : year && room > fs * 2.4 ? String(d.getFullYear()) : shortName.slice(0, 1);
      svg.appendChild(svgEl('text', { x: tx, y: fs * 1.25, fill: textC, 'font-size': fs * .9, 'font-weight': 700 }, label));
    }
    // weeks, or days when zoomed in
    if (pxDay > fs * 1.7) {
      for (let d = startOfDay(from); d < to; d = addDays(d, 1)) {
        const x = X(d); if (x < headW) continue;
        const monday = d.getDay() === 1;
        svg.appendChild(svgEl('line', { x1: x, x2: x, y1: timeH - fs * .7, y2: H, stroke: border, 'stroke-width': monday ? .8 : .4, 'stroke-dasharray': monday ? '2 4' : '1 5' }));
        svg.appendChild(svgEl('text', { x: x + 3, y: timeH - fs * .45, fill: muted, 'font-size': fs * .68, 'font-weight': monday ? 700 : 400 }, monday && settings.showWeekNumber && pxDay > fs * 3.2 ? `${d.getDate()} · ${isoWeek(d)}w` : String(d.getDate())));
      }
    } else if (pxDay * 7 > fs * 1.8) {
      let d = startOfDay(from); d = addDays(d, (8 - d.getDay()) % 7); // Mondays
      for (; d < to; d = addDays(d, 7)) {
        const x = X(d);
        svg.appendChild(svgEl('line', { x1: x, x2: x, y1: timeH - fs * .7, y2: H, stroke: border, 'stroke-width': .5, 'stroke-dasharray': '2 4' }));
        if (pxDay * 7 > fs * 2.4) svg.appendChild(svgEl('text', { x: x + 3, y: timeH - fs * .45, fill: muted, 'font-size': fs * .68 }, settings.showWeekNumber && pxDay * 7 > fs * 4.6 ? `${d.getDate()} · ${isoWeek(d)}w` : String(d.getDate())));
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
            const fileUrl = bar.icon.startsWith('file:') ? this.iconFile(bar.icon.slice(5)) : null;
            if (fileUrl) inner.appendChild(svgEl('image', { href: fileUrl, x: lx - 1, y: top + 3, width: sz, height: sz }));
            else if (ic) { const s = svgEl('svg', { x: lx - 1, y: top + 3, width: sz, height: sz, viewBox: ic.viewBox, fill: ink, color: ink, stroke: 'none' }); s.innerHTML = ic.inner; inner.appendChild(s); }
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
    const maxChars = Math.max(4, Math.floor((headW - 18 - fs * 1.6) / (fs * .82 * .56)));
    for (const o of layout) {
      const count = o.r.lanes.reduce((n, l) => n + l.length, 0);
      const g = svgEl('g', { style: 'cursor:pointer' });
      g.appendChild(svgEl('rect', { x: 0, y: o.y - 2, width: headW, height: o.h + 4, fill: 'transparent' }));
      g.appendChild(svgEl('rect', { x: 8, y: o.y + 6, width: 4, height: Math.max(8, Math.min(o.h - 12, laneH - 10)), rx: 2, fill: cssColor(o.r.color, '#888') }));
      const t = svgEl('text', { x: 18, y: o.y + 6 + fs * .7, fill: textC, 'font-size': fs * .82, 'font-weight': 650 }, o.r.title.length > maxChars ? o.r.title.slice(0, maxChars - 1) + '…' : o.r.title);
      g.appendChild(t);
      g.appendChild(svgEl('text', { x: headW - 8, y: o.y + 6 + fs * .7, fill: muted, 'font-size': fs * .7, 'text-anchor': 'end' }, o.r.collapsed ? `▸ ${count}` : String(count)));
      g.addEventListener('click', ev => this.rowMenu(ev, o.r, rows));
      svg.appendChild(g);
    }
    const top = this.scroller.scrollTop;
    fill(this.scroller, svg);
    this.scroller.scrollTop = top;
    if (!rows.some(r => r.lanes.length)) this.scroller.appendChild(el('div.small.muted', { style: { position: 'absolute', left: headW + 16 + 'px', top: timeH + 16 + 'px', maxWidth: '24em' } },
      'Nothing to show yet. A task appears with a Start date plus an End or a Finish date (or a Due date while it is in progress); milestones are created in the desktop app.'));
  },

  iconFile(name) {
    this.iconUrls ||= new Map();
    const key = this.p.id + '/' + name;
    if (this.iconUrls.has(key)) return this.iconUrls.get(key);
    const b = this.p.bytes('roadmap-icons/' + name);
    const u = b ? URL.createObjectURL(new Blob([b], { type: mimeOf(name) })) : null;
    this.iconUrls.set(key, u);
    return u;
  },

  emptyMenu(ev, at, row) {
    const anchor = el('div', { style: { position: 'fixed', left: ev.clientX + 'px', top: ev.clientY + 'px', width: '1px', height: '1px' } });
    document.body.appendChild(anchor);
    const fmt = `${pad2(at.getDate())} ${MONTHS[at.getMonth()]} ${at.getFullYear()}`;
    UI.menu(anchor, [
      { header: fmt + (this.p.info.settings.roadmap.showWeekNumber ? ` - ${isoWeek(at)}w` : '') },
      { label: 'New milestone here', icon: 'flag-outline', onClick: () => this.editMilestone(null, at) },
      { label: `New ${this.p.info.settings.roadmap.customName || 'Custom'} task here`, icon: 'add', onClick: () => this.editItem(null, at) }
    ], { align: 'left' });
    setTimeout(() => anchor.remove(), 50);
  },

  rowMenu(ev, row, rows) {
    const anchor = el('div', { style: { position: 'fixed', left: ev.clientX + 'px', top: ev.clientY + 'px', width: '1px', height: '1px' } });
    document.body.appendChild(anchor);
    const tags = Roadmap.orderedTags(this.p.board, this.data);
    const ti = tags.findIndex(t => t.id === row.key);
    const move = delta => {
      const order = tags.map(t => t.id); const j = ti + delta;
      order.splice(ti, 1); order.splice(j, 0, row.key);
      this.data.tagOrder = order; this.save(); this.render();
    };
    UI.menu(anchor, [
      { header: row.title },
      { label: row.collapsed ? 'Open the row' : 'Close the row', icon: row.collapsed ? 'eye-outline' : 'eye-off-outline', onClick: () => { row.collapsed ? this.collapsed.delete(row.key) : this.collapsed.add(row.key); this.save(); this.render(); } },
      row.kind === 'Tag' && ti > 0 ? { label: 'Move up', icon: 'chevron-up', onClick: () => move(-1) } : null,
      row.kind === 'Tag' && ti < tags.length - 1 ? { label: 'Move down', icon: 'chevron-down', onClick: () => move(1) } : null,
      row.kind === 'Milestones' ? { label: 'New milestone', icon: 'flag-outline', onClick: () => this.editMilestone(null, this.defaultDate()) } : null,
      row.kind === 'Custom' ? { label: 'New task', icon: 'add', onClick: () => this.editItem(null, this.defaultDate()) } : null
    ], { align: 'left' });
    setTimeout(() => anchor.remove(), 50);
  },

  /** MilestoneEditorViewModel: same level = same line; identical dates refused; a milestone that would be covered is deleted after a confirmation. */
  editMilestone(existing, at) {
    const settings = this.p.info.settings.roadmap;
    if (!existing && !settings.milestoneTypes.length) { UI.alert('There are no milestone types: add one in the roadmap settings first.', 'Roadmap'); return; }
    const name = el('input.input', { value: existing?.name || '', placeholder: 'Name (e.g. v1.0)' });
    const type = el('select.input', settings.milestoneTypes.map(t => el('option', { value: t.id, selected: t.id === (existing?.typeId ?? settings.milestoneTypes[0]?.id) }, `${t.name}  (line ${t.level || 1})`)));
    const start = el('input.input', { type: 'date', value: toDateInput(existing ? parseWall(existing.start) : at) });
    const end = el('input.input', { type: 'date', value: toDateInput(existing ? parseWall(existing.end) : addDays(at, 13)) });
    const note = el('textarea.input', { rows: 2, placeholder: 'Note' }, existing?.note || '');
    const err = el('div.error');
    const save = async () => {
      err.textContent = '';
      if (!name.value.trim()) { err.textContent = 'The name is required.'; return; }
      const sd = fromDateInput(start.value), ed = fromDateInput(end.value);
      if (!sd || !ed) { err.textContent = 'Both dates are required.'; return; }
      if (ed < sd) { err.textContent = 'The release date cannot be before the start date.'; return; }
      const draft = { id: existing?.id || uid(12), name: name.value.trim(), typeId: type.value, start: dateOnlyString(sd), end: dateOnlyString(ed), note: note.value.trim() };
      if (existing && +parseWall(existing.start) === +sd) draft.start = existing.start;
      if (existing && +parseWall(existing.end) === +ed) draft.end = existing.end;
      const { identical, hidden } = Roadmap.check(draft, this.data.milestones, settings);
      const fmt = d => `${pad2(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
      if (identical) {
        err.textContent = `'${identical.name}' already has exactly these dates.`;
        UI.alert(`Two milestones on the same line cannot have the same dates.\n\n'${identical.name}' already goes from ${fmt(parseWall(identical.start))} to ${fmt(parseWall(identical.end))}: change at least one of the two dates.`, 'Milestone');
        return;
      }
      let removed = [], self = false;
      if (hidden.length) {
        self = hidden.some(m => m.id === draft.id);
        const others = hidden.filter(m => m.id !== draft.id);
        const msg = self && !others.length
          ? `With these dates '${draft.name}' would be completely covered by other milestones of its line, so it could never be seen.\n\nContinue anyway? The milestone will be deleted.`
          : `With these dates ${others.length === 1 ? 'this milestone' : 'these milestones'} would be completely covered and could never be seen:\n\n${hidden.map(m => `•  ${m.name}  (${fmt(parseWall(m.start))} – ${fmt(parseWall(m.end))})`).join('\n')}\n\nContinue anyway? ${hidden.length === 1 ? 'It' : 'They'} will be deleted.`;
        if (!await UI.confirm(msg, 'Hidden milestone', 'Continue', true)) return;
        removed = others.map(m => m.id);
      }
      this.data.milestones = this.data.milestones.filter(m => !removed.includes(m.id));
      const idx = existing ? this.data.milestones.indexOf(existing) : -1;
      if (self) { if (idx >= 0) this.data.milestones.splice(idx, 1); }
      else if (idx >= 0) this.data.milestones[idx] = draft; else this.data.milestones.push(draft);
      this.save(); sh.close(); this.render();
    };
    const sh = UI.sheet({ title: existing ? 'Edit milestone' : 'New milestone', cls: 'mid',
      head: existing ? [el('button.btn.icon.ghost.danger', { title: 'Delete', onclick: () => { sh.close(); this.remove(existing, 'Milestone'); } }, icon('trash-outline'))] : [],
      body: el('div.col', { style: { gap: '.7em' } }, el('div.row', name, type), el('div.row', el('div.field.grow', el('label', 'Start of the work'), start), el('div.field.grow', el('label', 'Release'), end)), note, err),
      foot: [el('button.btn.ghost', { onclick: () => sh.close() }, 'Cancel'), el('button.btn.primary', { onclick: save }, icon('checkmark'), 'Save')] });
    if (!existing) setTimeout(() => name.focus(), 400);
  },

  /** RoadmapItemEditorViewModel: a task that exists only in the roadmap. */
  editItem(existing, at) {
    const settings = this.p.info.settings.roadmap;
    const name = el('input.input', { value: existing?.name || '', placeholder: 'Name' });
    const date = (v, label) => { const i = el('input.input', { type: 'date', value: toDateInput(v) }); return { i, f: el('div.field.grow', el('label', label), el('div.datepair', i, el('button.btn.icon.small.ghost', { onclick: () => i.value = '' }, icon('close')))) }; };
    const start = date(existing ? parseWall(existing.start) : at, 'Start'), due = date(existing?.due ? parseWall(existing.due) : null, 'Due'), end = date(existing?.end ? parseWall(existing.end) : null, 'End');
    const note = el('textarea.input', { rows: 2, placeholder: 'Note' }, existing?.note || '');
    const err = el('div.error');
    const keep = (key, d) => existing?.[key] && d && +parseWall(existing[key]) === +d ? existing[key] : d ? dateOnlyString(d) : null;
    const save = () => {
      err.textContent = '';
      if (!name.value.trim()) { err.textContent = 'The name is required.'; return; }
      const sd = fromDateInput(start.i.value), dd = fromDateInput(due.i.value), ed = fromDateInput(end.i.value);
      if (!sd) { err.textContent = 'The start date is required.'; return; }
      if (!dd && !ed) { err.textContent = 'Set a due date, an end date, or both.'; return; }
      if (ed && ed < sd) { err.textContent = 'The end date cannot be before the start date.'; return; }
      const item = { id: existing?.id || uid(12), name: name.value.trim(), start: keep('start', sd) };
      if (dd) item.due = keep('due', dd);
      if (ed) item.end = keep('end', ed);
      item.note = note.value.trim();
      const idx = existing ? this.data.items.indexOf(existing) : -1;
      if (idx >= 0) this.data.items[idx] = item; else this.data.items.push(item);
      this.save(); sh.close(); this.render();
    };
    const sh = UI.sheet({ title: (existing ? 'Edit task' : 'New task') + ` (${settings.customName || 'Custom'})`, cls: 'mid',
      head: existing ? [el('button.btn.icon.ghost.danger', { title: 'Delete', onclick: () => { sh.close(); this.remove(existing, 'Custom'); } }, icon('trash-outline'))] : [],
      body: el('div.col', { style: { gap: '.7em' } }, name, el('div.row', start.f, due.f, end.f),
        el('div.tiny.muted', 'Without a due date the end date gives a plain bar; with both, the bar shows the delay or the time saved.'), note, err),
      foot: [el('button.btn.ghost', { onclick: () => sh.close() }, 'Cancel'), el('button.btn.primary', { onclick: save }, icon('checkmark'), 'Save')] });
    if (!existing) setTimeout(() => name.focus(), 400);
  },

  async remove(obj, kind) {
    if (!await UI.confirm(`Delete '${obj.name}' from the roadmap?`, 'Delete', 'Delete', true)) return;
    if (kind === 'Milestone') this.data.milestones = this.data.milestones.filter(m => m !== obj);
    else this.data.items = this.data.items.filter(i => i !== obj);
    this.save(); this.render();
  },

  details(bar) {
    if (bar.kind === 'Milestone') { this.editMilestone(bar.milestone, null); return; }
    if (bar.kind === 'Custom') { this.editItem(bar.item, null); return; }
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
      foot: [el('button.btn.ghost.danger', { onclick: async () => {
        const c = bar.card;
        if (!await UI.confirm(`Remove the start and the finish date of '${c.title}'?\n\nThe task disappears from the roadmap; it stays on the Kanban board with its due and end date.`, 'Remove Start/Finish dates', 'Remove', true)) return;
        delete c.startDate; delete c.finishDate;
        App.ops.log(c, 'removed the start and finish dates (roadmap)');
        App.ops.commit(); s.close(); this.render();
      } }, icon('close'), 'Remove from roadmap'),
        el('button.btn.primary', { onclick: () => { s.close(); CardEditor.open(bar.card); } }, icon('open-outline'), 'Open card')] });
  }
};

/** Settings > Roadmap: the two special rows, the options and the milestone types (name, icon, color, line). */
const RoadmapSettingsSheet = {
  open() {
    const p = App.project, rm = p.info.settings.roadmap;
    const types = JSON.parse(JSON.stringify(rm.milestoneTypes));
    const opts = { showMilestones: rm.showMilestones, showCustom: rm.showCustom, showInProgress: rm.showInProgress, autoEndDate: rm.autoEndDate, showWeekNumber: rm.showWeekNumber };
    const names = { milestonesName: rm.milestonesName, customName: rm.customName, milestonesColor: rm.milestonesColor, customColor: rm.customColor };
    const opt = (k, label) => el('div.row', UI.toggle(opts[k], v => opts[k] = v), el('span.small', label));
    const rowName = (nk, ck, show) => {
      const inp = el('input.input', { value: names[nk], oninput: () => names[nk] = inp.value });
      const sw = el('button.swatch', { style: { background: cssColor(names[ck]) } });
      sw.onclick = () => UI.colorMenu(sw, PALETTE, names[ck], c => { if (c) { names[ck] = c; sw.style.background = cssColor(c); } });
      return el('div.row', UI.toggle(opts[show], v => opts[show] = v), sw, inp);
    };
    const list = el('div.col', { style: { gap: '.35em' } });
    const preview = async (t, box) => {
      fill(box);
      if (t.icon?.startsWith('ion:')) { const ic = await IonIcons.get(t.icon.slice(4)); if (ic) { const s = svgEl('svg', { viewBox: ic.viewBox, width: '100%', height: '100%', fill: '#fff', color: '#fff' }); s.innerHTML = ic.inner; box.appendChild(s); } }
      else if (t.icon?.startsWith('file:')) { const u = RoadmapView.iconFile?.call({ p, iconUrls: RoadmapView.iconUrls ||= new Map() }, t.icon.slice(5)); if (u) box.appendChild(el('img', { src: u, style: { width: '100%', height: '100%' } })); }
    };
    const render = () => fill(list, ...types.map(t => {
      const ib = el('button.iconbox', { style: { background: cssColor(t.color, '#5B5BD6') }, title: 'Icon', onclick: () => IconPicker.open(t.icon, ic => { t.icon = ic; render(); }) });
      preview(t, ib);
      const sw = el('button.swatch', { style: { background: cssColor(t.color) } });
      sw.onclick = () => UI.colorMenu(sw, PALETTE, t.color, c => { if (c) { t.color = c; render(); } });
      const nm = el('input.input', { value: t.name, oninput: () => t.name = nm.value });
      const lv = el('select.input', { style: { width: '5.5em' }, onchange: () => t.level = +lv.value }, [1, 2, 3, 4, 5].map(n => el('option', { value: n, selected: (t.level || 1) === n }, 'Line ' + n)));
      return el('div.row', ib, sw, nm, lv, el('button.btn.icon.small.ghost.danger', { onclick: () => { types.splice(types.indexOf(t), 1); render(); } }, icon('trash-outline')));
    }));
    render();
    const err = el('div.error');
    const s = UI.sheet({ title: 'Roadmap settings', cls: 'tall',
      body: el('div.ed',
        el('div.col', { style: { gap: '.6em' } },
          el('div.label', 'Rows'), rowName('milestonesName', 'milestonesColor', 'showMilestones'), rowName('customName', 'customColor', 'showCustom'),
          el('div.label', { style: { marginTop: '.5em' } }, 'Options'),
          opt('showInProgress', 'Tasks in progress (start + due): bar up to today'),
          opt('autoEndDate', 'End date set automatically when a task enters a "done" column'),
          opt('showWeekNumber', 'Week numbers')),
        el('div.col', { style: { gap: '.5em' } },
          el('div.label', 'Milestone types'),
          el('div.tiny.muted', 'Milestones of the same line share a row; lower lines are drawn above.'),
          list,
          el('button.btn.small', { style: { alignSelf: 'flex-start' }, onclick: () => { types.push({ id: uid(8), name: 'New type', icon: 'ion:flag-outline', color: '#5B5BD6', level: 1 }); render(); } }, icon('add'), 'Add type'),
          err)),
      foot: [el('button.btn.ghost', { onclick: () => s.close() }, 'Cancel'), el('button.btn.primary', { onclick: async () => {
        if (types.some(t => !t.name.trim())) { err.textContent = 'Every milestone type needs a name.'; return; }
        if (!names.milestonesName.trim() || !names.customName.trim()) { err.textContent = 'The rows need a name.'; return; }
        const next = Object.assign({}, rm, opts, { milestonesName: names.milestonesName.trim(), customName: names.customName.trim(), milestonesColor: names.milestonesColor, customColor: names.customColor, milestoneTypes: types.map(t => ({ id: t.id, name: t.name.trim(), icon: t.icon, color: t.color, level: t.level || 1 })) });
        // CheckHiddenMilestones: a new line or a removed type can put milestones completely under others.
        const data = RoadmapView.data && RoadmapView.pid === p.id ? RoadmapView.data : (p.roadmap || Roadmap.emptyData());
        const hidden = Roadmap.hidden(data.milestones || [], next);
        if (hidden.length) {
          const fmt = d => `${pad2(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
          if (!await UI.confirm(`With the new settings ${hidden.length === 1 ? 'this milestone is' : 'these milestones are'} completely covered by others on the same line:\n\n${hidden.map(m => `•  ${m.name}  (${fmt(parseWall(m.start))} – ${fmt(parseWall(m.end))})`).join('\n')}\n\nA covered milestone is not shown. Continue and delete ${hidden.length === 1 ? 'it' : 'them'}?`, 'Roadmap', 'Delete and save', true)) return;
          const ids = new Set(hidden.map(m => m.id));
          data.milestones = data.milestones.filter(m => !ids.has(m.id));
          if (!p.roadmap) p.roadmap = data;
          p.setJson('roadmap.json', data);
        }
        Object.assign(rm, next);
        p.saveInfo(); s.close(); App.route();
      } }, icon('checkmark'), 'Save')] });
  }
};

/** IconPickerDialog: the built-in Ionicons set, searchable. */
const IconPicker = {
  async open(current, onPick) {
    if (!IonIcons.zip) await IonIcons.get('flag-outline');
    const names = Object.keys(IonIcons.zip.files).filter(n => n.endsWith('.svg')).map(n => n.slice(0, -4)).sort();
    const search = el('input.input', { type: 'search', placeholder: 'Search icons (rocket, bug, star…)' });
    const grid = el('div.icongrid');
    let shown = 0;
    const render = async () => {
      const q = search.value.trim().toLowerCase();
      const list = names.filter(n => !q || n.includes(q)).slice(0, 180);
      const token = ++shown;
      fill(grid);
      for (const n of list) {
        const b = el('button.iconcell' + ('ion:' + n === current ? '.sel' : ''), { title: n, onclick: () => { s.close(); onPick('ion:' + n); } });
        grid.appendChild(b);
        IonIcons.get(n).then(ic => { if (token !== shown || !ic) return; const sv = svgEl('svg', { viewBox: ic.viewBox, width: '100%', height: '100%' }); sv.innerHTML = ic.inner; sv.style.fill = 'currentColor'; b.appendChild(sv); });
      }
    };
    search.oninput = debounce(render, 200);
    render();
    const s = UI.sheet({ title: 'Icon', cls: 'mid tall', body: el('div.col', search, grid) });
  }
};
