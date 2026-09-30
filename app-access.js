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

  function ensureNurseGuide() {
    const view = document.getElementById('view-pacientes');
    const toolbar = view?.querySelector('.toolbar');
    if (!view || !toolbar) return;
    let guide = document.getElementById('nurseFollowGuide');
    if (state.profile?.role !== 'posto') {
      guide?.remove();
      return;
    }
    if (!guide) {
      guide = document.createElement('div');
      guide.id = 'nurseFollowGuide';
      guide.style.cssText = 'margin-bottom:12px;padding:12px 14px;border:1px solid #cfe6e3;border-radius:12px;background:#f2faf9;color:#365a56;font-size:12px;line-height:1.45';
      guide.innerHTML = '<strong style="display:block;color:#0f766e;margin-bottom:3px">Acompanhamento da sua unidade</strong>Localize o paciente abaixo e clique em <b>Acompanhar</b>. O prontuário abrirá com os grupos já vinculados para você registrar consulta, exames, risco, medicações, retorno e observações.';
      toolbar.parentNode.insertBefore(guide, toolbar);
    }
  }

  function enhanceNurseRows() {
    ensureNurseGuide();
    const nurse = state.profile?.role === 'posto';
    document.querySelectorAll('#patientsTableBody [data-action="edit"]').forEach((button) => {
      if (nurse) {
        button.className = 'btn primary small';
        button.textContent = 'Acompanhar';
        button.title = 'Abrir acompanhamento do paciente';
        button.setAttribute('aria-label', 'Acompanhar paciente');
      } else {
        button.className = 'icon-btn row-icon-btn';
        button.textContent = '✎';
        button.title = 'Editar';
        button.setAttribute('aria-label', 'Editar paciente');
      }
    });
  }

  // A camada otimizada renderiza a tabela por uma função interna que foi criada
  // antes deste módulo. Observar o tbody garante que qualquer paginação, filtro
  // ou rerender também receba o botão correto para a enfermeira.
  const patientBody = document.getElementById('patientsTableBody');
  if (patientBody) {
    new MutationObserver(() => enhanceNurseRows()).observe(patientBody, {
      childList: true,
      subtree: true
    });
  }

  // Mantém compatibilidade com caminhos que chamam renderPatients diretamente.
  const baseRenderPatients = renderPatients;
  renderPatients = function accessAwareRenderPatients() {
    const result = baseRenderPatients();
    enhanceNurseRows();
    return result;
  };

  // E também cobre explicitamente o renderizador da camada otimizada, quando presente.
  if (typeof optRenderPatientListNow === 'function') {
    const baseOptimizedRender = optRenderPatientListNow;
    optRenderPatientListNow = function accessAwareOptimizedRender() {
      const result = baseOptimizedRender();
      enhanceNurseRows();
      return result;
    };
  }

  const baseOpenPatient = openPatient;
  openPatient = async function accessAwareOpenPatient(patient = null) {
    const result = await baseOpenPatient(patient);
    const isNurse = state.profile?.role === 'posto';
    const title = document.getElementById('patientModalTitle');
    const save = document.getElementById('savePatientBtn');
    if (isNurse && patient) {
      if (title) title.textContent = `Acompanhamento — ${patient.nome || 'Paciente'}`;
      if (save) save.textContent = 'Salvar acompanhamento';
    } else if (isNurse && !patient) {
      if (title) title.textContent = 'Cadastrar novo paciente';
      if (save) save.textContent = 'Cadastrar paciente';
    } else if (save) {
      save.textContent = 'Salvar paciente';
    }
    return result;
  };

  setAccessLabels();
  enhanceNurseRows();

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
