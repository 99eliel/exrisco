// Importação seletiva: somente pacientes que realmente entram no EXRisco.
readBaseFile = async function optimizedReadBaseFile(event) {
  const box = $('#importBaseError');
  box.classList.add('hidden');
  try {
    const file = event.target.files?.[0];
    if (!file) return;
    const data = JSON.parse(await file.text());
    if (data.schema !== 'exrisco-importacao-seletiva-v2' || !Array.isArray(data.postos) || !Array.isArray(data.pacientes)) throw new Error('Arquivo incompatível com a carga seletiva do EXRisco.');
    state.pendingImportData = data;
    $('#importBaseSummary').textContent = `${data.postos.length} postos · ${data.pacientes.length.toLocaleString('pt-BR')} pacientes selecionados · ${data.criterio?.incluidosAgora?.join(', ') || 'carga inicial'}`;
    $('#runImportBtn').disabled = false;
  } catch (error) {
    box.textContent = error.message;
    box.classList.remove('hidden');
    $('#runImportBtn').disabled = true;
  }
};

runBaseImport = async function optimizedRunBaseImport() {
  const data = state.pendingImportData;
  if (!data || state.profile?.role !== 'admin') return;
  const errorBox = $('#importBaseError');
  const bar = $('#importProgressBar');
  const status = $('#importStatus');
  errorBox.classList.add('hidden');
  $('#runImportBtn').disabled = true;
  $('#importProgressWrap').classList.remove('hidden');
  try {
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
        for (const key of Object.keys(metrics)) metrics[key] += mv[key];
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
    const chunkSize = 150;
    let done = 0;
    for (let offset = 0; offset < total; offset += chunkSize) {
      const batch = optBatch(db);
      for (const p of data.pacientes.slice(offset, offset + chunkSize)) {
        const patient = {
          ...p,
          nomeBusca: normalizeText(p.nome),
          cpfNormalizado: String(p.cpfNormalizado || p.cpf || '').replace(/\D/g, ''),
          cns: String(p.cnsNormalizado || p.cns || '').replace(/\D/g, ''),
          cnsNormalizado: String(p.cnsNormalizado || p.cns || '').replace(/\D/g, ''),
          programas: p.programas?.length ? p.programas : ['crianca'],
          dados: p.dados || { crianca: {} },
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

// Reassocia os handlers criados por app-network.js às funções otimizadas.
if ($('#importBaseFile')) $('#importBaseFile').onchange = readBaseFile;
if ($('#runImportBtn')) $('#runImportBtn').onclick = runBaseImport;
if ($('#importBaseModal .net-help')) $('#importBaseModal .net-help').textContent = 'Importe somente a carga seletiva preparada para o EXRisco. O arquivo vai direto do seu computador para o Firebase e não é publicado no GitHub.';
if ($('#networkSearchModal .net-help')) $('#networkSearchModal .net-help').textContent = 'Busca somente pacientes que realmente fazem parte do EXRisco. Exibe identificação e unidade; dados clínicos de outro posto continuam protegidos.';

if ($('#networkSearchBtn')) $('#networkSearchBtn').textContent = '⌕ Buscar paciente';
if ($('#networkSearchModal h2')) $('#networkSearchModal h2').textContent = 'Buscar paciente na rede';
if ($('#importBaseBtn')) $('#importBaseBtn').textContent = '⇧ Importar carga seletiva';
if ($('#exportCsvBtn')) $('#exportCsvBtn').title = 'Exporta somente os pacientes carregados na tela, evitando leituras extras.';
if ($('#printBtn')) $('#printBtn').title = 'Imprime somente os pacientes carregados na tela, evitando leituras extras.';
