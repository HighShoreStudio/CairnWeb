/* Cairn Web — the rules of the desktop app (Models/*, Services/BoardIndex, FilterViewModel,
 * BoardViewModel, CardEditorViewModel.DescribeChanges, Services/RoadmapLayout, DocsService) in JavaScript.
 * Field names, enum names, activity texts and date formats are the same as in the exe. */
'use strict';

const Model = {
  defaultBoard() {
    return {
      version: 2,
      tags: [
        { id: uid(), name: 'Bug', color: '#E5484D' },
        { id: uid(), name: 'Feature', color: '#30A46C' },
        { id: uid(), name: 'Design', color: '#8E4EC6' }
      ],
      columns: [
        { id: uid(), name: 'TODO', isDone: false, cards: [] },
        { id: uid(), name: 'In Progress', isDone: false, cards: [] },
        { id: uid(), name: 'Done', isDone: true, cards: [] }
      ],
      archived: [],
      savedFilters: []
    };
  },

  defaultMilestoneTypes() {
    return [
      { id: 'major', name: 'Major Release', icon: 'ion:rocket', color: '#E5484D', level: 1 },
      { id: 'minor', name: 'Minor Release', icon: 'ion:cube-outline', color: '#F2A541', level: 1 },
      { id: 'bugfix', name: 'Bug fix', icon: 'ion:bug-outline', color: '#30A46C', level: 1 },
      { id: 'beta', name: 'Internal/Beta', icon: 'ion:flask-outline', color: '#5B5BD6', level: 1 }
    ];
  },

  defaultSettings() {
    return {
      pomodoro: { focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 4, autoStartBreaks: true, autoStartFocus: false, sound: 'Chime', volume: 80, hidden: false },
      docs: { importMode: 'Copy', openInPreview: true },
      roadmap: {
        showMilestones: true, milestonesName: 'Milestones', milestonesColor: '#16324F',
        showCustom: true, customName: 'Custom', customColor: '#5F6B7A',
        showWeekNumber: true, showInProgress: true, autoEndDate: true,
        selectionBackLight: '#16324F', selectionTextLight: '#FFFFFF', selectionBackDark: '#F4F6F8', selectionTextDark: '#0F1720',
        milestoneTypes: Model.defaultMilestoneTypes()
      }
    };
  },

  /** Missing settings get the defaults of the exe (in memory: the file changes only if the project is saved). */
  normalizeSettings(s) {
    const d = Model.defaultSettings();
    s = s && typeof s === 'object' ? s : {};
    for (const k of ['pomodoro', 'docs', 'roadmap']) {
      s[k] = s[k] && typeof s[k] === 'object' ? s[k] : {};
      for (const [key, value] of Object.entries(d[k])) if (!(key in s[k])) s[k][key] = value;
    }
    if (!Array.isArray(s.roadmap.milestoneTypes)) s.roadmap.milestoneTypes = Model.defaultMilestoneTypes();
    return s;
  },

  newProjectInfo(name, description, color, icon, owner) {
    const info = { version: 1, id: uid(), name: name.trim(), description: (description || '').trim(), color: color || '#1F6F8B' };
    if (icon) info.icon = icon;
    Object.assign(info, { createdAt: utcNow(), ownerId: owner.id, ownerName: owner.username, settings: Model.defaultSettings() });
    return info;
  },

  /** ProjectService.Migrate: up to v1.1 a column had one color for both themes. */
  migrateBoard(board) {
    if ((board.version || 0) >= 2) return;
    for (const c of board.columns || []) {
      if (c.backgroundDark == null && c.background != null) c.backgroundDark = c.background;
      if (c.titleColorDark == null && c.titleColor != null) c.titleColorDark = c.titleColor;
    }
    board.version = 2;
  },

  normalizeBoard(board) {
    board.tags ||= []; board.columns ||= []; board.archived ||= []; board.savedFilters ||= [];
    if (!board.columns.length) board.columns.push({ id: uid(), name: 'TODO', isDone: false, cards: [] });
    for (const c of board.columns) { c.cards ||= []; c.cards.forEach(Model.normalizeCard); }
    board.archived.forEach(Model.normalizeCard);
  },
  normalizeCard(c) {
    c.tagIds ||= []; c.checklist ||= []; c.comments ||= []; c.activity ||= [];
    c.priority ||= 'None'; c.title ??= ''; c.description ??= '';
    // Enum names are read case-insensitively by the exe; keep them in the canonical case here.
    const p = PRIORITIES.find(x => x.toLowerCase() === String(c.priority).toLowerCase());
    c.priority = p || (typeof c.priority === 'number' ? PRIORITIES[c.priority] || 'None' : 'None');
  },

  newCard(user, title = '') {
    const now = utcNow();
    return {
      id: uid(), title, description: '', priority: 'None', assigneeId: null, tagIds: [], checklist: [],
      dueDate: null, dueHasTime: false, creatorId: user.id, creatorName: user.username,
      createdAt: now, updatedAt: now, comments: [], activity: [], archivedFromColumnId: null, archivedAt: null
    };
  },

  activity(user, text) { return { at: utcNow(), userId: user.id, userName: user.username, text }; },
  log(card, user, text) { card.activity.push(Model.activity(user, text)); card.updatedAt = utcNow(); },

  dueDate: c => parseWall(c.dueDate),
  /** CardData.DueMoment: end of the day when no time is set. */
  dueMoment(c) {
    const d = parseWall(c.dueDate);
    if (!d) return null;
    return c.dueHasTime ? d : new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
  },
  isOverdue(c, inDone, now = new Date()) { const m = Model.dueMoment(c); return !inDone && m != null && m < now; },
  isDueSoon(c, inDone, now = new Date()) { const m = Model.dueMoment(c); return !Model.isOverdue(c, inDone, now) && !inDone && m != null && m < addDays(now, 2); },

  /** Optional fields the exe omits when they are null / false: removed so the files stay as the exe writes them. */
  tidyCard(c) {
    for (const k of ['parentId', 'endDate', 'startDate', 'finishDate', 'docRefs']) if (c[k] == null) delete c[k];
    if (Array.isArray(c.docRefs) && !c.docRefs.length) delete c.docRefs;
    if (!c.endHasTime) delete c.endHasTime;
  }
};

// ------------------------------------------------------------------ BoardIndex

class BoardIndex {
  constructor(board) {
    this.cards = new Map(); this.columnOf = new Map(); this.children = new Map(); this.progressCache = new Map();
    for (const col of board.columns) for (const card of col.cards) { this.cards.set(card.id, card); this.columnOf.set(card.id, col); }
    for (const card of this.cards.values()) {
      if (!card.parentId || card.parentId === card.id || !this.cards.has(card.parentId)) continue;
      if (!this.children.has(card.parentId)) this.children.set(card.parentId, []);
      this.children.get(card.parentId).push(card);
    }
  }
  find(id) { return id ? this.cards.get(id) || null : null; }
  inDone(id) { return this.columnOf.get(id)?.isDone === true; }
  parentOf(card) { return card.parentId === card.id ? null : this.find(card.parentId); }
  childrenOf(id) { return this.children.get(id) || []; }
  isDescendant(candidateId, ancestorId) {
    let guard = 0, cur = this.find(candidateId);
    while (cur?.parentId && guard++ < 1000) { if (cur.parentId === ancestorId) return true; cur = this.find(cur.parentId); }
    return false;
  }
  canBeChildOf(cardId, parentId) { return cardId !== parentId && !this.isDescendant(parentId, cardId); }
  progress(card, visiting = new Set()) {
    if (this.progressCache.has(card.id)) return this.progressCache.get(card.id);
    if (visiting.has(card.id)) return 0;
    visiting.add(card.id);
    let r;
    if (this.inDone(card.id)) r = 1;
    else {
      const kids = this.childrenOf(card.id);
      const units = card.checklist.length + kids.length;
      if (!units) r = 0;
      else {
        let done = card.checklist.filter(i => i.done).length;
        for (const k of kids) done += this.progress(k, visiting);
        r = done / units;
      }
    }
    visiting.delete(card.id);
    this.progressCache.set(card.id, r);
    return r;
  }
  subtaskCount(id) { const k = this.childrenOf(id); return { done: k.filter(c => this.progress(c) >= 0.999).length, total: k.length }; }
}

// ------------------------------------------------------------------ filters (FilterViewModel)

const Filter = {
  empty() { return { search: '', assigneeIds: [], priorities: [], tagIds: [], columnIds: [], due: 'Any', sort: 'Manual', reverse: false }; },
  isActive(f) { return !!(f.search.trim() || f.assigneeIds.length || f.priorities.length || f.tagIds.length || f.columnIds.length || f.due !== 'Any' || f.sort !== 'Manual'); },
  count(f) { return (f.search.trim() ? 1 : 0) + f.assigneeIds.length + f.priorities.length + f.tagIds.length + f.columnIds.length + (f.due !== 'Any' ? 1 : 0) + (f.sort !== 'Manual' ? 1 : 0); },
  columnVisible(f, id) { return !f.columnIds.length || f.columnIds.includes(id); },
  matches(f, card, inDone, now = new Date()) {
    const search = f.search.trim().toLocaleLowerCase();
    if (search) for (const w of search.split(/\s+/)) {
      if (!card.title.toLocaleLowerCase().includes(w) && !(card.description || '').toLocaleLowerCase().includes(w)) return false;
    }
    if (f.assigneeIds.length && !f.assigneeIds.includes(card.assigneeId ?? '')) return false;
    if (f.priorities.length && !f.priorities.includes(card.priority)) return false;
    if (f.tagIds.length && !f.tagIds.some(t => card.tagIds.includes(t))) return false;
    return Filter.matchesDue(card, f.due, inDone, now);
  },
  matchesDue(card, due, inDone, now) {
    const d = parseWall(card.dueDate);
    switch (due) {
      case 'NoDueDate': return !d;
      case 'Overdue': return Model.isOverdue(card, inDone, now);
      case 'ThisWeek': {
        if (!d) return false;
        const start = startOfDay(addDays(now, -((now.getDay() + 6) % 7)));
        return d >= start && d < addDays(start, 7);
      }
      case 'ThisMonth': return !!d && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
      default: return true;
    }
  },
  sort(f, cards, memberName) {
    if (f.sort === 'Manual') return f.reverse ? cards.slice().reverse() : cards;
    const keyed = cards.map((c, i) => ({ c, i }));
    const cmp = {
      Priority: (a, b) => PRIORITIES.indexOf(b.c.priority) - PRIORITIES.indexOf(a.c.priority),
      Created: (a, b) => (b.c.createdAt || '').localeCompare(a.c.createdAt || ''),
      DueDate: (a, b) => { const x = Model.dueMoment(a.c), y = Model.dueMoment(b.c); return (x ? 0 : 1) - (y ? 0 : 1) || (x && y ? x - y : 0); },
      Assignee: (a, b) => { const x = memberName(a.c.assigneeId), y = memberName(b.c.assigneeId); return (x ? 0 : 1) - (y ? 0 : 1) || (x || '').localeCompare(y || '', undefined, { sensitivity: 'base' }); }
    }[f.sort];
    keyed.sort((a, b) => cmp(a, b) || a.i - b.i);
    const out = keyed.map(k => k.c);
    return f.reverse ? out.reverse() : out;
  },
  toSaved(f, name) {
    return { id: uid(), name, search: f.search, assigneeIds: [...f.assigneeIds], priorities: [...f.priorities], tagIds: [...f.tagIds], columnIds: [...f.columnIds], due: f.due, sort: f.sort, reverse: f.reverse };
  },
  fromSaved(s) {
    return { search: s.search || '', assigneeIds: [...(s.assigneeIds || [])], priorities: (s.priorities || []).map(p => PRIORITIES.find(x => x.toLowerCase() === String(p).toLowerCase()) || p),
      tagIds: [...(s.tagIds || [])], columnIds: [...(s.columnIds || [])], due: s.due || 'Any', sort: s.sort || 'Manual', reverse: !!s.reverse };
  }
};

// ------------------------------------------------------------------ board operations (BoardViewModel)

class BoardOps {
  constructor(project, user) { this.p = project; this.user = user; this.reindex(); }
  get board() { return this.p.board; }
  reindex() { this.index = new BoardIndex(this.p.board); }
  commit() { this.reindex(); this.p.saveBoard(); }
  log(card, text) { Model.log(card, this.user, text); }
  memberName(id) { return this.p.member(id)?.username || (id ? 'unknown user' : null); }
  tag(id) { return this.board.tags.find(t => t.id === id) || null; }
  column(id) { return this.board.columns.find(c => c.id === id) || null; }
  columnOf(card) { return this.board.columns.find(c => c.cards.includes(card)) || null; }

  /** StampEndDate: a card entering a done column without an end date gets now (roadmap option). */
  stampEndDate(card, target) {
    if (!target.isDone || card.endDate != null || !this.p.info.settings.roadmap.autoEndDate) return;
    const now = new Date(); now.setSeconds(0, 0);
    card.endDate = wallString(now); card.endHasTime = true;
    this.log(card, `end date set to ${formatDue(now, true)} (moved to a done column)`);
  }

  moveCard(card, target, index) {
    const source = this.columnOf(card);
    if (!source) return;
    const from = source.cards.indexOf(card);
    source.cards.splice(from, 1);
    if (source === target && index > from) index--;
    index = Math.max(0, Math.min(index ?? target.cards.length, target.cards.length));
    target.cards.splice(index, 0, card);
    if (source !== target) {
      this.log(card, `moved this card from ${source.name} to ${target.name}`);
      this.stampEndDate(card, target);
    }
    this.commit();
  }

  archiveCard(card) {
    const col = this.columnOf(card); if (!col) return;
    col.cards.splice(col.cards.indexOf(card), 1);
    card.archivedFromColumnId = col.id; card.archivedAt = utcNow();
    this.log(card, `archived this card (was in ${col.name})`);
    this.board.archived.push(card);
    this.commit();
  }
  restoreCard(card) {
    const i = this.board.archived.indexOf(card); if (i < 0) return;
    this.board.archived.splice(i, 1);
    const col = this.column(card.archivedFromColumnId) || this.board.columns[0];
    card.archivedFromColumnId = null; card.archivedAt = null;
    this.log(card, `restored this card to ${col.name}`);
    col.cards.push(card);
    this.commit();
  }
  deleteCard(card) {
    this.p.backup();
    const col = this.columnOf(card);
    if (col) col.cards.splice(col.cards.indexOf(card), 1);
    else this.board.archived.splice(this.board.archived.indexOf(card), 1);
    this.clearDanglingParents();
    this.forgetDeletedCards([card.id]);
    this.commit();
  }
  clearDanglingParents() {
    const all = [...this.board.columns.flatMap(c => c.cards), ...this.board.archived];
    const ids = new Set(all.map(c => c.id));
    for (const c of all) if (c.parentId && !ids.has(c.parentId)) delete c.parentId;
  }
  /** Cards deleted for good: whiteboard elements forget them (WhiteboardLinks.UnlinkCardsOnDisk). */
  forgetDeletedCards(ids) {
    const set = new Set(ids);
    for (const { path, data } of this.p.whiteboards()) {
      let changed = false;
      const walk = list => { for (const e of list || []) {
        if (e.cardRefs?.some(id => set.has(id))) { e.cardRefs = e.cardRefs.filter(id => !set.has(id)); if (!e.cardRefs.length) delete e.cardRefs; changed = true; }
        walk(e.children);
      } };
      walk(data.elements);
      if (changed) this.p.setJson(path, data);
    }
  }

  addColumn(name) { this.board.columns.push({ id: uid(), name, isDone: false, cards: [] }); this.commit(); }
  renameColumn(col, name) { col.name = name; this.commit(); }
  deleteColumn(col) {
    if (col.cards.length) this.p.backup();
    const ids = col.cards.map(c => c.id);
    this.board.columns.splice(this.board.columns.indexOf(col), 1);
    this.clearDanglingParents();
    this.forgetDeletedCards(ids);
    this.commit();
  }
  moveColumn(col, delta) {
    const i = this.board.columns.indexOf(col), j = i + delta;
    if (j < 0 || j >= this.board.columns.length) return;
    this.board.columns.splice(i, 1); this.board.columns.splice(j, 0, col);
    this.commit();
  }

  /** CardEditorViewModel.Save + BoardViewModel.EditCard/ApplySubtasks. */
  saveCard(original, draft, opts) {
    const { isNew, columnId, subtaskIds, newSubtasks, pendingActivity } = opts;
    const changes = isNew ? ['created this card'] : this.describeChanges(original, draft);
    for (const t of changes) draft.activity.push(Model.activity(this.user, t));
    draft.activity.push(...pendingActivity);
    if (changes.length || pendingActivity.length) draft.updatedAt = utcNow();
    Model.tidyCard(draft);

    const target = this.column(columnId) || this.columnOf(original) || this.board.columns[0];
    let card = original;
    if (isNew) { card = draft; target.cards.push(card); }
    else {
      for (const k of Object.keys(card)) if (!(k in draft)) delete card[k];
      Object.assign(card, draft);
      const source = this.columnOf(card);
      if (source && source !== target) {
        source.cards.splice(source.cards.indexOf(card), 1);
        target.cards.push(card);
        this.log(card, `moved this card from ${source.name} to ${target.name}`);
        this.stampEndDate(card, target);
      }
    }
    this.reindex();
    this.applySubtasks(card, target, subtaskIds, newSubtasks);
    this.commit();
    return card;
  }

  applySubtasks(parent, column, subtaskIds, newTitles) {
    const index = new BoardIndex(this.board);
    for (const child of index.childrenOf(parent.id).slice()) {
      if (subtaskIds.includes(child.id)) continue;
      delete child.parentId;
      this.log(child, `is no longer a subtask of "${parent.title}"`);
      this.log(parent, `removed the subtask "${child.title}"`);
    }
    for (const id of subtaskIds) {
      const child = index.find(id);
      if (!child || child.parentId === parent.id || !index.canBeChildOf(id, parent.id)) continue;
      child.parentId = parent.id;
      this.log(child, `became a subtask of "${parent.title}"`);
      this.log(parent, `got the subtask "${child.title}"`);
    }
    for (const title of newTitles) {
      const child = Model.newCard(this.user, title);
      child.parentId = parent.id;
      // Same property order as CardData
      const ordered = {}; for (const k of ['id', 'title', 'description', 'priority', 'assigneeId', 'parentId']) ordered[k] = child[k];
      Object.assign(ordered, child);
      this.log(ordered, `created this card as a subtask of "${parent.title}"`);
      column.cards.push(ordered);
      this.log(parent, `got the subtask "${title}"`);
    }
  }

  describeChanges(before, after) {
    const ch = [];
    if (before.title !== after.title) ch.push(`renamed this card from "${before.title}" to "${after.title}"`);
    if ((before.description || '') !== after.description) ch.push(after.description.length === 0 ? 'removed the description' : 'updated the description');
    if (before.priority !== after.priority) ch.push(`changed priority from ${before.priority} to ${after.priority}`);
    if ((before.assigneeId ?? null) !== (after.assigneeId ?? null)) ch.push(after.assigneeId == null ? 'removed the assignee' : `assigned this card to ${this.memberName(after.assigneeId)}`);
    if ((before.parentId ?? null) !== (after.parentId ?? null)) ch.push(after.parentId == null ? 'is no longer a subtask' : `became a subtask of "${this.index.find(after.parentId)?.title ?? ''}"`);
    for (const id of after.tagIds.filter(t => !before.tagIds.includes(t))) ch.push(`added the tag ${this.tag(id)?.name ?? ''}`);
    for (const id of before.tagIds.filter(t => !after.tagIds.includes(t))) { const t = this.tag(id); if (t) ch.push(`removed the tag ${t.name}`); }
    const same = (a, b) => (a ?? null) === (b ?? null) || (a && b && parseWall(a)?.getTime() === parseWall(b)?.getTime());
    if (!same(before.dueDate, after.dueDate) || !!before.dueHasTime !== !!after.dueHasTime)
      ch.push(after.dueDate == null ? 'removed the due date' : `set the due date to ${formatDue(parseWall(after.dueDate), after.dueHasTime)}`);
    if (!same(before.endDate, after.endDate) || !!before.endHasTime !== !!after.endHasTime)
      ch.push(after.endDate == null ? 'removed the end date' : `set the end date to ${formatDue(parseWall(after.endDate), after.endHasTime)}`);
    if (!same(before.startDate, after.startDate)) ch.push(after.startDate == null ? 'removed the start date' : `set the start date to ${formatDue(parseWall(after.startDate), false)}`);
    if (!same(before.finishDate, after.finishDate)) ch.push(after.finishDate == null ? 'removed the finish date' : `set the finish date to ${formatDue(parseWall(after.finishDate), false)}`);
    const oldRefs = before.docRefs || [], newRefs = after.docRefs || [];
    const lower = a => a.map(x => x.toLowerCase());
    for (const p of newRefs.filter(x => !lower(oldRefs).includes(x.toLowerCase()))) ch.push(`linked the document ${Docs.titleOf(Docs.fileName(p))}`);
    for (const p of oldRefs.filter(x => !lower(newRefs).includes(x.toLowerCase()))) ch.push(`removed the link to the document ${Docs.titleOf(Docs.fileName(p))}`);
    const list = c => c.checklist.map(i => `${i.done ? 'True' : 'False'}|${i.text}`).join('\n');
    if (list(before) !== list(after)) ch.push(after.checklist.length === 0 ? 'removed the checklist' : `updated the checklist (${after.checklist.filter(i => i.done).length}/${after.checklist.length} done)`);
    return ch;
  }
}

// ------------------------------------------------------------------ documentation (DocsService)

const Docs = {
  ROOT: 'docs/',
  TEXT: ['.md', '.markdown', '.txt'],
  ext(name) { const d = name.lastIndexOf('.'); return d <= 0 ? '' : name.slice(d).toLowerCase(); },
  isText(name) { return Docs.TEXT.includes(Docs.ext(name)); },
  isRich(name) { return Docs.ext(name) === '.rtf'; },
  isImage(name) { return ['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.tif', '.tiff', '.webp'].includes(Docs.ext(name)); },
  titleOf(name) { return Docs.isText(name) || Docs.isRich(name) ? name.slice(0, name.lastIndexOf('.')) : name; },
  fileName(p) { const s = p.lastIndexOf('/'); return s < 0 ? p : p.slice(s + 1); },
  parent(p) { const s = p.lastIndexOf('/'); return s < 0 ? '' : p.slice(0, s); },
  combine(a, b) { return !a ? b : !b ? a : a + '/' + b; },
  normalize(path) {
    const parts = [];
    for (const part of path.replace(/\\/g, '/').split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') { if (!parts.length) return null; parts.pop(); } else parts.push(part);
    }
    return parts.join('/');
  },
  relativeLink(fromPath, toPath) {
    const from = Docs.parent(fromPath).split('/').filter(Boolean), to = toPath.split('/').filter(Boolean);
    let common = 0;
    while (common < from.length && common < to.length - 1 && from[common].toLowerCase() === to[common].toLowerCase()) common++;
    return '../'.repeat(from.length - common) + to.slice(common).join('/');
  },
  validateName(name) {
    name = (name || '').trim();
    if (!name) return 'The name is required.';
    if (name.length > 120) return 'The name is too long.';
    if (name.startsWith('.')) return 'The name cannot start with a dot.';
    if (/[. ]$/.test(name)) return 'The name cannot end with a dot or a space.';
    if (/[\\/:*?"<>|\x00-\x1f]/.test(name)) return 'The name cannot contain  \\ / : * ? " < > |';
    if (/\.link$/i.test(name)) return 'The name cannot end with .link';
    return null;
  },

  /** The tree of docs/ (folders first, by name). Hidden: .assets, .trash and any dot entry. */
  tree(project) {
    const root = { path: '', name: 'Documentation', kind: 'folder', children: [] };
    const folders = new Map([['', root]]);
    const ensure = path => {
      if (folders.has(path)) return folders.get(path);
      const node = { path, name: Docs.fileName(path), kind: 'folder', children: [] };
      folders.set(path, node);
      ensure(Docs.parent(path)).children.push(node);
      return node;
    };
    for (const full of project.list(Docs.ROOT)) {
      const rel = full.slice(Docs.ROOT.length);
      if (!rel || rel.split('/').some(s => s.startsWith('.'))) continue;
      if (rel.endsWith('/')) { ensure(rel.slice(0, -1)); continue; }
      const parentNode = ensure(Docs.parent(rel));
      const name = Docs.fileName(rel);
      const isLink = /\.link$/i.test(name);
      const shown = isLink ? name.slice(0, -5) : name;
      parentNode.children.push({ path: rel, name: shown, kind: isLink ? 'link' : Docs.isRich(shown) ? 'rich' : Docs.isText(shown) ? 'text' : Docs.isImage(shown) ? 'image' : 'file', isLink, children: [] });
    }
    const sort = n => { n.children.sort((a, b) => ((a.kind === 'folder') ? 0 : 1) - ((b.kind === 'folder') ? 0 : 1) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })); n.children.forEach(sort); };
    sort(root);
    return root;
  },
  files(project) {
    const out = [];
    const walk = n => { for (const c of n.children) c.kind === 'folder' ? walk(c) : out.push(c); };
    walk(Docs.tree(project));
    return out;
  },
  displayPath(node) { return Docs.combine(Docs.parent(node.path), node.name); },

  /** DocIndex.Resolve: wiki links by path or by name (closest first), markdown links relative to the document. */
  index(project) {
    const files = Docs.files(project);
    const byPath = new Map(), byName = new Map();
    const add = (m, k, n) => { k = k.toLowerCase(); if (!m.has(k)) m.set(k, []); if (!m.get(k).includes(n)) m.get(k).push(n); };
    for (const f of files) {
      const dp = Docs.displayPath(f).toLowerCase();
      byPath.set(dp, f);
      const isDoc = f.kind === 'text' || f.kind === 'rich';
      if (isDoc && !byPath.has(Docs.titleOf(Docs.displayPath(f)).toLowerCase())) byPath.set(Docs.titleOf(Docs.displayPath(f)).toLowerCase(), f);
      add(byName, f.name, f);
      if (isDoc) add(byName, Docs.titleOf(f.name), f);
    }
    return {
      files,
      byPath: p => byPath.get(p.toLowerCase()) || null,
      resolve(fromPath, target, isWiki) {
        target = (target || '').trim().replace(/\\/g, '/');
        if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.includes(':')) return null;
        const folder = Docs.parent(fromPath);
        if (isWiki) {
          const clean = target.replace(/^\/+/, '');
          let hit = byPath.get(clean.toLowerCase());
          if (hit) return hit;
          const rel = Docs.normalize(Docs.combine(folder, clean));
          if (rel != null && (hit = byPath.get(rel.toLowerCase()))) return hit;
          if (clean.includes('/')) return null;
          const cands = byName.get(clean.toLowerCase());
          if (!cands) return null;
          return cands.slice().sort((a, b) =>
            (Docs.parent(a.path).toLowerCase() === folder.toLowerCase() ? 0 : 1) - (Docs.parent(b.path).toLowerCase() === folder.toLowerCase() ? 0 : 1) ||
            a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path))[0];
        }
        const path = target.startsWith('/') ? Docs.normalize(target.slice(1)) : Docs.normalize(Docs.combine(folder, target));
        return path != null ? byPath.get(path.toLowerCase()) || null : null;
      }
    };
  },

  /** DocsService.ExtractLinks (code blocks and code spans ignored). */
  extractLinks(text) {
    const links = [];
    if (!text) return links;
    const chars = text.split('');
    let pos = 0, fence = null;
    for (const raw of text.split('\n')) {
      const line = raw.replace(/\r$/, '');
      const start = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (fence) {
        const t = line.trim();
        const closes = t.length >= fence.length && [...t].every(c => c === fence[0]);
        for (let i = 0; i < line.length; i++) chars[pos + i] = ' ';
        if (closes) fence = null;
      } else if (start) {
        fence = start[1];
        for (let i = 0; i < line.length; i++) chars[pos + i] = ' ';
      } else {
        for (const m of line.matchAll(/(`+)(?:(?!\1).)+?\1/g)) for (let i = 0; i < m[0].length; i++) chars[pos + m.index + i] = ' ';
      }
      pos += raw.length + 1;
    }
    const clean = chars.join('');
    for (const m of clean.matchAll(/(!?)\[\[([^\]|\n]+?)(?:\\?\|[^\]\n]*)?\]\]/g)) {
      const raw = m[2].trim(), hash = raw.indexOf('#');
      links.push({ target: hash >= 0 ? raw.slice(0, hash) : raw, isWiki: true, isImage: !!m[1], start: m.index });
    }
    for (const m of clean.matchAll(/(!?)\[(?:[^\]\\\n]|\\.)*\]\(\s*(<[^>\n]*>|[^)\s]+)(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*\)/g)) {
      let t = m[2];
      t = t.length >= 2 && t[0] === '<' && t.endsWith('>') ? t.slice(1, -1) : t.replace(/^</, '');
      if (/^[a-z][a-z0-9+.-]*:/i.test(t) || t.startsWith('#')) continue;
      try { t = decodeURIComponent(t); } catch { }
      const hash = t.indexOf('#');
      links.push({ target: hash >= 0 ? t.slice(0, hash) : t, isWiki: false, isImage: !!m[1], start: m.index });
    }
    return links.filter(l => l.target).sort((a, b) => a.start - b.start);
  },

  uniqueName(project, folder, name) {
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
    const stem = ext ? name.slice(0, -ext.length) : name;
    let cand = name, n = 2;
    const exists = c => { const p = Docs.ROOT + Docs.combine(folder, c); return project.has(p) || project.has(p + '.link') || project.list(p + '/').length > 0; };
    while (exists(cand)) cand = `${stem} ${n++}${ext}`;
    return cand;
  },

  /** Plain text of an RTF file (Services/RtfText.cs, simplified): enough to read it on the phone. */
  rtfToText(rtf) {
    const skip = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'header', 'footer', 'headerl', 'headerr', 'footerl', 'footerr', 'footnote', 'themedata', 'colorschememapping', 'datastore', 'latentstyles', 'generator', 'listtable', 'listoverridetable', 'rsidtbl', 'xmlnstbl', 'mmathPr', 'fldinst', 'filetbl', 'revtbl', 'pgdsctbl', 'listtext', 'pntext', 'bkmkstart', 'bkmkend']);
    let out = '', i = 0, depth = 0, skipDepth = -1, uc = 1, pendingSkip = 0;
    const stack = [];
    while (i < rtf.length) {
      const ch = rtf[i];
      if (ch === '{') { stack.push(uc); depth++; i++; if (rtf.startsWith('\\*', i) && skipDepth < 0) skipDepth = depth; continue; }
      if (ch === '}') { if (depth === skipDepth) skipDepth = -1; depth--; uc = stack.pop() ?? 1; i++; continue; }
      if (ch === '\\') {
        const m = /^\\([a-zA-Z]+)(-?\d+)? ?|^\\'([0-9a-fA-F]{2})|^\\(.)/.exec(rtf.slice(i, i + 40));
        if (!m) { i++; continue; }
        i += m[0].length;
        if (skipDepth >= 0) continue;
        if (m[3]) { if (pendingSkip > 0) { pendingSkip--; continue; } const b = parseInt(m[3], 16); out += b >= 0x80 && b < 0xA0 ? CP1252_HIGH[b - 0x80] : String.fromCharCode(b); continue; }
        if (m[4]) { if (m[4] === '\\' || m[4] === '{' || m[4] === '}') out += m[4]; else if (m[4] === '~') out += ' '; continue; }
        const word = m[1], num = m[2] != null ? +m[2] : null;
        if (skip.has(word)) { skipDepth = depth; continue; }
        if (word === 'par' || word === 'line') out += '\n';
        else if (word === 'tab' || word === 'cell') out += '\t';
        else if (word === 'row') out += '\n';
        else if (word === 'uc') uc = num ?? 1;
        else if (word === 'u') { out += String.fromCharCode(num < 0 ? num + 65536 : num); pendingSkip = uc; }
        else if (word === 'emdash') out += '—'; else if (word === 'endash') out += '–'; else if (word === 'bullet') out += '•';
        else if (word === 'lquote') out += '‘'; else if (word === 'rquote') out += '’'; else if (word === 'ldblquote') out += '“'; else if (word === 'rdblquote') out += '”';
        continue;
      }
      if (ch === '\r' || ch === '\n') { i++; continue; }
      if (skipDepth < 0) { if (pendingSkip > 0) pendingSkip--; else out += ch; }
      i++;
    }
    return out.replace(/\n{3,}/g, '\n\n').trim();
  }
};

// ------------------------------------------------------------------ roadmap (Services/RoadmapLayout.cs)

const Roadmap = {
  emptyData() { return { version: 1, milestones: [], items: [], tagOrder: [], collapsed: [], months: 6 }; },
  day: d => startOfDay(d),
  levelOf(m, settings) { const t = settings.milestoneTypes.find(x => x.id === m.typeId); return Math.min(5, Math.max(1, t?.level ?? 1)); },
  sameDates: (a, b) => +Roadmap.day(a.s) === +Roadmap.day(b.s) && +Roadmap.day(a.e) === +Roadmap.day(b.e),
  overlap: (a, b) => a.s <= b.e && b.s <= a.e,
  covered(level) {
    const unique = [], result = [];
    for (const m of level) { if (unique.some(u => Roadmap.sameDates(u, m))) result.push(m); else unique.push(m); }
    for (const b of unique) {
      const around = unique.filter(x => x !== b && !(x.s >= b.s && x.e <= b.e));
      if (around.filter(a => a.s <= b.s).some(a => around.some(c => c.e >= b.e && Roadmap.overlap(a, c)))) result.push(b);
    }
    return result;
  },
  add(bar, from, to, fill) { if (to > from) bar.segments.push({ from, to, fill }); },
  barStart: b => b.segments.length ? new Date(Math.min(...b.segments.map(s => +s.from))) : null,
  barEnd: b => b.segments.length ? new Date(Math.max(...b.segments.map(s => +s.to))) : null,
  endOf(value, hasTime) { return hasTime ? value : addDays(startOfDay(value), 1); },
  fill(bar, start, due, end, finish, endActsAsFinish) {
    const minimum = addDays(start, 1);
    if (finish) { Roadmap.add(bar, start, finish < minimum ? minimum : finish, 'Outline'); return; }
    if (!end) return;
    let e = end < minimum ? minimum : end;
    if (!due) { Roadmap.add(bar, start, e, endActsAsFinish ? 'Outline' : 'Dark'); return; }
    if (start >= due) { Roadmap.add(bar, due, start, 'Striped'); Roadmap.add(bar, start, e, 'Dark'); }
    else if (e <= due) { Roadmap.add(bar, start, e, 'Dark'); Roadmap.add(bar, e, due, 'Light'); }
    else { Roadmap.add(bar, start, due, 'Dark'); Roadmap.add(bar, due, e, 'Striped'); }
  },
  cardBar(card, inDone, settings, now) {
    const sd = parseWall(card.startDate); if (!sd) return null;
    const start = startOfDay(sd);
    const dd = parseWall(card.dueDate), ed = parseWall(card.endDate), fd = parseWall(card.finishDate);
    const due = dd ? Roadmap.endOf(dd, card.dueHasTime) : null;
    let end = ed ? Roadmap.endOf(ed, card.endHasTime) : null;
    const finish = fd ? addDays(startOfDay(fd), 1) : null;
    const bar = { id: card.id, kind: 'Card', title: card.title, color: '#1F6F8B', segments: [], card };
    if (!finish && !end) {
      if (!settings.showInProgress || !due) return null;
      if (inDone) end = due;
      else if (now <= start) { Roadmap.add(bar, start, due > start ? due : addDays(start, 1), 'Light'); bar.labelFrom = Roadmap.barStart(bar); return bar; }
      else end = now;
    }
    Roadmap.fill(bar, start, due, end, finish, false);
    if (!bar.segments.length) return null;
    bar.labelFrom = Roadmap.barStart(bar);
    return bar;
  },
  itemBar(item, now) {
    const start = startOfDay(parseWall(item.start));
    const due = item.due ? addDays(startOfDay(parseWall(item.due)), 1) : null;
    let end = item.end ? addDays(startOfDay(parseWall(item.end)), 1) : null;
    const bar = { id: item.id, kind: 'Custom', title: item.name, color: '#5F6B7A', segments: [], item };
    if (!end) {
      if (!due) return null;
      if (now <= start) { Roadmap.add(bar, start, due > start ? due : addDays(start, 1), 'Light'); bar.labelFrom = Roadmap.barStart(bar); return bar; }
      end = now;
    }
    Roadmap.fill(bar, start, due, end, null, true);
    if (!bar.segments.length) return null;
    bar.labelFrom = Roadmap.barStart(bar);
    return bar;
  },
  lanes(bars) {
    const lanes = [];
    const sorted = bars.slice().sort((a, b) => Roadmap.barStart(a) - Roadmap.barStart(b) || Roadmap.barEnd(a) - Roadmap.barEnd(b) || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
    for (const bar of sorted) {
      let lane = lanes.find(l => Roadmap.barEnd(l[l.length - 1]) <= Roadmap.barStart(bar));
      if (!lane) lanes.push(lane = []);
      lane.push(bar);
    }
    return lanes;
  },
  milestoneLanes(data, settings) {
    const ms = data.milestones.map(m => ({ m, s: startOfDay(parseWall(m.start)), e: startOfDay(parseWall(m.end)) })).filter(x => x.s && x.e);
    const byLevel = new Map();
    for (const x of ms) { const l = Roadmap.levelOf(x.m, settings); if (!byLevel.has(l)) byLevel.set(l, []); byLevel.get(l).push(x); }
    const lanes = [];
    for (const level of [...byLevel.keys()].sort((a, b) => a - b)) {
      const all = byLevel.get(level).sort((a, b) => a.s - b.s || a.e - b.e);
      const hidden = new Set(Roadmap.covered(all));
      const lane = [];
      let prevColor = null, prevEnd = null;
      for (const x of all.filter(v => !hidden.has(v))) {
        const type = settings.milestoneTypes.find(t => t.id === x.m.typeId);
        const bar = { id: x.m.id, kind: 'Milestone', title: x.m.name, color: type?.color ?? settings.milestonesColor, icon: type?.icon ?? 'ion:flag-outline', segments: [], milestone: x.m, type };
        const from = x.s; let to = addDays(x.e, 1); if (to <= from) to = addDays(from, 1);
        if (prevColor != null && from < prevEnd) {
          const shared = prevEnd < to ? prevEnd : to;
          bar.segments.push({ from, to: shared, fill: 'Mixed', color2: prevColor });
          Roadmap.add(bar, shared, to, 'Dark');
          bar.labelFrom = shared < to ? shared : from;
          const prev = lane[lane.length - 1], last = prev.segments[prev.segments.length - 1];
          if (last.from < from) last.to = from;
          else { prev.segments.pop(); prev.labelFrom = prev.segments.length ? prev.segments[0].from : prev.labelFrom; }
        } else { Roadmap.add(bar, from, to, 'Dark'); bar.labelFrom = from; }
        lane.push(bar);
        prevColor = bar.color; prevEnd = to;
      }
      if (lane.length) lanes.push(lane);
    }
    return lanes;
  },
  orderedTags(board, data) {
    const out = [];
    for (const id of data.tagOrder || []) { const t = board.tags.find(x => x.id === id); if (t && !out.includes(t)) out.push(t); }
    for (const t of board.tags) if (!out.includes(t)) out.push(t);
    return out;
  },
  build(board, data, settings, now = new Date()) {
    const rows = [];
    if (settings.showMilestones) rows.push({ key: 'milestones', kind: 'Milestones', title: settings.milestonesName, color: settings.milestonesColor, lanes: Roadmap.milestoneLanes(data, settings) });
    if (settings.showCustom) {
      const bars = (data.items || []).map(i => Roadmap.itemBar(i, now)).filter(Boolean);
      for (const b of bars) b.color = settings.customColor;
      rows.push({ key: 'custom', kind: 'Custom', title: settings.customName, color: settings.customColor, lanes: Roadmap.lanes(bars) });
    }
    const cards = board.columns.flatMap(c => c.cards.map(card => ({ card, done: c.isDone })));
    for (const tag of Roadmap.orderedTags(board, data)) {
      const bars = [];
      for (const { card, done } of cards.filter(c => c.card.tagIds.includes(tag.id))) {
        const bar = Roadmap.cardBar(card, done, settings, now); if (!bar) continue;
        bar.color = tag.color; bars.push(bar);
      }
      rows.push({ key: tag.id, kind: 'Tag', title: tag.name, color: tag.color, lanes: Roadmap.lanes(bars) });
    }
    const tagIds = new Set(board.tags.map(t => t.id));
    const untagged = [];
    for (const { card, done } of cards.filter(c => !c.card.tagIds.some(t => tagIds.has(t)))) {
      const bar = Roadmap.cardBar(card, done, settings, now); if (!bar) continue;
      bar.color = '#8D8D8D'; untagged.push(bar);
    }
    if (untagged.length) rows.push({ key: 'untagged', kind: 'Untagged', title: 'No tag', color: '#8D8D8D', lanes: Roadmap.lanes(untagged) });
    for (const r of rows) r.collapsed = (data.collapsed || []).includes(r.key);
    return rows;
  }
};

// ------------------------------------------------------------------ whiteboard geometry (Services/WhiteboardOps.cs)

const Wb = {
  rotate(v, deg) { const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return { x: v.x * c - v.y * s, y: v.x * s + v.y * c }; },
  center: e => ({ x: e.x + e.width / 2, y: e.y + e.height / 2 }),
  toWorld(e, local) { const c = Wb.center(e), r = Wb.rotate(local, e.rotation || 0); return { x: c.x + r.x, y: c.y + r.y }; },
  toLocal(e, world) { const c = Wb.center(e); return Wb.rotate({ x: world.x - c.x, y: world.y - c.y }, -(e.rotation || 0)); },
  bounds(e) {
    const hw = e.width / 2, hh = e.height / 2;
    const pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => Wb.toWorld(e, { x, y }));
    return { x1: Math.min(...pts.map(p => p.x)), y1: Math.min(...pts.map(p => p.y)), x2: Math.max(...pts.map(p => p.x)), y2: Math.max(...pts.map(p => p.y)) };
  },
  edgePoint(e, toward) {
    const d = Wb.toLocal(e, toward);
    const hw = Math.max(e.width / 2, .5), hh = Math.max(e.height / 2, .5);
    if (Math.abs(d.x) < 1e-9 && Math.abs(d.y) < 1e-9) return Wb.center(e);
    let t;
    if (Wb.kind(e) === 'Ellipse') t = 1 / Math.sqrt(d.x * d.x / (hw * hw) + d.y * d.y / (hh * hh));
    else t = Math.min(Math.abs(d.x) < 1e-9 ? Infinity : hw / Math.abs(d.x), Math.abs(d.y) < 1e-9 ? Infinity : hh / Math.abs(d.y));
    return Wb.toWorld(e, { x: d.x * t, y: d.y * t });
  },
  /** Enum names are written as strings; very old files might hold numbers. */
  kind(e) {
    const kinds = ['Text', 'Stroke', 'Line', 'Polyline', 'Rectangle', 'Ellipse', 'Triangle', 'Polygon', 'Image', 'Group'];
    if (typeof e.kind === 'number') return kinds[e.kind] || 'Rectangle';
    return kinds.find(k => k.toLowerCase() === String(e.kind).toLowerCase()) || 'Rectangle';
  },
  points(str) {
    if (!str) return [];
    if (Array.isArray(str)) return str.map(p => ({ x: p.x ?? p.X, y: p.y ?? p.Y }));
    return str.trim().split(/\s+/).map(pair => pair.split(',').map(Number)).filter(p => p.length === 2 && !p.some(isNaN)).map(([x, y]) => ({ x, y }));
  }
};
