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

  if (!panel || !content || !closeButton || !teachingButton || !requestButton || !historyButton || !window.UCVM_AFC) return;

  window.UCVM_AFC.mount({ panelId: 'afc-panel-content', mode: 'timetable' });

  function setActive(view) {
    requestButton.classList.toggle('active', view === 'afc');
    historyButton.classList.toggle('active', view === 'history');
  }

  function showPanel(view) {
    previousFocus = document.activeElement;
    panel.hidden = false;
    panel.setAttribute('aria-hidden', 'false');
    setActive(view);
    if (view === 'history') {
      title.textContent = 'My Change History';
      content.innerHTML = '';
      UCVM.logs(content, { includeFaculty: true, profile: window.UCVM_PAGE_DATA?.profile?.() || {} });
    } else {
      title.textContent = 'AFC Request';
      const event = new Event('ucvm:afc-open');
      event.ucvmForce = true;
      dispatchEvent(event);
    }
    closeButton.focus();
  }

  function close() {
    panel.hidden = true;
    panel.setAttribute('aria-hidden', 'true');
    setActive('');
    if (previousFocus?.focus) previousFocus.focus();
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
    if (event.key === 'Escape' && !panel.hidden) close();
  });

  window.UCVM_AFC_TIMETABLE_PANEL = {
    open: () => showPanel('afc'),
    close,
    isOpen: () => !panel.hidden
  };
})();
