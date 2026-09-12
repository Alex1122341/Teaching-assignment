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

  function isIdle(lastActivity, now = Date.now(), timeoutMs = IDLE_TIMEOUT_MS) {
    return Number.isFinite(lastActivity) && now - lastActivity >= timeoutMs;
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
    else documentObject.addEventListener('DOMContentLoaded', render, { once: true });
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
      if (timingOut || !auth?.currentUser || !isIdle(value, Date.now())) return;
      timingOut = true;
      const message = 'You were signed out after one hour without activity. Sign in again to continue.';
      try { windowObject.sessionStorage.setItem(NOTICE_KEY, message); } catch (_) {}
      Promise.resolve(auth.signOut()).catch(() => {}).finally(() => {
        showNotice(documentObject, message, false);
        const page = (windowObject.location.pathname.split('/').pop() || 'index.html').toLowerCase();
        if (page !== 'index.html') windowObject.location.replace('index.html');
      });
    };
    const timer = windowObject.setInterval(checkIdle, 30_000);
    controller.stop = () => {
      windowObject.clearInterval(timer);
      activityEvents.forEach(name => windowObject.removeEventListener(name, markActivity, { capture: true }));
    };
    controller.checkIdle = checkIdle;

    try {
      const notice = windowObject.sessionStorage.getItem(NOTICE_KEY);
      if (notice) {
        windowObject.sessionStorage.removeItem(NOTICE_KEY);
        showNotice(documentObject, notice, false);
      }
    } catch (_) {}
    return controller;
  }

  return { recordReload, isIdle, isReloadNavigation, start, constants: { RELOAD_WINDOW_MS, MAX_RELOADS, IDLE_TIMEOUT_MS } };
});
