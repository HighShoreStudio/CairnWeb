/* Cairn Web — the card editor (CardDialog + CardEditorViewModel): works on a draft, applied on Save. */
'use strict';

const CardEditor = {
  open(card, columnId) {
    const p = App.project, ops = App.ops, me = Accounts.current, board = p.board;
    const isNew = !card;
    const original = card || Model.newCard(me);
    const draft = JSON.parse(JSON.stringify(original));
    const col0 = isNew ? (ops.column(columnId) || board.columns[0]) : ops.columnOf(original);
    const state = {
      columnId: col0?.id || board.columns[0].id,
      subtaskIds: isNew ? [] : ops.index.childrenOf(original.id).map(c => c.id),
      newSubtasks: [],
      pendingActivity: [],
      dirty: false
    };
    const touch = () => { state.dirty = true; };

    // ---------------------------------------------------------- left: title, description, checklist, subtasks, comments
    const title = UI.autoGrow(el('textarea.input.title-in', { rows: 1, placeholder: 'Card title', oninput: () => { draft.title = title.value; touch(); } }, draft.title), 160);
    const desc = UI.autoGrow(el('textarea.input', { rows: 3, placeholder: 'Description', oninput: () => { draft.description = desc.value; touch(); } }, draft.description || ''), 300);

    const progress = el('div.progressbar', el('div'));
    const checkList = el('div.col', { style: { gap: '.1em' } });
    const renderChecklist = () => {
      const done = draft.checklist.filter(i => i.done).length;
      progress.firstChild.style.width = draft.checklist.length ? (100 * done / draft.checklist.length) + '%' : '0';
      progress.style.display = draft.checklist.length ? '' : 'none';
      checkHead.lastChild.textContent = draft.checklist.length ? `${done}/${draft.checklist.length}` : '';
      fill(checkList, ...draft.checklist.map(item => {
        const box = el('button.cbox' + (item.done ? '.on' : ''), { onclick: () => { item.done = !item.done; touch(); renderChecklist(); } }, icon('checkmark'));
        const txt = el('input', { type: 'text', value: item.text, oninput: () => { item.text = txt.value; touch(); } });
        return el('div.check' + (item.done ? '.done' : ''), box, txt,
          el('button.btn.icon.small.ghost', { onclick: () => { draft.checklist.splice(draft.checklist.indexOf(item), 1); touch(); renderChecklist(); } }, icon('close')));
      }));
    };
    const newItem = el('input.input', { placeholder: 'Add an item', enterkeyhint: 'enter' });
    const addItem = () => { const t = newItem.value.trim(); if (!t) return; draft.checklist.push({ id: uid(), text: t, done: false }); newItem.value = ''; touch(); renderChecklist(); };
    newItem.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } };
    const checkHead = el('h4', icon('list-outline'), 'Checklist', el('span.muted', ''));

    const subList = el('div.col', { style: { gap: '.3em' } });
    const renderSubs = () => {
      const rows = state.subtaskIds.map(id => ops.index.find(id)).filter(Boolean).map(c => el('div.listrow', icon('git-branch-outline'), el('span.grow.ellipsis', c.title),
        el('span.tiny.muted', ops.columnOf(c)?.name || ''),
        el('button.btn.icon.small.ghost', { title: 'Remove subtask', onclick: () => { state.subtaskIds = state.subtaskIds.filter(x => x !== c.id); touch(); renderSubs(); } }, icon('close'))));
      const fresh = state.newSubtasks.map((t, i) => el('div.listrow', icon('add-circle-outline'), el('span.grow.ellipsis', t), el('span.tiny.muted', 'new'),
        el('button.btn.icon.small.ghost', { onclick: () => { state.newSubtasks.splice(i, 1); renderSubs(); } }, icon('close'))));
      fill(subList, ...rows, ...fresh);
    };
    const newSub = el('input.input', { placeholder: 'New subtask', enterkeyhint: 'enter' });
    const addSub = () => { const t = newSub.value.trim(); if (!t) return; state.newSubtasks.push(t); newSub.value = ''; touch(); renderSubs(); };
    newSub.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); addSub(); } };
    const pickSub = () => {
      const candidates = ops.index ? [...ops.index.cards.values()].filter(c => c.id !== original.id && !state.subtaskIds.includes(c.id) && c.id !== parentSel.value &&
        (isNew || ops.index.canBeChildOf(c.id, original.id))) : [];
      ItemPicker.open('Add existing card as subtask', candidates.map(c => ({ id: c.id, label: c.title, hint: ops.columnOf(c)?.name })), id => { state.subtaskIds.push(id); touch(); renderSubs(); });
    };

    const comments = el('div.col');
    const renderComments = () => {
      fill(comments, ...draft.comments.map(c => el('div.comment',
        el('div.who', UI.avatar(p.member(c.authorId) || { username: c.authorName, avatarColor: '#8D8D8D' }), el('b', c.authorName), el('span', formatStamp(parseInstant(c.createdAt))),
          (c.authorId === me.id || original.creatorId === me.id) ? el('button.btn.icon.small.ghost', { style: { marginLeft: 'auto' }, onclick: async () => {
            if (!await UI.confirm('Delete this comment?', 'Delete comment', 'Delete', true)) return;
            draft.comments.splice(draft.comments.indexOf(c), 1);
            state.pendingActivity.push(Model.activity(me, `deleted a comment by ${c.authorName}`)); touch(); renderComments();
          } }, icon('trash-outline')) : null),
        el('div.txt', c.text))));
      commentsHead.lastChild.textContent = draft.comments.length ? String(draft.comments.length) : '';
    };
    const newComment = UI.autoGrow(el('textarea.input', { rows: 1, placeholder: 'Write a comment…' }), 160);
    const postComment = () => {
      const t = newComment.value.trim(); if (!t) return;
      draft.comments.push({ id: uid(), authorId: me.id, authorName: me.username, createdAt: utcNow(), text: t });
      state.pendingActivity.push(Model.activity(me, 'added a comment'));
      newComment.value = ''; newComment.dispatchEvent(new Event('input')); touch(); renderComments();
    };
    const commentsHead = el('h4', icon('chatbubble-outline'), 'Comments', el('span.muted', ''));

    const activity = el('div.activity');
    const actEntries = original.activity.slice().reverse();
    let actOpen = false;
    const renderActivity = () => fill(activity, ...(actOpen ? actEntries : actEntries.slice(0, 3)).map(a => el('div', el('b', a.userName), ' ', a.text, el('span', ' · ' + relTime(parseInstant(a.at))))),
      actEntries.length > 3 ? el('button.btn.ghost.small', { style: { alignSelf: 'flex-start' }, onclick: () => { actOpen = !actOpen; renderActivity(); } }, actOpen ? 'Show less' : `Show all (${actEntries.length})`) : null);

    // ---------------------------------------------------------- right: properties
    const colSel = el('select.input', { onchange: () => { state.columnId = colSel.value; touch(); } }, board.columns.map(c => el('option', { value: c.id, selected: c.id === state.columnId }, c.name)));
    const prio = el('div.pick');
    const renderPrio = () => fill(prio, ...PRIORITIES.map(pr => el('button.chip' + (draft.priority === pr ? '.sel' : ''), { onclick: () => { draft.priority = pr; touch(); renderPrio(); } },
      el('span.dot', { style: { background: PRIORITY_COLOR[pr] } }), pr)));
    const assignee = el('select.input', { onchange: () => { draft.assigneeId = assignee.value || null; touch(); } },
      el('option', { value: '' }, 'Unassigned'), p.accounts.accounts.map(a => el('option', { value: a.id, selected: a.id === draft.assigneeId }, a.username)));
    const tags = el('div.pick');
    const renderTags = () => fill(tags, ...board.tags.map(t => el('button.chip' + (draft.tagIds.includes(t.id) ? '.sel' : ''), {
      style: draft.tagIds.includes(t.id) ? { background: cssColor(t.color), color: readableOn(t.color), outlineColor: cssColor(t.color) } : {},
      onclick: () => { const i = draft.tagIds.indexOf(t.id); i >= 0 ? draft.tagIds.splice(i, 1) : draft.tagIds.push(t.id); touch(); renderTags(); }
    }, el('span.dot', { style: { background: cssColor(t.color) } }), t.name)), board.tags.length ? null : el('span.tiny.muted', 'No tags: create them from the ⋯ menu.'));

    const dateRow = (label, key, withTime) => {
      const d = parseWall(draft[key]);
      const di = el('input.input', { type: 'date', value: toDateInput(d), oninput: touch });
      const ti = withTime ? el('input.input', { type: 'time', oninput: touch }) : null;
      const hasTimeKey = key === 'dueDate' ? 'dueHasTime' : key === 'endDate' ? 'endHasTime' : null;
      if (ti && hasTimeKey) ti.value = d && draft[hasTimeKey] ? toTimeInput(d) : '';
      const clear = el('button.btn.icon.small.ghost', { title: 'Clear', onclick: () => { di.value = ''; if (ti) ti.value = ''; touch(); } }, icon('close'));
      const field = el('div.field.full', el('label', label), el('div.datepair', di, ti, clear));
      field.read = () => {
        const date = fromDateInput(di.value);
        if (!date) return { value: null, hasTime: false };
        const orig = parseWall(original[key]);
        let hasTime = false;
        if (ti && ti.value) { const [h, m] = ti.value.split(':').map(Number); date.setHours(h, m, 0, 0); hasTime = true; }
        // unchanged: keep the exact string of the file
        if (orig && original[key] && +orig === +date && (!hasTimeKey || !!original[hasTimeKey] === hasTime)) return { value: original[key], hasTime };
        return { value: withTime ? wallString(date) : dateOnlyString(date), hasTime };
      };
      return field;
    };
    const dueF = dateRow('Due', 'dueDate', true), endF = dateRow('End', 'endDate', true);
    const startF = dateRow('Start', 'startDate', false), finishF = dateRow('Finish', 'finishDate', false);

    const parentCandidates = [...ops.index.cards.values()].filter(c => c.id !== original.id && (isNew || ops.index.canBeChildOf(original.id, c.id)));
    const parentSel = el('select.input', { onchange: touch }, el('option', { value: '' }, '— none —'),
      parentCandidates.map(c => el('option', { value: c.id, selected: c.id === draft.parentId }, c.title)));

    const refs = el('div.col', { style: { gap: '.3em' } });
    draft.docRefs = draft.docRefs ? [...draft.docRefs] : [];
    const renderRefs = () => fill(refs, ...draft.docRefs.map(path => el('div.listrow', icon('document-text-outline'),
      el('button.btn.ghost.small.grow', { style: { justifyContent: 'flex-start', color: 'var(--link)' }, onclick: () => nav(`#/p/${p.id}/docs/${encodeURIComponent(path)}`) }, el('span.ellipsis', Docs.titleOf(Docs.fileName(path)))),
      el('button.btn.icon.small.ghost', { onclick: () => { draft.docRefs.splice(draft.docRefs.indexOf(path), 1); touch(); renderRefs(); } }, icon('close')))));
    const addRef = () => {
      const files = Docs.files(p).filter(f => !draft.docRefs.some(r => r.toLowerCase() === Docs.displayPath(f).toLowerCase()));
      ItemPicker.open('Link a document', files.map(f => ({ id: Docs.displayPath(f), label: Docs.titleOf(f.name), hint: Docs.parent(f.path) || 'docs' })), id => { draft.docRefs.push(id); touch(); renderRefs(); });
    };
    const nav = async hash => { await s.entry.close(); if (s.entry.closed) App.go(hash); };
    const wbRef = isNew ? null : BoardView.wbRefs().get(original.id);

    const created = isNew ? null : el('div.tiny.muted', `Created by ${original.creatorName || '?'} on ${formatStamp(parseInstant(original.createdAt))}  ·  Last modified ${formatStamp(parseInstant(original.updatedAt))}`);
    const err = el('div.error');

    const body = el('div.ed',
      el('div.col', { style: { gap: '.7em' } },
        title, desc,
        el('div.section', checkHead, progress, checkList, el('div.row', newItem, el('button.btn.icon', { onclick: addItem }, icon('add')))),
        el('div.section', el('h4', icon('git-branch-outline'), 'Subtasks'), subList,
          el('div.row', newSub, el('button.btn.icon', { onclick: addSub, title: 'New subtask' }, icon('add')), el('button.btn.small', { onclick: pickSub }, icon('link-outline'), 'Existing'))),
        el('div.section', commentsHead, comments, el('div.row', { style: { alignItems: 'flex-end' } }, newComment, el('button.btn.primary.icon', { onclick: postComment, title: 'Post' }, icon('arrow-redo-outline')))),
        !isNew && actEntries.length ? el('div.section', el('h4', icon('time-outline'), 'Activity'), activity) : null),
      el('div.props',
        el('div.field', el('label', 'Column'), colSel),
        el('div.field', el('label', 'Assignee'), assignee),
        el('div.field.full', el('label', 'Priority'), prio),
        el('div.field.full', el('label', 'Tags'), tags),
        dueF, endF,
        el('div.field.full', el('label', 'Parent task'), parentSel),
        el('div.full.label', { style: { marginTop: '.3em' } }, 'Roadmap'),
        startF, finishF,
        el('div.field.full', el('label', 'References'), wbRef ? el('div.listrow', icon('easel-outline'),
          el('button.btn.ghost.small.grow', { style: { justifyContent: 'flex-start', color: 'var(--link)' }, onclick: () => nav(`#/p/${p.id}/whiteboard/${encodeURIComponent(wbRef.boardId)}/${encodeURIComponent(wbRef.elementId)}`) }, el('span.ellipsis', 'Whiteboard: ' + wbRef.name))) : null,
          refs, el('button.btn.small', { style: { alignSelf: 'flex-start' }, onclick: addRef }, icon('add'), 'Link document')),
        el('div.full', created), el('div.full', err)));

    const save = () => {
      err.textContent = '';
      draft.title = title.value.trim();
      if (!draft.title) { err.textContent = 'The title is required.'; title.focus(); return; }
      const due = dueF.read(), end = endF.read(), start = startF.read(), finish = finishF.read();
      const sd = parseWall(start.value), fd = parseWall(finish.value), ed = parseWall(end.value);
      if (sd && fd && startOfDay(fd) < startOfDay(sd)) { err.textContent = 'The finish date cannot be before the start date.'; return; }
      if (sd && ed && startOfDay(ed) < startOfDay(sd)) { err.textContent = 'The end date cannot be before the start date.'; return; }
      const parentId = parentSel.value || null;
      if (parentId && state.subtaskIds.some(id => id === parentId || ops.index.isDescendant(parentId, id))) { err.textContent = 'A card cannot be the parent task and, at the same time, one of the subtasks.'; return; }
      if (newSub.value.trim()) addSub();
      if (newComment.value.trim()) postComment();
      if (newItem.value.trim()) addItem();
      draft.description = desc.value;
      draft.checklist = draft.checklist.filter(i => i.text.trim() || i.done);
      draft.parentId = parentId;
      draft.dueDate = due.value; draft.dueHasTime = due.hasTime;
      draft.endDate = end.value; draft.endHasTime = end.hasTime;
      draft.startDate = start.value; draft.finishDate = finish.value;
      if (!draft.docRefs.length) draft.docRefs = null;
      // CardData property order
      const order = ['id', 'title', 'description', 'priority', 'assigneeId', 'parentId', 'tagIds', 'checklist', 'dueDate', 'dueHasTime', 'endDate', 'endHasTime', 'startDate', 'finishDate', 'docRefs', 'creatorId', 'creatorName', 'createdAt', 'updatedAt', 'comments', 'activity', 'archivedFromColumnId', 'archivedAt'];
      const ordered = {}; for (const k of order) if (k in draft) ordered[k] = draft[k];
      for (const k of Object.keys(draft)) if (!(k in ordered)) ordered[k] = draft[k];
      const saved = ops.saveCard(original, ordered, { isNew, columnId: state.columnId, subtaskIds: state.subtaskIds, newSubtasks: state.newSubtasks, pendingActivity: state.pendingActivity });
      state.dirty = false;
      s.close();
      BoardView.render(saved.id);
      if (App.tab === 'roadmap') RoadmapView.render();
      UI.toast(isNew ? 'Card created' : 'Card saved');
    };

    const headButtons = isNew ? [] : [
      el('button.btn.icon.ghost', { title: 'Archive', onclick: async () => {
        if (state.dirty && !await UI.confirm('Discard the changes made to this card and archive it?', 'Archive card', 'Archive')) return;
        state.dirty = false; ops.archiveCard(original); s.close(); BoardView.render(); UI.toast('Card archived', 'archive-outline');
      } }, icon('archive-outline')),
      el('button.btn.icon.ghost.danger', { title: 'Delete', onclick: async () => {
        if (!await UI.confirm(`Permanently delete the card '${original.title}'?\n\nA backup of the board is created first. Use Archive to hide a card without deleting it.`, 'Delete card', 'Delete', true)) return;
        state.dirty = false; ops.deleteCard(original); s.close(); BoardView.render(); UI.toast('Card deleted', 'trash-outline');
      } }, icon('trash-outline'))];

    const s = UI.sheet({
      title: isNew ? 'New card' : (ops.columnOf(original)?.name || 'Card'), cls: 'tall', head: headButtons, body,
      foot: [el('button.btn.ghost', { onclick: () => s.close() }, 'Cancel'), el('button.btn.primary', { onclick: save }, icon('checkmark'), 'Save')],
      dismissable: true
    });
    // Unsaved changes: ask before closing (ConfirmDiscard).
    const realClose = s.entry.close;
    s.entry.close = async r => {
      if (state.dirty || newComment.value.trim()) {
        if (!await UI.confirm('Discard the changes made to this card?', 'Unsaved changes', 'Discard', true)) return;
      }
      realClose(r);
    };
    s.close = r => s.entry.close(r);
    renderChecklist(); renderSubs(); renderComments(); renderActivity(); renderPrio(); renderTags(); renderRefs();
    if (isNew) setTimeout(() => title.focus(), 450);
  }
};

/** A searchable list to pick one item (ItemPickerDialog / DocPickerDialog). */
const ItemPicker = {
  open(title, items, onPick) {
    const search = el('input.input', { type: 'search', placeholder: 'Search' });
    const list = el('div.col', { style: { gap: '.3em' } });
    const render = () => {
      const q = search.value.trim().toLowerCase();
      const shown = items.filter(i => !q || i.label.toLowerCase().includes(q) || (i.hint || '').toLowerCase().includes(q));
      fill(list, ...(shown.length ? shown.map(i => el('button.listrow', { style: { border: 0, textAlign: 'left', cursor: 'pointer' }, onclick: () => { s.close(); onPick(i.id); } },
        el('span.grow.ellipsis', i.label), i.hint ? el('span.tiny.muted', i.hint) : null)) : [el('div.small.muted', 'Nothing to choose.')]));
    };
    search.oninput = render;
    render();
    const s = UI.sheet({ title, cls: 'narrow tall', body: el('div.col', search, list) });
    setTimeout(() => search.focus(), 400);
  }
};
