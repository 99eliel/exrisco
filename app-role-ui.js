// EXRisco — interface de pacientes orientada ao perfil do usuário.
// Carrega logo após app-patient.js e antes das camadas de otimização, para que
// todos os renderizadores usem o mesmo comportamento desde a origem.
(function configureRoleAwarePatientUi() {
  const PRIORITY_KEYS = new Set([
    'dataProximaConsulta', 'dataRetorno', 'estratificacao', 'classificacaoRisco',
    'acs', 'solicitacaoExames', 'riscoCvPrevent'
  ]);

  function isNurseProfile() {
    return state.profile?.role === 'posto';
  }

  function ensureNurseGuide() {
    const view = document.getElementById('view-pacientes');
    const toolbar = view?.querySelector('.toolbar');
    if (!view || !toolbar) return;

    let guide = document.getElementById('nurseFollowGuide');
    if (!isNurseProfile()) {
      guide?.remove();
      return;
    }

    if (!guide) {
      guide = document.createElement('div');
      guide.id = 'nurseFollowGuide';
      guide.className = 'nurse-follow-guide';
      guide.innerHTML = '<strong>Acompanhamento da sua unidade</strong><span>Localize o paciente e clique em <b>Acompanhar</b>. O prontuário abre em modo guiado, mostrando um acompanhamento por vez.</span>';
      toolbar.parentNode.insertBefore(guide, toolbar);
    }
  }

  function applyPatientActionLabels() {
    ensureNurseGuide();
    const nurse = isNurseProfile();

    document.querySelectorAll('#patientsTableBody [data-action="edit"]').forEach((button) => {
      if (nurse) {
        button.className = 'btn primary small';
        button.textContent = 'Acompanhar';
        button.title = 'Abrir acompanhamento do paciente';
        button.setAttribute('aria-label', 'Acompanhar paciente');
      } else {
        button.className = 'icon-btn row-icon-btn';
        button.textContent = '✎';
        button.title = 'Editar';
        button.setAttribute('aria-label', 'Editar paciente');
      }
    });
  }

  const baseRenderPatients = renderPatients;
  renderPatients = function roleAwareRenderPatients() {
    const result = baseRenderPatients();
    applyPatientActionLabels();
    return result;
  };

  function patientSections() {
    const sections = [...document.querySelectorAll('#patientForm > .form-section')];
    return {
      identification: sections[0] || null,
      groups: sections[1] || null,
      surveillance: sections[2] || null
    };
  }

  function activePrograms() {
    return $$('.program-checkbox:checked').map((checkbox) => checkbox.value);
  }

  function programCompletion(program) {
    const section = document.querySelector(`[data-program-form="${program}"]`);
    if (!section) return { filled: 0, total: 0, percent: 0 };
    const fields = [...section.querySelectorAll('[data-program][data-key]')];
    const meaningful = fields.filter((field) => field.dataset.key !== 'observacoes');
    const filled = meaningful.filter((field) => String(field.value || '').trim() !== '').length;
    const total = meaningful.length;
    return { filled, total, percent: total ? Math.round((filled / total) * 100) : 0 };
  }

  function followupMeta(patient) {
    const age = calculateAge(patient?.dataNascimento || $('#patientBirth')?.value || '');
    const cpf = patient?.cpf || $('#patientCpf')?.value || '';
    const cns = patient?.cns || $('#patientCns')?.value || '';
    const risk = patient?.riscoGeral || 'nao_informado';
    const returnDate = patient?.proximoRetorno || '';
    const docs = [cpf ? `CPF ${cpf}` : '', cns ? `CNS ${cns}` : ''].filter(Boolean);
    return {
      age,
      docs: docs.join(' · ') || 'Documento não informado',
      risk,
      returnDate
    };
  }

  function ensureFollowupSummary(patient) {
    const form = document.getElementById('patientForm');
    if (!form) return;
    let summary = document.getElementById('nurseFollowupSummary');
    if (!summary) {
      summary = document.createElement('section');
      summary.id = 'nurseFollowupSummary';
      summary.className = 'followup-summary';
      form.prepend(summary);
    }

    const meta = followupMeta(patient);
    const programBadges = activePrograms().map((key) => `<span class="followup-group-chip">${escapeHtml(PROGRAMS[key]?.label || key)}</span>`).join('');
    const overdue = meta.returnDate && meta.returnDate < todayIso();
    summary.innerHTML = `
      <div class="followup-summary-main">
        <span class="followup-kicker">Consulta em andamento</span>
        <strong>${escapeHtml(patient?.nome || $('#patientName')?.value || 'Novo paciente')}</strong>
        <div class="followup-person-meta">
          <span>${meta.age !== '' ? `${meta.age} anos` : 'Idade não informada'}</span>
          <span>${escapeHtml(meta.docs)}</span>
          <span>${escapeHtml(getPostoName(patient?.postoId || state.profile?.postoId))}</span>
        </div>
        <div class="followup-group-row">${programBadges || '<span class="followup-group-chip empty">Selecione o acompanhamento abaixo</span>'}</div>
      </div>
      <div class="followup-summary-side">
        <div class="followup-status-card ${riskClass(meta.risk)}"><small>Risco atual</small><strong>${escapeHtml(riskLabel(meta.risk))}</strong></div>
        <div class="followup-status-card ${overdue ? 'overdue' : ''}"><small>Próximo retorno</small><strong>${meta.returnDate ? `${overdue ? 'Vencido · ' : ''}${formatDate(meta.returnDate)}` : 'Não informado'}</strong></div>
        ${patient ? '<div class="followup-summary-buttons"><button type="button" class="btn ghost small" data-followup-toggle="identification">Dados do paciente</button><button type="button" class="btn ghost small" data-followup-toggle="groups">Alterar grupos</button></div>' : ''}
      </div>`;
  }

  function setSectionCollapsed(section, collapsed) {
    if (!section) return;
    section.classList.toggle('followup-collapsed', collapsed);
  }

  function updateNavigatorProgress() {
    const current = document.getElementById('patientForm')?.dataset.followupProgram || '';
    const progress = document.getElementById('followupProgress');
    const bar = document.getElementById('followupProgressBar');
    if (!progress || !current) return;
    const completion = programCompletion(current);
    progress.textContent = completion.total ? `${completion.filled} de ${completion.total} campos preenchidos` : '';
    if (bar) bar.style.width = `${completion.percent}%`;

    document.querySelectorAll('#followupProgramTabs [data-followup-program]').forEach((button) => {
      const c = programCompletion(button.dataset.followupProgram);
      button.classList.toggle('complete', c.total > 0 && c.filled === c.total);
    });
  }

  function setCurrentProgram(program) {
    const form = document.getElementById('patientForm');
    if (!form) return;
    const programs = activePrograms();
    const current = programs.includes(program) ? program : (programs[0] || '');
    form.dataset.followupProgram = current;

    document.querySelectorAll('#programForms .program-form').forEach((section) => {
      section.classList.toggle('followup-current', section.dataset.programForm === current);
    });
    document.querySelectorAll('#followupProgramTabs [data-followup-program]').forEach((button) => {
      const active = button.dataset.followupProgram === current;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    updateNavigatorProgress();
  }

  function markPriorityFields() {
    document.querySelectorAll('#programForms [data-program][data-key]').forEach((field) => {
      field.closest('.field')?.classList.toggle('followup-priority-field', PRIORITY_KEYS.has(field.dataset.key));
    });
  }

  function rebuildFollowupNavigator(preferredProgram = '') {
    const forms = document.getElementById('programForms');
    if (!forms) return;
    let navigator = document.getElementById('followupNavigator');
    if (!navigator) {
      navigator = document.createElement('div');
      navigator.id = 'followupNavigator';
      navigator.className = 'followup-navigator';
      forms.before(navigator);
    }

    const programs = activePrograms();
    if (!programs.length) {
      navigator.innerHTML = '<div class="followup-empty-guide"><strong>Escolha pelo menos um acompanhamento</strong><span>Depois de marcar um grupo acima, os campos da consulta aparecerão aqui de forma organizada.</span></div>';
      document.querySelectorAll('#programForms .program-form').forEach((section) => section.classList.remove('followup-current'));
      return;
    }

    navigator.innerHTML = `
      <div class="followup-nav-head">
        <div><small>Etapa da consulta</small><strong>Preencha um acompanhamento por vez</strong></div>
        <span id="followupProgress"></span>
      </div>
      <div id="followupProgramTabs" class="followup-tabs" role="tablist">
        ${programs.map((key) => `<button type="button" role="tab" data-followup-program="${key}"><span>${escapeHtml(PROGRAMS[key]?.symbol || '•')}</span><strong>${escapeHtml(PROGRAMS[key]?.label || key)}</strong></button>`).join('')}
      </div>
      <div class="followup-progress-track"><i id="followupProgressBar"></i></div>`;

    const current = document.getElementById('patientForm')?.dataset.followupProgram;
    setCurrentProgram(programs.includes(preferredProgram) ? preferredProgram : (programs.includes(current) ? current : programs[0]));
  }

  function bindGuidedFollowupEvents() {
    const form = document.getElementById('patientForm');
    if (!form || form.dataset.followupBound === 'true') return;
    form.dataset.followupBound = 'true';

    document.getElementById('programSelector')?.addEventListener('change', (event) => {
      const checkbox = event.target.closest('.program-checkbox');
      if (!checkbox) return;
      rebuildFollowupNavigator(checkbox.checked ? checkbox.value : '');
      ensureFollowupSummary($('#patientId')?.value ? {
        nome: $('#patientName')?.value,
        cpf: $('#patientCpf')?.value,
        cns: $('#patientCns')?.value,
        dataNascimento: $('#patientBirth')?.value,
        postoId: state.profile?.postoId,
        riscoGeral: 'nao_informado',
        proximoRetorno: ''
      } : null);
    });

    document.getElementById('programForms')?.addEventListener('input', updateNavigatorProgress);
    document.getElementById('programForms')?.addEventListener('change', updateNavigatorProgress);

    form.addEventListener('click', (event) => {
      const tab = event.target.closest('[data-followup-program]');
      if (tab) {
        setCurrentProgram(tab.dataset.followupProgram);
        return;
      }
      const toggle = event.target.closest('[data-followup-toggle]');
      if (!toggle) return;
      const sections = patientSections();
      const target = sections[toggle.dataset.followupToggle];
      if (target) target.classList.toggle('followup-collapsed');
    });
  }

  function configureGuidedFollowup(patient) {
    const modal = document.getElementById('patientModal');
    const form = document.getElementById('patientForm');
    if (!modal || !form) return;
    const sections = patientSections();

    modal.classList.add('nurse-followup-modal');
    form.classList.add('nurse-followup-form');
    sections.identification?.classList.add('followup-identification-section');
    sections.groups?.classList.add('followup-groups-section');
    sections.surveillance?.classList.add('followup-surveillance-section');

    setSectionCollapsed(sections.identification, Boolean(patient));
    setSectionCollapsed(sections.groups, Boolean(patient));
    ensureFollowupSummary(patient);
    markPriorityFields();
    rebuildFollowupNavigator(activePrograms()[0] || '');
    bindGuidedFollowupEvents();

    const body = modal.querySelector('.modal-body');
    if (body) body.scrollTop = 0;
  }

  function clearGuidedFollowup() {
    const modal = document.getElementById('patientModal');
    const form = document.getElementById('patientForm');
    modal?.classList.remove('nurse-followup-modal');
    form?.classList.remove('nurse-followup-form');
    form?.removeAttribute('data-followup-program');
    document.getElementById('nurseFollowupSummary')?.remove();
    document.getElementById('followupNavigator')?.remove();
    document.querySelectorAll('#patientForm .form-section').forEach((section) => section.classList.remove('followup-collapsed'));
    document.querySelectorAll('#programForms .program-form').forEach((section) => section.classList.remove('followup-current'));
  }

  const baseOpenPatient = openPatient;
  openPatient = function roleAwareOpenPatient(patient = null) {
    const result = baseOpenPatient(patient);
    const nurse = isNurseProfile();
    const title = document.getElementById('patientModalTitle');
    const saveButton = document.getElementById('savePatientBtn');

    if (nurse && patient) {
      if (title) title.textContent = `Acompanhamento — ${patient.nome || 'Paciente'}`;
      if (saveButton) saveButton.textContent = 'Salvar acompanhamento';
      configureGuidedFollowup(patient);
    } else if (nurse) {
      if (title) title.textContent = 'Cadastrar novo paciente';
      if (saveButton) saveButton.textContent = 'Cadastrar paciente';
      configureGuidedFollowup(null);
    } else {
      clearGuidedFollowup();
      if (title) title.textContent = patient ? 'Editar paciente' : 'Novo paciente';
      if (saveButton) saveButton.textContent = 'Salvar paciente';
    }

    return result;
  };
})();