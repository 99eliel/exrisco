// EXRisco — programa Pessoa Idosa (60+) e proteção da carga seletiva.
// Carregado depois das camadas otimizadas e antes do app-main.js.

PROGRAMS.idoso = {
  label: 'Pessoa idosa',
  plural: 'Pessoas idosas',
  symbol: 'I',
  subtitle: 'Acompanhamento de pessoas com 60 anos ou mais',
  fields: [
    { key: 'dataProximaConsulta', label: 'Data da próxima consulta', type: 'date' },
    { key: 'acs', label: 'ACS responsável', type: 'text', placeholder: 'Nome do ACS' },
    { key: 'observacoes', label: 'Observações', type: 'textarea', span: 2 }
  ]
};

// Inclui idosos nos contadores incrementais por posto sem acrescentar leituras.
const elderlyBaseEmptyMetrics = optEmptyMetrics;
optEmptyMetrics = function elderlyAwareEmptyMetrics() {
  return { ...elderlyBaseEmptyMetrics(), idoso: 0 };
};

// O dashboard otimizado original possui quatro cards fixos. Acrescenta o quinto
// a partir das mesmas métricas já carregadas no documento do posto.
const elderlyBaseRenderDashboard = renderDashboard;
renderDashboard = function elderlyAwareDashboard() {
  elderlyBaseRenderDashboard();
  if (!state.profile || !$('#programCards')) return;
  const { metrics } = optDashboardMetrics();
  $('#programCards').insertAdjacentHTML('beforeend', `
    <article class="program-card" data-program-card="idoso">
      <div class="program-card-top"><span class="program-symbol">I</span><span>Pessoa idosa</span></div>
      <strong>${Number(metrics.idoso || 0)}</strong><span>em acompanhamento</span>
    </article>
  `);
};

// Filtro da listagem. O formulário de paciente é gerado de PROGRAMS e já passa
// a exibir Pessoa idosa automaticamente antes da inicialização do app-main.js.
if ($('#programFilter') && !$('#programFilter option[value="idoso"]')) {
  $('#programFilter').insertAdjacentHTML('beforeend', '<option value="idoso">Pessoas idosas</option>');
}

// Importação endurecida: CNS precisa ter exatamente 15 dígitos e CNES do posto
// fica em cnesPosto. Evita que cargas legadas confundam CNES com CNS.
runBaseImport = async function elderlySafeRunBaseImport() {
  const data = state.pendingImportData;
  if (!data || state.profile?.role !== 'admin') return;
  const errorBox = $('#importBaseError');
  const bar = $('#importProgressBar');
  const status = $('#importStatus');
  errorBox.classList.add('hidden');
  $('#runImportBtn').disabled = true;
  $('#importProgressWrap').classList.remove('hidden');

  try {
    const postoById = new Map(data.postos.map((p) => [p.id, p]));
    const grouped = new Map(data.postos.map((p) => [p.id, []]));
    for (const p of data.pacientes) {
      if (!grouped.has(p.postoId)) grouped.set(p.postoId, []);
      grouped.get(p.postoId).push(p);
    }

    for (const posto of data.postos) {
      const rows = grouped.get(posto.id) || [];
      const metrics = optEmptyMetrics();
      for (const p of rows) {
        const mv = optPatientMetrics(p);
        for (const key of Object.keys(metrics)) metrics[key] += Number(mv[key] || 0);
      }
      await setDoc(doc(db, 'postos', posto.id), {
        nome: posto.nome,
        sigla: posto.sigla || '',
        cnes: posto.cnes || '',
        ativo: posto.ativo !== false,
        metricas: metrics,
        atualizadoEm: serverTimestamp()
      }, { merge: true });
    }

    const total = data.pacientes.length;
    const chunkSize = 150; // 2 writes/paciente = 300 operações por batch.
    let done = 0;

    for (let offset = 0; offset < total; offset += chunkSize) {
      const batch = optBatch(db);
      for (const p of data.pacientes.slice(offset, offset + chunkSize)) {
        const cpfRaw = String(p.cpfNormalizado || p.cpf || '').replace(/\D/g, '');
        const cpfDigits = cpfRaw.length === 11 ? cpfRaw : '';
        const cnsRaw = String(p.cnsNormalizado || p.cns || '').replace(/\D/g, '');
        const cnsDigits = cnsRaw.length === 15 ? cnsRaw : '';
        const programs = p.programas?.length ? [...new Set(p.programas)] : ['crianca'];
        const dados = { ...(p.dados || {}) };
        for (const program of programs) dados[program] ||= {};
        const postoInfo = postoById.get(p.postoId);

        const patient = {
          ...p,
          nomeBusca: normalizeText(p.nome),
          cpf: cpfDigits ? maskCpf(cpfDigits) : '',
          cpfNormalizado: cpfDigits,
          cns: cnsDigits,
          cnsNormalizado: cnsDigits,
          cnesPosto: p.cnesPosto || postoInfo?.cnes || '',
          programas: programs,
          dados,
          riscoGeral: p.riscoGeral || 'nao_informado',
          proximoRetorno: p.proximoRetorno || '',
          acsResumo: p.acsResumo || '',
          examesPendentes: Boolean(p.examesPendentes),
          ativo: p.ativo !== false,
          criadoPor: state.firebaseUser.uid,
          atualizadoPor: state.firebaseUser.uid,
          criadoEm: serverTimestamp(),
          atualizadoEm: serverTimestamp(),
          origemTipo: p.origemTipo || 'carga_inicial_seletiva'
        };

        const patientRef = doc(db, 'pacientes', p.id);
        batch.set(patientRef, patient, { merge: true });
        batch.set(doc(db, 'pacientes_index', p.id), optIndexPayload({ id: p.id, ...patient }), { merge: true });
      }
      await batch.commit();
      done += Math.min(chunkSize, total - offset);
      const pct = Math.round((done / total) * 100);
      bar.style.width = `${pct}%`;
      status.textContent = `${done.toLocaleString('pt-BR')} de ${total.toLocaleString('pt-BR')} (${pct}%)`;
    }

    await loadPostos();
    refreshPostoFilters();
    state.opt.patientSignature = '';
    state.opt.dashboardCache.clear();
    renderPostos();
    renderDashboard();
    status.textContent = `Concluído: ${total.toLocaleString('pt-BR')} pacientes importados.`;
    showToast('Carga seletiva importada com sucesso.');
  } catch (error) {
    console.error(error);
    errorBox.textContent = firebaseMessage(error);
    errorBox.classList.remove('hidden');
    $('#runImportBtn').disabled = false;
  }
};

if ($('#runImportBtn')) $('#runImportBtn').onclick = runBaseImport;
