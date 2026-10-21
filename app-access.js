// EXRisco — gestão de acessos: enfermeiras, administradores e senhas.
// A alteração direta de senha é feita por Cloud Function com Firebase Admin SDK.
(function configureAccessManagement() {
  const PASSWORD_FUNCTION_URL = 'https://southamerica-east1-extratificacao.cloudfunctions.net/adminSetUserPassword';
  let passwordTarget = null;

  function setAccessLabels() {
    const navLabel = document.querySelector('[data-view="usuarios"] span:last-child');
    if (navLabel) navLabel.textContent = 'Usuários e acessos';

    const userView = document.getElementById('view-usuarios');
    if (userView) {
      const title = userView.querySelector('.section-actions h2');
      const description = userView.querySelector('.section-actions .muted');
      if (title) title.textContent = 'Usuários e acessos';
      if (description) description.textContent = 'Cadastre enfermeiras e administradores, vincule postos e gerencie senhas de acesso.';

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
        actions.appendChild(adminButton);
      }
    }

    const headers = [...document.querySelectorAll('#view-usuarios thead th')];
    if (headers[0]) headers[0].textContent = 'Usuário';
    if (headers[1]) headers[1].textContent = 'Perfil de acesso';

    const roleSelect = document.getElementById('newUserRole');
    if (roleSelect) {
      const nurseOption = roleSelect.querySelector('option[value="posto"]');
      const adminOption = roleSelect.querySelector('option[value="admin"]');
      if (nurseOption) nurseOption.textContent = 'Enfermeira do posto';
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
      if (hint) hint.textContent = 'Administrador geral: acesso a todos os postos, pacientes e gestão de usuários. Para trocar a senha, use o botão de senha na lista de usuários.';
    } else {
      if (title) title.textContent = 'Editar enfermeira';
      if (hint) hint.textContent = 'A enfermeira fica vinculada a um posto. Um mesmo posto pode ter várias enfermeiras ativas. Para trocar a senha, use o botão de senha na lista de usuários.';
    }
  };

  function ensurePasswordModal() {
    if (document.getElementById('adminPasswordModal')) return;

    document.body.insertAdjacentHTML('beforeend', `
      <div id="adminPasswordModal" class="modal hidden" aria-hidden="true">
        <div class="modal-backdrop" data-close-password-modal></div>
        <div class="modal-dialog small-dialog">
          <div class="modal-head">
            <div>
              <span class="eyebrow">Segurança</span>
              <h2>Alterar senha do usuário</h2>
            </div>
            <button class="icon-btn" type="button" data-close-password-modal>×</button>
          </div>
          <form id="adminPasswordForm" class="modal-body">
            <div class="access-password-target">
              <strong id="adminPasswordUserName">Usuário</strong>
              <span id="adminPasswordUserEmail"></span>
            </div>
            <label class="field">
              <span>Nova senha *</span>
              <div class="password-control">
                <input id="adminNewPassword" type="password" minlength="6" autocomplete="new-password" required placeholder="Mínimo de 6 caracteres" />
                <button id="adminNewPasswordToggle" class="password-toggle" type="button">Mostrar</button>
              </div>
            </label>
            <label class="field">
              <span>Confirmar nova senha *</span>
              <div class="password-control">
                <input id="adminConfirmPassword" type="password" minlength="6" autocomplete="new-password" required placeholder="Digite novamente" />
                <button id="adminConfirmPasswordToggle" class="password-toggle" type="button">Mostrar</button>
              </div>
            </label>
            <p class="hint">A senha não é armazenada no EXRisco. A alteração é enviada diretamente a uma função administrativa protegida do Firebase.</p>
            <p id="adminPasswordError" class="form-error hidden"></p>
          </form>
          <div class="modal-foot">
            <button id="sendResetEmailBtn" type="button" class="btn ghost">Enviar link por e-mail</button>
            <div class="modal-actions">
              <button type="button" class="btn ghost" data-close-password-modal>Cancelar</button>
              <button id="saveAdminPasswordBtn" class="btn primary" type="submit" form="adminPasswordForm">Alterar senha</button>
            </div>
          </div>
        </div>
      </div>
    `);

    document.querySelectorAll('[data-close-password-modal]').forEach((button) => {
      button.addEventListener('click', closePasswordModal);
    });

    document.getElementById('adminPasswordForm')?.addEventListener('submit', saveAdminPassword);
    document.getElementById('sendResetEmailBtn')?.addEventListener('click', sendResetEmailForTarget);
    bindLocalPasswordToggle('adminNewPassword', 'adminNewPasswordToggle');
    bindLocalPasswordToggle('adminConfirmPassword', 'adminConfirmPasswordToggle');
  }

  function bindLocalPasswordToggle(inputId, buttonId) {
    const input = document.getElementById(inputId);
    const button = document.getElementById(buttonId);
    if (!input || !button) return;
    button.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      button.textContent = show ? 'Ocultar' : 'Mostrar';
    });
  }

  function openPasswordModal(user) {
    if (state.profile?.role !== 'admin' || !user) return;
    ensurePasswordModal();
    passwordTarget = user;

    const form = document.getElementById('adminPasswordForm');
    form?.reset();
    document.getElementById('adminPasswordError')?.classList.add('hidden');
    document.getElementById('adminPasswordUserName').textContent = user.nome || 'Usuário';
    document.getElementById('adminPasswordUserEmail').textContent = user.email || 'E-mail não informado';

    const selfNote = user.uid === state.firebaseUser?.uid
      ? ' · você está alterando a senha da conta atualmente conectada'
      : '';
    document.getElementById('adminPasswordUserEmail').textContent += selfNote;

    openModal('adminPasswordModal');
    setTimeout(() => document.getElementById('adminNewPassword')?.focus(), 80);
  }

  function closePasswordModal() {
    passwordTarget = null;
    closeModal('adminPasswordModal');
  }

  function showPasswordError(message) {
    const box = document.getElementById('adminPasswordError');
    if (!box) return;
    box.textContent = message;
    box.classList.remove('hidden');
  }

  function setPasswordBusy(busy) {
    const save = document.getElementById('saveAdminPasswordBtn');
    const email = document.getElementById('sendResetEmailBtn');
    if (save) {
      save.disabled = busy;
      save.textContent = busy ? 'Alterando...' : 'Alterar senha';
    }
    if (email) email.disabled = busy;
  }

  async function callAdminPasswordFunction(uid, password) {
    const currentUser = state.firebaseUser;
    if (!currentUser) throw new Error('Sua sessão expirou. Entre novamente no sistema.');

    const token = await currentUser.getIdToken(true);
    let response;

    try {
      response = await fetch(PASSWORD_FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ data: { uid, password } })
      });
    } catch (error) {
      const networkError = new Error('Não foi possível acessar o serviço de alteração de senha. Verifique a internet e se a Cloud Function do EXRisco já foi publicada.');
      networkError.code = 'exrisco/password-service-unavailable';
      throw networkError;
    }

    let payload = {};
    try { payload = await response.json(); } catch (_) {}

    if (!response.ok || payload.error) {
      const message = payload?.error?.message || payload?.message || '';
      const error = new Error(message || 'O serviço administrativo recusou a alteração de senha.');
      error.code = payload?.error?.status || `http-${response.status}`;
      throw error;
    }

    if (!payload?.result?.ok) {
      throw new Error('O serviço não confirmou a alteração da senha.');
    }

    return payload.result;
  }

  async function saveAdminPassword(event) {
    event.preventDefault();
    if (state.profile?.role !== 'admin' || !passwordTarget) return;

    const password = document.getElementById('adminNewPassword')?.value || '';
    const confirm = document.getElementById('adminConfirmPassword')?.value || '';
    document.getElementById('adminPasswordError')?.classList.add('hidden');

    if (password.length < 6) return showPasswordError('A nova senha precisa ter pelo menos 6 caracteres.');
    if (password !== confirm) return showPasswordError('As duas senhas não conferem.');

    setPasswordBusy(true);
    try {
      await callAdminPasswordFunction(passwordTarget.uid, password);
      const changedUser = passwordTarget;
      closePasswordModal();
      showToast(`Senha de ${changedUser.nome || changedUser.email || 'usuário'} alterada com sucesso.`);
    } catch (error) {
      console.error('Falha ao alterar senha do usuário.', error);
      const unavailable = [
        'exrisco/password-service-unavailable',
        'http-404',
        'NOT_FOUND',
        'UNIMPLEMENTED'
      ].includes(error?.code);

      showPasswordError(unavailable
        ? 'A função administrativa de senha ainda não está publicada no Firebase. Enquanto isso, use “Enviar link por e-mail”.'
        : (error?.message || 'Não foi possível alterar a senha.'));
    } finally {
      setPasswordBusy(false);
    }
  }

  async function sendResetEmailForTarget() {
    if (state.profile?.role !== 'admin' || !passwordTarget?.email) {
      return showPasswordError('Este usuário não possui um e-mail válido cadastrado.');
    }

    setPasswordBusy(true);
    document.getElementById('adminPasswordError')?.classList.add('hidden');
    try {
      await sendPasswordResetEmail(auth, passwordTarget.email);
      showToast(`Link de redefinição enviado para ${passwordTarget.email}.`);
    } catch (error) {
      console.error(error);
      showPasswordError(firebaseMessage(error));
    } finally {
      setPasswordBusy(false);
    }
  }

  function bindPasswordUserAction() {
    document.getElementById('usersTableBody')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action="password-user"]');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();

      const row = button.closest('tr[data-user-id]');
      const user = state.users.find((item) => item.uid === row?.dataset.userId);
      if (user) openPasswordModal(user);
    });
  }

  setAccessLabels();
  bindPasswordUserAction();

  const passwordField = document.getElementById('newUserPasswordField');
  if (passwordField && !passwordField.querySelector('.access-note')) {
    const note = document.createElement('small');
    note.className = 'access-note';
    note.textContent = 'Senha inicial: entregue ao usuário. Ela não fica salva no EXRisco.';
    note.style.display = 'block';
    note.style.marginTop = '6px';
    note.style.color = 'var(--muted)';
    passwordField.appendChild(note);
  }
})();
