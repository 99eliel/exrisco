// EXRisco — atualização automática do PWA.
// Responsável apenas por detectar e aplicar novas versões com segurança.
(function configureAutomaticUpdates() {
  if (!('serviceWorker' in navigator)) return;

  const CHECK_INTERVAL_MS = 10 * 60 * 1000;
  const MIN_CHECK_GAP_MS = 60 * 1000;
  let registration = null;
  let lastCheckAt = 0;
  let shellUpdatePending = false;
  let waitingWorker = null;
  let retryTimer = null;

  function hasOpenEditor() {
    return Boolean(document.querySelector('.modal:not(.hidden)'));
  }

  function stopRetryTimer() {
    if (!retryTimer) return;
    clearInterval(retryTimer);
    retryTimer = null;
  }

  function applyPendingUpdateWhenSafe() {
    if (serviceWorkerReloading) return;

    if (hasOpenEditor()) {
      if (!retryTimer) {
        retryTimer = setInterval(() => {
          if (!hasOpenEditor()) applyPendingUpdateWhenSafe();
        }, 3000);
      }
      return;
    }

    stopRetryTimer();

    if (waitingWorker) {
      const worker = waitingWorker;
      waitingWorker = null;
      shellUpdatePending = false;
      worker.postMessage({ type: 'SKIP_WAITING' });
      return;
    }

    if (shellUpdatePending) {
      shellUpdatePending = false;
      serviceWorkerReloading = true;
      window.location.reload();
    }
  }

  async function requestUpdateCheck(force = false) {
    if (!navigator.onLine) return;
    const now = Date.now();
    if (!force && now - lastCheckAt < MIN_CHECK_GAP_MS) return;
    lastCheckAt = now;

    try {
      registration = registration || await navigator.serviceWorker.ready;
      await registration.update();

      if (registration.waiting) {
        waitingWorker = registration.waiting;
        applyPendingUpdateWhenSafe();
        return;
      }

      const controller = navigator.serviceWorker.controller;
      if (controller) controller.postMessage({ type: 'CHECK_APP_SHELL' });
    } catch (error) {
      console.warn('Não foi possível verificar atualização do EXRisco.', error);
    }
  }

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type !== 'EXRISCO_UPDATE_READY') return;
    shellUpdatePending = true;
    applyPendingUpdateWhenSafe();
  });

  window.addEventListener('load', () => {
    setTimeout(() => requestUpdateCheck(true), 1500);
    setInterval(() => requestUpdateCheck(false), CHECK_INTERVAL_MS);
  });

  window.addEventListener('focus', () => requestUpdateCheck(false));
  window.addEventListener('online', () => requestUpdateCheck(true));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestUpdateCheck(false);
  });

  document.addEventListener('click', (event) => {
    if (!shellUpdatePending && !waitingWorker) return;
    if (event.target.closest('[data-close-modal], #confirmCancel, #confirmOk')) {
      setTimeout(applyPendingUpdateWhenSafe, 300);
    }
  });
})();