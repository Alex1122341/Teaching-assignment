const test = require('node:test');
const assert = require('node:assert/strict');
const {workDays, validateDraft, nextStatus, HOLIDAYS} = require('../test-support/afc-policy');

test('workdays exclude weekends and official UCalgary closures', () => {
  assert.equal(HOLIDAYS.has('2026-09-30'), true);
  assert.equal(workDays('2026-09-28', '2026-10-02'), 4);
  assert.equal(workDays('2026-12-21', '2027-01-04'), 5);
});

test('Business or Other requires purpose and destination', () => {
  assert.throws(() => validateDraft({startDate:'2026-10-01',endDate:'2026-10-02',reason:'business_other',signatureName:'Alex Zhu',attested:true,teachingSessions:[]}), /purpose and destination/i);
});

test('teaching assignments require coverage', () => {
  assert.throws(() => validateDraft({startDate:'2026-10-01',endDate:'2026-10-02',reason:'vacation',signatureName:'Alex Zhu',attested:true,teachingSessions:[{id:'s1'}]}), /coverage/i);
});

test('AFC workflow requires report-to recommendation before final approval unless ADFA signs on behalf', () => {
  assert.equal(nextStatus('submit', {reportToUid:'ad-1'}), 'pending_report_to');
  assert.equal(nextStatus('submit', {reportToUid:''}), 'pending_admin');
  assert.equal(nextStatus('recommend', {status:'pending_report_to'}), 'pending_admin');
  assert.equal(nextStatus('approve', {status:'pending_admin'}), 'approved');
});
