savePatient = async function optimizedSavePatient(event) {
  event.preventDefault();
  const message = $('#patientFormMessage');
  message.classList.add('hidden');

  const formPatientId = $('#patientId').value;
  const nome = $('#patientName').value.trim();
  const cpf = maskCpf($('#patientCpf').value);
  const cpfNormalizado = cpf.replace(/\D/g, '');
  const cns = String($('#patientCns')?.value || '').replace(/\D/g, '');
  const dataNascimento = $('#patientBirth').value;
  const postoId = state.profile.role === 'admin' ? $('#patientPosto').value : state.profile.postoId;
  const collected = collectProgramData();
  let programas = collected.programas;
  let dados = collected.dados;
  let source = state.pendingNetworkRecord || null;

  if (!nome || !dataNascimento || !postoId) return showPatientError('Preencha nome, data de nascimento e posto de saúde.');
  if (!programas.length) return showPatientError('Selecione pelo menos um acompanhamento.');
  if (cns && cns.length !== 15) return showPatientError('O CNS deve conter 15 dígitos.');

  let patientId = formPatientId;
  let old = patientId ? (state.opt.fullPatients.get(patientId) || state.patients.find((p) => p.id === patientId)) : null;
  let reusedExisting = false;

  // Em condições normais openPatient() já deixa o prontuário completo em cache.
  // Este fallback evita tratar um resumo de índice como prontuário durante o salvamento.
  if (patientId && old?._summaryOnly) {
    try {
      const oldSnap = await getDoc(doc(db, 'pacientes', patientId));
      if (oldSnap.exists()) {
        old = { id: oldSnap.id, ...oldSnap.data() };
        state.opt.fullPatients.set(patientId, old);
      }
    } catch (error) {
      return showPatientError(firebaseMessage(error));
    }
  }

  const oldCpf = String(old?.cpfNormalizado || old?.cpf || '').replace(/\D/g, '');
  const oldCns = String(old?.cnsNormalizado || old?.cns || '').replace(/\D/g, '');
  const identifiersChanged = Boolean(old) && (oldCpf !== cpfNormalizado || oldCns !== cns);

  // Só consulta duplicidade ao criar um vínculo ou quando CPF/CNS realmente mudaram.
  // IDs do prontuário, índice canônico e registro-base são ignorados como a mesma pessoa.
  if (!patientId || identifiersChanged) {
    try {
      const ignoreIds = [
        patientId,
        old?.networkIndexId,
        source?.id,
        source?.pacienteId
      ].filter(Boolean);
      const hit = await identityConflict(cpfNormalizado, cns, ignoreIds);

      if (hit) {
        const samePosto = hit.postoId === postoId;
        const hitPatientId = String(hit.pacienteId || '');

        if (!samePosto) {
          return showPatientError(`Este cidadão já existe na rede e está vinculado a ${hit.postoNome || 'outro posto'}. Use “Buscar paciente”.`);
        }

        // Cadastro novo de alguém que já possui prontuário na mesma unidade:
        // reutiliza o prontuário e soma os acompanhamentos em vez de duplicar a pessoa.
        if (!patientId && hitPatientId) {
          const existingSnap = await getDoc(doc(db, 'pacientes', hitPatientId));
          if (existingSnap.exists()) {
            old = { id: existingSnap.id, ...existingSnap.data() };
            patientId = existingSnap.id;
            reusedExisting = true;
            source = hit;

            const mergedPrograms = [...new Set([...(old.programas || []), ...programas])];
            const mergedData = { ...(old.dados || {}) };
            for (const program of programas) {
              mergedData[program] = {
                ...(old.dados?.[program] || {}),
                ...(dados[program] || {})
              };
            }
            programas = mergedPrograms;
            dados = mergedData;
          }
        } else if (!patientId && !hitPatientId) {
          // Cidadão existe apenas no diretório/base. Usa esse índice como origem.
          source = hit;
        } else if (patientId) {
          // Índices antigos podem ter deixado um registro-base sem pacienteId.
          // Na mesma unidade ele é um alias da própria pessoa, não um conflito.
          if (hitPatientId && hitPatientId !== patientId) {
            return showPatientError('Já existe outro prontuário desta unidade usando o mesmo CPF/CNS. Procure o administrador antes de continuar.');
          }
          if (!hitPatientId) source = hit;
        }
      }
    } catch (error) {
      return showPatientError(firebaseMessage(error));
    }
  }

  const derived = derivePatient(programas, dados);
  const active = old ? old.ativo !== false : true;
  const targetRef = patientId ? doc(db, 'pacientes', patientId) : doc(collection(db, 'pacientes'));
  patientId = targetRef.id;

  // Para cidadãos iniciados a partir da base, mantém o índice original como canônico.
  // Para prontuários antigos sem esse vínculo explícito, preserva o índice pelo patientId.
  const networkIndexId = old?.networkIndexId || (!old && source?.id) || patientId;

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
    networkIndexId,
    ativo: active,
    atualizadoEm: serverTimestamp(),
    atualizadoPor: state.firebaseUser.uid
  };

  $('#savePatientBtn').disabled = true;
  try {
    const localPatient = { id: patientId, ...basePayload };
    const indexPayload = optIndexPayload(localPatient, source);
    const summary = { id: patientId, _indexId: networkIndexId, _summaryOnly: true, ...indexPayload };
    delete summary.atualizadoEm;

    const batch = optBatch(db);
    if (old) {
      batch.update(targetRef, basePayload);
    } else {
      batch.set(targetRef, {
        ...basePayload,
        criadoEm: serverTimestamp(),
        criadoPor: state.firebaseUser.uid,
        origemTipo: source?.origemTipo || 'cadastro_manual'
      });
    }

    batch.set(doc(db, 'pacientes_index', networkIndexId), indexPayload, { merge: true });

    // Repara o falso duplicado gerado por versões antigas: se encontramos um
    // registro-base da mesma pessoa e o prontuário já usa outro índice, o antigo
    // deixa de participar das buscas e filtros, mas permanece no Firestore para auditoria.
    if (old && source?.id && source.id !== networkIndexId && !source.pacienteId) {
      batch.set(doc(db, 'pacientes_index', source.id), {
        pacienteId,
        acompanhamentoAtivo: false,
        ativo: false,
        aliasDe: networkIndexId,
        nomeBusca: `~alias~${source.id}`,
        postoNomeBusca: `~alias~${source.id}`,
        cpfNormalizado: '',
        cnsNormalizado: '',
        programas: [],
        consultaKeys: ['alias'],
        retornoKey: '',
        postoRetornoKey: '',
        atualizadoEm: serverTimestamp()
      }, { merge: true });
    }

    const oldPosto = old?.postoId || null;
    if (oldPosto && oldPosto !== postoId) {
      optApplyPostMetricBatch(batch, oldPosto, optMetricDelta(old, null));
      optApplyPostMetricBatch(batch, postoId, optMetricDelta(null, localPatient));
    } else {
      optApplyPostMetricBatch(batch, postoId, optMetricDelta(old, localPatient));
    }

    const beforePrograms = new Set(old?.programas || []);
    const afterPrograms = new Set(programas);
    const addedPrograms = [...afterPrograms].filter((key) => !beforePrograms.has(key));
    const removedPrograms = [...beforePrograms].filter((key) => !afterPrograms.has(key));
    const labelPrograms = (keys) => keys.map((key) => PROGRAMS[key]?.label || key).join(', ');

    let action = old ? 'edição' : 'criação';
    let historySummary = old
      ? `Cadastro e acompanhamento atualizados para ${nome}.`
      : `Paciente ${nome} cadastrado no sistema.`;

    if (reusedExisting && addedPrograms.length) {
      action = 'acompanhamento';
      historySummary = `Novo acompanhamento adicionado: ${labelPrograms(addedPrograms)}.`;
    } else if (old && (addedPrograms.length || removedPrograms.length)) {
      action = 'acompanhamento';
      const changes = [];
      if (addedPrograms.length) changes.push(`adicionado: ${labelPrograms(addedPrograms)}`);
      if (removedPrograms.length) changes.push(`removido: ${labelPrograms(removedPrograms)}`);
      historySummary = `Grupos de acompanhamento atualizados — ${changes.join(' · ')}.`;
    }

    batch.set(doc(collection(db, 'historico')), {
      patientId,
      postoId,
      acao: action,
      resumo: historySummary,
      userId: state.firebaseUser.uid,
      userName: state.profile.nome || state.firebaseUser.email,
      criadoEm: serverTimestamp()
    });

    await batch.commit();

    if (oldPosto && oldPosto !== postoId) {
      optApplyLocalPostMetrics(oldPosto, optMetricDelta(old, null));
      optApplyLocalPostMetrics(postoId, optMetricDelta(null, localPatient));
    } else {
      optApplyLocalPostMetrics(postoId, optMetricDelta(old, localPatient));
    }

    state.opt.fullPatients.set(patientId, { id: patientId, ...basePayload });
    optUpdateLocalPatientSummary(summary);
    state.opt.networkCache.clear();
    state.opt.dashboardCache.clear();
    state.pendingNetworkRecord = null;
    closeModal('patientModal');
    optRenderPatientListNow();
    renderDashboard();
    renderPostos();

    if (reusedExisting && addedPrograms.length) {
      showToast(`Paciente já existente. ${labelPrograms(addedPrograms)} foi adicionado ao mesmo prontuário.`);
    } else {
      showToast(old ? 'Acompanhamento salvo com sucesso.' : 'Paciente cadastrado com sucesso.');
    }
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

