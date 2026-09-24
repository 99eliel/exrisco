savePatient = async function optimizedSavePatient(event) {
  event.preventDefault();
  const message = $('#patientFormMessage');
  message.classList.add('hidden');
  const id = $('#patientId').value;
  const nome = $('#patientName').value.trim();
  const cpf = maskCpf($('#patientCpf').value);
  const cpfNormalizado = cpf.replace(/\D/g, '');
  const cns = String($('#patientCns')?.value || '').replace(/\D/g, '');
  const dataNascimento = $('#patientBirth').value;
  const postoId = state.profile.role === 'admin' ? $('#patientPosto').value : state.profile.postoId;
  const { programas, dados } = collectProgramData();
  const pending = state.pendingNetworkRecord;

  if (!nome || !dataNascimento || !postoId) return showPatientError('Preencha nome, data de nascimento e posto de saúde.');
  if (!programas.length) return showPatientError('Selecione pelo menos um acompanhamento.');
  if (cns && cns.length !== 15) return showPatientError('O CNS deve conter 15 dígitos.');

  let old = id ? (state.opt.fullPatients.get(id) || state.patients.find((p) => p.id === id)) : null;
  const oldCpf = String(old?.cpfNormalizado || '').replace(/\D/g, '');
  const oldCns = String(old?.cnsNormalizado || old?.cns || '').replace(/\D/g, '');
  if (!id || oldCpf !== cpfNormalizado || oldCns !== cns) {
    try {
      const hit = await identityConflict(cpfNormalizado, cns, pending?.id || id || '');
      if (hit) return showPatientError(`Este cidadão já existe na rede e está vinculado a ${hit.postoNome || 'outro posto'}. Use “Buscar cidadão”.`);
    } catch (error) {
      return showPatientError(firebaseMessage(error));
    }
  }

  const derived = derivePatient(programas, dados);
  const active = old ? old.ativo !== false : true;
  const basePayload = {
    nome,
    nomeBusca: normalizeText(nome),
    cpf,
    cpfNormalizado,
    cns,
    cnsNormalizado: cns,
    dataNascimento,
    postoId,
    programas,
    dados,
    ...derived,
    ativo: active,
    atualizadoEm: serverTimestamp(),
    atualizadoPor: state.firebaseUser.uid
  };

  $('#savePatientBtn').disabled = true;
  try {
    const patientRef = id ? doc(db, 'pacientes', id) : doc(collection(db, 'pacientes'));
    const patientId = patientRef.id;
    const localPatient = { id: patientId, ...basePayload };
    const summary = { id: patientId, _summaryOnly: true, ...optIndexPayload(localPatient, pending) };
    // Timestamps sentinela não entram no estado local.
    delete summary.atualizadoEm;

    const batch = optBatch(db);
    if (id) batch.update(patientRef, basePayload);
    else batch.set(patientRef, { ...basePayload, criadoEm: serverTimestamp(), criadoPor: state.firebaseUser.uid, origemTipo: pending?.origemTipo || 'cadastro_manual' });
    batch.set(doc(db, 'pacientes_index', patientId), optIndexPayload(localPatient, pending), { merge: true });

    const oldPosto = old?.postoId || null;
    if (oldPosto && oldPosto !== postoId) {
      optApplyPostMetricBatch(batch, oldPosto, optMetricDelta(old, null));
      optApplyPostMetricBatch(batch, postoId, optMetricDelta(null, localPatient));
    } else {
      optApplyPostMetricBatch(batch, postoId, optMetricDelta(old, localPatient));
    }

    const historyRef = doc(collection(db, 'historico'));
    batch.set(historyRef, {
      patientId,
      postoId,
      acao: id ? 'edição' : 'criação',
      resumo: id ? `Cadastro e acompanhamento atualizados para ${nome}.` : `Paciente ${nome} cadastrado no sistema.`,
      userId: state.firebaseUser.uid,
      userName: state.profile.nome || state.firebaseUser.email,
      criadoEm: serverTimestamp()
    });
    await batch.commit();

    if (oldPosto && oldPosto !== postoId) {
      optApplyLocalPostMetrics(oldPosto, optMetricDelta(old, null));
      optApplyLocalPostMetrics(postoId, optMetricDelta(null, localPatient));
    } else optApplyLocalPostMetrics(postoId, optMetricDelta(old, localPatient));

    state.opt.fullPatients.set(patientId, { id: patientId, ...basePayload });
    optUpdateLocalPatientSummary(summary);
    state.opt.networkCache.clear();
    state.opt.dashboardCache.clear();
    state.pendingNetworkRecord = null;
    closeModal('patientModal');
    optRenderPatientListNow();
    renderDashboard();
    renderPostos();
    showToast(id ? 'Paciente atualizado com sucesso.' : 'Paciente cadastrado com sucesso.');
  } catch (error) {
    console.error(error);
    showPatientError(firebaseMessage(error));
  } finally {
    $('#savePatientBtn').disabled = false;
  }
};

togglePatient = async function optimizedTogglePatient(patient) {
  const active = patient.ativo !== false;
  const ok = await confirmAction(active ? 'Arquivar paciente' : 'Reativar paciente', active
    ? `O paciente ${patient.nome} deixará de aparecer entre os pacientes ativos, mas todo o histórico será preservado.`
    : `O paciente ${patient.nome} voltará aos acompanhamentos ativos.`, active ? 'Arquivar' : 'Reativar');
  if (!ok) return;
  try {
    const after = { ...patient, ativo: !active };
    const batch = optBatch(db);
    batch.update(doc(db, 'pacientes', patient.id), { ativo: !active, atualizadoEm: serverTimestamp(), atualizadoPor: state.firebaseUser.uid });
    batch.set(doc(db, 'pacientes_index', patient.id), optIndexPayload(after), { merge: true });
    optApplyPostMetricBatch(batch, patient.postoId, optMetricDelta(patient, after));
    batch.set(doc(collection(db, 'historico')), {
      patientId: patient.id,
      postoId: patient.postoId,
      acao: active ? 'arquivamento' : 'reativação',
      resumo: active ? 'Paciente arquivado.' : 'Paciente reativado.',
      userId: state.firebaseUser.uid,
      userName: state.profile.nome || state.firebaseUser.email,
      criadoEm: serverTimestamp()
    });
    await batch.commit();
    optApplyLocalPostMetrics(patient.postoId, optMetricDelta(patient, after));
    const summary = { ...patient, ...after, _summaryOnly: true };
    optUpdateLocalPatientSummary(summary);
    state.opt.fullPatients.delete(patient.id);
    state.opt.dashboardCache.clear();
    state.opt.networkCache.clear();
    optRenderPatientListNow();
    renderDashboard();
    renderPostos();
    showToast(active ? 'Paciente arquivado.' : 'Paciente reativado.');
  } catch (error) {
    console.error(error);
    showToast(firebaseMessage(error), 'error');
  }
};

openHistory = async function optimizedOpenHistory(patient) {
  $('#historyTitle').textContent = `Histórico — ${patient.nome}`;
  $('#historyList').innerHTML = '<div class="empty-inline">Carregando histórico...</div>';
  openModal('historyModal');
  try {
    const snap = await getDocs(query(
      collection(db, 'historico'),
      where('patientId', '==', patient.id),
      where('postoId', '==', patient.postoId),
      optLimit(OPT_HISTORY_LIMIT)
    ));
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => {
      const ta = a.criadoEm?.toMillis?.() || 0;
      const tb = b.criadoEm?.toMillis?.() || 0;
      return tb - ta;
    });
    $('#historyList').innerHTML = items.length ? items.map((item) => `<div class="timeline-item"><span class="timeline-dot"></span><strong>${escapeHtml(capitalize(item.acao || 'alteração'))}</strong><p>${escapeHtml(item.resumo || '')}</p><small>${escapeHtml(item.userName || 'Usuário')} · ${formatTimestamp(item.criadoEm)}</small></div>`).join('') : '<div class="empty-inline">Ainda não há registros de histórico.</div>';
    if (snap.docs.length === OPT_HISTORY_LIMIT) $('#historyList').insertAdjacentHTML('beforeend', '<div class="net-help">Exibindo os 20 registros recuperados nesta consulta. O histórico completo permanece preservado.</div>');
  } catch (error) {
    $('#historyList').innerHTML = `<div class="form-error">${escapeHtml(firebaseMessage(error))}</div>`;
  }
};

