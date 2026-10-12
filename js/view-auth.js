/* Cairn Web — sign in / create an account (LoginView of the desktop app). */
'use strict';

const AuthView = {
  mode: null,
  show(mode) {
    this.mode = mode || (Accounts.list.length ? 'login' : 'welcome');
    UI.swap(v => {
      const card = el('div.auth-card.glass');
      v.appendChild(el('div.auth',
        el('div.brand',
          el('img', { src: 'assets/icon.png', alt: '' }),
          el('h1', 'Cairn'),
          el('div.muted.small', 'by Highshore Studio'),
          el('p', 'Your Kanban boards, documentation, roadmap and whiteboards — on the phone. Projects stay on this device; move them to and from the desktop app as zip files.')),
        card));
      this.render(card);
    });
  },

  render(card) {
    fill(card);
    if (this.mode === 'welcome') {
      card.append(
        el('h2', { style: { margin: 0 } }, 'Welcome'),
        el('div.small.muted', 'Create a local account, or import a project exported from Cairn and sign in as one of its members.'),
        el('button.btn.primary', { onclick: () => { this.mode = 'create'; this.render(card); } }, icon('person-add-outline'), 'Create account'),
        el('button.btn', { onclick: () => this.importFirst(card) }, icon('download-outline'), 'Import a project (.zip)'));
      return;
    }
    if (this.mode === 'login') {
      let chosen = Accounts.list[0];
      const pw = el('input.input', { type: 'password', placeholder: 'Password', autocomplete: 'current-password', enterkeyhint: 'go' });
      const err = el('div.error');
      const list = el('div.acc-list.scroll');
      const renderList = () => fill(list, ...Accounts.list.map(a => el('button.acc' + (a === chosen ? '.sel' : ''), { onclick: () => { chosen = a; renderList(); pw.focus(); } },
        UI.avatar(a), el('div.grow', el('b', a.username), el('div.tiny.muted', a.email || '')), a === chosen ? icon('checkmark') : null)));
      renderList();
      const go = async () => {
        err.textContent = '';
        btn.disabled = true; btn.lastChild.textContent = 'Checking…';
        const ok = await verifyPassword(chosen, pw.value);
        btn.disabled = false; btn.lastChild.textContent = 'Sign in';
        if (!ok) { err.textContent = 'Wrong password.'; pw.select(); card.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'translateX(0)' }], { duration: 300 }); return; }
        await Accounts.login(chosen);
        App.go('#/projects', true);
      };
      const btn = el('button.btn.primary', { onclick: go }, icon('enter-outline'), el('span', 'Sign in'));
      pw.onkeydown = e => { if (e.key === 'Enter') go(); };
      card.append(el('h2', { style: { margin: 0 } }, 'Sign in'), list, pw, err, btn,
        el('div.row', el('button.btn.ghost.small', { onclick: () => { this.mode = 'create'; this.render(card); } }, icon('person-add-outline'), 'New account'),
          el('button.btn.ghost.small', { onclick: () => this.importFirst(card) }, icon('download-outline'), 'Import project')));
      setTimeout(() => pw.focus(), 300);
      return;
    }
    // create
    let color = PALETTE[Math.floor(Math.random() * 6)];
    const name = el('input.input', { placeholder: 'Username', autocomplete: 'username' });
    const email = el('input.input', { placeholder: 'E-mail (optional)', type: 'email', autocomplete: 'email' });
    const pw = el('input.input', { type: 'password', placeholder: 'Password (6+ characters)', autocomplete: 'new-password' });
    const pw2 = el('input.input', { type: 'password', placeholder: 'Repeat password', autocomplete: 'new-password' });
    const err = el('div.error');
    const create = async () => {
      err.textContent = Accounts.validate(name.value, email.value) || Accounts.validatePassword(pw.value) || (pw.value !== pw2.value ? 'The passwords do not match.' : '');
      if (err.textContent) return;
      btn.disabled = true;
      const a = await Accounts.create(name.value, pw.value, email.value, color);
      await Accounts.login(a);
      App.go('#/projects', true);
    };
    const btn = el('button.btn.primary', { onclick: create }, icon('checkmark'), 'Create account');
    card.append(el('h2', { style: { margin: 0 } }, 'New account'),
      el('div.row', name, email), el('div.row', pw, pw2),
      el('div.field', el('label', 'Color'), UI.swatches(PALETTE.slice(0, 14), color, c => color = c)),
      err, btn,
      Accounts.list.length ? el('button.btn.ghost.small', { onclick: () => { this.mode = 'login'; this.render(card); } }, icon('chevron-back'), 'Back to sign in') : el('button.btn.ghost.small', { onclick: () => { this.mode = 'welcome'; this.render(card); } }, icon('chevron-back'), 'Back'));
    setTimeout(() => name.focus(), 300);
  },

  /** Import before signing in: then sign in as one of the members of the imported project. */
  async importFirst(card) {
    const file = await UI.pickFile('.zip,application/zip');
    const info = await App.importZip(file);
    if (!info) return;
    const p = await Project.open(info.id);
    const members = p.accounts.accounts;
    if (!members.length) { this.mode = 'create'; this.render(card); UI.toast('Create an account, then open the project.', 'information-circle-outline', 3500); return; }
    let chosen = members[0];
    const pw = el('input.input', { type: 'password', placeholder: 'Password', autocomplete: 'current-password', enterkeyhint: 'go' });
    const err = el('div.error');
    const list = el('div.acc-list.scroll');
    const renderList = () => fill(list, ...members.map(a => el('button.acc' + (a === chosen ? '.sel' : ''), { onclick: () => { chosen = a; renderList(); pw.focus(); } },
      UI.avatar(a), el('div.grow', el('b', a.username), el('div.tiny.muted', 'member')), a === chosen ? icon('checkmark') : null)));
    renderList();
    const go = async () => {
      btn.disabled = true;
      const ok = await verifyPassword(chosen, pw.value);
      btn.disabled = false;
      if (!ok) { err.textContent = 'Wrong password (use the one of the desktop app).'; pw.select(); return; }
      await Accounts.login(await Accounts.import(chosen));
      App.go('#/p/' + info.id + '/board', true);
    };
    const btn = el('button.btn.primary', { onclick: go }, icon('enter-outline'), 'Sign in and open');
    pw.onkeydown = e => { if (e.key === 'Enter') go(); };
    fill(card, el('h2', { style: { margin: 0 } }, info.name), el('div.small.muted', 'Sign in as a member of this project, with the same password you use in the desktop app.'), list, pw, err, btn,
      el('button.btn.ghost.small', { onclick: () => { this.mode = 'create'; this.render(card); } }, icon('person-add-outline'), 'Create a new account instead'));
    setTimeout(() => pw.focus(), 300);
  }
};
