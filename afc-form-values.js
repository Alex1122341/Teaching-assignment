'use strict';
window.UCVM_AFC_FORM_VALUES = (() => {
  const clean = value => String(value || '').trim().replace(/[‐‑‒–—]/g, '-');
  const key = value => clean(value).toLowerCase();
  const ranks = new Map([
    ['assistant professor', 'Assistant Professor - AC0003'],
    ['assistant professor (teaching)', 'Assistant Professor (Teaching) - AC0004'],
    ['associate professor', 'Associate Professor - AC0002'],
    ['associate professor (teaching)', 'Associate Professor (Teaching) - AC0007'],
    ['professor', 'Professor - AC0001'],
    ['professor (teaching)', 'Professor (Teaching) - AC0008']
  ]);
  const appointments = new Map([
    ['tenure', 'With Tenure'], ['with tenure', 'With Tenure'],
    ['tenure track', 'Tenure-track'], ['tenure-track', 'Tenure-track'],
    ['limited term', 'Limited Term'], ['contingent term', 'Contingent Term']
  ]);
  return {
    PRIMARY_DEPARTMENT: '30060 - Faculty of Veterinary Medicine',
    rank: value => ranks.get(key(value)) || '',
    appointment: value => appointments.get(key(value)) || '',
    contact: request => ({address: clean(request?.contactAddress), phone: clean(request?.contactPhone)})
  };
})();
