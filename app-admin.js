function activeNursesForPosto(postoId) {
  return state.users.filter((user) => (
    user.role === 'posto'
    && user.postoId === postoId
    && user.ativo !== false
  ));
}

function roleLabel(role) {
  if (role === 'admin') return 'Administrador geral';
  if (role === 'posto') return 'Enfermeira do posto';
  return 'Perfil não identificado';
}

function renderPostos() {
  if (state.profile?.role !== 'admin') return;
  $('#postosGrid').innerHTML = state.postos.length ? state.postos.map((p) => {
    const patients = state.patients.filter((patient) => patient.postoId === p.id && patient.ativo !== false).length;
    const nurses = activeNursesForPosto(p.id);
    const nurseText = nurses.length
      ? `${nurses.length} enfermeira${nurses.length === 1 ? '' : 's'} vinculada${nurses.length === 1 ? '' : 's'}`
      : 'Sem enfermeira vinculada';
    return `<article class="unit-card" data-posto-id="${p.id}"><div class="unit-card-head"><span class="unit-icon">+</span><button class="icon-btn row-icon-btn" data-action="edit-posto">✎</button></div><h3>${escapeHtml(p.nome)}</h3><p>${escapeHtml([p.sigla, p.cnes ? `CNES ${p.cnes}` : ''].filter(Boolean).join(' · ') || 'Sem sigla/CNES informado')}</p><div class="unit-meta"><span class="status-chip${p.ativo === false ? ' off' : ''}">${p.ativo === false ? 'Inativo' : 'Ativo'}</span><span class="mini-badge">${patients} pacientes</span><span class="mini-badge">${nurseText}</span></div></article>`;
  }).join('') : '<div class="empty-state"><div class="empty-icon">+</div><h3>Nenhum posto cadastrado</h3><p>Cadastre a primeira unidade e depois vincule a enfermeira responsável.</p></div>';
}

function openPosto(posto = null) {
  $('#postoForm').reset();
  $('#postoId').value = posto?.id || '';
  $('#postoNome').value = posto?.nome || '';
  $('#postoSigla').value = posto?.sigla || '';
  $('#postoCnes').value = posto?.cnes || '';
  $('#postoAtivo').checked = posto?.ativo !== false;
  $('#postoModalTitle').textContent = posto ? 'Editar posto de saúde' : 'Novo posto de saúde';
  openModal('postoModal');
}

async function savePosto(event) {
  event.preventDefault();
  const id = $('#postoId').value;
  const payload = {
    nome: $('#postoNome').value.trim(),
    sigla: $('#postoSigla').value.trim(),
    cnes: $('#postoCnes').value.trim(),
    ativo: $('#postoAtivo').checked,
    atualizadoEm: serverTimestamp()
  };
  if (!payload.nome) return;
  try {
    if (id) await updateDoc(doc(db, 'postos', id), payload);
    else await addDoc(collection(db, 'postos'), { ...payload, criadoEm: serverTimestamp() });
    closeModal('postoModal');
    await loadPostos();
    refreshPostoFilters();
    renderPostos();
    renderDashboard();
    showToast(id ? 'Posto atualizado.' : 'Posto cadastrado. Agora vincule a enfermeira responsável.');
  } catch (error) {
    console.error(error);
    showToast(firebaseMessage(error), 'error');
  }
}

function renderUsers() {
  if (state.profile?.role !== 'admin') return;
  $('#usersTableBody').innerHTML = state.users.map((u) => `<tr data-user-id="${u.uid}"><td><div class="patient-name"><strong>${escapeHtml(u.nome || 'Sem nome')}</strong><span>${escapeHtml(u.email || '')}</span></div></td><td>${roleLabel(u.role)}</td><td>${u.role === 'admin' ? 'Todos os postos' : escapeHtml(getPostoName(u.postoId))}</td><td><span class="status-chip${u.ativo === false ? ' off' : ''}">${u.ativo === false ? 'Inativo' : 'Ativo'}</span></td><td><div class="row-actions"><button class="icon-btn row-icon-btn" data-action="edit-user" title="Editar">✎</button></div></td></tr>`).join('');
}

function openUser(user = null) {
  $('#userForm').reset();
  $('#userFormError').classList.add('hidden');
  $('#editUserUid').value = user?.uid || '';
  $('#newUserName').value = user?.nome || '';
  $('#newUserEmail').value = user?.email || '';
  $('#newUserEmail').disabled = Boolean(user);
  $('#newUserPasswordField').classList.toggle('hidden', Boolean(user));
  $('#newUserPassword').required = !user;
  const nurseOption = $('#newUserRole option[value="posto"]');
  if (nurseOption) nurseOption.textContent = 'Enfermeira do posto';
  $('#newUserRole').value = user?.role || 'posto';
  fillPostoSelect($('#newUserPosto'));
  $('#newUserPosto').value = user?.postoId || '';
  $('#newUserAtivo').checked = user?.ativo !== false;
  $('#userModalTitle').textContent = user ? 'Editar usuário' : 'Novo usuário';
  $('#userFormHint').textContent = user
    ? 'A enfermeira fica vinculada a um único posto. Um mesmo posto pode ter várias enfermeiras ativas. O e-mail e a senha do Firebase Authentication não são alterados por esta tela.'
    : 'Cadastre quantas enfermeiras forem necessárias e vincule cada uma ao posto onde trabalha. Todas poderão acompanhar os pacientes da própria unidade.';
  syncUserRoleField();
  openModal('userModal');
}

function syncUserRoleField() {
  const admin = $('#newUserRole').value === 'admin';
  $('#newUserPostoField').classList.toggle('hidden', admin);
  $('#newUserPosto').required = !admin;
  const label = $('#newUserPostoField span');
  if (label) label.textContent = admin ? 'Posto' : 'Posto de atuação *';
}

async function saveUser(event) {
  event.preventDefault();
  const uid = $('#editUserUid').value;
  const nome = $('#newUserName').value.trim();
  const email = $('#newUserEmail').value.trim().toLowerCase();
  const role = $('#newUserRole').value;
  const postoId = role === 'admin' ? null : $('#newUserPosto').value;
  const ativo = $('#newUserAtivo').checked;
  const errorBox = $('#userFormError');
  errorBox.classList.add('hidden');

  if (!nome || !role || (role === 'posto' && !postoId)) return showUserError('Preencha os campos obrigatórios.');
  if (uid === state.firebaseUser.uid && (role !== 'admin' || !ativo)) return showUserError('O administrador conectado não pode remover o próprio acesso administrativo nem desativar a própria conta.');

  const posto = role === 'posto' ? state.postos.find((item) => item.id === postoId) : null;
  if (role === 'posto' && (!posto || posto.ativo === false)) {
    return showUserError('Selecione um posto de saúde ativo para esta enfermeira.');
  }

  const cargo = role === 'posto' ? 'enfermeira' : 'administrador';
  const postoNome = posto?.nome || '';
  const postoAtivo = role === 'posto' ? posto?.ativo !== false : null;

  if (uid) {
    try {
      await updateDoc(doc(db, 'usuarios', uid), {
        nome,
        email,
        role,
        cargo,
        postoId,
        postoNome,
        postoAtivo,
        ativo,
        atualizadoEm: serverTimestamp()
      });
      closeModal('userModal');
      await loadUsers(true);
      renderUsers();
      renderPostos();
      showToast(role === 'posto' ? 'Acesso da enfermeira atualizado.' : 'Usuário atualizado.');
    } catch (error) {
      showUserError(firebaseMessage(error));
    }
    return;
  }

  const password = $('#newUserPassword').value;
  if (!email || password.length < 6) return showUserError('Informe um e-mail válido e uma senha inicial com pelo menos 6 caracteres.');
  let secondaryApp;
  let credential;
  let profileCreated = false;
  try {
    secondaryApp = initializeApp(firebaseConfig, `user-create-${Date.now()}`);
    const secondaryAuth = getAuth(secondaryApp);
    credential = await createUserWithEmailAndPassword(secondaryAuth, email, password);

    const profileRef = doc(db, 'usuarios', credential.user.uid);
    await setDoc(profileRef, {
      nome,
      email,
      role,
      cargo,
      postoId,
      postoNome,
      postoAtivo,
      ativo,
      criadoEm: serverTimestamp(),
      atualizadoEm: serverTimestamp()
    });
    profileCreated = true;

    const verification = await getDoc(profileRef);
    const saved = verification.exists() ? verification.data() : null;
    if (!saved || saved.role !== role || saved.ativo !== ativo || (role === 'posto' && saved.postoId !== postoId)) {
      const verificationError = new Error('O perfil foi criado, mas a validação do vínculo falhou. Edite este usuário antes de entregar o acesso.');
      verificationError.code = 'exrisco/profile-verification';
      throw verificationError;
    }

    // Testa o acesso com a própria sessão recém-criada. Assim o administrador
    // só recebe "pronto para entrar" quando as regras publicadas realmente
    // permitem que a enfermeira leia seu perfil, seu posto e o índice da rede.
    if (role === 'posto' && ativo) {
      try {
        const secondaryDb = getFirestore(secondaryApp);
        const ownProfile = await getDoc(doc(secondaryDb, 'usuarios', credential.user.uid));
        if (!ownProfile.exists()) throw new Error('Perfil não encontrado na sessão da enfermeira.');
        const ownPost = await getDoc(doc(secondaryDb, 'postos', postoId));
        if (!ownPost.exists()) throw new Error('Posto vinculado não encontrado.');
        await getDocs(query(
          collection(secondaryDb, 'pacientes_index'),
          window.EXRiscoFirebase.limit(1)
        ));
      } catch (accessError) {
        console.error('Validação real do acesso da enfermeira falhou.', accessError);
        const validationError = new Error('A conta e o perfil foram criados, mas as regras publicadas do Firestore estão bloqueando o acesso da enfermeira. Publique o firestore-rules.txt atual do EXRisco e depois ela poderá entrar com esta mesma conta.');
        validationError.code = 'exrisco/access-validation';
        throw validationError;
      }
    }

    closeModal('userModal');
    await loadUsers(true);
    renderUsers();
    renderPostos();
    showToast(role === 'posto'
      ? 'Enfermeira criada. Ela já pode entrar com o e-mail e a senha cadastrados.'
      : 'Administrador criado. Ele já pode entrar no sistema.');
  } catch (error) {
    console.error(error);
    if (credential?.user && !profileCreated) {
      try { await deleteUser(credential.user); }
      catch (cleanupError) { console.warn('Não foi possível remover a conta criada após falha no perfil.', cleanupError); }
    }
    if (error?.code === 'exrisco/access-validation') {
      closeModal('userModal');
      try { await loadUsers(true); renderUsers(); renderPostos(); } catch (_) {}
      showToast(error.message, 'error');
    } else {
      showUserError(error?.code === 'exrisco/profile-verification' ? error.message : firebaseMessage(error));
    }
  } finally {
    if (secondaryApp) { try { await deleteApp(secondaryApp); } catch (_) {} }
  }
}

function showUserError(text) {
  const el = $('#userFormError');
  el.textContent = text;
  el.classList.remove('hidden');
}

function openCalculator() {
  $('#calculatorFrame').src = CALCULATOR_URL;
  openModal('calculatorModal');
}

function exportCsv() {
  const patients = filteredPatients();
  const headers = ['Nome', 'CPF', 'Data de nascimento', 'Idade', 'Posto', 'Acompanhamentos', 'Risco geral', 'Próximo retorno', 'ACS', 'Status'];
  const rows = patients.map((p) => [
    p.nome, p.cpf || '', p.dataNascimento || '', calculateAge(p.dataNascimento), getPostoName(p.postoId),
    (p.programas || []).map((key) => PROGRAMS[key]?.plural || key).join(' | '), riskLabel(p.riscoGeral), p.proximoRetorno || '', p.acsResumo || '', p.ativo === false ? 'Arquivado' : 'Ativo'
  ]);
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `exrisco-pacientes-${todayIso()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  const s = String(value ?? '').replace(/"/g, '""');
  return `"${s}"`;
}

function printPatients() {
  const patients = filteredPatients();
  const rows = patients.map((p) => `<tr><td>${escapeHtml(p.nome)}</td><td>${escapeHtml(p.cpf || '—')}</td><td>${escapeHtml(getPostoName(p.postoId))}</td><td>${escapeHtml((p.programas || []).map((k) => PROGRAMS[k]?.label || k).join(', '))}</td><td>${escapeHtml(riskLabel(p.riscoGeral))}</td><td>${formatDate(p.proximoRetorno)}</td><td>${escapeHtml(p.acsResumo || '—')}</td></tr>`).join('');
  const w = window.open('', '_blank', 'width=1100,height=800');
  if (!w) return showToast('O navegador bloqueou a janela de impressão.', 'error');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>EXRisco - Pacientes</title><style>body{font-family:Arial,sans-serif;color:#1f3533;padding:28px}h1{margin:0;font-size:22px}p{color:#647674;font-size:11px;margin:5px 0 20px}table{width:100%;border-collapse:collapse;font-size:10px}th,td{padding:8px;border:1px solid #dce5e4;text-align:left}th{background:#f0f6f5}@media print{body{padding:0}}</style></head><body><h1>EXRisco — Relatório de pacientes</h1><p>Gerado em ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeStyle: 'short' }).format(new Date())} · ${patients.length} paciente(s)</p><table><thead><tr><th>Paciente</th><th>CPF</th><th>Posto</th><th>Acompanhamentos</th><th>Risco</th><th>Retorno</th><th>ACS</th></tr></thead><tbody>${rows}</tbody></table><script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
}

function clearFilters() {
  $('#patientSearch').value = '';
  $('#programFilter').value = '';
  $('#riskFilter').value = '';
  $('#patientPostoFilter').value = '';
  $('#patientStatusFilter').value = 'active';
  state.patientPreset = null;
  renderPatients();
}
