// EXRisco — interface de pacientes orientada ao perfil do usuário.
// Carrega logo após app-patient.js e antes das camadas de otimização, para que
// todos os renderizadores usem o mesmo comportamento desde a origem.
(function configureRoleAwarePatientUi() {
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
      guide.innerHTML = '<strong>Acompanhamento da sua unidade</strong><span>Localize o paciente e clique em <b>Acompanhar</b> para registrar consulta, exames, risco, medicações, retorno e observações.</span>';
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

  const baseOpenPatient = openPatient;
  openPatient = function roleAwareOpenPatient(patient = null) {
    const result = baseOpenPatient(patient);
    const nurse = isNurseProfile();
    const title = document.getElementById('patientModalTitle');
    const saveButton = document.getElementById('savePatientBtn');

    if (nurse && patient) {
      if (title) title.textContent = `Acompanhamento — ${patient.nome || 'Paciente'}`;
      if (saveButton) saveButton.textContent = 'Salvar acompanhamento';
    } else if (nurse) {
      if (title) title.textContent = 'Cadastrar novo paciente';
      if (saveButton) saveButton.textContent = 'Cadastrar paciente';
    } else {
      if (title) title.textContent = patient ? 'Editar paciente' : 'Novo paciente';
      if (saveButton) saveButton.textContent = 'Salvar paciente';
    }

    return result;
  };
})();