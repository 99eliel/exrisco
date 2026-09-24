function optDashboardMetrics() {
  const blank = optEmptyMetrics();
  const selectedPosto = state.profile?.role === 'admin' ? ($('#dashboardPostoFilter')?.value || '') : state.profile?.postoId;
  const source = selectedPosto ? state.postos.filter((p) => p.id === selectedPosto) : state.postos;
  for (const posto of source) {
    const m = posto.metricas || {};
    for (const key of Object.keys(blank)) blank[key] += Number(m[key] || 0);
  }
  return { selectedPosto, metrics: blank };
}

function optDashboardCacheKey(postoId) {
  return `${postoId || 'rede'}|${todayIso()}`;
}

function optRenderUpcoming(rows = []) {
  const today = todayIso();
  $('#upcomingList').innerHTML = rows.length ? rows.map((p) => {
    const overdue = p.proximoRetorno && p.proximoRetorno < today;
    return `<div class="stack-item"><div><strong>${escapeHtml(p.nome)}</strong><span>${escapeHtml(p.postoNome || getPostoName(p.postoId))} · ${escapeHtml(p.acsResumo || 'ACS não informado')}</span></div><span class="date-chip${overdue ? ' overdue' : ''}">${overdue ? 'Vencido · ' : ''}${formatDate(p.proximoRetorno)}</span></div>`;
  }).join('') : '<div class="empty-inline">Nenhum retorno previsto para os próximos 30 dias.</div>';
}

async function optLoadDashboardExtras(postoId) {
  const cacheKey = optDashboardCacheKey(postoId);
  if (state.opt.dashboardCache.has(cacheKey)) return state.opt.dashboardCache.get(cacheKey);
  const idx = collection(db, 'pacientes_index');
  const today = todayIso();
  const yesterday = addDaysIso(-1);
  const until = addDaysIso(30);
  let overdueQ, upcomingQ;
  if (postoId) {
    overdueQ = query(idx, optOrderBy('postoRetornoKey'), optStartAt(`${postoId}|0000-00-00`), optEndAt(`${postoId}|${yesterday}`));
    upcomingQ = query(idx, optOrderBy('postoRetornoKey'), optStartAt(`${postoId}|${today}`), optEndAt(`${postoId}|${until}`), optLimit(8));
  } else {
    overdueQ = query(idx, optOrderBy('retornoKey'), optStartAt('0000-00-00'), optEndAt(yesterday));
    upcomingQ = query(idx, optOrderBy('retornoKey'), optStartAt(today), optEndAt(until), optLimit(8));
  }
  const [overdueSnap, upcomingSnap] = await Promise.all([optGetCount(overdueQ), getDocs(upcomingQ)]);
  const value = {
    overdue: overdueSnap.data().count,
    upcoming: upcomingSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
  };
  state.opt.dashboardCache.set(cacheKey, value);
  return value;
}

renderDashboard = function optimizedRenderDashboard() {
  if (!state.profile) return;
  const { selectedPosto, metrics: m } = optDashboardMetrics();
  $('#kpiTotal').textContent = m.totalAtivos;
  $('#kpiHigh').textContent = m.riscoAlto;
  $('#kpiPending').textContent = m.examesPendentes;
  $('#kpiTotalSub').textContent = state.profile.role === 'admin' && !selectedPosto ? 'em todos os postos' : 'na unidade selecionada';
  $('#kpiHighSub').textContent = m.riscoAlto ? 'prioridade de acompanhamento' : 'nenhum paciente em alto risco';
  $('#dashboardGreeting').textContent = state.profile.role === 'admin' ? 'Acompanhamento da rede' : `Acompanhamento — ${getPostoName(state.profile.postoId)}`;

  $('#programCards').innerHTML = [
    ['hipertensao', 'Hipertensão', 'H'],
    ['diabetes', 'Diabetes', 'D'],
    ['gestante', 'Gestação', 'G'],
    ['crianca', 'Saúde da Criança', 'C']
  ].map(([key, label, symbol]) => `<article class="program-card"><div class="program-card-top"><span class="program-symbol">${symbol}</span><span>${label}</span></div><strong>${m[key] || 0}</strong><span>em acompanhamento</span></article>`).join('');

  const riskCounts = { alto: m.riscoAlto, intermediario: m.riscoIntermediario, baixo: m.riscoBaixo, nao_informado: m.riscoNaoInformado };
  const max = Math.max(1, ...Object.values(riskCounts));
  $('#riskDistribution').innerHTML = [
    ['alto', 'Alto risco', 'high'],
    ['intermediario', 'Intermediário', 'mid'],
    ['baixo', 'Baixo/Habitual', 'low'],
    ['nao_informado', 'Não informado', 'none']
  ].map(([key, label, cls]) => `<div class="risk-line ${cls}"><span>${label}</span><div class="risk-bar"><i style="width:${Math.round((riskCounts[key] / max) * 100)}%"></i></div><b>${riskCounts[key]}</b></div>`).join('');

  const cacheKey = optDashboardCacheKey(selectedPosto);
  const cached = state.opt.dashboardCache.get(cacheKey);
  if (cached) {
    $('#kpiOverdue').textContent = cached.overdue;
    optRenderUpcoming(cached.upcoming);
  } else {
    $('#kpiOverdue').textContent = '…';
    $('#upcomingList').innerHTML = '<div class="empty-inline">Carregando próximos retornos...</div>';
    if (state.currentView === 'dashboard') optLoadDashboardExtras(selectedPosto).then((x) => {
      if (state.currentView !== 'dashboard') return;
      const current = optDashboardMetrics().selectedPosto;
      if (current !== selectedPosto) return;
      $('#kpiOverdue').textContent = x.overdue;
      optRenderUpcoming(x.upcoming);
    }).catch((error) => {
      console.error(error);
      $('#kpiOverdue').textContent = '—';
      $('#upcomingList').innerHTML = `<div class="form-error">${escapeHtml(firebaseMessage(error))}</div>`;
    });
  }
};

const optLegacyRenderPostos = renderPostos;
renderPostos = function optimizedRenderPostos() {
  if (state.profile?.role !== 'admin') return;
  $('#postosGrid').innerHTML = state.postos.length ? state.postos.map((p) => {
    const total = Number(p.metricas?.totalAtivos || 0);
    const nurse = responsibleNurseForPosto(p.id);
    return `<article class="unit-card" data-posto-id="${p.id}"><div class="unit-card-head"><span class="unit-icon">+</span><button class="icon-btn row-icon-btn" data-action="edit-posto">✎</button></div><h3>${escapeHtml(p.nome)}</h3><p>${escapeHtml([p.sigla, p.cnes ? `CNES ${p.cnes}` : ''].filter(Boolean).join(' · ') || 'Sem sigla/CNES informado')}</p><div class="unit-meta"><span class="status-chip${p.ativo === false ? ' off' : ''}">${p.ativo === false ? 'Inativo' : 'Ativo'}</span><span class="mini-badge">${total} pacientes</span><span class="mini-badge">${nurse ? `Enf. ${escapeHtml(nurse.nome || nurse.email || 'Responsável')}` : 'Enfermeira carregada ao abrir a gestão'}</span></div></article>`;
  }).join('') : '<div class="empty-state"><div class="empty-icon">+</div><h3>Nenhum posto cadastrado</h3><p>Cadastre a primeira unidade e depois vincule a enfermeira responsável.</p></div>';
};

const optLegacySwitchView = switchView;
switchView = function optimizedSwitchView(view) {
  optLegacySwitchView(view);
  if (view === 'pacientes') {
    state.opt.patientRequested = true;
    optQueryPatientPage(true);
  }
  if ((view === 'usuarios' || view === 'postos') && state.profile?.role === 'admin' && !state.opt.usersLoaded) {
    loadUsers(true).then(() => { renderUsers(); renderPostos(); }).catch((e) => showToast(firebaseMessage(e), 'error'));
  }
};

