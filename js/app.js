/* Cairn Web — application shell: routing between the screens, project opening, project access. */
'use strict';

const App = {
  version: '1.3-web',
  project: null,     // Project (store.js)
  ops: null,         // BoardOps (model.js)
  tab: 'board',
  listeners: {},
  on(ev, fn) { (this.listeners[ev] ||= new Set()).add(fn); return () => this.listeners[ev].delete(fn); },
  emit(ev, ...a) { for (const fn of this.listeners[ev] || []) try { fn(...a); } catch (e) { console.error(e); } },

  async start() {
    UI.applyTheme();
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => UI.applyTheme());
    try { await Accounts.load(); }
    catch (e) {
      UI.swap(v => v.appendChild(UI.empty('alert-circle-outline', 'Storage is not available', 'This browser blocks local storage (private mode?). Cairn needs it to keep your projects.')));
      return;
    }
    window.addEventListener('hashchange', () => App.route());
    document.addEventListener('keydown', e => { if (e.key === 'Escape') UI.closeTop(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') App.project?.flush(); });
    window.addEventListener('pagehide', () => App.project?.flush());
    App.route();
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
  },

  go(hash, replace = false) {
    if (location.hash === hash) { App.route(); return; }
    if (replace) { history.replaceState(null, '', hash); App.route(); } else location.hash = hash;
  },

  async route() {
    UI.closeAll();
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    if (!Accounts.current) {
      if (App.project) await App.closeProject();
      AuthView.show();
      return;
    }
    if (parts[0] === 'p' && parts[1]) {
      const tab = ['board', 'whiteboard', 'docs', 'roadmap'].includes(parts[2]) ? parts[2] : 'board';
      if (!App.project || App.project.id !== parts[1]) {
        const ok = await App.openProject(parts[1]);
        if (!ok) { App.go('#/projects', true); return; }
      }
      App.tab = tab;
      ProjectShell.show(tab, parts.slice(3).map(decodeURIComponent));
      return;
    }
    if (App.project) await App.closeProject();
    ProjectsView.show();
  },

  async openProject(id) {
    let project;
    try { project = await Project.open(id); }
    catch (e) { UI.toast(e.message || 'The project could not be opened.', 'alert-circle-outline'); return false; }
    if (!await App.ensureAccess(project)) return false;
    App.project = project;
    App.ops = new BoardOps(project, Accounts.current);
    const meta = await Store.getMeta(id);
    if (meta) { meta.lastOpenedAt = utcNow(); await Store.putMeta(meta); }
    return true;
  },
  async closeProject() {
    const p = App.project;
    App.project = null; App.ops = null;
    if (p) await p.flush();
  },

  /** ProjectAccessViewModel: log in as a project member, join with the current account, or cancel. */
  async ensureAccess(project) {
    const me = Accounts.current;
    const members = project.accounts.accounts;
    if (members.some(a => a.id === me.id)) return true;
    return new Promise(resolve => {
      let chosen = members.find(m => Accounts.find(m.id)) || members[0] || null;
      const pw = el('input.input', { type: 'password', placeholder: 'Password of the member', autocomplete: 'current-password', enterkeyhint: 'go' });
      const err = el('div.error');
      const list = el('div.acc-list.scroll');
      const renderList = () => {
        fill(list, ...members.map(m => el('button.acc' + (chosen === m ? '.sel' : ''), { onclick: () => { chosen = m; renderList(); pw.focus(); } },
          UI.avatar(m), el('div.grow', el('b', m.username), el('div.tiny.muted', m.email || 'member')), chosen === m ? icon('checkmark') : null)));
      };
      renderList();
      let done = false;
      const finish = v => { if (done) return; done = true; s.close(); resolve(v); };
      const login = async () => {
        if (!chosen) return;
        err.textContent = '';
        btnLogin.disabled = true;
        const ok = await verifyPassword(chosen, pw.value);
        btnLogin.disabled = false;
        if (!ok) { err.textContent = 'Wrong password.'; pw.select(); return; }
        const acc = await Accounts.import(chosen);
        await Accounts.login(acc);
        App.emit('account');
        finish(true);
      };
      const join = () => { project.accounts.accounts.push(Accounts.clone(me)); project.saveAccounts(); finish(true); };
      pw.onkeydown = e => { if (e.key === 'Enter') login(); };
      const btnLogin = el('button.btn.primary', { onclick: login }, icon('enter-outline'), 'Log in as member');
      const s = UI.sheet({
        title: `Open "${project.info.name}"`, cls: 'mid',
        body: el('div.col', { style: { gap: '.8em' } },
          el('div.small.muted', `You are signed in as ${me.username}, who is not a member of this project. Log in as one of its members, or join the project with your account.`),
          members.length ? el('div.col', el('div.label', 'Members'), list, pw, err) : el('div.small.muted', 'This project has no members yet.')),
        foot: [el('button.btn.ghost', { onclick: () => finish(false) }, 'Cancel'),
          el('button.btn', { onclick: join }, icon('person-add-outline'), `Join as ${me.username}`),
          members.length ? btnLogin : null],
        onClose: () => finish(false)
      });
      setTimeout(() => pw.focus(), 400);
    });
  },

  /** Import from a zip: asks before replacing a project already on this device. */
  async importZip(file) {
    if (!file) return null;
    let result;
    try { result = await readProjectZip(file); }
    catch (e) { UI.alert(e.message || String(e), 'Import failed'); return null; }
    const { info, files } = result;
    const existing = await Store.getMeta(info.id);
    if (existing) {
      const ok = await UI.confirm(`"${existing.name}" is already on this device.\n\nReplace it with the version in the zip? Changes made here and not exported will be lost.`, 'Replace project', 'Replace', true);
      if (!ok) return null;
      if (App.project?.id === info.id) { App.project = null; App.ops = null; }
    }
    await Store.replaceProject(metaFrom(info, files, { lastOpenedAt: existing?.lastOpenedAt || null, importedAt: utcNow() }), files);
    UI.toast(`Imported "${info.name}"`, 'download-outline');
    return info;
  },

  async exportProject(id) {
    const p = App.project?.id === id ? App.project : await Project.open(id);
    const blob = await p.exportBlob();
    const name = slug(p.info.name) + '.zip';
    const touch = matchMedia('(pointer: coarse)').matches;
    const r = await deliverFile(blob, name, touch);
    if (r !== 'cancelled') {
      const meta = await Store.getMeta(id); if (meta) { meta.exportedAt = utcNow(); await Store.putMeta(meta); }
      UI.toast(r === 'shared' ? 'Project shared' : `Saved ${name}`, 'share-outline');
    }
  }
};

document.addEventListener('DOMContentLoaded', () => App.start());
