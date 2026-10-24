(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.UCVMSessionGuard = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const RELOAD_KEY = 'ucvm_reload_timestamps_v1';
  const ACTIVITY_KEY = 'ucvm_last_activity_v1';
  const NOTICE_KEY = 'ucvm_session_notice_v1';
  const RELOAD_WINDOW_MS = 60_000;
  const MAX_RELOADS = 5;
  const IDLE_TIMEOUT_MS = 60 * 60 * 1000;
  const IDLE_WARNING_MS = 5 * 60 * 1000;
  const IDLE_CHECK_INTERVAL_MS = 30 * 1000;

  function readTimestamps(storage) {
    try {
      const value = JSON.parse(storage.getItem(RELOAD_KEY) || '[]');
      return Array.isArray(value) ? value.filter(Number.isFinite) : [];
    } catch (_) {
      return [];
    }
  }

  function recordReload(storage, now = Date.now(), isReload = true, options = {}) {
    const windowMs = options.windowMs || RELOAD_WINDOW_MS;
    const maxReloads = options.maxReloads || MAX_RELOADS;
    const recent = readTimestamps(storage).filter(value => now - value < windowMs && value <= now);
    if (isReload) recent.push(now);
    try { storage.setItem(RELOAD_KEY, JSON.stringify(recent)); } catch (_) {}
    const allowed = !isReload || recent.length <= maxReloads;
    return {
      allowed,
      count: recent.length,
      retryAfterMs: allowed || !recent.length ? 0 : Math.max(1, recent[0] + windowMs - now),
    };
  }

  function idleState(lastActivity, now = Date.now(), timeoutMs = IDLE_TIMEOUT_MS, warningBeforeMs = IDLE_WARNING_MS) {
    if (!Number.isFinite(lastActivity)) return { idle: false, warning: false, remainingMs: timeoutMs };
    const elapsed = Math.max(0, now - lastActivity);
    const remainingMs = Math.max(0, timeoutMs - elapsed);
    return {
      idle: elapsed >= timeoutMs,
      warning: elapsed < timeoutMs && elapsed >= Math.max(0, timeoutMs - warningBeforeMs),
      remainingMs,
    };
  }

  function isIdle(lastActivity, now = Date.now(), timeoutMs = IDLE_TIMEOUT_MS) {
    return idleState(lastActivity, now, timeoutMs).idle;
  }

  function isReloadNavigation(performanceObject) {
    try {
      const entry = performanceObject?.getEntriesByType?.('navigation')?.[0];
      if (entry) return entry.type === 'reload';
      return performanceObject?.navigation?.type === 1;
    } catch (_) {
      return false;
    }
  }

  /* Deferred render listeners are registered when document.body does not exist
   * yet. They must be removable, otherwise stop() cannot fully detach the guard. */
  function deferRender(documentObject, handler) {
    if (!documentObject || typeof handler !== 'function') return;
    if (!Array.isArray(documentObject.__ucvmGuardDeferred)) documentObject.__ucvmGuardDeferred = [];
    documentObject.__ucvmGuardDeferred.push(handler);
  }

  function clearDeferredRenders(documentObject) {
    const list = documentObject?.__ucvmGuardDeferred;
    if (!Array.isArray(list) || !list.length) return;
    for (const handler of list) {
      try { documentObject.removeEventListener?.('DOMContentLoaded', handler); } catch (_) {}
    }
    list.length = 0;
  }

  function hideIdleWarning(documentObject, restoreFocus = true) {
    const warning = documentObject?.getElementById?.('ucvm-session-timeout-warning');
    if (!warning) return false;
    const previousFocus = warning.__ucvmPreviousFocus;
    warning.remove?.();
    if (restoreFocus && previousFocus?.focus && previousFocus !== warning) {
      try { previousFocus.focus(); } catch (_) {}
    }
    return true;
  }

  function showIdleWarning(documentObject, remainingMs, onStaySignedIn) {
    if (!documentObject) return null;
    const render = () => {
      if (!documentObject.body) return null;
      let warning = documentObject.getElementById('ucvm-session-timeout-warning');
      const created = !warning;
      if (!warning) {
        warning = documentObject.createElement('div');
        warning.id = 'ucvm-session-timeout-warning';
        warning.__ucvmPreviousFocus = documentObject.activeElement || null;
        warning.setAttribute('role', 'alertdialog');
        warning.setAttribute('aria-live', 'polite');
        warning.setAttribute('aria-modal', 'false');
        warning.setAttribute('aria-labelledby', 'ucvm-session-timeout-copy');
        warning.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:100001;width:min(620px,calc(100vw - 32px));padding:14px 16px;border-radius:10px;background:#fff;color:#111827;border:2px solid #b45309;box-shadow:0 10px 34px #0004;font:600 14px/1.45 Segoe UI,Arial,sans-serif;display:flex;gap:14px;align-items:center;justify-content:space-between;';
        warning.innerHTML = '<span id="ucvm-session-timeout-copy" data-ucvm-session-countdown></span><button type="button" data-ucvm-stay-signed-in style="white-space:nowrap;padding:8px 12px;border:1px solid #92400e;border-radius:6px;background:#fff7ed;color:#7c2d12;font-weight:700;cursor:pointer">Stay signed in</button>';
        documentObject.body.appendChild(warning);
      }
      const minutes = Math.max(1, Math.ceil(Math.max(0, remainingMs) / 60_000));
      const label = warning.querySelector?.('[data-ucvm-session-countdown]');
      if (label) label.textContent = `You will be signed out in about ${minutes} minute${minutes === 1 ? '' : 's'} due to inactivity.`;
      const button = warning.querySelector?.('[data-ucvm-stay-signed-in]');
      if (button) {
        button.onclick = () => { onStaySignedIn?.(); hideIdleWarning(documentObject); };
        if (created) {
          try { button.focus?.(); } catch (_) {}
        }
      }
      return warning;
    };
    if (documentObject.body) return render();
    documentObject.addEventListener?.('DOMContentLoaded', render, { once: true });
    deferRender(documentObject, render);
    return null;
  }

  function showNotice(documentObject, message, blocking = false) {
    if (!documentObject || documentObject.getElementById('ucvm-session-guard-notice')) return;
    const render = () => {
      if (!documentObject.body || documentObject.getElementById('ucvm-session-guard-notice')) return;
      const notice = documentObject.createElement('div');
      notice.id = 'ucvm-session-guard-notice';
      notice.setAttribute('role', 'alert');
      notice.textContent = message;
      notice.style.cssText = blocking
        ? 'position:fixed;inset:0;z-index:100000;display:grid;place-items:center;padding:32px;background:#0f172acc;color:#fff;font:600 16px/1.5 Segoe UI,Arial,sans-serif;text-align:center;'
        : 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:100000;max-width:720px;padding:12px 18px;border-radius:8px;background:#7f1d1d;color:#fff;font:600 14px/1.4 Segoe UI,Arial,sans-serif;box-shadow:0 8px 28px #0004;text-align:center;';
      documentObject.body.appendChild(notice);
    };
    if (documentObject.body) render();
    else {
      documentObject.addEventListener('DOMContentLoaded', render, { once: true });
      deferRender(documentObject, render);
    }
  }

  function start(auth, environment = {}) {
    const windowObject = environment.window || (typeof window !== 'undefined' ? window : null);
    const documentObject = environment.document || windowObject?.document;
    if (!windowObject || !windowObject.localStorage || !windowObject.sessionStorage) return { blocked: false };
    if (windowObject.__ucvmSessionGuard) return windowObject.__ucvmSessionGuard;

    const reload = recordReload(windowObject.localStorage, Date.now(), isReloadNavigation(windowObject.performance));
    const controller = { blocked: !reload.allowed, stop: () => {} };
    windowObject.__ucvmSessionGuard = controller;

    if (!reload.allowed) {
      const seconds = Math.max(1, Math.ceil(reload.retryAfterMs / 1000));
      const message = `Too many refreshes. For data protection, this session was signed out. Please wait ${seconds} seconds before signing in again.`;
      try { windowObject.sessionStorage.setItem(NOTICE_KEY, message); } catch (_) {}
      showNotice(documentObject, message, true);
      Promise.resolve(auth?.signOut?.()).catch(() => {});
      return controller;
    }

    let lastWrite = 0;
    const markActivity = () => {
      const now = Date.now();
      hideIdleWarning(documentObject);
      if (now - lastWrite < 15_000) return;
      lastWrite = now;
      try { windowObject.localStorage.setItem(ACTIVITY_KEY, String(now)); } catch (_) {}
    };
    let lastActivity = Number(windowObject.localStorage.getItem(ACTIVITY_KEY));
    if (!Number.isFinite(lastActivity) || lastActivity <= 0) markActivity();

    const activityEvents = ['pointerdown', 'keydown', 'touchstart', 'scroll'];
    activityEvents.forEach(name => windowObject.addEventListener(name, markActivity, { passive: true, capture: true }));
    let timingOut = false;
    const checkIdle = () => {
      const value = Number(windowObject.localStorage.getItem(ACTIVITY_KEY));
      if (timingOut) return;
      if (!auth?.currentUser) { hideIdleWarning(documentObject); return; }
      const state = idleState(value, Date.now());
      if (state.idle) {
        timingOut = true;
        hideIdleWarning(documentObject, false);
        const message = 'You were signed out after one hour without activity. Sign in again to continue.';
        try { windowObject.sessionStorage.setItem(NOTICE_KEY, message); } catch (_) {}
        Promise.resolve(auth.signOut()).catch(() => {}).finally(() => {
          showNotice(documentObject, message, false);
          const page = (windowObject.location.pathname.split('/').pop() || 'index.html').toLowerCase();
          if (page !== 'index.html') windowObject.location.replace('index.html');
        });
        return;
      }
      if (state.warning) showIdleWarning(documentObject, state.remainingMs, markActivity);
      else hideIdleWarning(documentObject);
    };
    const onStorage = event => {
      if (event?.key !== ACTIVITY_KEY) return;
      const value = Number(event.newValue);
      if (Number.isFinite(value) && value > 0) {
        hideIdleWarning(documentObject);
        if (!timingOut) checkIdle();
      }
    };
    windowObject.addEventListener('storage', onStorage);
    // Background tabs get their timers throttled and a sleeping device does not
    // run them at all, so a visibility change re-evaluates the idle state from
    // the real last-activity timestamp instead of waiting for the next interval.
    const onVisibility = () => {
      if (documentObject?.visibilityState && documentObject.visibilityState !== 'visible') return;
      checkIdle();
    };
    documentObject?.addEventListener?.('visibilitychange', onVisibility);
    const timer = windowObject.setInterval(checkIdle, IDLE_CHECK_INTERVAL_MS);
    controller.stop = () => {
      windowObject.clearInterval(timer);
      hideIdleWarning(documentObject);
      documentObject?.removeEventListener?.('visibilitychange', onVisibility);
      clearDeferredRenders(documentObject);
      activityEvents.forEach(name => windowObject.removeEventListener(name, markActivity, { capture: true }));
      windowObject.removeEventListener('storage', onStorage);
      if (windowObject.__ucvmSessionGuard === controller) delete windowObject.__ucvmSessionGuard;
    };
    controller.checkIdle = checkIdle;
    // Evaluate once at start so an already-expired idle period cannot be extended
    // by user activity during the first interval window.
    checkIdle();

    try {
      const notice = windowObject.sessionStorage.getItem(NOTICE_KEY);
      if (notice) {
        windowObject.sessionStorage.removeItem(NOTICE_KEY);
        showNotice(documentObject, notice, false);
      }
    } catch (_) {}
    return controller;
  }

  return { recordReload, idleState, isIdle, isReloadNavigation, showIdleWarning, hideIdleWarning, start, constants: { RELOAD_WINDOW_MS, MAX_RELOADS, IDLE_TIMEOUT_MS, IDLE_WARNING_MS, IDLE_CHECK_INTERVAL_MS, ACTIVITY_KEY } };
});
