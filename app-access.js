// EXRisco — gestão clara de acessos: enfermeiras e administradores.
// Carregado após app-main.js para complementar a interface sem alterar a lógica de autenticação.
(function configureAccessManagement() {
  function setAccessLabels() {
    const navLabel = document.querySelector('[data-view="usuarios"] span:last-child');
    if (navLabel) navLabel.textContent = 'Usuários e acessos';

    const userView = document.getElementById('view-usuarios');
    if (userView) {
      const title = userView.querySelector('.section-actions h2');
      const description = userView.querySelector('.section-actions .muted');
      if (title) title.textContent = 'Usuários e acessos';
      if (description) description.textContent = 'Cadastre enfermeiras vinculadas aos postos e administradores com acesso geral ao EXRisco.';

      const actions = userView.querySelector('.section-actions');
      const nurseButton = document.getElementById('addUserBtn');
      if (nurseButton) nurseButton.textContent = '+ Cadastrar enfermeira';

      if (actions && !document.getElementById('addAdminUserBtn')) {
        const adminButton = document.createElement('button');
        adminButton.id = 'addAdminUserBtn';
        adminButton.type = 'button';
        adminButton.className = 'btn ghost';
        adminButton.textContent = '+ Cadastrar administrador';
        adminButton.addEventListener('click', openAdminAccessForm);
        if (nurseButton) actions.appendChild(adminButton);
        else actions.appendChild(adminButton);
      }
    }

    const headers = [...document.querySelectorAll('#view-usuarios thead th')];
    if (headers[0]) headers[0].textContent = 'Usuário';
    if (headers[1]) headers[1].textContent = 'Perfil de acesso';

    const roleSelect = document.getElementById('newUserRole');
    if (roleSelect) {
      const nurseOption = roleSelect.querySelector('option[value="posto"]');
      const adminOption = roleSelect.querySelector('option[value="admin"]');
      if (nurseOption) nurseOption.textContent = 'Enfermeira responsável pelo posto';
      if (adminOption) adminOption.textContent = 'Administrador geral';
    }
  }

  function openAdminAccessForm() {
    openUser();
    const role = document.getElementById('newUserRole');
    if (role) role.value = 'admin';
    syncUserRoleField();
    const title = document.getElementById('userModalTitle');
    const hint = document.getElementById('userFormHint');
    if (title) title.textContent = 'Cadastrar administrador';
    if (hint) hint.textContent = 'Defina nome, e-mail e senha inicial. A conta será criada no Firebase Authentication e poderá entrar no EXRisco imediatamente com acesso geral.';
    document.getElementById('newUserName')?.focus();
  }

  const baseOpenUser = openUser;
  openUser = function accessAwareOpenUser(user = null) {
    baseOpenUser(user);
    const hint = document.getElementById('userFormHint');
    const title = document.getElementById('userModalTitle');
    if (!user) {
      if (hint) hint.textContent = 'Ao salvar, o EXRisco cria a conta no Firebase Authentication e o perfil do sistema. O acesso fica disponível imediatamente. A senha inicial não é armazenada pelo EXRisco.';
      return;
    }
    if (user.role === 'admin') {
      if (title) title.textContent = 'Editar administrador';
      if (hint) hint.textContent = 'Administrador geral: acesso a todos os postos, pacientes e gestão de usuários. E-mail e senha do Firebase não são alterados nesta tela.';
    } else {
      if (title) title.textContent = 'Editar enfermeira responsável';
      if (hint) hint.textContent = 'A enfermeira fica vinculada a um único posto. E-mail e senha do Firebase não são alterados nesta tela.';
    }
  };

  setAccessLabels();

  // O formulário já possui Mostrar/Ocultar senha via app-main.js.
  const passwordField = document.getElementById('newUserPasswordField');
  if (passwordField && !passwordField.querySelector('.access-note')) {
    const note = document.createElement('small');
    note.className = 'access-note';
    note.textContent = 'Senha inicial: entregue ao usuário. Ela não fica salva nem pode ser consultada depois pelo EXRisco.';
    note.style.display = 'block';
    note.style.marginTop = '6px';
    note.style.color = 'var(--muted)';
    passwordField.appendChild(note);
  }
})();
