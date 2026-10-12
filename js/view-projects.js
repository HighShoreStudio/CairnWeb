/* Cairn Web — project list (ProjectListView). */
'use strict';

const ProjectsView = {
  async show() {
    const metas = await Store.listProjects();
    UI.swap(v => {
      const me = Accounts.current;
      v.appendChild(el('header.topbar.glass',
        el('div.left', el('img', { src: 'assets/icon.png', alt: '', style: { width: '2em', height: '2em', borderRadius: '.6em' } }), el('span.title', 'Cairn'), el('span.small.muted', 'Projects')),
        el('div.right',
          el('button.btn', { onclick: async () => { const info = await App.importZip(await UI.pickFile('.zip,application/zip')); if (info) ProjectsView.show(); } }, icon('download-outline'), el('span', 'Import')),
          el('button.btn.icon', { title: 'Help', onclick: () => ProjectsView.help() }, icon('information-circle-outline')),
          AccountMenu.button(me))));
      const grid = el('div.plist.scroll');
      grid.appendChild(el('div.ptile.glass.new', { onclick: () => ProjectsView.create(), style: { animationDelay: '0ms' } }, icon('add', 'big'), 'New project'));
      metas.forEach((m, i) => grid.appendChild(ProjectsView.tile(m, i)));
      if (!metas.length) grid.appendChild(el('div.ptile.glass', { style: { animationDelay: '60ms', cursor: 'default' } },
        el('h3', 'No projects yet'),
        el('div.desc', 'Create one here, or export a project from the desktop app (compress its folder to a .zip) and import it.'),
        el('div.meta', el('button.btn.small', { onclick: async () => { const info = await App.importZip(await UI.pickFile('.zip,application/zip')); if (info) ProjectsView.show(); } }, icon('download-outline'), 'Import .zip'))));
      v.appendChild(el('div.content', grid));
    });
  },

  tile(m, i) {
    const more = el('button.btn.icon.small.ghost.more', { onclick: e => { e.stopPropagation(); ProjectsView.tileMenu(more, m); } }, icon('ellipsis-horizontal'));
    const when = m.exportedAt ? `exported ${relTime(parseInstant(m.exportedAt))}` : m.importedAt ? `imported ${relTime(parseInstant(m.importedAt))}` : '';
    const t = el('div.ptile.glass', { style: { animationDelay: (i + 1) * 50 + 'ms' }, onclick: () => App.go('#/p/' + m.id + '/board') },
      more, UI.projectIcon(m, 'pi'), el('h3.ellipsis', m.name), el('div.desc', m.description || ''),
      el('div.meta', `${m.columns} columns · ${m.cards} cards · ${m.members} members`, when ? el('div', when) : null));
    UI.longPress(t, () => ProjectsView.tileMenu(more, m));
    return t;
  },

  tileMenu(anchor, m) {
    UI.menu(anchor, [
      { label: 'Open', icon: 'open-outline', onClick: () => App.go('#/p/' + m.id + '/board') },
      { label: 'Export .zip', icon: 'share-outline', onClick: () => App.exportProject(m.id) },
      { sep: true },
      { label: 'Remove from this device', icon: 'trash-outline', danger: true, onClick: async () => {
        if (!await UI.confirm(`Remove "${m.name}" from this browser?\n\nOnly the copy on this device is deleted. Export it first if it has changes you want to keep.`, 'Remove project', 'Remove', true)) return;
        await Store.deleteProject(m.id);
        UI.toast('Project removed', 'trash-outline');
        ProjectsView.show();
      } }
    ]);
  },

  create() {
    let color = '#1F6F8B', iconB64 = null;
    const name = el('input.input', { placeholder: 'Project name', enterkeyhint: 'next' });
    const desc = el('textarea.input', { placeholder: 'Description (optional)', rows: 2 });
    const err = el('div.error');
    const preview = el('div', { style: { width: '3.2em', height: '3.2em' } });
    const upd = () => fill(preview, UI.projectIcon({ name: name.value || '?', color, icon: iconB64 }, 'pi'));
    name.oninput = upd; upd();
    const s = UI.sheet({
      title: 'New project', cls: 'mid',
      body: el('div.col', { style: { gap: '.8em' } },
        el('div.row', { style: { alignItems: 'flex-start', gap: '.9em' } }, preview, el('div.col.grow', name, desc)),
        el('div.field', el('label', 'Color'), UI.swatches(PALETTE, color, c => { color = c; upd(); })),
        el('div.row', el('button.btn.small', { onclick: async () => { const f = await UI.pickFile('image/*'); if (f) { iconB64 = await squarePng(f); upd(); } } }, icon('image-outline'), 'Icon…'),
          el('button.btn.small.ghost', { onclick: () => { iconB64 = null; upd(); } }, 'No icon')),
        err),
      foot: [el('button.btn.ghost', { onclick: () => s.close() }, 'Cancel'), el('button.btn.primary', { onclick: async () => {
        if (!name.value.trim()) { err.textContent = 'The project name is required.'; return; }
        const id = await createProject(name.value, desc.value, color, iconB64, Accounts.current);
        s.close();
        App.go('#/p/' + id + '/board');
      } }, icon('checkmark'), 'Create')]
    });
    setTimeout(() => name.focus(), 400);
  },

  help() {
    const step = (n, t, d) => el('div.row', { style: { alignItems: 'flex-start', gap: '.7em' } }, el('span.chip', { style: { background: 'var(--primary)', color: '#fff' } }, n), el('div', el('b', t), el('div.small.muted', d)));
    UI.sheet({
      title: 'Phone ⇄ PC', cls: 'mid',
      body: el('div.col', { style: { gap: '.9em' } },
        el('div.label', 'From the PC to the phone'),
        step('1', 'Export it from the desktop app', 'Cairn 1.4: select the project in the list → Export .zip… (or compress the project folder: Send to → Compressed folder).'),
        step('2', 'Import it here', 'Projects → Import, pick the zip. Sign in with the same account and password you use in the desktop app.'),
        el('div.label', 'From the phone to the PC'),
        step('1', 'Export the project', 'Project menu → Export .zip. On iPhone the share sheet opens: save it to Files, AirDrop it, or send it to yourself.'),
        step('2', 'Import it in the desktop app', 'Cairn 1.4: Import .zip… in the project list. Yes updates the project already on the PC (what it replaces is kept in backups/replaced-…), No imports a copy.'),
        el('div.small.muted', 'Projects are stored only in this browser. Every file the web version does not edit is kept exactly as it was.'))
    });
  }
};

/** Account button + menu (also used in the project header). */
const AccountMenu = {
  button(me) {
    const b = el('button.btn.icon', { title: me.username, style: { padding: 0 } }, UI.avatar(me));
    b.onclick = () => AccountMenu.open(b);
    return b;
  },
  open(anchor) {
    const mode = UI.theme();
    UI.menu(anchor, [
      { header: Accounts.current.username },
      { label: 'Automatic theme', icon: 'contrast-outline', checked: mode === 'auto', onClick: () => UI.setTheme('auto') },
      { label: 'Light', icon: 'sunny-outline', checked: mode === 'light', onClick: () => UI.setTheme('light') },
      { label: 'Dark', icon: 'moon-outline', checked: mode === 'dark', onClick: () => UI.setTheme('dark') },
      { sep: true },
      { label: 'Profile…', icon: 'person-outline', onClick: () => AccountMenu.profile() },
      { label: 'Fullscreen', icon: 'expand-outline', onClick: () => AccountMenu.fullscreen() },
      { label: 'Sign out', icon: 'log-out-outline', onClick: async () => { await App.closeProject(); await Accounts.logout(); App.go('#/', true); } }
    ]);
  },
  fullscreen() {
    const d = document.documentElement;
    if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else {
      const req = d.requestFullscreen || d.webkitRequestFullscreen;
      if (req) req.call(d).then?.(() => screen.orientation?.lock?.('landscape').catch(() => { })).catch(() => UI.toast('Fullscreen is not available here. On iPhone: Share → Add to Home Screen.', 'information-circle-outline', 4000));
      else UI.toast('On iPhone: Share → Add to Home Screen for a full-screen app.', 'information-circle-outline', 4000);
    }
  },
  profile() {
    const a = Accounts.current;
    let color = a.avatarColor, image = a.avatarImage || null;
    const name = el('input.input', { value: a.username });
    const email = el('input.input', { value: a.email || '', type: 'email', placeholder: 'E-mail (optional)' });
    const pw = el('input.input', { type: 'password', placeholder: 'New password (leave empty to keep it)', autocomplete: 'new-password' });
    const err = el('div.error');
    const prev = el('div');
    const upd = () => fill(prev, UI.avatar({ username: name.value || a.username, avatarColor: color, avatarImage: image }, 'lg'));
    upd(); name.oninput = upd;
    const s = UI.sheet({ title: 'Profile', cls: 'mid',
      body: el('div.col', { style: { gap: '.8em' } },
        el('div.row', { style: { gap: '.9em' } }, prev, el('div.col.grow', el('div.row', name, email), pw)),
        el('div.field', el('label', 'Color'), UI.swatches(PALETTE.slice(0, 14), color, c => { color = c; upd(); })),
        el('div.row', el('button.btn.small', { onclick: async () => { const f = await UI.pickFile('image/*'); if (f) { image = await squarePng(f); upd(); } } }, icon('image-outline'), 'Picture…'),
          el('button.btn.small.ghost', { onclick: () => { image = null; upd(); } }, 'Remove picture')),
        el('div.tiny.muted', 'Changes apply to this device. A project you open again gets your updated profile among its members.'),
        err),
      foot: [el('button.btn.ghost', { onclick: () => s.close() }, 'Cancel'), el('button.btn.primary', { onclick: async () => {
        err.textContent = Accounts.validate(name.value, email.value, a.id) || (pw.value ? Accounts.validatePassword(pw.value) : '') || '';
        if (err.textContent) return;
        a.username = name.value.trim(); a.email = email.value.trim() || null; a.avatarColor = color;
        if (image) a.avatarImage = image; else delete a.avatarImage;
        if (pw.value) await setPassword(a, pw.value);
        await Accounts.save();
        // The member copy inside the open project follows (ProjectSettings > Users does the same in the exe).
        const p = App.project;
        if (p) { const i = p.accounts.accounts.findIndex(m => m.id === a.id); if (i >= 0) { p.accounts.accounts[i] = Accounts.clone(a); p.saveAccounts(); } }
        s.close(); UI.toast('Profile saved'); App.route();
      } }, icon('checkmark'), 'Save')]
    });
  }
};
