const {
  firebaseConfig, auth, db,
  initializeApp, deleteApp, getAuth,
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
  createUserWithEmailAndPassword, deleteUser,
  collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc,
  query, where, serverTimestamp
} = window.EXRiscoFirebase;

const CALCULATOR_URL = 'https://calculadora-risco.saude.go.gov.br/';
const VERSION = '1.0.0';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = {
  firebaseUser: null,
  profile: null,
  postos: [],
  users: [],
  patients: [],
  currentView: 'dashboard',
  patientPreset: null,
  confirmResolve: null
};

const YES_NO = ['SIM', 'NÃO'];
const EXAM_STATUS = ['PENDENTES', 'SOLICITADOS', 'REALIZADOS'];
const STRAT_RISK = ['ALTO RISCO', 'RISCO INTERMEDIÁRIO', 'RISCO BAIXO'];
const CV_RISK = ['BAIXO RISCO', 'RISCO INTERMEDIÁRIO', 'ALTO RISCO'];
const MED_ADHERENCE = ['Uso Adequado', 'Uso Irregular', 'Em Ajuste', 'Abandono'];
const VACCINE_STATUS = ['VACINADA', 'NÃO VACINADA', 'ORIENTADA'];

const PROGRAMS = {
  hipertensao: {
    label: 'Hipertensão', plural: 'Hipertensos', symbol: 'H', subtitle: 'Vigilância de hipertensão arterial',
    fields: [
      { key: 'possuiDiabetes', label: 'Possui Diabetes Mellitus?', type: 'select', options: ['NÃO', 'SIM'] },
      { key: 'dataUltimaConsulta', label: 'Data da última consulta', type: 'date' },
      { key: 'dataProximaConsulta', label: 'Data da próxima consulta', type: 'date' },
      { key: 'acs', label: 'ACS responsável', type: 'text', placeholder: 'Nome do ACS' },
      { key: 'solicitacaoExames', label: 'Solicitação de exames', type: 'select', options: EXAM_STATUS },
      { key: 'estratificacao', label: 'Estratificação de risco', type: 'select', options: STRAT_RISK },
      { key: 'riscoCvPrevent', label: 'Risco CV-Prevent', type: 'select', options: CV_RISK },
      { key: 'adesaoMedicacao', label: 'Adesão / uso das medicações', type: 'select', options: MED_ADHERENCE },
      { key: 'medicacoes', label: 'Medicações em uso', type: 'textarea', span: 2, placeholder: 'Informe quais medicações o paciente utiliza.' },
      { key: 'observacoes', label: 'Observações', type: 'textarea', span: 2 }
    ]
  },
  diabetes: {
    label: 'Diabetes', plural: 'Diabéticos', symbol: 'D', subtitle: 'Vigilância de diabetes mellitus',
    fields: [
      { key: 'possuiHas', label: 'Possui HAS?', type: 'select', options: ['NÃO', 'SIM'] },
      { key: 'dataProximaConsulta', label: 'Data da próxima consulta', type: 'date' },
      { key: 'acs', label: 'ACS responsável', type: 'text', placeholder: 'Nome do ACS' },
      { key: 'solicitacaoExames', label: 'Solicitação de exames', type: 'select', options: EXAM_STATUS },
      { key: 'hemoglobinaGlicada', label: 'Hemoglobina glicada', type: 'text', placeholder: 'Resultado / valor' },
      { key: 'avaliacaoPes', label: 'Avaliação dos pés', type: 'select', options: ['Sem Alterações', 'Alterado'] },
      { key: 'estratificacao', label: 'Estratificação de risco', type: 'select', options: STRAT_RISK },
      { key: 'riscoCvPrevent', label: 'Risco CV-Prevent', type: 'select', options: CV_RISK },
      { key: 'adesaoMedicacao', label: 'Adesão / uso das medicações', type: 'select', options: MED_ADHERENCE },
      { key: 'medicacoes', label: 'Medicações em uso', type: 'textarea', span: 2 },
      { key: 'observacoes', label: 'Observações', type: 'textarea', span: 2 }
    ]
  },
  gestante: {
    label: 'Gestação', plural: 'Gestantes', symbol: 'G', subtitle: 'Acompanhamento do pré-natal',
    fields: [
      { key: 'preNatalAte12Semanas', label: 'Iniciou pré-natal até 12 semanas?', type: 'select', options: YES_NO },
      { key: 'dataProximaConsulta', label: 'Data da próxima consulta', type: 'date' },
      { key: 'trimestreAtual', label: 'Trimestre atual', type: 'select', options: ['1° TRIMESTRE', '2° TRIMESTRE', '3° TRIMESTRE'] },
      { key: 'acs', label: 'ACS responsável', type: 'text' },
      { key: 'estratificacao', label: 'Estratificação de risco', type: 'select', options: ['ALTO RISCO', 'RISCO INTERMEDIÁRIO', 'RISCO HABITUAL'] },
      { key: 'fatoresRisco', label: 'Fatores da estratificação (se houver)', type: 'textarea', span: 2 },
      { key: 'dum', label: 'DUM', type: 'date' },
      { key: 'dpp', label: 'DPP', type: 'date' },
      { key: 'numeroConsultas', label: 'N° de consultas', type: 'number', min: 0 },
      { key: 'testeRapidoIsts', label: "Teste rápido IST's", type: 'select', options: ['REALIZADOS', 'NÃO REALIZADOS'] },
      { key: 'resultadoTesteRapidos', label: 'Resultado testes rápidos', type: 'select', options: ['NÃO REAGENTES', 'SÍFILIS REAGENTE', 'HIV REAGENTE', 'HEPATITE B REAGENTE', 'HEPATITE C REAGENTE'] },
      { key: 'valorVdrl', label: 'Valor VDRL', type: 'text' },
      { key: 'testeMamaePrimeiraFase', label: 'Teste da Mamãe — 1ª fase', type: 'select', options: ['REALIZADO SEM ALTERAÇÕES', 'REALIZADO COM ALTERAÇÕES', 'AGUARD. RESULTADO', 'TOXO IMUNE', 'TOXO SUSCEPTÍVEL'] },
      { key: 'resultadoAlteradoTesteMamae1Fase', label: 'Alteração no Teste da Mamãe — 1ª fase', type: 'text' },
      { key: 'testeMamaeSegundaFase', label: 'Teste da Mamãe — 2ª fase', type: 'select', options: ['SEM ALTERAÇÕES', 'AGUARD. RESULTADO', 'SÍFILIS REAGENTE', 'HIV REAGENTE'] },
      { key: 'vacinaDtpa20s', label: 'Vacinação DTPA 20ª semana', type: 'select', options: VACCINE_STATUS },
      { key: 'vacinaVsr28s', label: 'Vacina VSR 28 semanas', type: 'select', options: VACCINE_STATUS },
      { key: 'consultaOdontologica', label: 'Consulta odontológica', type: 'select', options: ['Orientada', 'OK - checada', 'Pendente'] },
      { key: 'observacoes', label: 'Observações', type: 'textarea', span: 2 }
    ]
  },
  crianca: {
    label: 'Saúde da Criança', plural: 'Saúde da Criança', symbol: 'C', subtitle: 'Vigilância da criança',
    fields: [
      { key: 'classificacaoRisco', label: 'Classificação de risco', type: 'select', options: ['HABITUAL', 'INTERMEDIÁRIO', 'ALTO RISCO'] },
      { key: 'acs', label: 'ACS responsável', type: 'text' },
      { key: 'primeiraConsultaAntes30Dias', label: '1ª consulta antes de 30 dias de vida?', type: 'select', options: ['SIM', 'NÃO', 'AGUARDANDO'] },
      { key: 'visitasDomiciliaresAcs', label: 'Visitas domiciliares ACS', type: 'select', options: ['CONCLUÍDAS', 'UMA VISITA', 'NENHUMA VISITA', 'ÁREA DESCOBERTA POR ACS'] },
      { key: 'numeroConsultas', label: 'N° de consultas', type: 'number', min: 0 },
      { key: 'dataPrimeiraConsulta', label: 'Data da primeira consulta', type: 'date' },
      { key: 'dataUltimaConsulta', label: 'Data da última consulta', type: 'date' },
      { key: 'dataRetorno', label: 'Data de retorno', type: 'date' },
      { key: 'marcosConsumoAlimentar', label: 'Marcos de consumo alimentar', type: 'select', options: ['REALIZADO', 'NÃO REALIZADO'] },
      { key: 'aleitamentoMaterno', label: 'Aleitamento materno', type: 'select', options: ['EXCLUSIVO', 'COMPLEMENTADO', 'FÓRMULA INFANTIL', 'NÃO SE APLICA'] },
      { key: 'desenvolvimentoNeuropsicomotor', label: 'Desenvolvimento neuropsicomotor', type: 'select', options: ['ADEQUADO', 'ATRASADO', 'EM AVALIAÇÃO'] },
      { key: 'vacinacao', label: 'Vacinação', type: 'select', options: ['OK CHECADO', 'NÃO CHECADO', 'DESATUALIZADO'] },
      { key: 'testePezinho', label: 'Teste do Pezinho', type: 'select', options: ['SEM ALTERAÇÕES', 'ALTERADO', 'AGUARD. RESULTADO', 'NÃO REALIZADO'] },
      { key: 'alteracoesTriagemNeonatal', label: 'Alterações na triagem neonatal?', type: 'textarea', span: 2 },
      { key: 'observacoes', label: 'Observações', type: 'textarea', span: 2 }
    ]
  }
};

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function normalizeText(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseLocalDate(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 12, 0, 0);
}

function formatDate(iso) {
  const d = parseLocalDate(iso);
  return d ? new Intl.DateTimeFormat('pt-BR').format(d) : '—';
}

function formatTimestamp(value) {
  if (!value) return 'Agora';
  const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function calculateAge(iso) {
  const birth = parseLocalDate(iso);
  if (!birth) return '';
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const md = now.getMonth() - birth.getMonth();
  if (md < 0 || (md === 0 && now.getDate() < birth.getDate())) age--;
  return age >= 0 ? age : '';
}

function maskCpf(raw) {
  const digits = String(raw || '').replace(/\D/g, '').slice(0, 11);
  return digits
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

function initials(name = '') {
  return String(name).trim().split(/\s+/).slice(0, 2).map((p) => p[0] || '').join('').toUpperCase() || 'U';
}

function riskScore(value) {
  const n = normalizeText(value);
  if (!n) return 0;
  if (n.includes('alto')) return 3;
  if (n.includes('intermedi')) return 2;
  if (n.includes('baixo') || n.includes('habitual')) return 1;
  return 0;
}

function riskKeyFromScore(score) {
  if (score >= 3) return 'alto';
  if (score === 2) return 'intermediario';
  if (score === 1) return 'baixo';
  return 'nao_informado';
}

function riskLabel(key) {
  return ({ alto: 'Alto risco', intermediario: 'Intermediário', baixo: 'Baixo/Habitual', nao_informado: 'Não informado' })[key] || 'Não informado';
}

function riskClass(key) {
  return ({ alto: 'high', intermediario: 'mid', baixo: 'low', nao_informado: 'none' })[key] || 'none';
}

function getPostoName(id) {
  return state.postos.find((p) => p.id === id)?.nome || 'Unidade não identificada';
}

function programRisk(data = {}) {
  return Math.max(
    riskScore(data.estratificacao),
    riskScore(data.riscoCvPrevent),
    riskScore(data.classificacaoRisco)
  );
}

function isPendingValue(value) {
  const n = normalizeText(value);
  return Boolean(n && (
    n.includes('pendente') ||
    n.includes('solicitado') ||
    n.includes('aguard') ||
    n.includes('nao realizado') ||
    n.includes('nao checado') ||
    n.includes('desatualizado')
  ));
}

function derivePatient(programas, dados) {
  let maxRisk = 0;
  const dates = [];
  let acsResumo = '';
  let examesPendentes = false;

  for (const program of programas) {
    const d = dados[program] || {};
    maxRisk = Math.max(maxRisk, programRisk(d));
    const returnDate = program === 'crianca' ? d.dataRetorno : d.dataProximaConsulta;
    if (returnDate) dates.push(returnDate);
    if (!acsResumo && d.acs) acsResumo = d.acs.trim();

    const monitoredKeys = [
      'solicitacaoExames', 'testeRapidoIsts', 'resultadoTesteRapidos',
      'testeMamaePrimeiraFase', 'testeMamaeSegundaFase', 'consultaOdontologica',
      'marcosConsumoAlimentar', 'vacinacao', 'testePezinho'
    ];
    if (monitoredKeys.some((key) => isPendingValue(d[key]))) examesPendentes = true;
  }

  dates.sort();
  return {
    riscoGeral: riskKeyFromScore(maxRisk),
    proximoRetorno: dates[0] || '',
    acsResumo,
    examesPendentes
  };
}

function showToast(message, type = 'ok') {
  const toast = $('#toast');
  toast.textContent = message;
  toast.className = `toast${type === 'error' ? ' error' : ''}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add('hidden'), 3600);
}

function setLoading(show) {
  $('#loadingScreen').classList.toggle('hidden', !show);
}

function showLogin(error = '') {
  $('#appView').classList.add('hidden');
  $('#loginView').classList.remove('hidden');
  $('#loginError').textContent = error;
  $('#loginError').classList.toggle('hidden', !error);
  setLoading(false);
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  if (!document.querySelector('.modal:not(.hidden)')) document.body.style.overflow = '';
  if (id === 'calculatorModal') $('#calculatorFrame').src = 'about:blank';
}

function confirmAction(title, text, confirmLabel = 'Confirmar') {
  $('#confirmTitle').textContent = title;
  $('#confirmText').textContent = text;
  $('#confirmOk').textContent = confirmLabel;
  openModal('confirmModal');
  return new Promise((resolve) => { state.confirmResolve = resolve; });
}

function resolveConfirm(value) {
  closeModal('confirmModal');
  if (state.confirmResolve) state.confirmResolve(value);
  state.confirmResolve = null;
}

function switchView(view) {
  state.currentView = view;
  $$('.view').forEach((el) => el.classList.toggle('active', el.id === `view-${view}`));
  $$('.nav-item').forEach((el) => el.classList.toggle('active', el.dataset.view === view));
  const titles = {
    dashboard: ['Painel', 'Visão geral'],
    pacientes: ['Vigilância', 'Pacientes'],
    postos: ['Administração', 'Postos de saúde'],
    usuarios: ['Administração', 'Usuários']
  };
  $('#pageEyebrow').textContent = titles[view]?.[0] || '';
  $('#pageTitle').textContent = titles[view]?.[1] || '';
  $('.sidebar').classList.remove('open');
  if (view === 'dashboard') renderDashboard();
  if (view === 'pacientes') renderPatients();
  if (view === 'postos') renderPostos();
  if (view === 'usuarios') renderUsers();
}
