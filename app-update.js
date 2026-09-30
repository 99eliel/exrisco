// EXRisco — atualização automática do PWA sem depender de Ctrl+F5.
// Verifica o service worker e os arquivos do app ao abrir, ao voltar para a aba,
// ao reconectar e periodicamente. Nunca toca no Firestore.
(function configureAutomaticUpdates() {
  if (!('serviceWorker' in navigator)) return;

  const CHECK_INTERVAL_MS = 10 * 60 * 1000;
  const MIN_CHECK_GAP_MS = 60 * 1000;
  let registration = null;
  let lastCheckAt = 0;
  let updatePending = false;
  let retryTimer = null;

  function hasOpenEditor() {
    return Boolean(document.querySelector('.modal:not(.hidden)'));
  }

  function reloadWhenSafe() {
    if (serviceWorkerReloading) return;
    if (hasOpenEditor()) {
      updatePending = true;
      if (!retryTimer) {
        retryTimer = setInterval(() => {
          if (!updatePending || hasOpenEditor()) return;
          clearInterval(retryTimer);
          retryTimer = null;
          reloadWhenSafe();
        }, 5000);
      }
      return;
    }

    updatePending = false;
    serviceWorkerReloading = true;
    window.location.reload();
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
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }

      const controller = navigator.serviceWorker.controller;
      if (controller) controller.postMessage({ type: 'CHECK_APP_SHELL' });
    } catch (error) {
      console.warn('Não foi possível verificar atualização do EXRisco.', error);
    }
  }

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type !== 'EXRISCO_UPDATE_READY') return;
    reloadWhenSafe();
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    reloadWhenSafe();
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
    if (!updatePending) return;
    if (event.target.closest('[data-close-modal], #confirmCancel, #confirmOk')) {
      setTimeout(reloadWhenSafe, 250);
    }
  });
})();
