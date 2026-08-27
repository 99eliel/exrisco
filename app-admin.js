function renderPostos() {
  if (state.profile?.role !== 'admin') return;
  $('#postosGrid').innerHTML = state.postos.length ? state.postos.map((p) => {
    const patients = state.patients.filter((patient) => patient.postoId === p.id && patient.ativo !== false).length;
    const users = state.users.filter((user) => user.postoId === p.id && user.ativo !== false).length;
    return `<article class="unit-card" data-posto-id="${p.id}"><div class="unit-card-head"><span class="unit-icon">+</span><button class="icon-btn row-icon-btn" data-action="edit-posto">✎</button></div><h3>${escapeHtml(p.nome)}</h3><p>${escapeHtml([p.sigla, p.cnes ? `CNES ${p.cnes}` : ''].filter(Boolean).join(' · ') || 'Sem sigla/CNES informado')}</p><div class="unit-meta"><span class="status-chip${p.ativo === false ? ' off' : ''}">${p.ativo === false ? 'Inativo' : 'Ativo'}</span><span class="mini-badge">${patients} pacientes</span><span class="mini-badge">${users} usuários</span></div></article>`;
  }).join('') : '<div class="empty-state"><div class="empty-icon">+</div><h3>Nenhum posto cadastrado</h3><p>Cadastre a primeira unidade para começar a organizar os usuários e pacientes.</p></div>';
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
    showToast(id ? 'Posto atualizado.' : 'Posto cadastrado.');
  } catch (error) {
    console.error(error);
    showToast(firebaseMessage(error), 'error');
  }
}

function renderUsers() {
  if (state.profile?.role !== 'admin') return;
  $('#usersTableBody').innerHTML = state.users.map((u) => `<tr data-user-id="${u.uid}"><td><div class="patient-name"><strong>${escapeHtml(u.nome || 'Sem nome')}</strong><span>${escapeHtml(u.email || '')}</span></div></td><td>${u.role === 'admin' ? 'Administrador geral' : 'Usuário do posto'}</td><td>${u.role === 'admin' ? 'Todos os postos' : escapeHtml(getPostoName(u.postoId))}</td><td><span class="status-chip${u.ativo === false ? ' off' : ''}">${u.ativo === false ? 'Inativo' : 'Ativo'}</span></td><td><div class="row-actions"><button class="icon-btn row-icon-btn" data-action="edit-user" title="Editar">✎</button></div></td></tr>`).join('');
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
  $('#newUserRole').value = user?.role || 'posto';
  fillPostoSelect($('#newUserPosto'));
  $('#newUserPosto').value = user?.postoId || '';
  $('#newUserAtivo').checked = user?.ativo !== false;
  $('#userModalTitle').textContent = user ? 'Editar usuário' : 'Novo usuário';
  $('#userFormHint').textContent = user ? 'O e-mail e a senha do Firebase Authentication não são alterados por esta tela.' : 'A conta será criada no Firebase Authentication e vinculada ao perfil do sistema.';
  syncUserRoleField();
  openModal('userModal');
}

function syncUserRoleField() {
  const admin = $('#newUserRole').value === 'admin';
  $('#newUserPostoField').classList.toggle('hidden', admin);
  $('#newUserPosto').required = !admin;
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

  if (uid) {
    try {
      await updateDoc(doc(db, 'usuarios', uid), { nome, role, postoId, ativo, atualizadoEm: serverTimestamp() });
      closeModal('userModal');
      await loadUsers();
      renderUsers();
      renderPostos();
      showToast('Usuário atualizado.');
    } catch (error) {
      showUserError(firebaseMessage(error));
    }
    return;
  }

  const password = $('#newUserPassword').value;
  if (!email || password.length < 6) return showUserError('Informe um e-mail válido e uma senha inicial com pelo menos 6 caracteres.');
  let secondaryApp;
  let credential;
  try {
    secondaryApp = initializeApp(firebaseConfig, `user-create-${Date.now()}`);
    const secondaryAuth = getAuth(secondaryApp);
    credential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    await setDoc(doc(db, 'usuarios', credential.user.uid), {
      nome, email, role, postoId, ativo,
      criadoEm: serverTimestamp(),
      atualizadoEm: serverTimestamp()
    });
    closeModal('userModal');
    await loadUsers();
    renderUsers();
    renderPostos();
    showToast('Usuário criado com sucesso.');
  } catch (error) {
    console.error(error);
    if (credential?.user) {
      try { await deleteUser(credential.user); } catch (cleanupError) { console.warn('Não foi possível remover a conta criada após falha no perfil.', cleanupError); }
    }
    showUserError(firebaseMessage(error));
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
