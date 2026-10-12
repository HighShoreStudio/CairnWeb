/* Cairn Web — project header shared by the four areas, and the Kanban board (BoardView). */
'use strict';

const TABS = [
  { id: 'board', label: 'Kanban', icon: 'grid-outline' },
  { id: 'whiteboard', label: 'Whiteboard', icon: 'easel-outline' },
  { id: 'docs', label: 'Docs', icon: 'book-outline' },
  { id: 'roadmap', label: 'Roadmap', icon: 'analytics-outline' }
];

const ProjectShell = {
  mounted: null,  // { projectId, seg, content, right }
  show(tab, args = []) {
    const p = App.project;
    const reuse = this.mounted && this.mounted.projectId === p.id && document.contains(this.mounted.content);
    if (!reuse) {
      UI.swap(v => {
        const right = el('div.right');
        const seg = UI.segmented(TABS, tab, id => App.go(`#/p/${p.id}/${id}`));
        const name = el('span.title.ellipsis', p.info.name);
        v.appendChild(el('header.topbar.glass',
          el('div.left',
            el('button.btn.icon.ghost', { title: 'Projects', onclick: () => App.go('#/projects') }, icon('arrow-back')),
            el('button.btn.ghost', { style: { padding: '0 .4em', minWidth: 0 }, onclick: () => ProjectSettings.open() }, UI.projectIcon(p.info), name)),
          el('div.center', seg),
          right));
        const content = el('div.content');
        v.appendChild(content);
        this.mounted = { projectId: p.id, seg, content, right, name };
      });
    } else this.mounted.seg.select(tab);
    const m = this.mounted;
    m.name.textContent = p.info.name;
    fill(m.right);
    fill(m.content);
    m.content.animate([{ opacity: 0, transform: 'translateY(.4em)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' });
    const views = { board: BoardView, whiteboard: WhiteboardView, docs: DocsView, roadmap: RoadmapView };
    views[tab].mount(m.content, m.right, args);
    m.right.appendChild(el('button.btn.icon', { title: 'More', onclick: e => ProjectShell.more(e.currentTarget, tab) }, icon('ellipsis-horizontal')));
    m.right.appendChild(AccountMenu.button(Accounts.current));
  },
  more(anchor, tab) {
    UI.menu(anchor, [
      tab === 'board' ? { label: 'Add column', icon: 'add', onClick: () => BoardView.addColumn() } : null,
      { label: 'Tags', icon: 'pricetag-outline', onClick: () => TagManager.open() },
      { label: 'Archive', icon: 'archive-outline', hint: String(App.project.board.archived.length), onClick: () => ArchiveSheet.open() },
      { label: 'Project settings', icon: 'settings-outline', onClick: () => ProjectSettings.open() },
      { sep: true },
      { label: 'Export .zip', icon: 'share-outline', onClick: () => App.exportProject(App.project.id) }
    ]);
  }
};

// ------------------------------------------------------------------ board

const BoardView = {
  filter: Filter.empty(),
  filterFor: null,
  root: null,
  mount(content, right) {
    const p = App.project;
    if (this.filterFor !== p.id) { this.filter = Filter.empty(); this.filterFor = p.id; }
    this.right = right;
    const fbtn = el('button.btn', { title: 'Filter and sort', onclick: () => FilterSheet.open() }, icon('funnel-outline'), el('span.lbl', 'Filter'));
    this.filterBtn = fbtn;
    right.appendChild(fbtn);
    this.root = el('div', { style: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' } });
    content.appendChild(this.root);
    this.render();
  },
  get ops() { return App.ops; },

  render(flashId) {
    if (!this.root || !document.contains(this.root)) return;
    const p = App.project, ops = App.ops, board = p.board, f = this.filter;
    const prevScroll = this.root.querySelector('.board')?.scrollLeft || 0;
    const colScroll = {};
    for (const c of this.root.querySelectorAll('.column[data-id]')) colScroll[c.dataset.id] = c.querySelector('.cards')?.scrollTop || 0;
    fill(this.root);
    ops.reindex();
    const n = Filter.count(f);
    this.filterBtn.querySelector('.badge')?.remove();
    if (n) this.filterBtn.appendChild(el('span.badge', String(n)));

    if (Filter.isActive(f)) {
      const chips = [];
      if (f.search.trim()) chips.push(`“${f.search.trim()}”`);
      for (const id of f.assigneeIds) chips.push(id ? ops.memberName(id) : 'Unassigned');
      chips.push(...f.priorities);
      for (const id of f.tagIds) chips.push(ops.tag(id)?.name || '?');
      for (const id of f.columnIds) chips.push(ops.column(id)?.name || '?');
      if (f.due !== 'Any') chips.push({ Overdue: 'Overdue', ThisWeek: 'This week', ThisMonth: 'This month', NoDueDate: 'No due date' }[f.due]);
      if (f.sort !== 'Manual') chips.push('Sort: ' + f.sort + (f.reverse ? ' ↑' : ''));
      this.root.appendChild(el('div.filterbar', icon('funnel-outline'), ...chips.map(c => el('span.chip', { onclick: () => FilterSheet.open() }, c)),
        el('button.btn.small.ghost', { onclick: () => { this.filter = Filter.empty(); this.render(); } }, icon('close'), 'Clear')));
    }

    const wrap = el('div', { style: { position: 'relative', flex: 1, minHeight: 0 } });
    const boardEl = el('div.board');
    wrap.appendChild(boardEl);
    this.root.appendChild(wrap);
    const now = new Date();
    let delay = 0;
    for (const col of board.columns) {
      if (!Filter.columnVisible(f, col.id)) continue;
      const cards = Filter.sort(f, col.cards.filter(c => Filter.matches(f, c, col.isDone, now)), id => ops.memberName(id));
      const dark = UI.isDark();
      const bg = cssColor(dark ? col.backgroundDark : col.background);
      const title = cssColor(dark ? col.titleColorDark : col.titleColor);
      const menuBtn = el('button.btn.icon.small.ghost', { onclick: e => this.columnMenu(e.currentTarget, col) }, icon('ellipsis-horizontal'));
      const list = el('div.cards', { dataset: { col: col.id } });
      for (const c of cards) list.appendChild(this.cardEl(c, col, delay += 18));
      const colEl = el('section.column.glass', { dataset: { id: col.id }, style: { animationDelay: (delay / 3) + 'ms' } },
        el('div.col-head',
          col.isDone ? icon('checkmark-circle', 'done-mark') : null,
          el('span.name.ellipsis', col.name),
          el('span.count', cards.length === col.cards.length ? String(col.cards.length) : `${cards.length}/${col.cards.length}`),
          el('button.btn.icon.small.ghost', { title: 'Add card', onclick: () => CardEditor.open(null, col.id) }, icon('add')),
          menuBtn),
        list,
        el('div.col-foot', el('button.btn.ghost.small', { onclick: () => CardEditor.open(null, col.id) }, icon('add'), 'Add card')));
      if (bg) colEl.style.setProperty('--col-bg', bg);
      if (title) colEl.style.setProperty('--col-title', title);
      UI.longPress(colEl.querySelector('.col-head'), () => this.columnMenu(menuBtn, col));
      boardEl.appendChild(colEl);
      list.scrollTop = colScroll[col.id] || 0;
    }
    boardEl.appendChild(el('div.column.glass.add-col', { onclick: () => this.addColumn() }, icon('add'), 'Add column'));
    boardEl.scrollLeft = prevScroll;
    if (flashId) {
      const c = boardEl.querySelector(`.card[data-id="${flashId}"]`);
      if (c) { c.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' }); c.classList.add('flash'); }
    }
    DnD.attach(boardEl);
  },

  cardEl(card, col, delay = 0) {
    const ops = App.ops, idx = ops.index;
    const tags = card.tagIds.map(id => ops.tag(id)).filter(Boolean);
    const parent = idx.parentOf(card);
    const sub = idx.subtaskCount(card.id);
    const progress = idx.progress(card);
    const due = parseWall(card.dueDate);
    const over = Model.isOverdue(card, col.isDone), soon = Model.isDueSoon(card, col.isDone);
    const assignee = card.assigneeId ? App.project.member(card.assigneeId) : null;
    const checklistDone = card.checklist.filter(i => i.done).length;
    const wbRef = this.wbRefs().get(card.id);
    const refs = [...(wbRef ? [{ wb: wbRef }] : []), ...(card.docRefs || []).map(d => ({ doc: d }))];
    const node = el('article.card' + (card.priority !== 'None' ? '.prio' : '') + (col.isDone ? '.dim' : ''), { dataset: { id: card.id }, style: { animationDelay: delay + 'ms' } },
      tags.length ? el('div.tags.named', tags.map(t => el('span.tag', { style: { background: cssColor(t.color, '#888') } }, t.name))) : null,
      parent ? el('div.parent', icon('git-branch-outline'), el('span.ellipsis', parent.title)) : null,
      el('div.ctitle', card.title),
      el('div.cmeta',
        card.priority !== 'None' ? el('span.m', { style: { color: PRIORITY_COLOR[card.priority], fontWeight: 700 } }, card.priority) : null,
        due ? el('span.m' + (over ? '.over' : soon ? '.soon' : ''), icon(over ? 'alert-circle-outline' : 'calendar-outline'), formatDue(due, card.dueHasTime)) : null,
        card.checklist.length ? el('span.m' + (checklistDone === card.checklist.length ? '.done' : ''), icon('list-outline'), `${checklistDone}/${card.checklist.length}`) : null,
        sub.total ? el('span.m', icon('git-branch-outline'), `${sub.done}/${sub.total}`) : null,
        card.comments.length ? el('span.m', icon('chatbubble-outline'), String(card.comments.length)) : null,
        el('span.right',
          (card.checklist.length || sub.total) ? UI.ring(progress) : null,
          assignee ? UI.avatar(assignee) : null)),
      refs.length ? el('div.refs', refs.map(r => r.wb
        ? el('span.chip', { onclick: e => { e.stopPropagation(); App.go(`#/p/${App.project.id}/whiteboard/${encodeURIComponent(r.wb.boardId)}/${encodeURIComponent(r.wb.elementId)}`); } }, icon('easel-outline'), r.wb.name)
        : el('span.chip', { onclick: e => { e.stopPropagation(); App.go(`#/p/${App.project.id}/docs/${encodeURIComponent(r.doc)}`); } }, icon('document-text-outline'), Docs.titleOf(Docs.fileName(r.doc))))) : null);
    if (card.priority !== 'None') node.style.setProperty('--prio', PRIORITY_COLOR[card.priority]);
    node.addEventListener('click', () => { if (!DnD.justDropped) CardEditor.open(card); });
    return node;
  },

  /** Card id -> the whiteboard element that references it (a card is linked to one element only). */
  wbRefs() {
    const map = new Map();
    for (const { data } of App.project.whiteboards()) {
      const walk = (list, top) => { for (const e of list || []) {
        for (const id of e.cardRefs || []) if (!map.has(id)) map.set(id, { boardId: data.id, elementId: (top || e).id, name: data.name });
        walk(e.children, top || e);
      } };
      walk(data.elements);
    }
    return map;
  },

  async addColumn() {
    const name = await UI.prompt('New column', 'Column name');
    if (!name) return;
    App.ops.addColumn(name);
    this.render();
    requestAnimationFrame(() => { const b = this.root.querySelector('.board'); b?.scrollTo({ left: b.scrollWidth, behavior: 'smooth' }); });
  },

  columnMenu(anchor, col) {
    const ops = App.ops, i = App.project.board.columns.indexOf(col), n = App.project.board.columns.length;
    UI.menu(anchor, [
      { header: col.name },
      { label: 'Add card', icon: 'add', onClick: () => CardEditor.open(null, col.id) },
      { label: 'Rename', icon: 'create-outline', onClick: async () => { const v = await UI.prompt('Rename column', 'Column name', col.name); if (v) { ops.renameColumn(col, v); this.render(); } } },
      { label: col.isDone ? 'Not a "done" column' : 'Mark as "done" column', icon: 'checkmark-circle', onClick: () => { col.isDone = !col.isDone; ops.commit(); this.render(); } },
      { label: 'Colors…', icon: 'color-palette-outline', onClick: () => this.columnColors(col) },
      i > 0 ? { label: 'Move left', icon: 'chevron-back', onClick: () => { ops.moveColumn(col, -1); this.render(); } } : null,
      i < n - 1 ? { label: 'Move right', icon: 'chevron-forward', onClick: () => { ops.moveColumn(col, 1); this.render(); } } : null,
      { sep: true },
      { label: 'Delete column', icon: 'trash-outline', danger: true, onClick: async () => {
        if (n <= 1) { UI.alert('A board needs at least one column.'); return; }
        const count = col.cards.length;
        const msg = count === 0 ? `Delete the column '${col.name}'?` : `Delete the column '${col.name}' and its ${count} card(s)?\n\nA backup of the board is created first.`;
        if (!await UI.confirm(msg, 'Delete column', 'Delete', true)) return;
        ops.deleteColumn(col); this.render();
      } }
    ]);
  },

  columnColors(col) {
    const soft = ['#E3F0F4', '#FDF1DC', '#FDECEC', '#E6F4EA', '#EFE6F7', '#E8EAFB', '#F4F6F8', '#16324F', '#17384A', '#3D3018', '#3A1F22', '#173A2B', '#2B2140', '#1F2547', '#263442'];
    const rows = [['Background (light theme)', 'background', soft], ['Title (light theme)', 'titleColor', PALETTE], ['Background (dark theme)', 'backgroundDark', soft], ['Title (dark theme)', 'titleColorDark', [...PALETTE, '#E6EDF3']]];
    const draft = {}; for (const [, k] of rows) draft[k] = col[k] ?? null;
    const s = UI.sheet({ title: `Colors — ${col.name}`, cls: 'mid',
      body: el('div.col', { style: { gap: '.9em' } }, rows.map(([label, key, colors]) => el('div.field', el('label', label), UI.swatches(colors, draft[key], c => draft[key] = c, { allowNone: true })))),
      foot: [el('button.btn.ghost', { onclick: () => s.close() }, 'Cancel'), el('button.btn.primary', { onclick: () => {
        for (const [, k] of rows) { if (draft[k] == null) delete col[k]; else col[k] = draft[k]; }
        // keep the property order of ColumnData: id, name, isDone, colors, cards
        const cards = col.cards; delete col.cards; col.cards = cards;
        App.ops.commit(); s.close(); this.render();
      } }, icon('checkmark'), 'Apply')] });
  }
};

// ------------------------------------------------------------------ drag & drop of the cards (mouse: drag; touch: long press, then drag)

const DnD = {
  justDropped: false,
  attach(boardEl) {
    boardEl.addEventListener('pointerdown', e => {
      const cardEl = e.target.closest('.card');
      if (!cardEl || e.button > 0 || e.target.closest('.chip,button')) return;
      const start = { x: e.clientX, y: e.clientY, id: e.pointerId, type: e.pointerType };
      let timer = 0, dragging = false;
      const cancel = () => { clearTimeout(timer); cleanup(); };
      const move = ev => {
        if (ev.pointerId !== start.id) return;
        const d = Math.hypot(ev.clientX - start.x, ev.clientY - start.y);
        if (!dragging) {
          if (start.type === 'mouse' && d > 6) { dragging = true; this.begin(cardEl, ev, boardEl); }
          else if (start.type !== 'mouse' && d > 10) cancel();
          return;
        }
        this.move(ev);
      };
      const up = ev => { if (ev.pointerId !== start.id) return; clearTimeout(timer); if (dragging) this.end(); cleanup(); };
      const cleanup = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); };
      addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
      if (start.type !== 'mouse') timer = setTimeout(() => { dragging = true; navigator.vibrate?.(12); this.begin(cardEl, e, boardEl); }, 320);
    });
  },
  begin(cardEl, e, boardEl) {
    const stage = UI.stage().getBoundingClientRect();
    const r = cardEl.getBoundingClientRect();
    const ghost = cardEl.cloneNode(true);
    ghost.classList.add('drag-ghost');
    Object.assign(ghost.style, { width: r.width + 'px', left: (r.left - stage.left) + 'px', top: (r.top - stage.top) + 'px', animation: 'none' });
    UI.stage().appendChild(ghost);
    requestAnimationFrame(() => ghost.style.transform = 'rotate(2.5deg) scale(1.04)');
    cardEl.classList.add('placeholder');
    this.s = { cardEl, ghost, boardEl, stage, dx: e.clientX - r.left, dy: e.clientY - r.top, line: el('div.drop-line'), target: null, x: e.clientX, y: e.clientY };
    document.body.classList.add('dragging');
    this.block = ev => ev.preventDefault();
    document.addEventListener('touchmove', this.block, { passive: false });
    this.tick = requestAnimationFrame(() => this.autoscroll());
  },
  move(ev) {
    const s = this.s; if (!s) return;
    s.x = ev.clientX; s.y = ev.clientY;
    s.ghost.style.left = (ev.clientX - s.dx - s.stage.left) + 'px';
    s.ghost.style.top = (ev.clientY - s.dy - s.stage.top) + 'px';
    this.locate();
  },
  locate() {
    const s = this.s;
    s.ghost.style.display = 'none';
    const under = document.elementFromPoint(s.x, s.y);
    s.ghost.style.display = '';
    const colEl = under?.closest('.column[data-id]');
    $$('.column.drop-target', s.boardEl).forEach(c => c !== colEl && c.classList.remove('drop-target'));
    if (!colEl) { s.line.remove(); s.target = null; return; }
    colEl.classList.add('drop-target');
    const list = colEl.querySelector('.cards');
    const cards = $$('.card', list).filter(c => c !== s.cardEl);
    let before = null;
    for (const c of cards) { const r = c.getBoundingClientRect(); if (s.y < r.top + r.height / 2) { before = c; break; } }
    if (before) list.insertBefore(s.line, before); else list.appendChild(s.line);
    s.target = { colId: colEl.dataset.id, beforeId: before?.dataset.id || null };
  },
  autoscroll() {
    const s = this.s; if (!s) return;
    const b = s.boardEl.getBoundingClientRect(), edge = 50;
    if (s.x < b.left + edge) s.boardEl.scrollLeft -= 12; else if (s.x > b.right - edge) s.boardEl.scrollLeft += 12;
    const list = s.target && s.boardEl.querySelector(`.column[data-id="${s.target.colId}"] .cards`);
    if (list) { const r = list.getBoundingClientRect(); if (s.y < r.top + 30) list.scrollTop -= 8; else if (s.y > r.bottom - 30) list.scrollTop += 8; }
    this.locate();
    this.tick = requestAnimationFrame(() => this.autoscroll());
  },
  end() {
    const s = this.s; if (!s) return;
    this.s = null;
    cancelAnimationFrame(this.tick);
    document.removeEventListener('touchmove', this.block);
    document.body.classList.remove('dragging');
    this.justDropped = true; setTimeout(() => this.justDropped = false, 250);
    const ops = App.ops, board = App.project.board;
    const card = ops.index.find(s.cardEl.dataset.id);
    const target = s.target && ops.column(s.target.colId);
    const finish = () => { s.ghost.remove(); s.line.remove(); BoardView.render(); };
    if (!card || !target) {
      const r = s.cardEl.getBoundingClientRect();
      s.ghost.style.transition = 'left .3s, top .3s, transform .3s';
      s.ghost.style.left = (r.left - s.stage.left) + 'px'; s.ghost.style.top = (r.top - s.stage.top) + 'px'; s.ghost.style.transform = 'none';
      setTimeout(finish, 300);
      return;
    }
    let index = target.cards.length;
    if (s.target.beforeId) { const anchor = target.cards.findIndex(c => c.id === s.target.beforeId); if (anchor >= 0) index = anchor; }
    const r = s.line.getBoundingClientRect();
    s.ghost.style.transition = 'left .22s, top .22s, transform .22s, opacity .22s';
    s.ghost.style.left = (r.left - s.stage.left) + 'px'; s.ghost.style.top = (r.top - s.stage.top - 10) + 'px';
    s.ghost.style.transform = 'scale(1)'; s.ghost.style.opacity = '.4';
    const source = ops.columnOf(card);
    setTimeout(() => {
      ops.moveCard(card, target, index);
      finish();
      if (source !== target) UI.toast(`Moved to ${target.name}`, 'swap-horizontal', 1600);
    }, 200);
    void board;
  }
};

// ------------------------------------------------------------------ filter & sort (FilterViewModel)

const FilterSheet = {
  open() {
    const ops = App.ops, board = App.project.board;
    const f = JSON.parse(JSON.stringify(BoardView.filter));
    const toggleIn = (list, v) => { const i = list.indexOf(v); i >= 0 ? list.splice(i, 1) : list.push(v); };
    const chipGroup = (items, list) => {
      const wrap = el('div.pick');
      const render = () => fill(wrap, ...items.map(it => el('button.chip' + (list.includes(it.id) ? '.sel' : ''), { onclick: () => { toggleIn(list, it.id); render(); apply(); } },
        it.color ? el('span.dot', { style: { background: it.color } }) : null, it.avatar || null, it.label)));
      render();
      return wrap;
    };
    const search = el('input.input', { placeholder: 'Search title and description', value: f.search, type: 'search' });
    search.oninput = () => { f.search = search.value; apply(); };
    const due = el('select.input', { onchange: () => { f.due = due.value; apply(); } },
      [['Any', 'Any due date'], ['Overdue', 'Overdue'], ['ThisWeek', 'This week'], ['ThisMonth', 'This month'], ['NoDueDate', 'No due date']].map(([v, l]) => el('option', { value: v, selected: f.due === v }, l)));
    const sort = el('select.input', { onchange: () => { f.sort = sort.value; apply(); } },
      [['Manual', 'Manual order'], ['Priority', 'Priority'], ['Created', 'Creation date'], ['DueDate', 'Due date'], ['Assignee', 'Assignee']].map(([v, l]) => el('option', { value: v, selected: f.sort === v }, l)));
    const apply = () => { BoardView.filter = JSON.parse(JSON.stringify(f)); BoardView.render(); };
    const saved = board.savedFilters;
    const savedRow = el('div.pick');
    const renderSaved = () => fill(savedRow, ...saved.map(sf => el('span.chip', { onclick: () => { BoardView.filter = Filter.fromSaved(sf); BoardView.render(); s.close(); FilterSheet.open(); } }, icon('funnel-outline'), sf.name,
      el('button.btn.icon.ghost', { style: { width: '1.4em', height: '1.4em' }, onclick: async e => { e.stopPropagation(); if (await UI.confirm(`Delete the saved filter '${sf.name}'?`, 'Saved filters', 'Delete', true)) { saved.splice(saved.indexOf(sf), 1); ops.commit(); renderSaved(); } } }, icon('close')))));
    renderSaved();
    const s = UI.sheet({ title: 'Filter & sort', cls: 'tall',
      body: el('div.col', { style: { gap: '.8em' } },
        search,
        el('div.ed', { style: { gridTemplateColumns: '1fr 1fr' } },
          el('div.col', { style: { gap: '.7em' } },
            el('div.field', el('label', 'Assignee'), chipGroup([{ id: '', label: 'Unassigned' }, ...App.project.accounts.accounts.map(a => ({ id: a.id, label: a.username, avatar: UI.avatar(a) }))], f.assigneeIds)),
            el('div.field', el('label', 'Priority'), chipGroup(['Urgent', 'High', 'Medium', 'Low', 'None'].map(p => ({ id: p, label: p, color: PRIORITY_COLOR[p] })), f.priorities)),
            el('div.field', el('label', 'Tags'), chipGroup(board.tags.map(t => ({ id: t.id, label: t.name, color: cssColor(t.color) })), f.tagIds))),
          el('div.col', { style: { gap: '.7em' } },
            el('div.field', el('label', 'Columns'), chipGroup(board.columns.map(c => ({ id: c.id, label: c.name })), f.columnIds)),
            el('div.field', el('label', 'Due date'), due),
            el('div.field', el('label', 'Sort'), el('div.row', sort, el('label.row.small', UI.toggle(f.reverse, v => { f.reverse = v; apply(); }), 'Reverse'))))),
        saved.length ? el('div.field', el('label', 'Saved filters'), savedRow) : null),
      foot: [el('button.btn.ghost', { onclick: () => { BoardView.filter = Filter.empty(); BoardView.render(); s.close(); } }, 'Clear all'),
        el('button.btn', { onclick: async () => {
          const name = await UI.prompt('Save filter', 'Name of the filter');
          if (!name) return;
          const sv = Filter.toSaved(BoardView.filter, name);
          const i = saved.findIndex(x => x.name.toLowerCase() === name.toLowerCase());
          if (i >= 0) { sv.id = saved[i].id; saved[i] = sv; } else saved.push(sv);
          ops.commit(); renderSaved(); UI.toast('Filter saved');
        } }, icon('save-outline'), 'Save filter'),
        el('button.btn.primary', { onclick: () => s.close() }, 'Done')]
    });
  }
};

// ------------------------------------------------------------------ tags (TagManagerViewModel)

const TagManager = {
  open() {
    const board = App.project.board;
    const rows = board.tags.map(t => ({ id: t.id, name: t.name, color: t.color }));
    const list = el('div.col');
    const err = el('div.error');
    const render = () => fill(list, ...rows.map(r => {
      const sw = el('button.swatch', { style: { background: cssColor(r.color, '#888') } });
      sw.onclick = () => UI.menu(sw, PALETTE.map(c => ({ label: c, swatch: c, onClick: () => { r.color = c; render(); } })), { align: 'left' });
      const name = el('input.input', { value: r.name, oninput: () => r.name = name.value });
      return el('div.row', sw, name, el('button.btn.icon.ghost.danger', { onclick: () => { rows.splice(rows.indexOf(r), 1); render(); } }, icon('trash-outline')));
    }));
    render();
    const s = UI.sheet({ title: 'Tags', cls: 'mid', body: el('div.col', list, el('button.btn.small', { style: { alignSelf: 'flex-start' }, onclick: () => { rows.push({ id: uid(), name: 'New tag', color: PALETTE[Math.floor(Math.random() * PALETTE.length)] }); render(); list.lastChild?.querySelector('input')?.select(); } }, icon('add'), 'Add tag'), err),
      foot: [el('button.btn.ghost', { onclick: () => s.close() }, 'Cancel'), el('button.btn.primary', { onclick: async () => {
        if (rows.some(r => !r.name.trim())) { err.textContent = 'Every tag needs a name.'; return; }
        const removed = board.tags.filter(t => !rows.some(r => r.id === t.id));
        if (removed.length) {
          const all = [...board.columns.flatMap(c => c.cards), ...board.archived];
          const ids = new Set(removed.map(r => r.id));
          const used = all.filter(c => c.tagIds.some(id => ids.has(id))).length;
          if (used > 0 && !await UI.confirm(`${removed.length} tag(s) will be deleted and removed from ${used} card(s). Continue?`, 'Delete tags', 'Delete', true)) return;
          for (const c of all) c.tagIds = c.tagIds.filter(id => !ids.has(id));
        }
        board.tags = rows.map(r => ({ id: r.id, name: r.name.trim(), color: r.color }));
        App.ops.commit(); s.close(); App.route();
      } }, icon('checkmark'), 'Save')] });
  }
};

// ------------------------------------------------------------------ archive (ArchiveViewModel)

const ArchiveSheet = {
  open() {
    const ops = App.ops, board = App.project.board;
    const list = el('div.col');
    const render = () => {
      const cards = board.archived.slice().sort((a, b) => (b.archivedAt || '').localeCompare(a.archivedAt || ''));
      fill(list, ...(cards.length ? cards.map(c => el('div.listrow',
        el('div.grow', el('b.ellipsis', c.title), el('div.tiny.muted', `Archived ${formatStamp(parseInstant(c.archivedAt))}  ·  from ${ops.column(c.archivedFromColumnId)?.name || board.columns[0].name}`)),
        el('button.btn.small', { onclick: () => { ops.restoreCard(c); render(); BoardView.render(c.id); UI.toast('Card restored', 'refresh-outline'); } }, icon('refresh-outline'), 'Restore'),
        el('button.btn.small.icon.ghost.danger', { onclick: async () => { if (await UI.confirm(`Permanently delete the archived card '${c.title}'?`, 'Delete card', 'Delete', true)) { ops.deleteCard(c); render(); } } }, icon('trash-outline'))))
        : [UI.empty('archive-outline', 'The archive is empty', 'Archive a card from its editor to hide it from the board.')]));
    };
    render();
    UI.sheet({ title: 'Archive', cls: 'mid tall', body: list });
  }
};

// ------------------------------------------------------------------ project settings (subset of ProjectSettingsDialog)

const ProjectSettings = {
  open() {
    const p = App.project, info = p.info;
    let color = info.color, iconB64 = info.icon || null;
    const name = el('input.input', { value: info.name });
    const desc = el('textarea.input', { rows: 2 }, info.description || '');
    const prev = el('div');
    const upd = () => fill(prev, UI.projectIcon({ name: name.value || '?', color, icon: iconB64 }, 'pi'));
    name.oninput = upd; upd();
    const rm = info.settings.roadmap;
    const opts = { autoEndDate: rm.autoEndDate, showInProgress: rm.showInProgress, showMilestones: rm.showMilestones, showCustom: rm.showCustom, showWeekNumber: rm.showWeekNumber };
    const opt = (key, label, hint) => el('div.row', UI.toggle(opts[key], v => opts[key] = v), el('div.grow', el('div.small', label), hint ? el('div.tiny.muted', hint) : null));
    const members = p.accounts.accounts.map(a => el('div.listrow', UI.avatar(a), el('div.grow', el('b', a.username), el('div.tiny.muted', a.id === info.ownerId ? 'owner' : 'member')),
      a.id !== info.ownerId && a.id !== Accounts.current.id ? el('button.btn.icon.small.ghost.danger', { title: 'Remove from the project', onclick: async e => {
        if (!await UI.confirm(`Remove ${a.username} from the project?`, 'Members', 'Remove', true)) return;
        p.accounts.accounts = p.accounts.accounts.filter(x => x.id !== a.id); p.saveAccounts(); e.target.closest('.listrow').remove();
      } }, icon('remove')) : null));
    const s = UI.sheet({ title: 'Project settings', cls: 'tall',
      body: el('div.ed',
        el('div.col', { style: { gap: '.8em' } },
          el('div.row', { style: { gap: '.9em', alignItems: 'flex-start' } }, prev, el('div.col.grow', el('div.field', el('label', 'Name'), name), el('div.field', el('label', 'Description'), desc))),
          el('div.field', el('label', 'Color'), UI.swatches(PALETTE, color, c => { color = c; upd(); })),
          el('div.row', el('button.btn.small', { onclick: async () => { const f = await UI.pickFile('image/*'); if (f) { iconB64 = await squarePng(f); upd(); } } }, icon('image-outline'), 'Icon…'),
            el('button.btn.small.ghost', { onclick: () => { iconB64 = null; upd(); } }, 'No icon')),
          el('div.field', el('label', 'Members'), el('div.col', members))),
        el('div.col', { style: { gap: '.7em' } },
          el('div.label', 'Roadmap'),
          opt('autoEndDate', 'Set the end date automatically', 'When a card enters a "done" column'),
          opt('showInProgress', 'Show tasks in progress', 'Start + due date: the bar grows up to today'),
          opt('showMilestones', `Show the "${rm.milestonesName}" row`),
          opt('showCustom', `Show the "${rm.customName}" row`),
          opt('showWeekNumber', 'Week numbers in the timeline'),
          el('div.tiny.muted', 'Timer, documentation and milestone types are kept as set in the desktop app.'))),
      foot: [el('button.btn.ghost', { onclick: () => s.close() }, 'Cancel'), el('button.btn.primary', { onclick: () => {
        if (!name.value.trim()) { UI.toast('The project name is required.', 'alert-circle-outline'); return; }
        info.name = name.value.trim(); info.description = desc.value.trim(); info.color = color;
        if (iconB64) info.icon = iconB64; else delete info.icon;
        // keep the property order of ProjectInfo (icon after color)
        const order = ['version', 'id', 'name', 'description', 'color', 'icon', 'createdAt', 'ownerId', 'ownerName', 'settings'];
        const copy = { ...info }; for (const k of Object.keys(info)) delete info[k];
        for (const k of order) if (k in copy) info[k] = copy[k];
        for (const k of Object.keys(copy)) if (!(k in info)) info[k] = copy[k];
        Object.assign(rm, opts);
        p.saveInfo(); s.close(); App.route();
      } }, icon('checkmark'), 'Save')] });
  }
};
