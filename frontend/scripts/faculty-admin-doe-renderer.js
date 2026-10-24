(() => {
  'use strict';

  function create({ esc, number, formatDoe, display, effectiveRoleDoe, groupTeachingAssignments }) {
    function referenceBubble(text, label = 'Source') {
      return `<details class="reference-bubble"><summary aria-label="${esc(label)} details"><span aria-hidden="true">ⓘ</span> ${esc(label)}</summary><div class="reference-bubble-content">${esc(text || 'Source not recorded')}</div></details>`;
    }
    function apiTable(headers, rows) {
      if (!rows.length) return '';
      return `<div class="table-wrap"><table class="data-table"><thead><tr>${headers.map(header => `<th>${esc(header)}</th>`).join('')}</tr></thead><tbody>${rows.map(cells => `<tr>${cells.map((cell, index) => `<td>${/source|reference/i.test(headers[index]) ? referenceBubble(display(cell)) : esc(display(cell))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    }
    function renderContractDoe(contractDoe, faculty = {}) {
      const data = contractDoe && typeof contractDoe === 'object' ? contractDoe : {};
      const categoryLabels = {
        scholarly_activity: 'Scholarly Activity', ppvm_cost_share: 'PPVM Cost Share',
        clinical_unsorted: 'Clinical - To Be Sorted', clinical_teaching: 'Clinical Teaching',
        clinical_activity_ppvm: 'Clinical Activity / PPVM', research: 'Research',
        contract_admin: 'Contract Admin', service_admin: 'Service / Admin', other: 'Other', onboarding: 'Onboarding'
      };
      const teaching = number(data.teachingDoe), fte = number(faculty?.fte), supplied = [];
      const rows = [`<tr><th scope="row">Teaching</th><td>${teaching === null ? 'Teaching DOE unavailable' : formatDoe(teaching)}</td></tr>`];
      if (teaching !== null) supplied.push(teaching);
      for (const [categoryCode, label] of Object.entries(categoryLabels)) {
        const allocation = (Array.isArray(data.allocations) ? data.allocations : []).find(item => item && item.categoryCode === categoryCode);
        const value = allocation ? number(allocation.allocationDoe) : null;
        if (value === null) continue;
        supplied.push(value); rows.push(`<tr><th scope="row">${esc(label)}</th><td>${formatDoe(value)}</td></tr>`);
      }
      const total = supplied.length ? supplied.reduce((sum, value) => sum + value, 0) : null;
      const source = data.policyVersionLabel || data.source || 'Faculty Master List DOE snapshot';
      const sourceLine = `Source: ${source}${data.sourceReference ? ` · ${data.sourceReference}` : ''}`;
      const totalLine = total === null ? 'DOE unavailable' : formatDoe(total);
      const fteReference = faculty?.fteSourceReference ? `FTE source: ${faculty.fteSourceReference}` : 'FTE source: not recorded';
      return `<section class="section wide contract-doe-allocation"><div class="section-title">Workload / Contract · ${esc(data.academicYear || 'Academic year unavailable')}</div><div class="doe-profile-source"><strong>FTE:</strong> ${fte === null ? 'Unavailable' : esc(fte.toFixed(2))} ${referenceBubble(fteReference,'FTE source')} ${referenceBubble(sourceLine,'Contract DOE source')}</div><div class="table-wrap"><table class="data-table"><tbody>${rows.join('')}<tr class="contract-doe-total"><th scope="row">Total Contract DOE</th><td>${esc(totalLine)}</td></tr></tbody></table></div>${teaching === null ? '<div class="doe-note warn-box">Teaching contract target is unavailable; displayed total includes only supplied allocations.</div>' : ''}</section>`;
    }

    function renderDoeRuleBook(ruleBook) {
      const data = ruleBook && typeof ruleBook === 'object' ? ruleBook : {};
      const rules = Array.isArray(data.rules) ? data.rules : [];
      const rows = rules.map(rule => `<tr><td>${esc(rule.category || '—')}</td><td>${esc(rule.ruleLabel || '—')}</td><td>${esc(rule.academicYearOrStage || 'All applicable years')}</td><td>${esc(rule.rateOrTierPct || 'Reference only')}</td><td>${esc(rule.basis || '—')}</td><td>${esc(rule.requiredInput || '—')}</td><td>${esc(rule.calculationOrNote || '—')}</td></tr>`).join('');
      const source = data.sourceReference || 'UCVM Workload Guidelines', version = data.policyVersionLabel || 'No active policy version';
      const body = rows ? `<div class="table-wrap"><table class="data-table doe-rule-reference-table"><thead><tr><th>Category</th><th>Rule</th><th>Year / Stage</th><th>Value / Tier</th><th>Basis</th><th>Required input</th><th>Application / limits</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty">No DOE rule references for this year.</div>';
      return `<section class="section wide doe-rule-book"><div class="section-title">DOE Rule Reference · ${esc(data.academicYear || 'Academic year unavailable')}</div><div class="doe-profile-source">${referenceBubble('Policy: '+version+' · Source: '+source,'Policy & source')}</div>${body}<div class="doe-note">do not infer individual Research, PPVM, Service/Admin or supervision DOE.</div></section>`;
    }

    function doeEvidenceStatus(summary) {
      const lineCount = Number(summary.teachingLineCount || 0) + Number(summary.roleLineCount || 0);
      const recorded = Number(summary.teachingRecordedCount || 0) + Number(summary.roleRecordedCount || 0);
      if (!lineCount) return 'Recorded';
      if (!recorded) return 'DOE unavailable / Needs Review';
      if (summary.partial) return 'Partial / Needs Review';
      return 'Recorded';
    }

    function reviewLabel(reason) {
      const labels = {
        'stored-doe-differs-from-calculator': 'Stored DOE differs from Calculator',
        'teaching-role-not-covered-by-calculator': 'Teaching role not covered by Calculator',
        'credited-hours-required': 'Credited hours required',
        'legacy-course-coordinator-hicc-role-must-be-resolved': 'Resolve Course Coordinator vs HICC',
        'course-units-required': 'Course units required',
        'hicc-development-applicability-required': 'HICC development applicability required',
        'ccc-shift-count-required': 'CCC shift count required',
        'rotation-weeks-required': 'Rotation weeks required',
        'rotation-type-count-required': 'Rotation type count required',
        'visc-subject-count-required': 'VISC subject count required',
        'visc-year-not-covered-by-calculator': 'VISC academic year not covered',
        'role-type-not-covered-by-calculator': 'Role type not covered by Calculator',
        'role-date-proration-review-required': 'Role dates require case-by-case DOE proration review'
      };
      return labels[reason] || reason || '—';
    }

    function roleCandidateLabel(role = {}) {
      const candidates = role.doeCandidates && typeof role.doeCandidates === 'object' ? role.doeCandidates : null;
      if (!candidates) return '—';
      const parts = [];
      if (number(candidates.courseCoordinatorDoe) !== null) parts.push(`CC ${formatDoe(candidates.courseCoordinatorDoe)}`);
      if (number(candidates.hiccDoe) !== null) parts.push(`HICC ${formatDoe(candidates.hiccDoe)}`);
      const suffix = role.doeCandidateBasis === 'full-year-reference-before-proration' ? ' · full-year before proration' : '';
      return parts.length ? parts.join(' / ') + suffix : '—';
    }

    function teachingEffectiveDoe(assignment = {}) {
      if (assignment.doeApplicable === false && number(assignment.doeCredit) === null) return null;
      const effective = number(assignment.effectiveDoeCredit);
      return effective === null ? number(assignment.doeCredit) : effective;
    }

    function teachingStatus(assignment = {}) {
      if (assignment.doeApplicable === false) return 'Not applicable';
      const status = assignment.doeCalculationStatus || assignment.doeStatus;
      if (status === 'calculated') return 'Calculated';
      if (status === 'stored') return 'Stored';
      if (status === 'stored-calculation-mismatch') return 'Review stored value';
      if (status === 'needs-review') return reviewLabel(assignment.doeReviewReason);
      return status || (teachingEffectiveDoe(assignment) === null ? 'Needs Review' : 'Recorded');
    }

    function renderDoeEvidence(assignments, roles) {
      const teachingRows = (Array.isArray(assignments) ? assignments : []).map(assignment => {
        const effective = teachingEffectiveDoe(assignment);
        return `<tr><td>${esc(assignment.courseCode || '—')}</td><td>${esc(assignment.topic || '—')}</td><td>${esc(assignment.date || '—')}</td><td>${esc(assignment.sessionType || '—')}</td><td>${esc(assignment.teachingRole || '—')}</td><td>${formatDoe(assignment.doeCredit)}</td><td>${formatDoe(assignment.calculatedDoeCredit)}</td><td>${assignment.doeApplicable === false ? 'Not applicable' : formatDoe(effective)}</td><td>${esc(assignment.doeRuleCode || '—')}</td><td>${esc(assignment.doeSource || '—')}</td><td>${esc(teachingStatus(assignment))}</td></tr>`;
      }).join('');
      const roleRows = (Array.isArray(roles) ? roles : []).map(role => {
        const effective = effectiveRoleDoe(role);
        return `<tr><td>${esc(role.roleType || '—')}</td><td>${esc(role.courseOrSubjectOrRotation || role.courseName || '—')}</td><td>${formatDoe(effective.mapped)}</td><td>${formatDoe(effective.override)}</td><td>${formatDoe(effective.calculated)}</td><td>${formatDoe(effective.effective)}</td><td>${esc(roleCandidateLabel(role))}</td><td>${esc(role.doeRuleCode || '—')}</td><td>${esc(effective.source || role.doeSource || '—')}</td><td>${esc(reviewLabel(effective.reviewReason || role.doeReviewReason))}</td><td>${esc(role.specialNotes || '—')}</td></tr>`;
      }).join('');
      if (!teachingRows && !roleRows) return '';
      const teaching = teachingRows ? `<details class="doe-evidence-group"><summary>Teaching evidence · ${assignments.length} assignment lines</summary><div class="table-wrap"><table class="data-table doe-evidence-table"><thead><tr><th>Course</th><th>Topic / Activity</th><th>Date</th><th>Session Type</th><th>Teaching Role</th><th>Stored DOE</th><th>Calculated DOE</th><th>Effective DOE</th><th>Rule</th><th>Source</th><th>Status / Review</th></tr></thead><tbody>${teachingRows}</tbody></table></div></details>` : '';
      const role = roleRows ? `<details class="doe-evidence-group"><summary>Role evidence · ${roles.length} role lines</summary><div class="table-wrap"><table class="data-table doe-evidence-table"><thead><tr><th>Role Type</th><th>Assignment</th><th>Mapped DOE</th><th>Override DOE</th><th>Calculated DOE</th><th>Effective DOE</th><th>Full-year Candidates</th><th>Rule</th><th>Source</th><th>Status / Review</th><th>Special Notes</th></tr></thead><tbody>${roleRows}</tbody></table></div></details>` : '';
      return `<div class="doe-evidence"><div class="doe-evidence-title">DOE Evidence · VetMed-Ops + DOE Calculator</div><div class="doe-evidence-copy">Stored DOE and overrides remain authoritative. Server-side Calculator results are shown separately and are used only when no stored value exists; unresolved required inputs remain review items.</div>${teaching}${role}</div>`;
    }

    function renderDoeSummary(summary, academicYear, assignments, roles, contractDoe = {}) {
      const teaching = number(summary.teachingDoe), role = number(summary.roleDoe), target = number(contractDoe?.teachingDoe);
      const teachingMissing = Math.max(0, Number(summary.teachingMissingCount || 0));
      const roleMissing = Math.max(0, Number(summary.roleMissingCount || 0));
      const teachingNotApplicable = Math.max(0, Number(summary.teachingNotApplicableCount || 0));
      const knownValues = [teaching, role].filter(value => value !== null);
      const totalKnown = knownValues.length ? knownValues.reduce((sum, value) => sum + value, 0) : null;
      const status = teachingMissing && roleMissing
        ? 'Teaching + Role Review'
        : teachingMissing
          ? 'Teaching Review'
          : roleMissing
            ? 'Role Review'
            : target === null ? 'Target unavailable' : 'Complete';
      const statusClass = status === 'Complete' ? 'doe-within' : 'doe-under';
      const card = (label, value, subline = '', className = '') => `<div class="doe-summary-card ${className}"><div class="doe-summary-label">${esc(label)}</div><div class="doe-summary-value">${esc(value)}</div>${subline ? `<div class="doe-summary-subline">${esc(subline)}</div>` : ''}</div>`;
      const totalSubline = [teachingMissing ? `${teachingMissing} teaching line(s) unresolved` : '', roleMissing ? `${roleMissing} role line(s) unresolved` : '', teachingNotApplicable ? `${teachingNotApplicable} teaching line(s) not applicable` : ''].filter(Boolean).join(' · ') || 'Sum of effective teaching and role DOE';
      const difference = target !== null && teaching !== null ? target - teaching : null;
      const teachingSubline = [`${teachingMissing} unresolved of ${Number(summary.teachingApplicableCount ?? summary.teachingLineCount ?? 0)} applicable lines`, teachingNotApplicable ? `${teachingNotApplicable} not applicable` : ''].filter(Boolean).join(' · ');
      return `<section class="section wide doe-profile-summary doe-worksheet"><div class="section-title">DOE Summary · ${esc(`${academicYear || 'Teaching'} · VetMed-Ops + Calculator evidence`)}</div><div class="doe-worksheet-boundary"><span class="available">EFFECTIVE DOE</span> Stored/override values take precedence; DOE Calculator fills only deterministic gaps and never guesses missing inputs.</div><div class="doe-summary-grid">${card('Contract / Teaching Target DOE', target === null ? 'Unavailable' : formatDoe(target), target === null ? 'No authoritative target recorded' : `${contractDoe.policyVersionLabel || contractDoe.source || 'Source recorded'}`)}${card('Assigned Teaching DOE', formatDoe(teaching), teachingSubline)}${card('Role / Service DOE', formatDoe(role), `${roleMissing} unresolved of ${Number(summary.roleLineCount || 0)} lines`)}${card('Total Effective DOE', formatDoe(totalKnown), totalSubline)}${target !== null && difference !== null ? card('Teaching Target Remaining / Difference', formatDoe(difference), 'Target minus effective assigned teaching DOE') : card('Teaching Target Remaining / Difference', 'Unavailable', 'Requires an authoritative teaching target and resolved teaching DOE')}</div><div class="doe-note">DOE Calculator source: Teaching Assignments 2026-27 MASTER.xlsx. Legacy role ambiguity and missing CCC shifts/course units remain explicit review items.</div><div class="doe-evidence-status ${statusClass}">DOE status: ${esc(status)}</div>${renderDoeEvidence(assignments, roles)}</section>`;
    }

    function renderTeachingCourses(assignments) {
      const years = groupTeachingAssignments(assignments);
      const body = years.map(year => `<section class="year-section"><h3 class="year-title">${esc(year.curriculumYear)} · ${year.sessionCount ?? year.assignmentCount ?? 0} sessions · ${Number(year.creditedHours || 0).toFixed(2)} credited hours</h3>${year.courses.map(course => {
        const courseStatus = course.doeStatus === 'complete' ? 'DOE resolved' : course.doeStatus === 'not-applicable' ? 'DOE not applicable' : 'Needs Review';
        return `<details class="course-group"><summary><div><div class="course-group-title">${esc(course.courseCode)}</div><div class="course-group-meta">${esc(course.courseName || 'Course name unavailable')} · ${course.assignmentCount} sessions · ${course.creditedHours.toFixed(2)} credited hours · ${formatDoe(course.doeTotal)} effective DOE</div></div><span class="course-group-meta">${courseStatus} ▾</span></summary><div class="table-wrap"><table class="activity-table"><thead><tr><th>Date</th><th>Start</th><th>End</th><th>Session Type</th><th>Teaching Role</th><th>Topic / Activity</th><th>Room</th><th>Credited Hours</th><th>Stored DOE</th><th>Calculated DOE</th><th>Effective DOE</th><th>DOE Status</th></tr></thead><tbody>${course.assignments.map(assignment => `<tr data-session-id="${esc(assignment.sessionId || '')}"><td>${esc(assignment.date || '—')}</td><td>${esc(assignment.startTime || '—')}</td><td>${esc(assignment.endTime || '—')}</td><td>${esc(assignment.sessionType || '—')}</td><td>${esc(assignment.teachingRole || '—')}</td><td class="session-topic">${esc(assignment.topic || '—')}</td><td>${esc(assignment.room || '—')}</td><td>${display(assignment.creditedHours)}</td><td>${formatDoe(assignment.doeCredit)}</td><td>${formatDoe(assignment.calculatedDoeCredit)}</td><td>${assignment.doeApplicable === false ? 'Not applicable' : formatDoe(teachingEffectiveDoe(assignment))}</td><td>${esc(teachingStatus(assignment))}</td></tr>`).join('')}</tbody></table></div></details>`;
      }).join('')}</section>`).join('') || '<div class="empty">No teaching assignments recorded for this academic year.</div>';
      return `<section class="section wide"><div class="section-title">Teaching / Courses</div>${body}</section>`;
    }

    return Object.freeze({ renderContractDoe, renderDoeRuleBook, renderDoeSummary, renderTeachingCourses, referenceBubble, apiTable });
  }

  window.UCVM_FACULTY_DOE_RENDERER = Object.freeze({ create });
})();
