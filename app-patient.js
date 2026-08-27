function renderProgramSelector() {
  $('#programSelector').innerHTML = Object.entries(PROGRAMS).map(([key, p]) => `
    <label class="program-check">
      <input type="checkbox" class="program-checkbox" value="${key}">
      <span class="program-symbol">${p.symbol}</span>
      <span><strong>${escapeHtml(p.plural)}</strong><small>${escapeHtml(p.subtitle)}</small></span>
    </label>
  `).join('');

  $('#programForms').innerHTML = Object.entries(PROGRAMS).map(([key, p]) => `
    <section class="program-form" data-program-form="${key}">
      <div class="program-form-head"><span class="program-symbol">${p.symbol}</span><div><h4>${escapeHtml(p.plural)}</h4><p>${escapeHtml(p.subtitle)}</p></div></div>
      <div class="form-grid two">${p.fields.map((field) => renderField(key, field)).join('')}</div>
    </section>
  `).join('');

  $$('.program-checkbox').forEach((checkbox) => checkbox.addEventListener('change', syncProgramForms));
}

function renderField(program, field) {
  const id = `field-${program}-${field.key}`;
  const span = field.span === 2 ? ' span-2' : '';
  let control = '';
  if (field.type === 'select') {
    control = `<select id="${id}" data-program="${program}" data-key="${field.key}"><option value="">Selecione...</option>${field.options.map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join('')}</select>`;
  } else if (field.type === 'textarea') {
    control = `<textarea id="${id}" data-program="${program}" data-key="${field.key}" placeholder="${escapeHtml(field.placeholder || '')}"></textarea>`;
  } else {
    control = `<input id="${id}" data-program="${program}" data-key="${field.key}" type="${field.type || 'text'}" ${field.min !== undefined ? `min="${field.min}"` : ''} placeholder="${escapeHtml(field.placeholder || '')}">`;
  }
  return `<label class="field${span}"><span>${escapeHtml(field.label)}</span>${control}</label>`;
}

function syncProgramForms() {
  $$('.program-checkbox').forEach((checkbox) => {
    const section = document.querySelector(`[data-program-form="${checkbox.value}"]`);
    section?.classList.toggle('active', checkbox.checked);
  });
}

function resetPatientForm() {
  $('#patientForm').reset();
  $('#patientId').value = '';
  $('#patientAge').value = '';
  $('#patientFormMessage').classList.add('hidden');
  $$('.program-checkbox').forEach((c) => { c.checked = false; });
  $$('#programForms [data-program]').forEach((el) => { el.value = ''; });
  syncProgramForms();
}

function fillPostoSelect(select, includeBlank = true) {
  const activePostos = state.postos.filter((p) => p.ativo !== false);
  select.innerHTML = `${includeBlank ? '<option value="">Selecione...</option>' : ''}${activePostos.map((p) => `<option value="${p.id}">${escapeHtml(p.nome)}</option>`).join('')}`;
}

function openPatient(patient = null) {
  resetPatientForm();
  $('#patientModalTitle').textContent = patient ? 'Editar paciente' : 'Novo paciente';
  const isAdmin = state.profile?.role === 'admin';
  $('#patientPostoField').classList.toggle('hidden', !isAdmin);
  if (isAdmin) fillPostoSelect($('#patientPosto'));

  if (patient) {
    $('#patientId').value = patient.id;
    $('#patientName').value = patient.nome || '';
    $('#patientCpf').value = patient.cpf || '';
    $('#patientBirth').value = patient.dataNascimento || '';
    $('#patientAge').value = calculateAge(patient.dataNascimento);
    if (isAdmin) $('#patientPosto').value = patient.postoId || '';
    (patient.programas || []).forEach((program) => {
      const checkbox = document.querySelector(`.program-checkbox[value="${program}"]`);
      if (checkbox) checkbox.checked = true;
      const data = patient.dados?.[program] || {};
      Object.entries(data).forEach(([key, value]) => {
        const field = document.getElementById(`field-${program}-${key}`);
        if (field) field.value = value ?? '';
      });
    });
    syncProgramForms();
  } else if (isAdmin && $('#dashboardPostoFilter').value) {
    $('#patientPosto').value = $('#dashboardPostoFilter').value;
  }
  openModal('patientModal');
  setTimeout(() => $('#patientName').focus(), 80);
}

function collectProgramData() {
  const programas = $$('.program-checkbox:checked').map((c) => c.value);
  const dados = {};
  for (const program of programas) {
    dados[program] = {};
    document.querySelectorAll(`[data-program="${program}"]`).forEach((field) => {
      const value = typeof field.value === 'string' ? field.value.trim() : field.value;
      dados[program][field.dataset.key] = value;
    });
  }
  return { programas, dados };
}

async function savePatient(event) {
  event.preventDefault();
  const message = $('#patientFormMessage');
  message.classList.add('hidden');
  const id = $('#patientId').value;
  const nome = $('#patientName').value.trim();
  const cpf = maskCpf($('#patientCpf').value);
  const dataNascimento = $('#patientBirth').value;
  const postoId = state.profile.role === 'admin' ? $('#patientPosto').value : state.profile.postoId;
  const { programas, dados } = collectProgramData();

  if (!nome || !dataNascimento || !postoId) return showPatientError('Preencha nome, data de nascimento e posto de saúde.');
  if (!programas.length) return showPatientError('Selecione pelo menos um acompanhamento.');

  const cpfNormalizado = cpf.replace(/\D/g, '');
  if (cpfNormalizado) {
    const duplicate = state.patients.find((p) => p.id !== id && p.cpfNormalizado === cpfNormalizado && p.ativo !== false);
    if (duplicate) return showPatientError(`Já existe um paciente ativo com este CPF: ${duplicate.nome}.`);
  }

  const derived = derivePatient(programas, dados);
  const payload = {
    nome,
    nomeBusca: normalizeText(nome),
    cpf,
    cpfNormalizado,
    dataNascimento,
    postoId,
    programas,
    dados,
    ...derived,
    ativo: id ? state.patients.find((p) => p.id === id)?.ativo !== false : true,
    atualizadoEm: serverTimestamp(),
    atualizadoPor: state.firebaseUser.uid
  };

  $('#savePatientBtn').disabled = true;
  try {
    let patientId = id;
    if (id) {
      await updateDoc(doc(db, 'pacientes', id), payload);
      await addHistory(id, postoId, 'edição', `Cadastro e acompanhamento atualizados para ${nome}.`);
    } else {
      payload.criadoEm = serverTimestamp();
      payload.criadoPor = state.firebaseUser.uid;
      const ref = await addDoc(collection(db, 'pacientes'), payload);
      patientId = ref.id;
      await addHistory(patientId, postoId, 'criação', `Paciente ${nome} cadastrado no sistema.`);
    }
    closeModal('patientModal');
    await loadPatients();
    renderDashboard();
    renderPatients();
    showToast(id ? 'Paciente atualizado com sucesso.' : 'Paciente cadastrado com sucesso.');
  } catch (error) {
    console.error(error);
    showPatientError(firebaseMessage(error));
  } finally {
    $('#savePatientBtn').disabled = false;
  }
}

function showPatientError(text) {
  const el = $('#patientFormMessage');
  el.textContent = text;
  el.classList.remove('hidden');
  return false;
}

async function addHistory(patientId, postoId, acao, resumo) {
  await addDoc(collection(db, 'historico'), {
    patientId,
    postoId,
    acao,
    resumo,
    userId: state.firebaseUser.uid,
    userName: state.profile.nome || state.firebaseUser.email,
    criadoEm: serverTimestamp()
  });
}

async function loadPostos() {
  if (state.profile.role === 'admin') {
    const snap = await getDocs(collection(db, 'postos'));
    state.postos = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));
  } else {
    const snap = await getDoc(doc(db, 'postos', state.profile.postoId));
    state.postos = snap.exists() ? [{ id: snap.id, ...snap.data() }] : [];
  }
}

async function loadPatients() {
  const ref = state.profile.role === 'admin'
    ? collection(db, 'pacientes')
    : query(collection(db, 'pacientes'), where('postoId', '==', state.profile.postoId));
  const snap = await getDocs(ref);
  state.patients = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));
}

async function loadUsers() {
  if (state.profile.role !== 'admin') { state.users = []; return; }
  const snap = await getDocs(collection(db, 'usuarios'));
  state.users = snap.docs.map((d) => ({ uid: d.id, ...d.data() })).sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));
}

async function loadAllData() {
  await loadPostos();
  await Promise.all([loadPatients(), loadUsers()]);
  refreshPostoFilters();
  renderDashboard();
  renderPatients();
  renderPostos();
  renderUsers();
}

function refreshPostoFilters() {
  const options = state.postos.filter((p) => p.ativo !== false).map((p) => `<option value="${p.id}">${escapeHtml(p.nome)}</option>`).join('');
  ['dashboardPostoFilter', 'patientPostoFilter'].forEach((id) => {
    const select = document.getElementById(id);
    if (!select) return;
    const current = select.value;
    select.innerHTML = `<option value="">Todos os postos</option>${options}`;
    if ([...select.options].some((o) => o.value === current)) select.value = current;
  });
  fillPostoSelect($('#newUserPosto'));
}

function dashboardPatients() {
  let patients = state.patients.filter((p) => p.ativo !== false);
  if (state.profile.role === 'admin') {
    const posto = $('#dashboardPostoFilter').value;
    if (posto) patients = patients.filter((p) => p.postoId === posto);
  }
  return patients;
}

function renderDashboard() {
  if (!state.profile) return;
  const patients = dashboardPatients();
  const today = todayIso();
  const high = patients.filter((p) => p.riscoGeral === 'alto').length;
  const overdue = patients.filter((p) => p.proximoRetorno && p.proximoRetorno < today).length;
  const pending = patients.filter((p) => p.examesPendentes).length;
  $('#kpiTotal').textContent = patients.length;
  $('#kpiHigh').textContent = high;
  $('#kpiOverdue').textContent = overdue;
  $('#kpiPending').textContent = pending;
  $('#kpiTotalSub').textContent = state.profile.role === 'admin' && !$('#dashboardPostoFilter').value ? 'em todos os postos' : 'na unidade selecionada';
  $('#kpiHighSub').textContent = high ? 'prioridade de acompanhamento' : 'nenhum paciente em alto risco';
  $('#dashboardGreeting').textContent = state.profile.role === 'admin' ? 'Acompanhamento da rede' : `Acompanhamento — ${getPostoName(state.profile.postoId)}`;

  $('#programCards').innerHTML = Object.entries(PROGRAMS).map(([key, p]) => {
    const count = patients.filter((patient) => patient.programas?.includes(key)).length;
    return `<article class="program-card"><div class="program-card-top"><span class="program-symbol">${p.symbol}</span><span>${escapeHtml(p.label)}</span></div><strong>${count}</strong><span>${escapeHtml(p.plural)} em acompanhamento</span></article>`;
  }).join('');

  const upcoming = patients
    .filter((p) => p.proximoRetorno)
    .sort((a, b) => a.proximoRetorno.localeCompare(b.proximoRetorno))
    .filter((p) => p.proximoRetorno <= addDaysIso(30))
    .slice(0, 8);
  $('#upcomingList').innerHTML = upcoming.length ? upcoming.map((p) => {
    const isOverdue = p.proximoRetorno < today;
    return `<div class="stack-item"><div><strong>${escapeHtml(p.nome)}</strong><span>${escapeHtml(getPostoName(p.postoId))} · ${escapeHtml(p.acsResumo || 'ACS não informado')}</span></div><span class="date-chip${isOverdue ? ' overdue' : ''}">${isOverdue ? 'Vencido · ' : ''}${formatDate(p.proximoRetorno)}</span></div>`;
  }).join('') : '<div class="empty-inline">Nenhum retorno vencido ou previsto para os próximos 30 dias.</div>';

  const counts = {
    alto: patients.filter((p) => p.riscoGeral === 'alto').length,
    intermediario: patients.filter((p) => p.riscoGeral === 'intermediario').length,
    baixo: patients.filter((p) => p.riscoGeral === 'baixo').length,
    nao_informado: patients.filter((p) => !p.riscoGeral || p.riscoGeral === 'nao_informado').length
  };
  const max = Math.max(1, ...Object.values(counts));
  $('#riskDistribution').innerHTML = [
    ['alto', 'Alto risco', 'high'],
    ['intermediario', 'Intermediário', 'mid'],
    ['baixo', 'Baixo/Habitual', 'low'],
    ['nao_informado', 'Não informado', 'none']
  ].map(([key, label, cls]) => `<div class="risk-line ${cls}"><span>${label}</span><div class="risk-bar"><i style="width:${Math.round((counts[key] / max) * 100)}%"></i></div><b>${counts[key]}</b></div>`).join('');
}

function addDaysIso(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function filteredPatients() {
  const search = normalizeText($('#patientSearch').value);
  const searchDigits = $('#patientSearch').value.replace(/\D/g, '');
  const program = $('#programFilter').value;
  const risk = $('#riskFilter').value;
  const posto = $('#patientPostoFilter').value;
  const status = $('#patientStatusFilter').value;
  let list = [...state.patients];

  if (search) list = list.filter((p) => normalizeText(p.nome).includes(search) || (searchDigits && String(p.cpfNormalizado || '').includes(searchDigits)));
  if (program) list = list.filter((p) => p.programas?.includes(program));
  if (risk) list = list.filter((p) => p.riscoGeral === risk);
  if (posto && state.profile.role === 'admin') list = list.filter((p) => p.postoId === posto);
  if (status === 'active') list = list.filter((p) => p.ativo !== false);
  if (status === 'archived') list = list.filter((p) => p.ativo === false);
  if (state.patientPreset === 'overdue') list = list.filter((p) => p.ativo !== false && p.proximoRetorno && p.proximoRetorno < todayIso());
  return list;
}

function renderPatients() {
  if (!state.profile) return;
  const patients = filteredPatients();
  const body = $('#patientsTableBody');
  body.innerHTML = patients.map((p) => {
    const active = p.ativo !== false;
    const programBadges = (p.programas || []).map((key) => `<span class="mini-badge">${escapeHtml(PROGRAMS[key]?.label || key)}</span>`).join('');
    const adminCell = state.profile.role === 'admin' ? `<td class="admin-only-cell">${escapeHtml(getPostoName(p.postoId))}</td>` : '<td class="admin-only-cell"></td>';
    const overdue = active && p.proximoRetorno && p.proximoRetorno < todayIso();
    return `<tr data-patient-id="${p.id}"${active ? '' : ' style="opacity:.62"'}>
      <td><div class="patient-name"><strong>${escapeHtml(p.nome)}</strong><span>${escapeHtml(p.cpf || 'CPF não informado')} · ${calculateAge(p.dataNascimento)} anos${active ? '' : ' · ARQUIVADO'}</span></div></td>
      <td><div class="badge-row">${programBadges || '<span class="mini-badge">Sem acompanhamento</span>'}</div></td>
      <td><span class="risk-badge ${riskClass(p.riscoGeral)}">${escapeHtml(riskLabel(p.riscoGeral))}</span></td>
      <td><span${overdue ? ' style="color:#b42318;font-weight:800"' : ''}>${formatDate(p.proximoRetorno)}${overdue ? ' · vencido' : ''}</span></td>
      <td>${escapeHtml(p.acsResumo || '—')}</td>
      ${adminCell}
      <td><div class="row-actions"><button class="icon-btn row-icon-btn" data-action="history" title="Histórico">◷</button><button class="icon-btn row-icon-btn" data-action="edit" title="Editar">✎</button><button class="icon-btn row-icon-btn" data-action="toggle" title="${active ? 'Arquivar' : 'Reativar'}">${active ? '⊘' : '↺'}</button></div></td>
    </tr>`;
  }).join('');
  $('#patientCount').textContent = `${patients.length} ${patients.length === 1 ? 'paciente' : 'pacientes'}`;
  $('#filterSummary').textContent = state.patientPreset === 'overdue' ? '· apenas retornos vencidos' : '';
  $('#patientsEmpty').classList.toggle('hidden', patients.length > 0);
  $('.table-scroll').classList.toggle('hidden', patients.length === 0);
  $$('.admin-only-cell').forEach((el) => el.classList.toggle('hidden', state.profile.role !== 'admin'));
}

async function togglePatient(patient) {
  const active = patient.ativo !== false;
  const ok = await confirmAction(active ? 'Arquivar paciente' : 'Reativar paciente', active
    ? `O paciente ${patient.nome} deixará de aparecer entre os pacientes ativos, mas todo o histórico será preservado.`
    : `O paciente ${patient.nome} voltará aos acompanhamentos ativos.`, active ? 'Arquivar' : 'Reativar');
  if (!ok) return;
  try {
    await updateDoc(doc(db, 'pacientes', patient.id), { ativo: !active, atualizadoEm: serverTimestamp(), atualizadoPor: state.firebaseUser.uid });
    await addHistory(patient.id, patient.postoId, active ? 'arquivamento' : 'reativação', active ? 'Paciente arquivado.' : 'Paciente reativado.');
    await loadPatients();
    renderPatients();
    renderDashboard();
    showToast(active ? 'Paciente arquivado.' : 'Paciente reativado.');
  } catch (error) {
    console.error(error);
    showToast(firebaseMessage(error), 'error');
  }
}

async function openHistory(patient) {
  $('#historyTitle').textContent = `Histórico — ${patient.nome}`;
  $('#historyList').innerHTML = '<div class="empty-inline">Carregando histórico...</div>';
  openModal('historyModal');
  try {
    const snap = await getDocs(query(collection(db, 'historico'), where('patientId', '==', patient.id), where('postoId', '==', patient.postoId)));
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => {
      const ta = a.criadoEm?.toMillis?.() || 0;
      const tb = b.criadoEm?.toMillis?.() || 0;
      return tb - ta;
    });
    $('#historyList').innerHTML = items.length ? items.map((item) => `<div class="timeline-item"><span class="timeline-dot"></span><strong>${escapeHtml(capitalize(item.acao || 'alteração'))}</strong><p>${escapeHtml(item.resumo || '')}</p><small>${escapeHtml(item.userName || 'Usuário')} · ${formatTimestamp(item.criadoEm)}</small></div>`).join('') : '<div class="empty-inline">Ainda não há registros de histórico.</div>';
  } catch (error) {
    $('#historyList').innerHTML = `<div class="form-error">${escapeHtml(firebaseMessage(error))}</div>`;
  }
}

function capitalize(value) {
  const s = String(value || '');
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
