// EXRisco — camada de otimização de leituras Firestore
// Carregada após app-network.js e antes de app-main.js.
const OPT_FIREBASE = window.EXRiscoFirebase;
const {
  writeBatch: optBatch,
  startAfter: optStartAfter,
  orderBy: optOrderBy,
  startAt: optStartAt,
  endAt: optEndAt,
  limit: optLimit,
  getCountFromServer: optGetCount,
  increment: optIncrement
} = OPT_FIREBASE;

const OPT_PAGE_SIZE = 30;
const OPT_SEARCH_LIMIT = 12;
const OPT_HISTORY_LIMIT = 20;

state.opt = {
  patientRequested: false,
  patientBusy: false,
  patientCursor: null,
  patientHasMore: false,
  patientSignature: '',
  usersLoaded: false,
  fullPatients: new Map(),
  networkCache: new Map(),
  dashboardCache: new Map(),
  patientReloadTimer: null
};

function optEmptyMetrics() {
  return {
    totalAtivos: 0,
    riscoAlto: 0,
    riscoIntermediario: 0,
    riscoBaixo: 0,
    riscoNaoInformado: 0,
    examesPendentes: 0,
    hipertensao: 0,
    diabetes: 0,
    gestante: 0,
    crianca: 0
  };
}

function optPatientMetrics(patient) {
  const m = optEmptyMetrics();
  if (!patient || patient.ativo === false) return m;
  m.totalAtivos = 1;
  const risk = patient.riscoGeral || 'nao_informado';
  if (risk === 'alto') m.riscoAlto = 1;
  else if (risk === 'intermediario') m.riscoIntermediario = 1;
  else if (risk === 'baixo') m.riscoBaixo = 1;
  else m.riscoNaoInformado = 1;
  if (patient.examesPendentes) m.examesPendentes = 1;
  for (const program of patient.programas || []) if (Object.prototype.hasOwnProperty.call(m, program)) m[program] = 1;
  return m;
}

function optMetricDelta(before, after) {
  const a = optPatientMetrics(before);
  const b = optPatientMetrics(after);
  const out = {};
  for (const key of Object.keys(a)) out[key] = (b[key] || 0) - (a[key] || 0);
  return out;
}

function optApplyPostMetricBatch(batch, postoId, delta) {
  if (!postoId) return;
  const patch = { atualizadoEm: serverTimestamp() };
  let changed = false;
  for (const [key, value] of Object.entries(delta)) {
    if (!value) continue;
    patch[`metricas.${key}`] = optIncrement(value);
    changed = true;
  }
  if (changed) batch.update(doc(db, 'postos', postoId), patch);
}

function optApplyLocalPostMetrics(postoId, delta) {
  const posto = state.postos.find((p) => p.id === postoId);
  if (!posto) return;
  posto.metricas ||= optEmptyMetrics();
  for (const [key, value] of Object.entries(delta)) {
    posto.metricas[key] = Math.max(0, Number(posto.metricas[key] || 0) + Number(value || 0));
  }
}

function optRiskMetricKey(risk) {
  if (risk === 'alto') return 'riscoAlto';
  if (risk === 'intermediario') return 'riscoIntermediario';
  if (risk === 'baixo') return 'riscoBaixo';
  return 'riscoNaoInformado';
}

function optConsultaKeys(patient) {
  const status = patient.ativo === false ? 'archived' : 'active';
  const posto = patient.postoId || '';
  const risk = patient.riscoGeral || 'nao_informado';
  const programs = patient.programas?.length ? patient.programas : ['sem_programa'];
  const keys = new Set([`s:${status}`]);
  if (posto) keys.add(`s:${status}|p:${posto}`);
  keys.add(`s:${status}|r:${risk}`);
  if (posto) keys.add(`s:${status}|p:${posto}|r:${risk}`);
  for (const program of programs) {
    keys.add(`s:${status}|g:${program}`);
    keys.add(`s:${status}|g:${program}|r:${risk}`);
    if (posto) {
      keys.add(`s:${status}|p:${posto}|g:${program}`);
      keys.add(`s:${status}|p:${posto}|g:${program}|r:${risk}`);
    }
  }
  return [...keys];
}

function optIndexPayload(patient, source = null) {
  const postoId = patient.postoId || source?.postoId || '';
  const postoNome = getPostoName(postoId) || source?.postoNome || '';
  const cpfDigits = String(patient.cpfNormalizado || patient.cpf || source?.cpfNormalizado || source?.cpf || '').replace(/\D/g, '');
  const cnsDigits = String(patient.cnsNormalizado || patient.cns || source?.cnsNormalizado || source?.cns || '').replace(/\D/g, '');
  const nome = patient.nome || source?.nome || '';
  const nomeBusca = normalizeText(nome);
  const active = patient.ativo !== false;
  const returnDate = active ? String(patient.proximoRetorno || '') : '';
  const payload = {
    nome,
    nomeBusca,
    postoNomeBusca: `${postoId}|${nomeBusca}`,
    cpf: patient.cpf || source?.cpf || '',
    cpfNormalizado: cpfDigits,
    cns: cnsDigits,
    cnsNormalizado: cnsDigits,
    dataNascimento: patient.dataNascimento || source?.dataNascimento || '',
    postoId,
    postoNome,
    programas: patient.programas || [],
    riscoGeral: patient.riscoGeral || 'nao_informado',
    proximoRetorno: patient.proximoRetorno || '',
    acsResumo: patient.acsResumo || '',
    examesPendentes: Boolean(patient.examesPendentes),
    ativo: active,
    acompanhamentoAtivo: true,
    pacienteId: patient.id,
    consultaKeys: optConsultaKeys(patient),
    retornoKey: returnDate,
    postoRetornoKey: returnDate ? `${postoId}|${returnDate}` : '',
    atualizadoEm: serverTimestamp()
  };
  return payload;
}

function optCurrentFilter() {
  return {
    text: String($('#patientSearch')?.value || '').trim(),
    program: $('#programFilter')?.value || '',
    risk: $('#riskFilter')?.value || '',
    posto: state.profile?.role === 'admin' ? ($('#patientPostoFilter')?.value || '') : (state.profile?.postoId || ''),
    status: $('#patientStatusFilter')?.value || 'active',
    preset: state.patientPreset || ''
  };
}

function optFilterSignature() {
  return JSON.stringify(optCurrentFilter());
}

function optFilterKey(filter) {
  const parts = [`s:${filter.status === 'archived' ? 'archived' : 'active'}`];
  if (filter.posto) parts.push(`p:${filter.posto}`);
  if (filter.program) parts.push(`g:${filter.program}`);
  if (filter.risk) parts.push(`r:${filter.risk}`);
  return parts.join('|');
}

function optMatchesLoadedFilter(patient, filter = optCurrentFilter()) {
  if ((filter.status === 'archived') !== (patient.ativo === false)) return false;
  if (filter.posto && patient.postoId !== filter.posto) return false;
  if (filter.program && !patient.programas?.includes(filter.program)) return false;
  if (filter.risk && patient.riscoGeral !== filter.risk) return false;
  if (filter.preset === 'overdue' && !(patient.proximoRetorno && patient.proximoRetorno < todayIso() && patient.ativo !== false)) return false;
  if (filter.text) {
    const digits = filter.text.replace(/\D/g, '');
    if (digits) {
      if (digits.length === 11 && patient.cpfNormalizado !== digits) return false;
      if (digits.length === 15 && patient.cnsNormalizado !== digits) return false;
    } else if (!normalizeText(patient.nome).includes(normalizeText(filter.text))) return false;
  }
  return true;
}

async function optQueryPatientPage(reset = false) {
  if (!state.profile || state.opt.patientBusy) return;
  const filter = optCurrentFilter();
  const signature = optFilterSignature();
  if (reset || signature !== state.opt.patientSignature) {
    state.opt.patientCursor = null;
    state.opt.patientHasMore = false;
    state.opt.patientSignature = signature;
    state.patients = [];
  }
  state.opt.patientBusy = true;
  try {
    const index = collection(db, 'pacientes_index');
    const text = filter.text;
    const digits = text.replace(/\D/g, '');
    let q;
    if (digits.length === 11) {
      q = query(index, where('cpfNormalizado', '==', digits), optLimit(5));
    } else if (digits.length === 15) {
      q = query(index, where('cnsNormalizado', '==', digits), optLimit(5));
    } else if (text.length >= 3) {
      const t = normalizeText(text);
      if (filter.posto) {
        const prefix = `${filter.posto}|${t}`;
        q = query(index, optOrderBy('postoNomeBusca'), optStartAt(prefix), optEndAt(prefix + '\uf8ff'), optLimit(OPT_PAGE_SIZE));
      } else {
        q = query(index, optOrderBy('nomeBusca'), optStartAt(t), optEndAt(t + '\uf8ff'), optLimit(OPT_PAGE_SIZE));
      }
    } else if (filter.preset === 'overdue') {
      const yesterday = addDaysIso(-1);
      if (filter.posto) {
        const constraints = [optOrderBy('postoRetornoKey')];
        if (!reset && state.opt.patientCursor) constraints.push(optStartAfter(state.opt.patientCursor));
        else constraints.push(optStartAt(`${filter.posto}|0000-00-00`));
        constraints.push(optEndAt(`${filter.posto}|${yesterday}`), optLimit(OPT_PAGE_SIZE));
        q = query(index, ...constraints);
      } else {
        const constraints = [optOrderBy('retornoKey')];
        if (!reset && state.opt.patientCursor) constraints.push(optStartAfter(state.opt.patientCursor));
        else constraints.push(optStartAt('0000-00-00'));
        constraints.push(optEndAt(yesterday), optLimit(OPT_PAGE_SIZE));
        q = query(index, ...constraints);
      }
    } else {
      const key = optFilterKey(filter);
      const constraints = [where('consultaKeys', 'array-contains', key)];
      if (!reset && state.opt.patientCursor) constraints.push(optStartAfter(state.opt.patientCursor));
      constraints.push(optLimit(OPT_PAGE_SIZE));
      q = query(index, ...constraints);
    }
    const snap = await getDocs(q);
    let rows = snap.docs.map((d) => ({ id: d.id, _summaryOnly: true, ...d.data() }));
    rows = rows.filter((p) => optMatchesLoadedFilter(p, filter));
    rows.sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));
    if (reset) state.patients = rows;
    else {
      const map = new Map(state.patients.map((p) => [p.id, p]));
      for (const p of rows) map.set(p.id, p);
      state.patients = [...map.values()].sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));
    }
    state.opt.patientCursor = snap.docs.at(-1) || null;
    state.opt.patientHasMore = !text && snap.docs.length === OPT_PAGE_SIZE;
  } catch (error) {
    console.error(error);
    showToast(firebaseMessage(error), 'error');
  } finally {
    state.opt.patientBusy = false;
    optRenderPatientListNow();
  }
}

function optEnsurePager() {
  let wrap = $('#optPatientPager');
  const table = $('#patientsTableBody')?.closest('.table-scroll');
  if (!table) return;
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'optPatientPager';
    wrap.style.cssText = 'display:flex;justify-content:center;padding:14px 0 4px';
    wrap.innerHTML = '<button id="optLoadMorePatients" class="btn ghost" type="button">Carregar mais</button>';
    table.after(wrap);
    $('#optLoadMorePatients').onclick = () => optQueryPatientPage(false);
  }
  wrap.classList.toggle('hidden', !state.opt.patientHasMore || state.opt.patientBusy);
}

const optLegacyRenderPatients = renderPatients;
function optRenderPatientListNow() {
  optLegacyRenderPatients();
  const loaded = state.patients.length;
  if ($('#patientCount')) $('#patientCount').textContent = state.opt.patientHasMore ? `${loaded}+ pacientes carregados` : `${loaded} ${loaded === 1 ? 'paciente' : 'pacientes'}`;
  optEnsurePager();
}

renderPatients = function optimizedRenderPatients() {
  if (!state.profile) return;
  optRenderPatientListNow();
  if (state.currentView !== 'pacientes' || !state.opt.patientRequested) return;
  const signature = optFilterSignature();
  if (signature === state.opt.patientSignature || state.opt.patientBusy) return;
  clearTimeout(state.opt.patientReloadTimer);
  state.opt.patientReloadTimer = setTimeout(() => optQueryPatientPage(true), 280);
};

// Nunca carrega a coleção inteira no login.
loadPatients = async function optimizedLoadPatients() {
  if (!state.opt.patientRequested && state.currentView !== 'pacientes') {
    state.patients = [];
    return;
  }
  return optQueryPatientPage(true);
};

const optLegacyLoadUsers = loadUsers;
loadUsers = async function optimizedLoadUsers(force = false) {
  if (state.profile?.role !== 'admin') { state.users = []; return; }
  if (!force && state.currentView !== 'usuarios' && state.currentView !== 'postos') return;
  if (state.opt.usersLoaded && !force) return;
  await optLegacyLoadUsers();
  state.opt.usersLoaded = true;
};

function optNetworkCacheKey(value) {
  return normalizeText(String(value || '').trim());
}

findNetwork = async function optimizedFindNetwork(value) {
  const cacheKey = optNetworkCacheKey(value);
  if (state.opt.networkCache.has(cacheKey)) return state.opt.networkCache.get(cacheKey);
  const digits = String(value || '').replace(/\D/g, '');
  const index = collection(db, 'pacientes_index');
  let q;
  if (digits.length === 11) q = query(index, where('cpfNormalizado', '==', digits), optLimit(3));
  else if (digits.length === 15) q = query(index, where('cnsNormalizado', '==', digits), optLimit(3));
  else {
    const t = normalizeText(value);
    if (t.length < 3) return [];
    q = query(index, optOrderBy('nomeBusca'), optStartAt(t), optEndAt(t + '\uf8ff'), optLimit(OPT_SEARCH_LIMIT));
  }
  const snap = await getDocs(q);
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));
  state.opt.networkCache.set(cacheKey, rows);
  return rows;
};

identityConflict = async function optimizedIdentityConflict(cpf, cns, ignore = '') {
  const checks = [];
  if (cpf) checks.push(['cpfNormalizado', cpf]);
  if (cns) checks.push(['cnsNormalizado', cns]);
  for (const [field, value] of checks) {
    const snap = await getDocs(query(collection(db, 'pacientes_index'), where(field, '==', value), optLimit(2)));
    const hit = snap.docs.find((d) => d.id !== ignore);
    if (hit) return { id: hit.id, ...hit.data() };
  }
  return null;
};

const optNetworkOpenPatient = openPatient;
openPatient = async function optimizedOpenPatient(patient = null) {
  if (patient?._summaryOnly) {
    try {
      let full = state.opt.fullPatients.get(patient.id);
      if (!full) {
        const snap = await getDoc(doc(db, 'pacientes', patient.id));
        if (!snap.exists()) return showToast('O acompanhamento não foi encontrado.', 'error');
        full = { id: snap.id, ...snap.data() };
        state.opt.fullPatients.set(patient.id, full);
      }
      return optNetworkOpenPatient(full);
    } catch (error) {
      return showToast(firebaseMessage(error), 'error');
    }
  }
  return optNetworkOpenPatient(patient);
};

function optUpdateLocalPatientSummary(summary) {
  const idx = state.patients.findIndex((p) => p.id === summary.id);
  const matches = optMatchesLoadedFilter(summary);
  if (idx >= 0 && matches) state.patients[idx] = summary;
  else if (idx >= 0 && !matches) state.patients.splice(idx, 1);
  else if (matches && state.currentView === 'pacientes') state.patients.push(summary);
  state.patients.sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));
  if (state.patients.length > OPT_PAGE_SIZE && !state.opt.patientHasMore) state.patients.length = OPT_PAGE_SIZE;
}

