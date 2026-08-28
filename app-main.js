let authExitMessage = '';
let sessionSequence = 0;
let serviceWorkerReloading = false;

function firebaseMessage(error) {
  const code = String(error?.code || '').replace(/^firestore\//, '').replace(/^auth\//, 'auth/');
  const messages = {
    'auth/invalid-credential': 'E-mail ou senha incorretos.',
    'auth/wrong-password': 'E-mail ou senha incorretos.',
    'auth/user-not-found': 'E-mail ou senha incorretos.',
    'auth/invalid-email': 'Informe um e-mail válido.',
    'auth/email-already-in-use': 'Já existe uma conta com este e-mail.',
    'auth/weak-password': 'A senha precisa ter pelo menos 6 caracteres.',
    'auth/too-many-requests': 'Muitas tentativas foram realizadas. Aguarde um pouco e tente novamente.',
    'auth/network-request-failed': 'Não foi possível acessar o Firebase. Verifique sua conexão com a internet.',
    'permission-denied': 'Seu usuário não tem permissão para realizar esta ação.',
    'unavailable': 'O serviço está temporariamente indisponível. Tente novamente.',
    'failed-precondition': 'Esta operação exige uma configuração adicional do Firestore.'
  };
  return messages[code] || messages[error?.code] || error?.message || 'Não foi possível concluir a operação.';
}

function setLoginBusy(busy) {
  const button = $('#loginForm button[type="submit"]');
  if (!button) return;
  button.disabled = busy;
  button.textContent = busy ? 'Entrando...' : 'Entrar';
}

function configureNurseUi() {
  const nurseNavLabel = document.querySelector('[data-view="usuarios"] span:last-child');
  if (nurseNavLabel) nurseNavLabel.textContent = 'Enfermeiras';

  const userView = $('#view-usuarios');
  if (userView) {
    const title = userView.querySelector('.section-actions h2');
    const description = userView.querySelector('.section-actions .muted');
    if (title) title.textContent = 'Enfermeiras responsáveis';
    if (description) description.textContent = 'Cadastre a enfermeira responsável de cada posto e gerencie o acesso da unidade.';
  }

  const addUserBtn = $('#addUserBtn');
  if (addUserBtn) addUserBtn.textContent = '+ Cadastrar enfermeira';

  const headers = $$('#view-usuarios thead th');
  if (headers[0]) headers[0].textContent = 'Enfermeira / usuário';
  if (headers[1]) headers[1].textContent = 'Tipo de acesso';

  const nurseOption = $('#newUserRole option[value="posto"]');
  if (nurseOption) nurseOption.textContent = 'Enfermeira responsável';

  const topbar = document.querySelector('.topbar-actions');
  if (topbar && !$('#quickAddNurseBtn')) {
    const button = document.createElement('button');
    button.id = 'quickAddNurseBtn';
    button.type = 'button';
    button.className = 'btn ghost admin-only hidden';
    button.textContent = '+ Enfermeira';
    topbar.insertBefore(button, $('#quickAddPatientBtn'));
  }
}

function enhancePasswordInput(inputId) {
  const input = document.getElementById(inputId);
  if (!input || input.closest('.password-control')) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'password-control';
  input.parentNode.insertBefore(wrapper, input);
  wrapper.appendChild(input);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'password-toggle';
  button.textContent = 'Mostrar';
  button.setAttribute('aria-label', 'Mostrar senha');
  button.addEventListener('click', () => {
    const visible = input.type === 'text';
    input.type = visible ? 'password' : 'text';
    button.textContent = visible ? 'Mostrar' : 'Ocultar';
    button.setAttribute('aria-label', visible ? 'Mostrar senha' : 'Ocultar senha');
  });
  wrapper.appendChild(button);
}

function bindPasswordToggles() {
  enhancePasswordInput('loginPassword');
  enhancePasswordInput('newUserPassword');
}

function applyProfileUi() {
  const admin = state.profile?.role === 'admin';
  $$('.admin-only').forEach((el) => el.classList.toggle('hidden', !admin));
  $$('.admin-only-cell').forEach((el) => el.classList.toggle('hidden', !admin));
  $('#dashboardPostoWrap')?.classList.toggle('hidden', !admin);
  $('#patientPostoFilter')?.classList.toggle('hidden', !admin);

  $('#userName').textContent = state.profile?.nome || state.firebaseUser?.email || 'Usuário';
  $('#userInitials').textContent = initials(state.profile?.nome || state.firebaseUser?.email || 'U');
  $('#userUnit').textContent = admin
    ? 'Administrador geral'
    : (state.postos.length ? getPostoName(state.profile?.postoId) : 'Posto de saúde');
}

function showApp() {
  $('#loginView').classList.add('hidden');
  $('#appView').classList.remove('hidden');
  $('#loginError').classList.add('hidden');
  applyProfileUi();
  switchView('dashboard');
  setLoading(false);
}

async function signOutWithMessage(message) {
  authExitMessage = message;
  try {
    await signOut(auth);
  } catch (error) {
    console.error(error);
    showLogin(message || firebaseMessage(error));
  }
}

async function loadSessionData() {
  await loadPostos();

  if (state.profile.role === 'posto') {
    const unit = state.postos.find((p) => p.id === state.profile.postoId);
    if (!unit) {
      const error = new Error('O posto vinculado a este usuário não existe mais.');
      error.code = 'exrisco/unit-not-found';
      throw error;
    }
    if (unit.ativo === false) {
      const error = new Error('O posto vinculado a este usuário está inativo. Procure um administrador.');
      error.code = 'exrisco/unit-inactive';
      throw error;
    }
  }

  await Promise.all([loadPatients(), loadUsers()]);
  refreshPostoFilters();
  renderDashboard();
  renderPatients();
  renderPostos();
  renderUsers();
}

async function handleAuthState(user) {
  const sequence = ++sessionSequence;

  if (!user) {
    state.firebaseUser = null;
    state.profile = null;
    state.postos = [];
    state.users = [];
    state.patients = [];
    const message = authExitMessage;
    authExitMessage = '';
    showLogin(message);
    setLoginBusy(false);
    return;
  }

  setLoading(true);
  try {
    const profileSnap = await getDoc(doc(db, 'usuarios', user.uid));
    if (sequence !== sessionSequence) return;

    if (!profileSnap.exists()) {
      await signOutWithMessage('Sua conta existe no Firebase Authentication, mas ainda não possui um perfil na coleção usuarios.');
      return;
    }

    const profile = { uid: profileSnap.id, ...profileSnap.data() };
    if (profile.ativo !== true) {
      await signOutWithMessage('Este usuário está desativado. Procure um administrador do sistema.');
      return;
    }
    if (!['admin', 'posto'].includes(profile.role)) {
      await signOutWithMessage('O perfil deste usuário está inválido. Procure um administrador do sistema.');
      return;
    }
    if (profile.role === 'posto' && !profile.postoId) {
      await signOutWithMessage('Este usuário ainda não está vinculado a um posto de saúde.');
      return;
    }

    state.firebaseUser = user;
    state.profile = profile;
    await loadSessionData();
    if (sequence !== sessionSequence) return;
    applyProfileUi();
    showApp();
  } catch (error) {
    console.error(error);
    const customMessage = error?.code === 'exrisco/unit-inactive' || error?.code === 'exrisco/unit-not-found'
      ? error.message
      : `Não foi possível carregar o sistema: ${firebaseMessage(error)}`;
    await signOutWithMessage(customMessage);
  }
}

function canOpenPatient() {
  if (state.profile?.role !== 'admin') return true;
  if (state.postos.some((p) => p.ativo !== false)) return true;
  showToast('Cadastre pelo menos um posto de saúde ativo antes de cadastrar pacientes.', 'error');
  switchView('postos');
  return false;
}

function openNewPatient() {
  if (!canOpenPatient()) return;
  openPatient();
}

function updateSyncState() {
  const el = $('#syncState');
  if (!el) return;
  const online = navigator.onLine;
  el.textContent = online ? '● Online' : '● Sem conexão';
  el.classList.toggle('offline', !online);
}

function calculateDppFromDum(dum) {
  const date = parseLocalDate(dum);
  if (!date) return '';
  date.setDate(date.getDate() + 280);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function bindGeneratedPatientFields() {
  const dum = $('#field-gestante-dum');
  const dpp = $('#field-gestante-dpp');
  if (dum && dpp) {
    dum.addEventListener('change', () => {
      if (!dum.value) return;
      if (!dpp.value || dpp.dataset.autoCalculated === 'true') {
        dpp.value = calculateDppFromDum(dum.value);
        dpp.dataset.autoCalculated = 'true';
      }
    });
    dpp.addEventListener('input', () => { dpp.dataset.autoCalculated = 'false'; });
  }
}

function bindNavigation() {
  $$('.nav-item').forEach((button) => button.addEventListener('click', () => {
    if (button.classList.contains('hidden')) return;
    state.patientPreset = null;
    switchView(button.dataset.view);
  }));

  $('[data-go-patients="overdue"]')?.addEventListener('click', () => {
    clearFilters();
    state.patientPreset = 'overdue';
    switchView('pacientes');
  });

  $('#mobileMenuBtn')?.addEventListener('click', () => $('.sidebar')?.classList.toggle('open'));
}

function bindPatientEvents() {
  $('#addPatientBtn')?.addEventListener('click', openNewPatient);
  $('#quickAddPatientBtn')?.addEventListener('click', openNewPatient);
  $('#patientForm')?.addEventListener('submit', savePatient);

  $('#patientBirth')?.addEventListener('change', () => {
    const age = calculateAge($('#patientBirth').value);
    $('#patientAge').value = age === '' ? '' : `${age} anos`;
  });
  $('#patientCpf')?.addEventListener('input', (event) => { event.target.value = maskCpf(event.target.value); });

  ['patientSearch', 'programFilter', 'riskFilter', 'patientPostoFilter', 'patientStatusFilter'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const eventName = id === 'patientSearch' ? 'input' : 'change';
    el.addEventListener(eventName, () => {
      state.patientPreset = null;
      renderPatients();
    });
  });

  $('#clearFiltersBtn')?.addEventListener('click', clearFilters);
  $('#exportCsvBtn')?.addEventListener('click', exportCsv);
  $('#printBtn')?.addEventListener('click', printPatients);
  $('#dashboardPostoFilter')?.addEventListener('change', renderDashboard);

  $('#patientsTableBody')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    const row = event.target.closest('tr[data-patient-id]');
    if (!button || !row) return;
    const patient = state.patients.find((p) => p.id === row.dataset.patientId);
    if (!patient) return;
    if (button.dataset.action === 'edit') openPatient(patient);
    if (button.dataset.action === 'history') openHistory(patient);
    if (button.dataset.action === 'toggle') togglePatient(patient);
  });
}

function openNurseForm() {
  openUser();
  $('#newUserRole').value = 'posto';
  syncUserRoleField();
  $('#userModalTitle').textContent = 'Cadastrar enfermeira responsável';
  $('#userFormHint').textContent = 'Crie o acesso da enfermeira e vincule-a ao posto de responsabilidade. Ela poderá cadastrar e acompanhar pacientes somente daquela unidade.';
}

function bindAdminEvents() {
  $('#addPostoBtn')?.addEventListener('click', () => openPosto());
  $('#postoForm')?.addEventListener('submit', savePosto);
  $('#postosGrid')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="edit-posto"]');
    const card = event.target.closest('[data-posto-id]');
    if (!button || !card) return;
    const posto = state.postos.find((p) => p.id === card.dataset.postoId);
    if (posto) openPosto(posto);
  });

  $('#addUserBtn')?.addEventListener('click', openNurseForm);
  $('#quickAddNurseBtn')?.addEventListener('click', openNurseForm);
  $('#userForm')?.addEventListener('submit', saveUser);
  $('#newUserRole')?.addEventListener('change', syncUserRoleField);
  $('#usersTableBody')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="edit-user"]');
    const row = event.target.closest('tr[data-user-id]');
    if (!button || !row) return;
    const user = state.users.find((u) => u.uid === row.dataset.userId);
    if (user) openUser(user);
  });
}

function bindModalEvents() {
  $$('[data-close-modal]').forEach((button) => button.addEventListener('click', () => {
    const id = button.dataset.closeModal;
    if (id === 'confirmModal') resolveConfirm(false);
    else closeModal(id);
  }));

  $('#confirmCancel')?.addEventListener('click', () => resolveConfirm(false));
  $('#confirmOk')?.addEventListener('click', () => resolveConfirm(true));

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const open = [...document.querySelectorAll('.modal:not(.hidden)')].at(-1);
    if (!open) return;
    if (open.id === 'confirmModal') resolveConfirm(false);
    else closeModal(open.id);
  });
}

function bindSessionEvents() {
  $('#loginForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = $('#loginEmail').value.trim();
    const password = $('#loginPassword').value;
    $('#loginError').classList.add('hidden');
    setLoginBusy(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
      console.error(error);
      $('#loginError').textContent = firebaseMessage(error);
      $('#loginError').classList.remove('hidden');
      setLoginBusy(false);
    }
  });

  $('#logoutBtn')?.addEventListener('click', async () => {
    setLoading(true);
    try { await signOut(auth); }
    catch (error) { setLoading(false); showToast(firebaseMessage(error), 'error'); }
  });

  $('#openCalculatorBtn')?.addEventListener('click', openCalculator);
  $('#quickCalculatorBtn')?.addEventListener('click', openCalculator);
}

function registerPwa() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = Boolean(navigator.serviceWorker.controller);
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('./sw.js');
      await registration.update();
      if (hadController) {
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (serviceWorkerReloading) return;
          serviceWorkerReloading = true;
          window.location.reload();
        });
      }
    } catch (error) {
      console.warn('Falha ao registrar o PWA.', error);
    }
  });
}

function initializeUi() {
  configureNurseUi();
  bindPasswordToggles();
  renderProgramSelector();
  bindGeneratedPatientFields();
  bindNavigation();
  bindPatientEvents();
  bindAdminEvents();
  bindModalEvents();
  bindSessionEvents();
  updateSyncState();
  window.addEventListener('online', updateSyncState);
  window.addEventListener('offline', updateSyncState);
  registerPwa();

  console.info(`EXRisco ${VERSION}`);
  onAuthStateChanged(auth, handleAuthState);
}

initializeUi();