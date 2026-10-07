'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const panel = $('afc-panel');
  const content = $('afc-panel-content');
  const title = $('afc-panel-title');
  const closeButton = $('afc-panel-close');
  const teachingButton = $('my-teaching-btn');
  const requestButton = $('afc-request-btn');
  const historyButton = $('my-change-history-btn');
  let previousFocus = null;
  let backgroundState = [];

  if (!panel || !content || !closeButton || !teachingButton || !requestButton || !historyButton || !window.UCVM_AFC) return;

  window.UCVM_AFC.mount({ panelId: 'afc-panel-content', mode: 'timetable' });

  function setActive(view) {
    requestButton.classList.toggle('active', view === 'afc');
    historyButton.classList.toggle('active', view === 'history');
  }

  function containBackground() {
    backgroundState = [...(document.body?.children || [])]
      .filter(element => element !== panel)
      .map(element => ({ element, inert: element.inert }));
    for (const state of backgroundState) state.element.inert = true;
  }

  function restoreBackground() {
    for (const state of backgroundState) state.element.inert = state.inert;
    backgroundState = [];
  }

  function focusableElements() {
    const selector = 'a[href],button,input,select,textarea,summary,[tabindex],[contenteditable="true"]';
    return [...panel.querySelectorAll(selector)].filter(element => {
      if (element.disabled || element.hidden || element.inert || element.getAttribute?.('aria-hidden') === 'true') return false;
      if (typeof element.tabIndex === 'number' && element.tabIndex < 0) return false;
      if (element.closest?.('[hidden],[inert],[aria-hidden="true"]')) return false;
      if (element.closest?.('details:not([open])') && String(element.tagName).toUpperCase() !== 'SUMMARY') return false;
      const style = window.getComputedStyle?.(element);
      if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
      return typeof element.getClientRects !== 'function' || element.getClientRects().length > 0;
    });
  }

  function showPanel(view) {
    if (panel.hidden) {
      previousFocus = document.activeElement;
      containBackground();
    }
    panel.hidden = false;
    panel.setAttribute('aria-hidden', 'false');
    setActive(view);
    if (view === 'history') {
      title.textContent = 'My Change History';
      content.innerHTML = '';
      UCVM.logs(content, { includeFaculty: true, profile: window.UCVM_PAGE_DATA?.profile?.() || {}, personalOnly: true });
    } else {
      title.textContent = 'AFC Request';
      const event = new Event('ucvm:afc-open');
      event.ucvmForce = true;
      dispatchEvent(event);
    }
    closeButton.focus();
  }

  function close() {
    if (panel.hidden) return;
    panel.hidden = true;
    panel.setAttribute('aria-hidden', 'true');
    setActive('');
    restoreBackground();
    const returnFocus = previousFocus;
    previousFocus = null;
    if (returnFocus?.focus) returnFocus.focus();
  }

  function showTeaching() {
    close();
    dispatchEvent(new Event('ucvm:show-teaching'));
  }

  teachingButton.onclick = showTeaching;
  requestButton.onclick = () => showPanel('afc');
  historyButton.onclick = () => showPanel('history');
  closeButton.onclick = close;
  if (document.addEventListener) document.addEventListener('keydown', event => {
    if (panel.hidden) return;
    if (event.key === 'Escape') { close(); return; }
    if (event.key !== 'Tab') return;
    const focusable = focusableElements();
    if (!focusable.length) { event.preventDefault(); closeButton.focus(); return; }
    const first = focusable[0], last = focusable[focusable.length - 1], active = document.activeElement;
    if (event.shiftKey && (active === first || !panel.contains(active))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (active === last || !panel.contains(active))) { event.preventDefault(); first.focus(); }
  });

  window.UCVM_AFC_TIMETABLE_PANEL = {
    open: () => showPanel('afc'),
    close,
    isOpen: () => !panel.hidden
  };
})();
