/* Cairn Web — UI building blocks: sheets, menus, dialogs, toasts, pickers, avatars. */
'use strict';

const UI = {
  stage: () => $('#stage'),
  layer: () => $('#layer'),

  // ---------------------------------------------------------------- theme
  theme() { try { return localStorage.getItem('cairn.theme') || 'auto'; } catch { return 'auto'; } },
  applyTheme(mode = UI.theme()) {
    const dark = mode === 'dark' || (mode === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    $('meta[name=theme-color]')?.setAttribute('content', dark ? '#0F1720' : '#F4F6F8');
  },
  setTheme(mode) {
    try { localStorage.setItem('cairn.theme', mode); } catch { }
    const run = () => UI.applyTheme(mode);
    if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(run); else run();
    App.emit('theme');
  },
  isDark: () => document.documentElement.dataset.theme === 'dark',

  /** Swaps the content of #view with a soft cross-fade (View Transitions where available). */
  swap(build) {
    const view = $('#view');
    fill(view);
    build(view);
    view.animate([{ opacity: 0, transform: 'scale(.985)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' });
  },

  // ---------------------------------------------------------------- toasts
  toast(text, iconName = 'checkmark-circle', ms = 2600) {
    const t = el('div.toast.glass', icon(iconName), el('span', text));
    $('#toasts').appendChild(t);
    setTimeout(() => { t.classList.add('bye'); setTimeout(() => t.remove(), 320); }, ms);
  },

  // ---------------------------------------------------------------- overlays
  _stack: [],
  overlay(node, { scrim = true, onClose, dismissable = true } = {}) {
    const layer = UI.layer();
    const s = scrim ? el('div.scrim') : null;
    const entry = { node, scrim: s, onClose, close: null };
    entry.close = (result) => {
      if (entry.closed) return; entry.closed = true;
      UI._stack.splice(UI._stack.indexOf(entry), 1);
      node.classList.remove('in'); node.classList.add('out');
      s?.classList.remove('in');
      setTimeout(() => { node.remove(); s?.remove(); }, 330);
      onClose?.(result);
    };
    entry.forceClose = r => entry.close === entry._base ? entry.close(r) : entry._base(r);
    entry._base = entry.close;
    if (s) { layer.appendChild(s); if (dismissable) s.addEventListener('click', () => entry.close()); }
    layer.appendChild(node);
    UI._stack.push(entry);
    requestAnimationFrame(() => requestAnimationFrame(() => { node.classList.add('in'); s?.classList.add('in'); }));
    return entry;
  },
  closeTop() { const top = UI._stack[UI._stack.length - 1]; if (top) { top.close(); return true; } return false; },
  closeAll() { for (const e of UI._stack.slice().reverse()) e.forceClose(); },

  /** A bottom sheet. Returns { el, body, foot, close }. */
  sheet({ title, cls = '', head = [], body, foot, onClose, dismissable = true }) {
    const close = el('button.btn.icon.ghost', { onclick: () => entry.close(), 'aria-label': 'Close' }, icon('close'));
    const bodyEl = el('div.sheet-body.scroll');
    const footEl = foot ? el('div.sheet-foot') : null;
    const node = el(`div.sheet.glass${cls ? '.' + cls.split(' ').join('.') : ''}`, { role: 'dialog' },
      el('div.grabber'),
      el('div.sheet-head', el('h2', title || ''), ...head, close),
      bodyEl, footEl);
    if (body) appendAll(bodyEl, [body]);
    if (foot) appendAll(footEl, [foot]);
    const entry = UI.overlay(node, { onClose, dismissable });
    UI.swipeToClose(node, entry);
    return { el: node, body: bodyEl, foot: footEl, close: r => entry.close(r), entry, title: node.querySelector('h2') };
  },
  swipeToClose(node, entry) {
    const head = node.querySelector('.sheet-head');
    let y0 = null, dy = 0;
    head.addEventListener('pointerdown', e => { if (e.target.closest('button,input')) return; y0 = e.clientY; dy = 0; node.style.transition = 'none'; head.setPointerCapture(e.pointerId); });
    head.addEventListener('pointermove', e => { if (y0 == null) return; dy = Math.max(0, e.clientY - y0); node.style.transform = `translate(-50%, ${dy}px)`; });
    const end = () => { if (y0 == null) return; y0 = null; node.style.transition = ''; node.style.transform = ''; if (dy > 80) entry.close(); };
    head.addEventListener('pointerup', end); head.addEventListener('pointercancel', end);
  },

  /** Context menu next to an anchor element. items: [{label, icon, onClick, danger, header, sep, checked}] */
  menu(anchor, items, { align = 'right' } = {}) {
    const stage = UI.stage().getBoundingClientRect();
    const r = anchor.getBoundingClientRect();
    const node = el('div.menu.glass.scroll', { role: 'menu' });
    for (const it of items) {
      if (!it) continue;
      if (it.sep) { node.appendChild(el('div.sep')); continue; }
      if (it.header) { node.appendChild(el('div.mh', it.header)); continue; }
      node.appendChild(el('button.mi' + (it.danger ? '.danger' : ''), {
        onclick: () => { entry.close(); setTimeout(() => it.onClick?.(), 10); }
      }, it.swatch ? el('span.dot', { style: { background: it.swatch, width: '.85em', height: '.85em' } })
        : it.checked != null ? icon('checkmark', it.checked ? '' : 'off')
        : icon(it.icon || 'ellipse-outline'),
      it.checked != null && it.icon ? icon(it.icon) : null,
      el('span.grow.ellipsis', it.label), it.hint ? el('span.tiny.muted', it.hint) : null));
    }
    const entry = UI.overlay(node, { scrim: false });
    const catcher = el('div', { style: { position: 'absolute', inset: 0 }, onpointerdown: () => entry.close() });
    UI.layer().insertBefore(catcher, node);
    const prevClose = entry._base;
    entry.close = entry._base = r2 => { catcher.remove(); prevClose(r2); };
    requestAnimationFrame(() => {
      const w = node.offsetWidth, h = node.offsetHeight;
      let left = align === 'right' ? r.right - stage.left - w : r.left - stage.left;
      let top = r.bottom - stage.top + 6;
      if (top + h > stage.height - 6) { top = r.top - stage.top - h - 6; node.style.transformOrigin = 'bottom right'; }
      left = Math.max(6, Math.min(left, stage.width - w - 6)); top = Math.max(6, top);
      node.style.left = left + 'px'; node.style.top = top + 'px';
    });
    return entry;
  },

  dialog({ title, message, buttons, content }) {
    return new Promise(resolve => {
      const actions = el('div.actions');
      const node = el('div.dialog.glass', { role: 'alertdialog' }, el('h3', title), message ? el('p', message) : null, content || null, actions);
      const entry = UI.overlay(node, { onClose: r => resolve(r ?? null) });
      for (const b of buttons) actions.appendChild(el('button.btn' + (b.cls ? '.' + b.cls : ''), { onclick: () => entry.close(b.value) }, b.label));
      setTimeout(() => node.querySelector('input')?.focus(), 350);
    });
  },
  confirm(message, title = 'Confirm', ok = 'OK', danger = false) {
    return UI.dialog({ title, message, buttons: [{ label: 'Cancel', value: false, cls: 'ghost' }, { label: ok, value: true, cls: danger ? 'danger.solid' : 'primary' }] }).then(Boolean);
  },
  alert(message, title = 'Cairn') { return UI.dialog({ title, message, buttons: [{ label: 'OK', value: true, cls: 'primary' }] }); },
  async prompt(title, label, value = '', validate) {
    const input = el('input.input', { value, type: 'text', autocomplete: 'off', enterkeyhint: 'done' });
    const err = el('div.error');
    const content = el('div.field', label ? el('label', label) : null, input, err);
    while (true) {
      const p = UI.dialog({ title, content, buttons: [{ label: 'Cancel', value: null, cls: 'ghost' }, { label: 'OK', value: 'ok', cls: 'primary' }] });
      input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); input.closest('.dialog').querySelector('.btn.primary').click(); } };
      const r = await p;
      if (r !== 'ok') return null;
      const v = input.value.trim();
      const msg = validate ? validate(v) : (v ? null : 'A value is required.');
      if (!msg) return v;
      err.textContent = msg;
    }
  },

  // ---------------------------------------------------------------- small widgets
  avatar(account, cls = '') {
    const a = el('span.avatar' + (cls ? '.' + cls : ''), { title: account?.username || 'Unassigned' });
    if (!account) { a.style.background = 'var(--chip)'; a.style.color = 'var(--muted)'; a.appendChild(icon('person-outline')); return a; }
    if (account.avatarImage) a.style.backgroundImage = `url(data:image/png;base64,${account.avatarImage})`;
    else { a.style.background = cssColor(account.avatarColor, '#1F6F8B'); a.textContent = initials(account.username); }
    return a;
  },
  projectIcon(info, cls = 'proj-icon') {
    const n = el('div.' + cls);
    if (info.icon) n.style.backgroundImage = `url(data:image/png;base64,${info.icon})`;
    else { n.style.background = cssColor(info.color, '#1F6F8B'); n.textContent = initials(info.name); }
    return n;
  },
  ring(value) {
    const r = 9, c = 2 * Math.PI * r;
    return svgEl('svg', { class: 'ring', viewBox: '0 0 24 24' },
      svgEl('circle', { class: 'bg', cx: 12, cy: 12, r }),
      svgEl('circle', { class: 'fg', cx: 12, cy: 12, r, 'stroke-dasharray': c, 'stroke-dashoffset': c * (1 - value) }));
  },
  swatches(colors, value, onPick, { allowNone = false } = {}) {
    const wrap = el('div.pick');
    const render = v => {
      fill(wrap);
      if (allowNone) wrap.appendChild(el('button.swatch.none' + (v == null ? '.sel' : ''), { title: 'Default', onclick: () => { render(null); onPick(null); } }));
      for (const c of colors) wrap.appendChild(el('button.swatch' + (String(v).toLowerCase() === c.toLowerCase() ? '.sel' : ''), { style: { background: c }, title: c, onclick: () => { render(c); onPick(c); } }));
    };
    render(value);
    return wrap;
  },
  /** Popover with a grid of colors (and "none" / "automatic" when noneLabel is given). */
  colorMenu(anchor, colors, value, onPick, noneLabel) {
    const grid = el('div.colorgrid');
    const entry = UI.menu(anchor, [], { align: 'left' });
    const node = entry.node;
    if (noneLabel) node.appendChild(el('button.mi', { onclick: () => { entry.close(); onPick(null); } }, el('span.swatch.none' + (value == null ? '.sel' : ''), { style: { width: '1.2em', height: '1.2em' } }), el('span', noneLabel)));
    for (const c of colors) grid.appendChild(el('button.swatch' + (String(value).toLowerCase() === c.toLowerCase() ? '.sel' : ''), { style: { background: c, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.15)' }, title: c, onclick: () => { entry.close(); onPick(c); } }));
    node.appendChild(grid);
    return entry;
  },
  /** A small button showing a number; tapping it lists the choices. */
  numberMenu(label, options, value, onPick) {
    const b = el('button.btn.small', label + ' ' + value);
    b.onclick = () => UI.menu(b, options.map(o => ({ label: String(o), checked: o === value, onClick: () => onPick(o) })), { align: 'left' });
    return b;
  },
  toggle(on, onChange) {
    const b = el('button.switch' + (on ? '.on' : ''), { role: 'switch', 'aria-checked': String(!!on) });
    b.onclick = () => { on = !on; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); onChange(on); };
    return b;
  },
  /** Segmented control with a sliding thumb. items: [{id, label, icon}] */
  segmented(items, value, onChange) {
    const seg = el('div.seg.glass-lite');
    const thumb = el('div.thumb');
    seg.appendChild(thumb);
    const buttons = items.map(it => el('button' + (it.id === value ? '.on' : ''), { onclick: () => select(it.id, true), title: it.label },
      it.icon ? icon(it.icon) : null, el('span.lbl', it.label)));
    buttons.forEach(b => seg.appendChild(b));
    const place = () => { const b = buttons[items.findIndex(i => i.id === value)]; if (!b) return; thumb.style.left = b.offsetLeft + 'px'; thumb.style.width = b.offsetWidth + 'px'; };
    const select = (id, fire) => { value = id; buttons.forEach((b, i) => b.classList.toggle('on', items[i].id === id)); place(); if (fire) onChange(id); };
    new ResizeObserver(place).observe(seg);
    requestAnimationFrame(place);
    seg.select = id => select(id, false);
    return seg;
  },
  empty(iconName, title, text, action) {
    return el('div.empty', el('div', icon(iconName, 'big')), el('b', title), text ? el('div.small', text) : null, action || null);
  },
  /** Long press helper (touch): calls fn(event) after ms without moving. */
  longPress(node, fn, ms = 450) {
    let t = 0, x = 0, y = 0;
    node.addEventListener('pointerdown', e => { x = e.clientX; y = e.clientY; clearTimeout(t); t = setTimeout(() => fn(e), ms); });
    node.addEventListener('pointermove', e => { if (Math.hypot(e.clientX - x, e.clientY - y) > 8) clearTimeout(t); });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) node.addEventListener(ev, () => clearTimeout(t));
    node.addEventListener('contextmenu', e => { e.preventDefault(); clearTimeout(t); fn(e); });
  },
  autoGrow(textarea, max = 400) {
    const fit = () => { textarea.style.height = 'auto'; textarea.style.height = Math.min(textarea.scrollHeight + 2, max) + 'px'; };
    textarea.addEventListener('input', fit);
    requestAnimationFrame(fit);
    return textarea;
  },
  pickFile(accept) {
    return new Promise(resolve => {
      const input = el('input', { type: 'file', accept, style: { display: 'none' } });
      input.onchange = () => { resolve(input.files[0] || null); input.remove(); };
      document.body.appendChild(input);
      input.click();
    });
  }
};
