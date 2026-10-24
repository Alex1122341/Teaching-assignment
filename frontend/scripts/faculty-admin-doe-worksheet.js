(() => {
  'use strict';

  function create({ api, escapeHtml, formatDoe, finiteDoe, getFaculty, getAcademicYear, editAction, onView } = {}) {
    if (!api || !escapeHtml || !formatDoe || !finiteDoe || !getFaculty || !getAcademicYear || !editAction || !onView) {
      throw new TypeError('DOE Worksheet module dependencies are required.');
    }
    let worksheets = null;
    let reviewPopover = null, reviewTrigger = null, reviewRequest = 0;
    const reviewDetails = new Map();
    const esc = escapeHtml;
    const showFaculty = value => typeof window === 'object' && window.PAWS_FACULTY_NAME ? window.PAWS_FACULTY_NAME.format(value) : String(value || '');
    const referenceBubble = (text, label = 'Reference') => `<details class="reference-bubble"><summary aria-label="${esc(label)} details"><span aria-hidden="true">ⓘ</span> ${esc(label)}</summary><div class="reference-bubble-content">${esc(text || 'Source not recorded')}</div></details>`;

    function reviewButton(facultyId, field = 'DOE', count = 0) {
      return `<button type="button" class="doe-status doe-under doe-review-trigger" data-doe-review="${esc(facultyId)}" aria-label="Needs Review: ${esc(field)} — show reasons" aria-haspopup="dialog">Needs Review${count > 0 ? ` (${count})` : ''}</button>`;
    }

    function balanceBadge(remaining, status, facultyId) {
      if (remaining === null || status !== 'calculated') return reviewButton(facultyId, 'Remaining / Overage');
      const displayed = Number(remaining.toFixed(2));
      const label = displayed === 0 ? 'At DOE' : displayed > 0 ? 'Within DOE' : 'Over DOE';
      const tone = displayed === 0 ? 'doe-at' : displayed > 0 ? 'doe-within' : 'doe-over';
      const amount = displayed === 0 ? '0.00% remaining' : `${Math.abs(displayed).toFixed(2)}% ${displayed > 0 ? 'remaining' : 'over'}`;
      return `<span class="doe-status ${tone}">${label}</span><div class="doe-balance-amount">${esc(amount)}</div>`;
    }

    function policySummary(row) {
      const source = String(row.workloadSourceReference || '').trim();
      const year = row.academicYear || 'Academic year not recorded';
      const title = source ? source.split(/\s[·|]\s/)[0] : row.policyVersionId ? 'Annual DOE policy' : 'Policy source not recorded';
      const updated = source.match(/updated\s+(\d{4}-\d{2}-\d{2})/i)?.[1];
      const basis = row.calculationBasis === 'recorded_sources' ? 'Recorded sources' : row.policyVersionId ? 'Annual calculation' : '';
      const details = [source, row.policyVersionId ? `Calculation policy: ${row.policyVersionId}` : 'No annual calculation policy recorded', row.targetPolicyVersionLabel ? `Target source: ${row.targetPolicyVersionLabel}` : '', row.target?.policyVersionId ? `Target policy ID: ${row.target.policyVersionId}` : ''].filter(Boolean).join(' · ');
      return `<strong class="doe-policy-label">${esc(title)}</strong>${updated ? `<div class="muted">Updated ${esc(updated)}</div>` : ''}<div class="muted">Academic year ${esc(year)}</div>${basis ? `<div class="muted">${esc(basis)}</div>` : ''}${referenceBubble(details, 'Policy & source')}`;
    }

    const groups=[{"title":"Lectures & Labs","items":[["lecture","Lectures","hours"],["srl","Self-Regulated Learning","hours"],["lab_primary","Labs (Primary)","hours"],["lab_secondary","Labs (Secondary)","hours"]]},{"title":"Course Coordination","items":[["course_coordinator","Course Coordination","courses"]]},{"title":"DVM HICC Course Development","items":[["hicc","HICC Development","units"]]},{"title":"VISC Coordination","items":[["visc","VISC Subjects","subjects"]]},{"title":"Clinical Rotations","items":[["rotation","Rotation Participant","weeks"],["ccc","Community Care Clinic","shifts"],["rotation_coordination","Designated Clinical Rotation Coordination","types"]]},{"title":"Other Approved Teaching","items":[["early_career","Early Career Development","approved"],["special","Special Activities","approved"]]},{"title":"Trainees & Supervision","items":[["undergrad","Undergraduate Students / Interns","trainees"],["vetm506","Undergraduate VETM 506","trainees"],["im","Undergraduate IM","trainees"],["preceptor","Fourth-Year Preceptor","trainees"],["grad_primary","Graduate Student (Primary)","trainees"],["grad_co","Graduate Student (Co-Supervised)","trainees"],["postdoc","Postdocs","trainees"],["supervision_unknown","Other Recorded Supervision","unavailable"]]}];
    function isReviewLine(line) {
  const status=String(line.status || '').toLowerCase();
  return line.applicable !== false && (finite(line.resultDoe) === null || line.requiresReview === true || ['needs_review','needs-review','error','stored-calculation-mismatch'].includes(status));
}
    function categoryForLine(line) {
  const category = String(line.category || '').toLowerCase();
  if (['research','administration','admin','contract_admin','service','service_admin','clinical_activity_ppvm'].includes(category)) return 'non_teaching';
  if (line.sourceEntityType === 'manual_doe_assignment') return 'unclassified';
  const role = String(line.roleType || '').trim().toLowerCase();
  const activity = String(line.activityType || '').trim().toLowerCase();
  const fact = line.facts || {};
  const sessionType = String(fact.sessionType || '').trim().toLowerCase();
  const label = [role,activity,String(line.ruleKey || '').toLowerCase()].join(' ');
  if (['supervision','trainee_supervision'].includes(category)) {
    if (/vetm[\s_-]*506/.test(label)) return 'vetm506';
    if (/(^|\W)im($|\W)/.test(label)) return 'im';
    if (/4th|fourth|preceptor/.test(label)) return 'preceptor';
    if (/undergrad|summer student/.test(label)) return 'undergrad';
    if (/co.supervis|co_supervis|cosupervis/.test(label)) return 'grad_co';
    if (/graduate|primary supervisor/.test(label)) return 'grad_primary';
    if (/postdoc/.test(label)) return 'postdoc';
    return 'supervision_unknown';
  }
  if (/coordinator\s*\/\s*hicc|hicc.*coordinator|legacy ambiguous/.test(role)) return 'unclassified';
  if (role === 'course coordinator' || category === 'course_coordination') return 'course_coordinator';
  if (role === 'hicc' || category === 'hicc') return 'hicc';
  if (role === 'visc' || category === 'visc') return 'visc';
  if (role === 'ccc' || /community care clinic/.test(role)) return 'ccc';
  if (/rotation participant/.test(role) || (category === 'rotation' && /participant/.test(label))) return 'rotation';
  if (/designated rotation coordinat|designated clinical rotation coordinat/.test(label)) return 'rotation_coordination';
  if (category === 'approved_activity' && /early career/.test(label)) return 'early_career';
  if (category === 'approved_activity' && /special activit/.test(label)) return 'special';
  if (['teaching','assigned_teaching'].includes(category)) {
    if (sessionType === 'srl' || /\bsrl\b|self.regulat/.test(label)) return 'srl';
    if (sessionType === 'lab' || /\blab\b|laboratory/.test(label)) {
      if (/secondary|co.instructor|lab_secondary/.test(label)) return 'lab_secondary';
      if (/primary|lead|lab_primary/.test(label)) return 'lab_primary';
      return 'unclassified';
    }
    if (sessionType === 'lec' || sessionType === 'lecture' || /lecture|lecturer|teaching_lecture/.test(label)) return 'lecture';
  }
  return 'unclassified';
}
    function quantityForLine(line,defaultUnit) {
  if (defaultUnit === 'unavailable') return {unit:'unavailable',value:null};
  const facts = line.facts || {};
  const inputs = line.inputs || {};
  const rule = line.rule || {};
  const sessionLike = ['legacy_session_assignment','session_assignment'].includes(String(line.sourceEntityType || ''));
  if (defaultUnit === 'hours' && sessionLike && String(rule.calculationMode || '') === 'fixed') return {unit:'session',value:1};
  if (defaultUnit === 'hours' && line.sourceEntityType === 'legacy_session_assignment') {
    const value=finite(line.doeQuantity ?? line.creditedHours);
    return {unit:'hours',value:value!==null&&value>=0?value:null};
  }
  const fields={
    hours:['hours','creditedHours','doeQuantity'],
    units:['units','unitCount','quantity'],
    weeks:['weeks'],
    shifts:['shifts'],
    courses:['courses','courseCount','quantity'],
    subjects:['subjectCount','subjects'],
    types:['uniqueRotationTypes','rotationTypes','rotationTypeCount','quantity'],
    trainees:['trainees','traineeCount','count'],
    approved:['approvedDoe','percentage','quantity']
  };
  for (const field of fields[defaultUnit] || []) {
    for (const obj of [inputs,facts,line]) {
      const raw=obj && obj[field];
      if (raw!==null&&raw!==undefined&&raw!==''&&Number.isFinite(Number(raw))&&Number(raw)>=0) return {unit:defaultUnit,value:Number(raw)};
    }
  }
  return {unit:defaultUnit,value:null};
}
    function buildLookupBreakdown(worksheet) {
  const lines=Array.isArray(worksheet?.lines)?worksheet.lines:[];
  const mapped=new Map(),excluded=[],unclassified=[];
  for(const line of lines){
    if(line.applicable===false && finite(line.resultDoe)===null) continue;
    const item=categoryForLine(line);
    if(item==='non_teaching'){excluded.push(line);continue;}
    if(item==='unclassified'){unclassified.push(line);continue;}
    if(!mapped.has(item))mapped.set(item,[]);
    mapped.get(item).push(line);
  }
  const ordered=groups.map(group=>({
    title:group.title,
    items:group.items.map(([key,label,unit])=>{
      const rows=mapped.get(key)||[];
      const quantities=rows.map(line=>quantityForLine(line,unit));
      const units=[...new Set(quantities.map(q=>q.unit))];
      const allQuantities=rows.length>0&&units.length===1&&quantities.every(q=>finite(q.value)!==null);
      const complete=rows.length>0&&rows.every(line=>!isReviewLine(line));
      const amount=complete?Number(rows.reduce((sum,line)=>sum+Number(line.resultDoe),0).toFixed(6)):null;
      return {key,label,rows:rows.length,unit:units.length===1?units[0]:'mixed',quantity:allQuantities?Number(quantities.reduce((sum,q)=>sum+q.value,0).toFixed(6)):null,amount,needsReview:rows.some(isReviewLine)};
    })
  }));
  const teachingRows=ordered.slice(0,-1).flatMap(group=>group.items).filter(row=>row.rows>0);
  const allMapped=unclassified.length===0&&teachingRows.every(row=>!row.needsReview)&&teachingRows.length>0;
  const without=allMapped?Number(teachingRows.reduce((sum,row)=>sum+row.amount,0).toFixed(6)):null;
  const applied=finite(worksheet?.totals?.appliedSupervisionDoe);
  const supervisionUnresolved=ordered[ordered.length-1].items.some(row=>row.needsReview);
  const withTrainees=allMapped&&excluded.length===0&&!supervisionUnresolved&&applied!==null?Number((without+applied).toFixed(6)):null;
  return {groups:ordered,without,rawSupervision:finite(worksheet?.totals?.rawSupervisionDoe),appliedSupervision:applied,withTrainees,unclassified,excluded,legacyTotal:finite(worksheet?.totals?.assignedTeachingDoe),status:worksheet?.status};
}
    function renderLookupBreakdown(worksheet) {
  const breakdown=buildLookupBreakdown(worksheet);
  const pct=value=>value===null?'Needs Review':formatDoe(value);
  const quantity=item=>{
    if(!item.rows)return '—';
    if(item.quantity===null)return 'Source quantity unavailable';
    const labels={hours:'hrs',session:'sessions',units:'units',weeks:'weeks',shifts:'shifts',courses:'courses',subjects:'subjects',types:'types',trainees:'trainees',approved:'% allocated'};
    return `${Number(item.quantity.toFixed(2))} ${labels[item.unit] || item.unit}`;
  };
  const body=breakdown.groups.map(group=>`<tbody class="doe-excel-rows"><tr class="doe-excel-heading"><th colspan="3">${esc(group.title)}</th></tr>${group.items.map(item=>`<tr><td>${esc(item.label)}</td><td>${esc(quantity(item))}</td><td>${item.rows===0?'—':item.needsReview?'Needs Review':esc(pct(item.amount))}</td></tr>`).join('')}</tbody>`).join('');
  const warnings=[
    breakdown.unclassified.length?`${breakdown.unclassified.length} DOE source line(s) cannot be safely classified as Teaching. These records remain in the existing Worksheet and are not silently added to this breakdown.`:'',
    breakdown.excluded.length?`${breakdown.excluded.length} source line(s) are explicitly Non-Teaching. Teaching-only Total + Trainees is held for review because the existing server reserve may include these sources.`:'',
    breakdown.rawSupervision===null?'Confirmed raw supervision evidence is unavailable.':'',
    breakdown.without===null?'Total Without Trainees cannot be finalized until every applicable Teaching source is classified and resolved.':'',
    breakdown.status!=='calculated'?'The source Worksheet is not fully calculated; use its Needs Review details above.':''
  ].filter(Boolean);
  return `<section class="doe-excel-summary"><h3>Assigned Teaching DOE · Excel-style Breakdown</h3><p class="aux-note">Source: current Faculty DOE Worksheet · ${esc(worksheet.academicYear||'Academic year unavailable')}. Each quantity comes from the linked assignment; no missing quantity is back-calculated from DOE.</p><div class="table-wrap"><table class="data-table doe-excel-summary-table"><thead><tr><th>Item</th><th>Quantity</th><th>Calculated DOE</th></tr></thead>${body}<tbody class="doe-excel-totals"><tr><th>Total Without Trainees</th><td></td><td>${esc(pct(breakdown.without))}</td></tr><tr><th>Trainee Actual (Raw)</th><td></td><td>${esc(pct(breakdown.rawSupervision))}</td></tr><tr><th>Trainee Applied after Reserve</th><td></td><td>${esc(pct(breakdown.appliedSupervision))}</td></tr><tr><th>Total + Applied Trainees</th><td></td><td>${esc(pct(breakdown.withTrainees))}</td></tr></tbody></table></div>${warnings.length?`<div class="warn-box">${warnings.map(w=>`<p>${esc(w)}</p>`).join('')}</div>`:''}<p class="aux-note">Current saved Worksheet Total Assigned: ${esc(pct(breakdown.legacyTotal))}. This may differ from the classified Teaching subtotal until all legacy and manual sources have an approved Teaching/Non-Teaching classification. The existing server calculation is not overwritten.</p></section>`;
}
    function renderWorksheet(worksheet) {
      const target = worksheet.target || {}, totals = worksheet.totals || {}, reserve = worksheet.reserve || {};
      const missingData = (worksheet.errors || []).some(error => ['SUPERVISION_DATA_UNAVAILABLE', 'DOE_TARGET_UNAVAILABLE', 'RESERVE_POLICY_INVALID'].includes(error.code));
      const statusLabel = worksheet.status === 'calculated' ? (worksheet.calculationBasis === 'recorded_sources' ? 'Calculated from recorded sources' : 'Calculated') : worksheet.status === 'not_found' ? 'Not found' : missingData ? 'Awaiting data / policy' : 'Needs Review';
      const cards = [
        ['Contract Teaching target', target.contractTeachingDoe], ['Effective target', target.effectiveTargetDoe],
        ['Scheduled / assigned teaching', totals.scheduledTeachingDoe], ['Role DOE', totals.roleDoe],
        ['Raw supervision DOE', totals.rawSupervisionDoe], ['Applied supervision DOE', totals.appliedSupervisionDoe],
        ['Other approved adjustments', totals.adjustmentDoe], ['Total assigned teaching DOE', totals.assignedTeachingDoe],
        ['Remaining / Overage', totals.remainingDoe]
      ].map(([label, value]) => `<div class="p4-doe-worksheet-card"><span>${esc(label)}</span><strong>${esc(finiteDoe(value) === null && missingData ? 'Pending data / policy' : formatDoe(value))}</strong></div>`).join('');
      const provenance = (worksheet.lines || []).map(line => {
        const reference = line.reference || {};
        const source = [line.ruleKey, reference.title, reference.section, reference.table, reference.page ? `p. ${reference.page}` : '', line.calculationId].filter(Boolean).join(' · ');
        const legacy = finiteDoe(line.resultDoe) === null && line.legacyResultDoe !== null && line.legacyResultDoe !== undefined ? ` · legacy stored ${formatDoe(line.legacyResultDoe)}` : '';
        return `<tr><td>${esc(line.category || '—')}</td><td>${esc(line.roleType || line.activityType || line.sourceEntityType || '—')}</td><td>${esc(line.scopeText || line.courseCode || line.subjectKey || '—')}</td><td>${esc(line.applicable === false && finiteDoe(line.resultDoe) === null ? 'Not applicable' : formatDoe(line.resultDoe))}${esc(legacy)}</td><td>${esc(line.status || 'Needs Review')}${line.errorCode ? ` · ${esc(line.errorCode)}` : ''}</td><td>${referenceBubble(source || line.sourceEntityId || '—')}</td></tr>`;
      }).join('');
      const issues = (worksheet.errors || []).map(error => `<li><strong>${esc(error.code || 'Needs Review')}</strong>: ${esc(error.message || 'Calculation evidence is incomplete.')}</li>`).join('');
      const reserveSummary = reserve && Object.keys(reserve).length ? `<p class="aux-note">Reserve · ${esc(reserve.stream || worksheet.stream || 'stream unavailable')} · applied supervision ${esc(formatDoe(reserve.appliedSupervision))} · unapplied ${esc(formatDoe(reserve.unappliedSupervision))} · remaining to target ${esc(formatDoe(reserve.remainingToTarget))}</p>` : '';
      const targetPolicy = worksheet.targetPolicyVersionLabel || target.policyVersionId;
      const policyText = worksheet.policyVersionId ? `Calculation policy ${worksheet.policyVersionId}` : worksheet.workloadSourceReference ? `Workload policy ${worksheet.workloadSourceReference}` : 'Annual calculation policy not recorded';
      const calculationText = worksheet.lastCalculatedAt ? `latest calculation evidence ${worksheet.lastCalculatedAt}` : 'No annual calculation record; line values retain their recorded source';
      return `<div class="p4-doe-worksheet"><div class="section-title">Faculty DOE Worksheet · ${esc(worksheet.academicYear || 'Academic Year unavailable')}</div><p class="aux-note">Calculation status: <strong>${esc(statusLabel)}</strong> ${referenceBubble(policyText + (targetPolicy ? ' · Target source '+targetPolicy : '') + ' · '+calculationText, 'Calculation source')}</p><div class="p4-doe-worksheet-summary">${cards}</div>${reserveSummary}${issues ? `<ul class="warn-box">${issues}</ul>` : ''}<div class="table-wrap p4-doe-worksheet-lines"><table class="data-table"><thead><tr><th>Category</th><th>Activity</th><th>Course / Subject / Scope</th><th>DOE</th><th>Status</th><th>Rule / Calculation / Reference provenance</th></tr></thead><tbody>${provenance || '<tr><td colspan="6" class="empty">No DOE calculation lines recorded for this year.</td></tr>'}</tbody></table></div>${renderLookupBreakdown(worksheet)}</div>`;
    }

    function finite(value) { return value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value); }

    function closeReview() {
      if (reviewPopover?.matches(':popover-open')) reviewPopover.hidePopover();
      if (reviewTrigger?.isConnected) reviewTrigger.focus();
    }

    function positionReview() {
      if (!reviewPopover || !reviewTrigger?.isConnected) return;
      const anchor = reviewTrigger.getBoundingClientRect(), box = reviewPopover.getBoundingClientRect();
      const left = Math.max(12, Math.min(anchor.left, window.innerWidth - box.width - 12));
      const below = anchor.bottom + 8;
      const top = below + box.height <= window.innerHeight - 12 ? below : Math.max(12, anchor.top - box.height - 8);
      reviewPopover.style.left = `${left}px`;
      reviewPopover.style.top = `${top}px`;
    }

    function reasonContent(worksheet) {
      const lines = worksheet.lines || [], groups = new Map();
      for (const error of worksheet.errors || []) {
        const message = error.message || 'The server recorded a review issue without a description.';
        const key = `${error.code || ''}|${message}`;
        if (!groups.has(key)) groups.set(key, { code: error.code || '', message, scopes: new Set(), count: 0 });
        const group = groups.get(key);
        group.count++;
        const line = lines.find(item => error.lineId && item.lineId === error.lineId || error.sourceEntityId && item.sourceEntityId === error.sourceEntityId);
        if (line) {
          const scope = [...new Set([line.roleType || line.activityType || line.category, line.courseCode, line.scopeText || line.subjectKey].filter(Boolean))].join(' · ');
          if (scope) group.scopes.add(scope);
        }
      }
      if (!groups.size) return '<p>No current review reasons were returned by the server. Refresh the DOE List to update its status.</p>';
      return `<ul class="doe-review-reasons">${[...groups.values()].map(group => `<li><p>${esc(group.message)}</p>${group.scopes.size ? `<details class="doe-review-items"><summary>Affected items (${group.count})</summary><ul>${[...group.scopes].map(scope => `<li>${esc(scope)}</li>`).join('')}</ul></details>` : ''}${group.code ? `<details class="doe-review-diagnostic"><summary>Diagnostic details</summary><code>${esc(group.code)}</code></details>` : ''}</li>`).join('')}</ul>`;
    }

    async function openReview(button) {
      const facultyId = button.dataset.doeReview, year = getAcademicYear();
      const row = (worksheets || []).find(item => String(item.facultyId).toLowerCase() === String(facultyId).toLowerCase());
      if (!row || !year) return;
      const request = ++reviewRequest;
      reviewTrigger = button;
      if (!reviewPopover) {
        reviewPopover = document.createElement('div');
        reviewPopover.id = 'doe-review-popover';
        reviewPopover.className = 'doe-review-popover';
        reviewPopover.setAttribute('popover', 'auto');
        reviewPopover.setAttribute('role', 'dialog');
        reviewPopover.setAttribute('aria-labelledby', 'doe-review-title');
        document.body.append(reviewPopover);
        reviewPopover.addEventListener('click', event => {
          if (event.target.closest('[data-doe-review-close]')) closeReview();
          if (event.target.closest('[data-doe-review-retry]') && reviewTrigger?.isConnected) openReview(reviewTrigger);
        });
        reviewPopover.addEventListener('toggle', () => { if (reviewPopover.matches(':popover-open')) positionReview(); }, true);
        window.addEventListener('resize', () => { if (reviewPopover.matches(':popover-open')) positionReview(); });
      }
      reviewPopover.innerHTML = `<div class="doe-review-head"><div><h2 id="doe-review-title">DOE review reasons</h2><p>${esc(showFaculty(row.displayName || facultyId))} · ${esc(year)}</p></div><button type="button" class="btn btn-small" data-doe-review-close aria-label="Close DOE review reasons">Close</button></div><div class="doe-review-body" aria-live="polite" aria-busy="true"><p>Loading current review reasons…</p></div>`;
      if (!reviewPopover.matches(':popover-open')) reviewPopover.showPopover({ source: button });
      positionReview();
      reviewPopover.querySelector('[data-doe-review-close]').focus({ preventScroll: true });
      const key = `${year}:${facultyId}`;
      try {
        const worksheet = reviewDetails.get(key) || await api.doeWorksheet({ facultyId, academicYear: year });
        if (request !== reviewRequest || !reviewPopover.matches(':popover-open')) return;
        reviewDetails.set(key, worksheet);
        reviewPopover.querySelector('.doe-review-body').innerHTML = reasonContent(worksheet);
      } catch (error) {
        if (request !== reviewRequest || !reviewPopover.matches(':popover-open')) return;
        reviewPopover.querySelector('.doe-review-body').innerHTML = `<p role="alert">Review reasons could not be loaded: ${esc(error.message || 'DOE service unavailable.')}</p><button type="button" class="btn btn-small" data-doe-review-retry>Retry</button>`;
      }
      reviewPopover.querySelector('.doe-review-body').setAttribute('aria-busy', 'false');
      positionReview();
    }
    async function loadDetail(facultyId, academicYear, panel, isStillSelected) {
      if (!panel) return;
      if (!academicYear) { panel.innerHTML = '<div class="warn-box">Academic year is unavailable; the server Worksheet cannot be loaded.</div>'; return; }
      try {
        const worksheet = await api.doeWorksheet({ facultyId, academicYear });
        if (!panel.isConnected || !isStillSelected()) return;
        panel.innerHTML = renderWorksheet(worksheet);
      } catch (error) {
        if (panel.isConnected) panel.innerHTML = `<div class="warn-box" role="alert">DOE Worksheet could not be loaded: ${esc(error.message || 'DOE service unavailable.')}</div>`;
      }
    }

    function renderList() {
      const body = document.getElementById('doe-list-body');
      if (!body || !Array.isArray(worksheets)) return;
      if (reviewPopover?.matches(':popover-open')) reviewPopover.hidePopover();
      const rosterRows = getFaculty() || [];
      const roster = new Map(rosterRows.map(row => [String(row.facultyId).toLowerCase(), row]));
      const rows = worksheets.filter(row => roster.get(String(row.facultyId).toLowerCase())?.active !== false).map(row => {
        const person = roster.get(String(row.facultyId).toLowerCase()) || {};
        const specialty = person.teachingArea || person.professionalCategory || '—';
        const assigned = finite(row.assignedTeachingDoe), target = finite(row.effectiveTargetDoe), remaining = finite(row.remainingDoe);
        const remainingText = balanceBadge(remaining, row.status, row.facultyId);
        const state = row.status === 'calculated' ? 'Calculated' : reviewButton(row.facultyId, 'Calculation status', row.issueCount);
        const value = (number, label) => finite(number) === null ? reviewButton(row.facultyId, label) : esc(formatDoe(number));
        const action = editAction(row.facultyId);
        return `<tr><td><strong>${esc(showFaculty(person.preferredFirstName && person.preferredLastName ? person : row.displayName || person.displayName || row.facultyId))}</strong><div class="muted">${esc(row.facultyId)}</div></td><td>${esc([person.rank, specialty].filter(Boolean).join(' · ') || '—')}</td><td>${value(target, 'Target DOE')}</td><td>${value(row.scheduledTeachingDoe, 'Scheduled teaching DOE')}</td><td>${value(row.roleDoe, 'Role DOE')}</td><td>${value(row.rawSupervisionDoe, 'Raw supervision DOE')}</td><td>${value(row.appliedSupervisionDoe, 'Applied supervision DOE')}</td><td>${value(row.adjustmentDoe, 'Adjustment DOE')}</td><td><strong>${value(assigned, 'Assigned DOE')}</strong></td><td>${remainingText}</td><td>${policySummary(row)}</td><td>${state}</td><td><button type="button" class="btn btn-small" data-doe-view="${esc(row.facultyId)}">View DOE</button>${action}</td></tr>`;
      });
      body.innerHTML = rows.join('') || '<tr><td colspan="13" class="empty">No Faculty Worksheets are available for the current Academic Year.</td></tr>';
    }

    async function loadList(force = false) {
      const body = document.getElementById('doe-list-body'), note = document.getElementById('doe-list-note');
      if (!body) return;
      const year = getAcademicYear();
      if (!year) { body.innerHTML = '<tr><td colspan="13" class="empty">Academic year is unavailable.</td></tr>'; if (note) note.textContent = 'DOE Worksheet requires an Academic Year.'; return; }
      if (worksheets && !force) return renderList();
      reviewDetails.clear();
      reviewRequest++;
      if (reviewPopover?.matches(':popover-open')) reviewPopover.hidePopover();
      body.innerHTML = '<tr><td colspan="13" class="empty">Loading server-authoritative DOE Worksheets…</td></tr>';
      if (note) note.innerHTML = `VetMed-Ops DOE Worksheet · Academic Year ${esc(year)} <span class="doe-status doe-within">Within DOE</span> <span class="doe-status doe-at">At DOE</span> <span class="doe-status doe-over">Over DOE</span>`;
      try { worksheets = await api.doeWorksheets({ academicYear: year }); renderList(); }
      catch (error) { worksheets = null; body.innerHTML = `<tr><td colspan="13" class="empty">${esc(error.message || 'DOE List could not be loaded.')}</td></tr>`; if (note) note.textContent = 'The server DOE Worksheet service is unavailable.'; }
    }

    function bindList() {
      document.getElementById('doe-list-body')?.addEventListener('click', event => {
        const review = event.target.closest('[data-doe-review]');
        if (review) { openReview(review); return; }
        const button = event.target.closest('[data-doe-view]');
        if (button) onView(button.dataset.doeView);
      });
    }
    return Object.freeze({ loadDetail, loadList, renderList, buildLookupBreakdown, renderLookupBreakdown, invalidate() { worksheets = null; reviewDetails.clear(); reviewRequest++; if (reviewPopover?.matches(':popover-open')) reviewPopover.hidePopover(); }, bindList });
  }

  window.UCVM_FACULTY_DOE_WORKSHEET = Object.freeze({ create });
})();
