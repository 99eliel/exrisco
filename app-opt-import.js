// Importação seletiva: somente pacientes que realmente entram no EXRisco.

function importPostCnes(value = '') {
  return String(value || '').replace(/\D/g, '');
}

function importPostName(value = '') {
  return normalizeText(value).replace(/\s+/g, ' ').trim();
}

function importPostTotal(posto) {
  return Number(posto?.metricas?.totalAtivos || 0);
}

function importPostsEquivalent(a, b) {
  const cnesA = importPostCnes(a?.cnes);
  const cnesB = importPostCnes(b?.cnes);
  if (cnesA && cnesB && cnesA === cnesB) return true;
  const nomeA = importPostName(a?.nome);
  const nomeB = importPostName(b?.nome);
  return Boolean(nomeA && nomeB && nomeA === nomeB);
}

function importDuplicatePostGroups() {
  const posts = state.postos.filter((p) => !p.mescladoPara);
  const visited = new Set();
  const groups = [];
  for (const start of posts) {
    if (visited.has(start.id)) continue;
    const group = [];
    const queue = [start];
    visited.add(start.id);
    while (queue.length) {
      const current = queue.shift();
      group.push(current);
      for (const candidate of posts) {
        if (visited.has(candidate.id)) continue;
        if (group.some((item) => importPostsEquivalent(item, candidate))) {
          visited.add(candidate.id);
          queue.push(candidate);
        }
      }
    }
    if (group.length > 1) groups.push(group);
  }
  return groups;
}

function importChooseCanonicalPost(group) {
  return [...group].sort((a, b) => {
    const patients = importPostTotal(b) - importPostTotal(a);
    if (patients) return patients;
    const cnes = Number(Boolean(importPostCnes(b.cnes))) - Number(Boolean(importPostCnes(a.cnes)));
    if (cnes) return cnes;
    return Number(b.ativo !== false) - Number(a.ativo !== false);
  })[0];
}

function importResolveExistingPost(sourcePosto) {
  const active = state.postos.filter((p) => !p.mescladoPara);
  const sourceCnes = importPostCnes(sourcePosto.cnes);
  if (sourceCnes) {
    const byCnes = active.find((p) => importPostCnes(p.cnes) === sourceCnes);
    if (byCnes) return byCnes;
  }
  const sourceName = importPostName(sourcePosto.nome);
  if (sourceName) {
    const byName = active.find((p) => importPostName(p.nome) === sourceName);
    if (byName) return byName;
  }
  return null;
}

function importEnsureConsolidateButton() {
  if (state.profile?.role !== 'admin') return null;
  let btn = $('#consolidatePostosBtn');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'consolidatePostosBtn';
    btn.type = 'button';
    btn.className = 'btn ghost';
    btn.onclick = importConsolidateDuplicatePosts;
    $('#view-postos .section-actions')?.appendChild(btn);
  }
  return btn;
}

function importRefreshConsolidateButton() {
  const btn = importEnsureConsolidateButton();
  if (!btn) return;
  const groups = importDuplicatePostGroups();
  btn.classList.toggle('hidden', groups.length === 0);
  btn.textContent = groups.length ? `⚙ Consolidar ${groups.length} posto${groups.length > 1 ? 's' : ''} duplicado${groups.length > 1 ? 's' : ''}` : '⚙ Consolidar postos duplicados';
}

async function importConsolidateDuplicatePosts() {
  if (state.profile?.role !== 'admin') return;
  const groups = importDuplicatePostGroups();
  if (!groups.length) return showToast('Nenhum posto duplicado encontrado.');
  if (!window.confirm(`Foram encontrados ${groups.length} grupos de postos duplicados. O EXRisco manterá o posto com pacientes, transferirá eventual enfermeira do card vazio e arquivará o duplicado. Continuar?`)) return;

  const btn = $('#consolidatePostosBtn');
  if (btn) btn.disabled = true;
  let merged = 0;
  let skipped = 0;
  try {
    for (const group of groups) {
      const canonical = importChooseCanonicalPost(group);
      const duplicates = group.filter((p) => p.id !== canonical.id);
      for (const duplicate of duplicates) {
        // Só arquivamos automaticamente duplicados realmente vazios. Se houver algum
        // prontuário no documento antigo, preservamos o posto para revisão manual.
        const patientSnap = await getDocs(query(collection(db, 'pacientes'), where('postoId', '==', duplicate.id), optLimit(1)));
        if (!patientSnap.empty) {
          skipped++;
          continue;
        }

        const userSnap = await getDocs(query(collection(db, 'usuarios'), where('postoId', '==', duplicate.id)));
        const batch = optBatch(db);
        for (const userDoc of userSnap.docs) {
          batch.update(doc(db, 'usuarios', userDoc.id), {
            postoId: canonical.id,
            postoNome: canonical.nome || '',
            atualizadoEm: serverTimestamp()
          });
        }
        batch.update(doc(db, 'postos', duplicate.id), {
          ativo: false,
          mescladoPara: canonical.id,
          mescladoEm: serverTimestamp(),
          atualizadoEm: serverTimestamp()
        });
        await batch.commit();
        merged++;
      }
    }

    await loadPostos();
    refreshPostoFilters();
    renderPostos();
    state.opt.dashboardCache.clear();
    renderDashboard();
    if (skipped) showToast(`${merged} posto(s) consolidado(s). ${skipped} duplicado(s) tinham prontuários e foram preservados para revisão.`, 'error');
    else showToast(`${merged} posto(s) duplicado(s) consolidados com sucesso.`);
  } catch (error) {
    console.error(error);
    showToast(firebaseMessage(error), 'error');
  } finally {
    if (btn) btn.disabled = false;
    importRefreshConsolidateButton();
  }
}

// Depois de uma consolidação, documentos antigos permanecem arquivados no Firestore
// para auditoria, mas não entram mais nas listas e filtros do sistema.
const importPreviousLoadPostos = loadPostos;
loadPostos = async function importAwareLoadPostos() {
  await importPreviousLoadPostos();
  state.postos = state.postos.filter((p) => !p.mescladoPara);
};

const importPreviousRenderPostos = renderPostos;
renderPostos = function importAwareRenderPostos() {
  importPreviousRenderPostos();
  importRefreshConsolidateButton();
};

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
    // Reutiliza postos já existentes. CNES tem prioridade; nome normalizado é o fallback.
    const postoMap = new Map();
    for (const posto of data.postos) {
      const existing = importResolveExistingPost(posto);
      const targetId = existing?.id || posto.id;
      postoMap.set(posto.id, targetId);
      if (!existing) {
        const provisional = { id: targetId, ...posto, metricas: optEmptyMetrics() };
        state.postos.push(provisional);
      }
    }

    const grouped = new Map([...postoMap.values()].map((id) => [id, []]));
    for (const p of data.pacientes) {
      const targetPostoId = postoMap.get(p.postoId) || p.postoId;
      if (!grouped.has(targetPostoId)) grouped.set(targetPostoId, []);
      grouped.get(targetPostoId).push({ ...p, postoId: targetPostoId });
    }

    for (const posto of data.postos) {
      const targetId = postoMap.get(posto.id) || posto.id;
      const rows = grouped.get(targetId) || [];
      const metrics = optEmptyMetrics();
      for (const p of rows) {
        const mv = optPatientMetrics(p);
        for (const key of Object.keys(metrics)) metrics[key] += mv[key];
      }
      const existing = state.postos.find((p) => p.id === targetId);
      await setDoc(doc(db, 'postos', targetId), {
        nome: existing?.nome || posto.nome,
        sigla: existing?.sigla || posto.sigla || '',
        cnes: existing?.cnes || posto.cnes || '',
        ativo: existing?.ativo !== false && posto.ativo !== false,
        metricas: metrics,
        atualizadoEm: serverTimestamp()
      }, { merge: true });
    }

    const total = data.pacientes.length;
    const chunkSize = 150;
    let done = 0;
    for (let offset = 0; offset < total; offset += chunkSize) {
      const batch = optBatch(db);
      for (const original of data.pacientes.slice(offset, offset + chunkSize)) {
        const targetPostoId = postoMap.get(original.postoId) || original.postoId;
        const rawCns = String(original.cnsNormalizado || original.cns || '').replace(/\D/g, '');
        const validCns = rawCns.length === 15 ? rawCns : '';
        const patient = {
          ...original,
          postoId: targetPostoId,
          cnesPosto: original.cnesPosto || '',
          nomeBusca: normalizeText(original.nome),
          cpfNormalizado: String(original.cpfNormalizado || original.cpf || '').replace(/\D/g, ''),
          cns: validCns,
          cnsNormalizado: validCns,
          programas: original.programas?.length ? original.programas : ['crianca'],
          dados: original.dados || { crianca: {} },
          riscoGeral: original.riscoGeral || 'nao_informado',
          proximoRetorno: original.proximoRetorno || '',
          acsResumo: original.acsResumo || '',
          examesPendentes: Boolean(original.examesPendentes),
          ativo: original.ativo !== false,
          criadoPor: state.firebaseUser.uid,
          atualizadoPor: state.firebaseUser.uid,
          criadoEm: serverTimestamp(),
          atualizadoEm: serverTimestamp(),
          origemTipo: original.origemTipo || 'carga_inicial_seletiva'
        };
        delete patient.cnes;
        patient.cns = validCns;
        const patientRef = doc(db, 'pacientes', original.id);
        batch.set(patientRef, patient, { merge: true });
        batch.set(doc(db, 'pacientes_index', original.id), optIndexPayload({ id: original.id, ...patient }), { merge: true });
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
importRefreshConsolidateButton();
