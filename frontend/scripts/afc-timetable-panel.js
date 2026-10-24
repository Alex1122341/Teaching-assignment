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
  const changesButton = $('cal-changes-btn');
  let historyView = null;
  let previousFocus = null;
  let backgroundState = [];

  if (!panel || !content || !closeButton || !teachingButton || !requestButton || !historyButton || !window.UCVM_AFC) return;

  window.UCVM_AFC.mount({ panelId: 'afc-panel-content', mode: 'timetable' });

  function setActive(view) {
    requestButton.classList.toggle('active', view === 'afc');
    historyButton.classList.toggle('active', view === 'history');
    changesButton?.classList.toggle('active', view === 'timetable-history');
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
    historyView?.destroy();historyView=null;
    if (view === 'history' || view === 'timetable-history') {
      title.textContent = view === 'history' ? 'My Change History' : 'Calendar Changes';
      content.innerHTML = '';
      historyView = window.PAWS_CHANGE_HISTORY.mount(content, { api: window.UCVM_PAWS_DATA, scope: view === 'history' ? 'mine' : 'timetable',academicYear:window.UCVM_PAGE_DATA?.academicYear?.() });
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
    historyView?.destroy();historyView=null;
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
  if(changesButton)changesButton.onclick = () => showPanel('timetable-history');
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
