(() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const text = value => String(value ?? '').trim();
  const clone = value => JSON.parse(JSON.stringify(value));
  const reviews = ['needs_review','approved','updated','new','retired'];
  const modes = ['fixed','per_hour','per_shift','per_week','per_trainee','tiered','minimum','capped','percentage_of_target','prorated','formula'];
  const reserveKeys = ['splitThreshold','splitRatio','highTeachingTraineeCeiling','teachingFocusedTraineeCeiling','rollingAverageYears'];
  const categories = [['all','All categories'],['teaching','Teaching Rules'],['role','Role Rules'],['supervision','Supervision & Complex'],['target','Target Rules'],['exceptions','Exceptions']];
  const groups = [['all','All groups'],['assigned','Assigned Teaching'],['coordination','Course Coordination'],['clinical','Clinical Rotations'],['supervision','Supervision'],['hicc','HICC / VISC'],['reserve','Reserve Logic'],['other','Other / Approved Activities']];
  const field = (key,label,type='text',options=null,required=false) => ({key,label,type,options,required});
  const common = [field('reviewStatus','Annual review','select',reviews),field('enabled','Enabled','checkbox')];
  const referenceField = field('referenceId','Linked reference','reference');
  const schemas = {
    rules: [field('ruleKey','Stable rule key','text',null,true),field('ruleLabel','Rule title','text',null,true),field('category','Category','select',['teaching','assigned_teaching','course_coordination','rotation','supervision','hicc','visc','reserve','adjustment','exception','approved_activity','target','other']),field('activityType','Activity type'),field('calculationMode','Calculation mode','select',modes),field('priority','Match priority','number'),field('resultKind','Result kind','select',['credit','target','reserve']),field('tierStrategy','Tier strategy','select',['','progressive','lookup']),field('mappingRequirement','Required mapping','select',['','course','subject']),field('formulaText','Formula','textarea'),referenceField,...common],
    references: [field('referenceId','Reference ID','id'),field('title','Document title','text',null,true),field('section','Section'),field('tableName','Table'),field('pageNumber','Page','number'),field('effectiveDate','Effective date','date'),field('sourceReference','Source / provenance'),field('documentLink','Document link','url'),field('reviewStatus','Annual review','select',reviews),field('notes','Notes','textarea')],
    courseMappings: [field('courseCode','Canonical course code','text',null,true),field('unitCount','Course units','number'),field('curriculumStage','Curriculum stage'),field('hiccEligible','HICC eligibility','nullableBoolean'),referenceField,...common,field('mappingFacts','Additional mapping facts','object')],
    subjectMappings: [field('subjectKey','Canonical subject key','text',null,true),field('subjectName','Subject name','text',null,true),field('curriculumStage','Curriculum stage'),field('developmentPhase','Development phase'),referenceField,...common,field('mappingFacts','Additional mapping facts','object')],
    exceptions: [field('category','Category'),field('scopeType','Scope','select',['global','faculty','session','course','role','assignment','source_entity']),field('scopeKey','Scope value'),field('facultyId','Faculty ID'),field('fixedDoe','Fixed DOE (%)','number',null,true),field('resultKind','Result kind','select',['credit','target','reserve']),field('reason','Approval reason','textarea',null,true),field('sourceReference','Source evidence','textarea',null,true),field('effectiveStart','Effective start','date'),field('effectiveEnd','Effective end','date'),field('recurring','Recurring','checkbox'),...common],
    reservePolicy: [field('splitThreshold','Teaching split threshold (%)','number',null,true),field('splitRatio','Split ratio (0–1)','number',null,true),field('highTeachingTraineeCeiling','High teaching trainee ceiling (%)','number',null,true),field('teachingFocusedTraineeCeiling','Teaching focused trainee ceiling (%)','number',null,true),field('rollingAverageYears','Rolling average years','number',null,true),referenceField,field('reviewStatus','Annual review','select',reviews)],
    selectors: [field('field','Context field','text',null,true),field('operator','Operator','select',['equals','not_equals','in','not_in','gt','gte','lt','lte']),field('valueType','Value type','select',['text','number']),field('valueText','Text value'),field('valueNumber','Numeric value','number'),field('values','Set values (JSON array)','array')],
    inputs: [field('inputName','Required fact','text',null,true),field('source','Source'),field('required','Required','checkbox')],
    parameters: [field('name','Parameter (rate, cap, fixed…)','text',null,true),field('valueNumber','Numeric value','number'),field('valueText','Text value')],
    tiers: [field('tierOrder','Order','number',null,true),field('fromValue','From (inclusive)','number',null,true),field('toValue','To (blank = unbounded)','number'),field('rate','Rate','number'),field('fixedCredit','Fixed credit (%)','number')]
  };
  const labels = {rules:'Rules',references:'References',courseMappings:'Course mappings',subjectMappings:'VISC subjects',exceptions:'Approved exceptions',reservePolicy:'Reserve Logic'};
  const guides={
    ruleKey:'Example: teaching_lab_2026_27. Unique technical identifier; the generated key can be kept.',ruleLabel:'Example: LAB teaching DOE · 2026–27. This name appears in calculation evidence.',category:'Example: teaching for Calendar; hicc or supervision for ADFA Dashboard. The category condition must match the data.',activityType:'Example: LAB or Graduate Primary Supervisor. A descriptive label; matching is controlled by Conditions.',calculationMode:'Example: per hour means credited hours × rate. Fixed means one DOE value per matching assignment.',priority:'Example: 200 outranks 100. Only the highest matching rule is selected; equal-priority matches need review.',resultKind:'Example: credit adds assigned DOE; target sets a teaching target; reserve is used by reserve logic.',tierStrategy:'Example: lookup selects one band; progressive adds credit across covered bands.',mappingRequirement:'Example: course requires an approved annual Course Mapping; subject requires a VISC Subject Mapping.',formulaText:'Example: hours * rate. Use declared input and parameter names; formulas run on the server.',referenceId:'Example: the approved 2026–27 MASTER or Workload Guidelines reference. Choose the actual source; add it in References if missing.',reviewStatus:'Example: needs review while preparing; approved only after checking the actual guideline/source.',enabled:'Example: checked makes this rule eligible after publication; unchecked excludes it from matching.',field:'Example: sessionType for Calendar; roleType or activityType for Dashboard. Use a fact that the source actually supplies.',operator:'Example: equals matches exactly; in matches any value in the JSON list.',valueType:'Example: text for LAB; number for curriculumYear quantities.',valueText:'Example: LAB, HICC or Graduate Primary Supervisor. Text matching is exact; use the canonical source value.',valueNumber:'Example: 0.3 for an approved hourly rate gives 0.6% for 2 credited hours; fixed 5 gives 5%. Use your actual source value, not this example.',values:'Example: ["LEC","LAB"]. Used with in/not in; this list is not a formula.',inputName:'Example: hours, weeks or trainees. Missing required facts produce Needs Review, never an assumed zero.',source:'Example: session creditedHours or MASTER # Trainees. Records where the required fact comes from.',required:'Example: checked means this fact must be supplied before DOE can be calculated.',name:'Example: fixed for Fixed mode, rate for per-hour/week/trainee, cap for Capped mode. Names must match the engine.',tierOrder:'Example: 0, 1, 2. Controls band ordering.',fromValue:'Example: 0. The lower bound is included.',toValue:'Example: 10. The upper bound is excluded; blank means no upper bound.',rate:'Example: 0.3 gives 0.3 percentage points per unit in this band.',fixedCredit:'Example: 5 means a matching lookup band returns 5% DOE.',referenceIdNote:'Select a real approved source.'
  };
  const ruleTemplates=[
    {id:'teaching',title:'Teaching session',origin:'Calendar',category:'teaching',mode:'per_hour',fact:'sessionType',example:'LAB',input:'hours',description:'Session type and credited teaching hours trigger this rule. Example only: 2 hours × 0.3 = 0.6% DOE.'},
    {id:'coordination',title:'Course Coordinator',origin:'ADFA Dashboard',category:'course_coordination',mode:'fixed',fact:'roleType',example:'Course Coordinator',description:'A matching role assignment triggers this rule. Example only: fixed 7 = 7% DOE per matching assignment.'},
    {id:'hicc',title:'HICC appointment',origin:'ADFA Dashboard',category:'hicc',mode:'fixed',fact:'roleType',example:'HICC',description:'HICC role facts trigger this rule. Add a course condition/mapping when credit depends on a specific course or units.'},
    {id:'visc',title:'VISC appointment',origin:'ADFA Dashboard',category:'visc',mode:'fixed',fact:'roleType',example:'VISC',description:'VISC role facts trigger this rule. Specify subject conditions/mapping when credit varies by subject.'},
    {id:'rotation',title:'Rotation / week lead',origin:'ADFA Dashboard',category:'rotation',mode:'per_week',fact:'roleType',example:'Rotation Participant',input:'weeks',description:'Rotation assignment facts trigger this rule. Example only: 4 weeks × 2.5 = 10%. Weeks must exist in the assignment facts.'},
    {id:'supervision',title:'Trainee supervision',origin:'ADFA Dashboard',category:'supervision',mode:'per_trainee',fact:'activityType',example:'Graduate Primary Supervisor',input:'trainees',description:'Supervision counts trigger this rule. Example only: 2 trainees × 1.5 = 3% raw supervision DOE; reserve limits may change the applied amount.'},
    {id:'target',title:'Teaching target',origin:'ADFA Dashboard',category:'target',mode:'fixed',fact:'facultyId',example:'actual faculty UUID',description:'Faculty target facts trigger this rule. Example only: fixed 80 = 80% target. Specify the actual faculty scope; never use a display name as identity.'},
    {id:'custom',title:'Custom / advanced rule',origin:'Choose matching facts',category:'other',mode:'fixed',description:'Define the actual source category and conditions. No blanket match or calculation rate is supplied.'}
  ];
  function groupOf(row) {
    const value = `${row.ruleKey || ''} ${row.activityType || ''} ${row.ruleLabel || ''}`.toLowerCase();
    if(row.category === 'reserve' || /reserve/.test(value))return 'reserve';
    if(['hicc','visc'].includes(row.category)||/hicc|visc/.test(value))return 'hicc';
    if(row.category==='course_coordination'||/coordination|coordinator|coordinate/.test(value) && !/clinical|rotation/.test(value))return 'coordination';
    if(row.category==='rotation'||/clinical|rotation/.test(value))return 'clinical';
    if(row.category === 'supervision' || /supervis|trainee/.test(value))return 'supervision';
    if(['teaching','assigned_teaching'].includes(row.category)||/lecture|laboratory|srl/.test(value))return 'assigned';
    return 'other';
  }
  function create({onChange=()=>{},editable=()=>false,getFaculty=()=>[],canAddRule=editable,onStartDraft=async()=>false,idPrefix='',onError=()=>{}}={}) {
    let root=null,bundle={},dirty=false,panel='rules',category='all',group='all',search='',editing=null,locked=false,helpSequence=0;
    const inlineModeInputHistory=new Map();
    const node = id => root?.querySelector(`#${idPrefix}${id}`);
    const refName = id => {const r=(bundle.references||[]).find(r=>r.referenceId===id);return r?[r.title,r.section&&`§${r.section}`,r.tableName,r.pageNumber!=null&&`p.${r.pageNumber}`].filter(Boolean).join(' · '):id||'Reference required';};
    function mark(){dirty=true;onChange();}
    function inputHtml(def,value,path,disabled=false) {
      const helpId=`${idPrefix}doe-field-help-${++helpSequence}`;
      const attr=`data-field="${esc(def.key)}" data-path="${esc(path)}" aria-label="${esc(def.label)}" aria-describedby="${helpId}" ${disabled?'disabled':''} ${def.required?'required':''}`;
      let control;
      if(def.type==='checkbox')control=`<input type="checkbox" ${attr} ${value!==false?'checked':''}>`;
      else if(def.type==='nullableBoolean')control=`<select class="select" ${attr}>${[['','Unknown'],['true','Yes'],['false','No']].map(([v,l])=>`<option value="${v}" ${(value==null?'':String(value))===v?'selected':''}>${l}</option>`).join('')}</select>`;
      else if(def.type==='select'||def.type==='reference'){
        const choices=def.choices?def.choices.slice():def.type==='reference'?[['','No reference selected'],...(bundle.references||[]).map(r=>[r.referenceId,refName(r.referenceId)])]:(def.options||[]).map(v=>[v,v.replace(/_/g,' ')||'Not specified']);
        if(value && !choices.some(([v])=>v===value))choices.push([value,value]);
        control=`<select class="select" ${attr}>${choices.map(([v,l])=>`<option value="${esc(v)}" ${value===v?'selected':''}>${esc(l)}</option>`).join('')}</select>`;
      } else if(['textarea','array','object'].includes(def.type))control=`<textarea class="input" rows="${def.type==='textarea'?2:3}" ${attr}>${esc(def.type==='array'||def.type==='object'?value==null?'':typeof value==='string'?value:JSON.stringify(value,null,2):value)}</textarea>`;
      else control=`<input class="input" type="${def.type==='id'?'text':def.type}" ${def.type==='number'?'step="any"':''} ${attr} value="${esc(def.type==='date'?text(value).slice(0,10):value)}" ${def.type==='id'?'readonly':''}>`;
      const help=def.help||guides[def.key]||`Example: enter the actual ${def.label.toLowerCase()} from its approved source. This value is saved with this ${path==='root'?'record':path.replace(/s$/,'')} and used where applicable.`;
      return `<label class="field ${['textarea','object','array'].includes(def.type)?'doe-field-wide':''}"><span class="field-label">${esc(def.label)}</span>${control}<small class="doe-field-example" id="${helpId}">${esc(help)}</small></label>`;
    }
    function readFields(container,defs,original,validate=true){
      const result={...original};
      for(const def of defs){
        const element=container.querySelector(`[data-field="${def.key}"]`);if(!element||element.disabled)continue;
        const raw=element.value;
        if(def.type==='checkbox')result[def.key]=element.checked;
        else if(def.type==='number'){
          result[def.key]=raw===''?null:Number(raw);
          if(raw!==''&&!Number.isFinite(result[def.key])){if(validate)throw new Error(`${def.label} must be a finite number.`);result[def.key]=raw;}
        } else if(def.type==='nullableBoolean')result[def.key]=raw===''?null:raw==='true';
        else if(def.type==='array'||def.type==='object'){
          if(def.type==='array'&&element.tagName==='SELECT'&&element.multiple){result[def.key]=[...element.selectedOptions].map(o=>o.value);continue;}
          if(!text(raw)){if(Object.prototype.hasOwnProperty.call(original,def.key))result[def.key]=def.type==='array'?[]:{};continue;}
          try{result[def.key]=JSON.parse(raw);}catch(_){if(validate)throw new Error(`${def.label} must be valid JSON.`);result[def.key]=raw;continue;}
          if(def.type==='array'?!Array.isArray(result[def.key]):!result[def.key]||typeof result[def.key]!=='object'||Array.isArray(result[def.key])){if(validate)throw new Error(`${def.label} must be a JSON ${def.type}.`);result[def.key]=raw;}
        } else result[def.key]=['date','reference'].includes(def.type)&&!raw?null:text(raw);
        if(validate&&def.required&&(result[def.key]===null||result[def.key]===''))throw new Error(`${def.label} is required.`);
      }
      return result;
    }
    function ruleGroupName(row) {
  const category = String(row.category || '').toLowerCase();
  const label = String([row.ruleKey,row.ruleLabel,row.activityType].filter(Boolean).join(' ')).toLowerCase();
  if (category === 'reserve' || category === 'target') return 'Reserve & Targets';
  if (category === 'supervision' || /trainee|supervis|preceptor|postdoc/.test(label)) return 'Trainees & Supervision';
  if (category === 'hicc' || /hicc/.test(label)) return 'HICC Course Development';
  if (category === 'visc' || /visc/.test(label)) return 'VISC Coordination';
  if (category === 'course_coordination' || /course coordinat/.test(label)) return 'Course Coordination';
  if (category === 'rotation' || /rotation|clinical|ccc/.test(label)) return 'Clinical Rotations & CCC';
  if (category === 'approved_activity' || /early career|special activit/.test(label)) return 'Other Approved Teaching';
  if (['teaching','assigned_teaching'].includes(category)) return 'Lectures & Labs';
  return 'Other / Advanced Rules';
}
    function ruleWeight(row) {
  const mode = String(row.calculationMode || '');
  const paramName = mode === 'fixed' ? 'fixed' : 'rate';
  const parameter = (row.parameters || []).find(p => p.name === paramName);
  const raw = parameter?.valueNumber;
  const numeric = raw === null || raw === undefined || raw === '' ? null : Number(raw);
  return Number.isFinite(numeric) ? numeric : null;
}
    function sessionWeightRule(row) {
  return ['teaching','assigned_teaching'].includes(row.category)
    && ['fixed','per_hour'].includes(row.calculationMode)
    && (row.selectors || []).some(selector => ['sessionType','teachingRole'].includes(selector.field));
}
    function rateSummary(row) {
  const mode = String(row.calculationMode || '');
  const weight = ruleWeight(row);
  const formatted = weight === null ? 'Weight not configured' : `Weight ${Number(weight.toFixed(6))}%`;
  if (mode === 'per_hour') return `${formatted} per credited hour`;
  if (mode === 'fixed') return `${formatted} per ${sessionWeightRule(row) ? 'session / faculty assignment' : 'matching assignment'}`;
  if (mode === 'per_week') return `${formatted} per week`;
  if (mode === 'per_shift') return `${formatted} per shift`;
  if (mode === 'per_trainee') return `${formatted} per trainee`;
  if (mode === 'tiered') return `Course-unit tiers (${(row.tiers || []).length} bands)`;
  if (mode === 'formula') return 'Approved formula';
  return mode.replace(/_/g,' ') || 'Calculation mode not configured';
}
    function simpleWeightRule(row) {
  return row && row.resultKind === 'credit'
    && ['teaching','assigned_teaching','course_coordination','hicc','visc','rotation','supervision','approved_activity'].includes(row.category)
    && ['fixed','per_hour','per_shift','per_week','per_trainee'].includes(row.calculationMode)
    && !String(row.formulaText || '').trim()
    && !(row.tiers || []).length
    && (row.parameters || []).every(p => ['rate','fixed'].includes(p.name));
}
    function simpleUnitLabel(mode) {
  return ({fixed:'Assignment',per_hour:'Hour',per_week:'Week',per_shift:'Shift',per_trainee:'Trainee'})[mode] || 'Approved formula';
}
    function applySimpleRate(row,{mode,weight},validate=true,inputHistory={}) {
  if(!simpleWeightRule(row)) throw new Error('This calculation requires Advanced Settings.');
  const value=String(weight??'').trim(),number=value===''?null:Number(value);
  if(validate && (number===null||!Number.isFinite(number)||number<0))throw new Error('Weight must be a nonnegative finite DOE percentage.');
  const selected=mode||row.calculationMode;
  if(selected!==row.calculationMode && !(sessionWeightRule(row)&&['fixed','per_hour'].includes(selected)))throw new Error('Changing this calculation unit requires Advanced Settings.');
  const copy=clone(row);
  if(copy.calculationMode!==selected)transitionCalculationMode(copy,selected,inputHistory);
  const name=selected==='fixed'?'fixed':'rate';
  copy.parameters ||= [];
  let param=copy.parameters.find(x=>x.name===name);
  if(!param){param={name,valueNumber:null,valueText:null};copy.parameters.push(param);}
  param.valueNumber=number!==null&&Number.isFinite(number)?number:null;
  param.valueText=null;
  return copy;
}
    function simpleWeightHtml(row) {
  if(!simpleWeightRule(row))return '';
  if(sessionWeightRule(row))return sessionWeightHtml(row);
  const value=ruleWeight(row);
  return `<div class="doe-session-weight doe-simple-editor"><label class="field"><span class="field-label">Weight (%)</span><input class="input" type="number" min="0" step="any" data-doe-simple-weight aria-label="DOE weight percentage" value="${value===null?'':esc(value)}" ${editable()?'':'disabled'} required><small class="doe-field-example">Approved DOE percentage points (for example, 0.50 means 0.50%).</small></label><label class="field"><span class="field-label">Credit Per</span><div class="doe-fixed-credit-unit">${esc(simpleUnitLabel(row.calculationMode))}</div><small class="doe-field-example">For a different unit or formula, use Advanced Settings.</small></label></div>`;
}
    function inlineWeightFields(row,index) {
  if(!simpleWeightRule(row))return `<div class="doe-excel-complex-rate"><span>${esc(rateSummary(row))}</span><small>Use Advanced Settings for this formula.</small></div>`;
  const value=ruleWeight(row),lockedFields=!editable()||locked;
  return `<div class="doe-excel-inline-controls"><label class="field"><span class="field-label">Weight (%)</span><input type="number" min="0" step="any" class="input" data-doe-inline-weight data-rule-index="${index}" value="${value===null?'':esc(value)}" aria-label="Weight for ${esc(row.ruleLabel||row.ruleKey)}" ${lockedFields?'disabled':''}></label><label class="field"><span class="field-label">Credit Per</span>${sessionWeightRule(row)?`<select class="select" data-doe-inline-basis data-rule-index="${index}" aria-label="Credit unit for ${esc(row.ruleLabel||row.ruleKey)}" ${lockedFields?'disabled':''}><option value="per_hour" ${row.calculationMode==='per_hour'?'selected':''}>Hour</option><option value="per_session" ${row.calculationMode==='fixed'?'selected':''}>Session / Faculty assignment</option></select>`:`<span class="doe-fixed-credit-unit">${esc(simpleUnitLabel(row.calculationMode))}</span>`}</label></div>`;
}
    function handleInlineRateChange(target) {
  if(!target.matches?.('[data-doe-inline-weight], [data-doe-inline-basis]'))return;
  const item=target.closest('.doe-excel-rule-item');if(!item)return;
  const index=Number(item.dataset.ruleIndex),old=bundle.rules?.[index];
  const weightInput=item.querySelector('[data-doe-inline-weight]');
  const basisInput=item.querySelector('[data-doe-inline-basis]');
  const error=item.querySelector('.doe-inline-error');
  if(!old||!simpleWeightRule(old)||!editable()||locked)return;
  try {
    const selected=basisInput?(basisInput.value==='per_session'?'fixed':'per_hour'):old.calculationMode;
    const historyKey=`${index}:${old.ruleId||old.ruleKey||''}`;
    const modeInputHistory=inlineModeInputHistory.get(historyKey)||{};
    const changed=applySimpleRate(old,{mode:selected,weight:weightInput.value},true,modeInputHistory);
    inlineModeInputHistory.set(historyKey,modeInputHistory);
    if(changed.calculationMode===old.calculationMode&&ruleWeight(changed)===ruleWeight(old))return;
    bundle.rules[index]=changed;if(error)error.textContent='';
    item.querySelector('.doe-excel-rule-rate').textContent=rateSummary(changed);
    mark();node('doe-rulebook-dirty').textContent='Unsaved Draft changes · Save Draft before validation or preview.';
  }catch(e){
    if(error)error.textContent=e.message;
    if(weightInput)weightInput.value=ruleWeight(old)===null?'':String(ruleWeight(old));
    if(basisInput)basisInput.value=old.calculationMode==='fixed'?'per_session':'per_hour';
    onError(e.message);
  }
}
    function editorRuleMarkup(row,editing,fields) {
  const simple=simpleWeightRule(row);
  const basicKeys=simple?['referenceId','reviewStatus','enabled']:['calculationMode','referenceId','reviewStatus','enabled'];
  return `<section class="doe-editor-section"><h4>${esc(row.ruleLabel||'DOE rule')}</h4>${simple?simpleWeightHtml(row):'<p class="aux-note">This rule uses an advanced formula or tiered calculation. Change its parameters under Advanced Settings.</p>'}<div class="doe-editor-grid doe-essentials">${fields(schemas.rules.filter(d=>basicKeys.includes(d.key)))}</div></section><aside class="doe-entry-guide"><strong>Calculation example (not applied)</strong><p id="${idPrefix}doe-rule-example-result">${esc(exampleResult(row))}</p></aside><details class="doe-editor-disclosure" data-disclosure="advanced"><summary>Advanced Settings <span>Restrictions, matching conditions, inputs, priority and formula</span></summary><div class="doe-entry-guide" id="${idPrefix}doe-rule-entry-guide">${esc(originGuide(row))}</div><div class="doe-condition-summary"><span class="field-label">Applies when</span><p id="${idPrefix}doe-rule-condition-summary">${esc(conditionSummary(row))}</p><small>These conditions decide which assignments receive this rule; they are not login permissions.</small></div>${nestedHtml('selectors',row.selectors||[])}${selectionRule(row)?precedenceHtml(row):''}${!simple?nestedHtml('parameters',row.parameters||[]):''}<div class="doe-editor-grid">${fields(schemas.rules.filter(d=>!basicKeys.includes(d.key)&&d.key!=='formulaText'))}</div>${nestedHtml('inputs',row.inputs||[])}<details class="doe-editor-disclosure" data-disclosure="formula"><summary>Formula</summary>${fields(schemas.rules.filter(d=>d.key==='formulaText'))}</details><details class="doe-editor-disclosure" data-disclosure="tiers" ${row.calculationMode==='tiered'?'open':''}><summary>DOE tiers · ${(row.tiers||[]).length}</summary>${nestedHtml('tiers',row.tiers||[])}</details></details>`;
}
    function groupedRuleTable(rows) {
  const ordered=['Lectures & Labs','Course Coordination','HICC Course Development','VISC Coordination','Clinical Rotations & CCC','Other Approved Teaching','Trainees & Supervision','Reserve & Targets','Other / Advanced Rules'];
  const visible=ordered.map(label=>({label,rows:rows.filter(({row})=>ruleGroupName(row)===label)})).filter(g=>g.rows.length);
  if(!visible.length)return '<div class="empty">No matching rules. Choose a policy version or change the filters.</div>';
  return `<div class="doe-excel-rule-groups">${visible.map(({label,rows},groupIndex)=>`<details class="doe-excel-rule-group" ${groupIndex===0?'open':''}><summary><strong>${esc(label)}</strong><span>${rows.length} ${rows.length===1?'item':'items'} · Expand</span></summary><div class="doe-excel-rule-items">${rows.map(({row,index})=>`<div class="doe-excel-rule-item" data-rule-index="${index}"><div class="doe-excel-rule-header"><div><strong>${esc(row.ruleLabel||row.ruleKey||'Unnamed DOE item')}</strong><small class="doe-excel-rule-rate">${esc(rateSummary(row))}</small></div><small>${row.enabled===false?'Disabled':row.reviewStatus==='approved'?'Source reviewed':'Source review required'}</small></div>${inlineWeightFields(row,index)}<p class="doe-inline-error" role="alert" aria-live="polite"></p><details class="doe-excel-rule-advanced"><summary>Advanced Settings</summary><p><strong>Applies when:</strong> ${esc(conditionSummary(row))}</p><p><strong>Source:</strong> ${esc(refName(row.referenceId))}</p><p><strong>Rule key:</strong> ${esc(row.ruleKey||'Not assigned')} · <strong>Priority:</strong> ${esc(row.priority??'Not configured')}</p><button class="btn btn-small" type="button" data-edit="rules" data-index="${index}">${editable()?'Edit Advanced Settings':'View Rule Details'}</button></details></div>`).join('')}</div></details>`).join('')}</div>`;
}
        function sessionWeightHtml(row) {
  const weight = ruleWeight(row);
  const chosen = row.calculationMode === 'fixed' ? 'per_session' : 'per_hour';
  return `<div class="doe-session-weight"><label class="field"><span class="field-label">Weight (%)</span><input class="input" type="number" min="0" step="any" data-doe-session-weight aria-label="DOE weight percentage" value="${weight === null ? '' : esc(weight)}" ${editable() ? '' : 'disabled'} required><small class="doe-field-example">Percentage points per selected unit, e.g. 0.30 means 0.30% DOE.</small></label><label class="field"><span class="field-label">Credit per</span><select class="select" data-doe-session-basis aria-label="DOE credit basis" ${editable() ? '' : 'disabled'}><option value="per_hour" ${chosen === 'per_hour' ? 'selected' : ''}>Credited hour</option><option value="per_session" ${chosen === 'per_session' ? 'selected' : ''}>Session / faculty assignment</option></select><small class="doe-field-example">Per session uses the engine's existing fixed credit once for each matching Faculty SessionAssignment.</small></label></div>`;
}
    function applySessionWeight(row,original,rootElement,validate) {
  const field = rootElement.querySelector('[data-doe-session-weight]');
  const selector = rootElement.querySelector('[data-doe-session-basis]');
  if (!field || !selector) return row;
  const raw = field.value.trim();
  const number = raw === '' ? null : Number(raw);
  if (validate && (number === null || !Number.isFinite(number) || number < 0)) throw new Error('Weight must be a nonnegative finite DOE percentage.');
  const mode = selector.value === 'per_session' ? 'fixed' : 'per_hour';
  row.calculationMode = original.calculationMode;
  updateMode(row,mode);
  const name = mode === 'fixed' ? 'fixed' : 'rate';
  let parameter = row.parameters.find(item => item.name === name);
  if (!parameter) { parameter = {name,valueNumber:null,valueText:null}; row.parameters.push(parameter); }
  parameter.valueNumber = number !== null && Number.isFinite(number) ? number : null;
  parameter.valueText = null;
  return row;
}
    function table(key){
      let rows=(bundle[key]||[]).map((row,index)=>({row,index}));
      const categoryMatches=row=>category==='all'||(category==='teaching'?['teaching','assigned_teaching','rotation'].includes(row.category):category==='role'?['course_coordination','hicc','visc','adjustment','approved_activity'].includes(row.category):category==='supervision'?['supervision','reserve','other'].includes(row.category):row.category===category);
      if(key==='rules')rows=rows.filter(({row})=>categoryMatches(row)&&(group==='all'||groupOf(row)===group)&&(!search||JSON.stringify(row).toLowerCase().includes(search)));
      const columns=key==='rules'?['Rule / key','Selectors / inputs','Calculation / rate / cap','Reference','Review']:key==='references'?['Document','Section / table / page','Effective / source','Review']:key==='courseMappings'?['Course','Units / stage','HICC','Reference','Review']:key==='subjectMappings'?['Subject','Stage / development','Reference','Review']:['Scope','DOE / kind','Reason / evidence','Effective','Review'];
      function cells(row){
        const review=esc(text(row.reviewStatus).replace(/_/g,' ')||'needs review');
        const ref=esc(refName(row.referenceId));
        if(key==='rules')return [`<strong>${esc(row.ruleLabel||row.ruleKey)}</strong><small>${esc(row.ruleKey)} · ${esc(row.category)}${row.enabled===false?' · disabled':''}</small>`,`${(row.selectors||[]).map(s=>esc(`${s.field} ${s.operator} ${s.values?JSON.stringify(s.values):s.valueNumber??s.valueText??'—'}`)).join('<br>')||'All matching contexts'}<small>Facts: ${esc((row.inputs||[]).map(i=>typeof i==='string'?i:i.inputName).join(', ')||'None declared')}</small>`,`${esc(row.calculationMode)}<small>${esc((row.parameters||[]).map(p=>`${p.name} = ${p.valueNumber??p.valueText??'—'}`).join(' · '))}</small>${row.tiers?.length?`${row.tiers.length} tier(s)`:''}${row.formulaText?`<small>${esc(row.formulaText)}</small>`:''}`,ref,review];
        if(key==='references')return [esc(row.title),esc([row.section,row.tableName,row.pageNumber!=null?`p.${row.pageNumber}`:''].filter(Boolean).join(' · ')),`${esc(row.effectiveDate||'Not specified')}<small>${esc(row.sourceReference)}</small>`,review];
        if(key==='courseMappings')return [esc(row.courseCode),`${esc(row.unitCount??'Missing units')}<small>${esc(row.curriculumStage||'Missing stage')}</small>`,row.hiccEligible==null?'Unknown':row.hiccEligible?'Yes':'No',ref,review];
        if(key==='subjectMappings')return [`<strong>${esc(row.subjectName||row.subjectKey)}</strong><small>${esc(row.subjectKey)}</small>`,`${esc([row.curriculumStage,row.developmentPhase].filter(Boolean).join(' · ')||'Annual subject group')}<small>Subject count: ${esc(row.mappingFacts?.subjectCount??'Not confirmed')}</small><small>Aliases: ${esc((row.mappingFacts?.aliases||[]).join('; ')||'None')}</small>`,ref,review];
        return [esc(`${row.scopeType||'global'}: ${row.scopeKey||row.facultyId||'All'}`),`${esc(row.fixedDoe??'Missing')}% · ${esc(row.resultKind)}`,`${esc(row.reason)}<small>${esc(row.sourceReference)}</small>`,esc([row.effectiveStart,row.effectiveEnd].filter(Boolean).join(' to ')||'Not specified'),review];
      }
      if (key === 'rules') return groupedRuleTable(rows);
      return `<div class="doe-table-scroll"><table class="doe-rule-table"><thead><tr>${columns.map(c=>`<th scope="col">${c}</th>`).join('')}<th scope="col">Actions</th></tr></thead><tbody>${rows.map(({row,index})=>`<tr>${cells(row).map(c=>`<td>${c}</td>`).join('')}<td><button type="button" class="btn btn-small" data-edit="${key}" data-index="${index}">${editable()?'Edit':'View'}</button></td></tr>`).join('')||`<tr><td colspan="${columns.length+1}" class="empty">${bundle.version?'No matching entries.':'Select a Policy Version to view its rule book.'}</td></tr>`}</tbody></table></div>`;
    }
    function render(){
      if(!root)return;
      node('doe-rulebook-tabs').querySelectorAll('button').forEach(b=>{b.classList.toggle('active',b.dataset.panel===panel);b.setAttribute('aria-pressed',String(b.dataset.panel===panel));});
      const key=category==='exceptions'&&panel==='rules'?'exceptions':panel;
      node('doe-rulebook-filters').hidden=panel!=='rules';
      node('doe-rulebook-category').value=category;node('doe-rulebook-group').value=group;
      node('doe-rulebook-content').innerHTML=key==='reservePolicy'?`<div class="doe-reserve-summary">${schemas.reservePolicy.map(d=>`<div><span>${esc(d.label)}</span><strong>${esc(d.key==='referenceId'?refName(bundle.reservePolicy?.referenceId):bundle.reservePolicy?.[d.key]??'Not configured')}</strong></div>`).join('')}</div><p class="aux-note">Reserve calculations run before negotiated manual DOE. Parameter edits require a Reserve rule; the linked reference and annual approval are stored on that rule.</p>`:table(key);
      node('doe-rulebook-add').textContent=key==='reservePolicy'?'Edit Reserve Logic':`Add ${key==='rules'?'Rule':key==='references'?'Reference':key==='exceptions'?'Exception':'Mapping'}`;
      node('doe-rulebook-add').disabled=locked||!(key==='rules'?canAddRule():editable());
      node('doe-rulebook-dirty').textContent=dirty?'Unsaved draft changes · Save Draft before validation or preview.':'Saved version';
    }
    const friendly = value => text(value).replace(/([a-z])([A-Z])/g,'$1 $2').replace(/_/g,' ');
    const selectorLabels={category:'Workload category',sessionType:'Session type',roleType:'Workload activity',teachingRole:'Teaching responsibility',activityType:'Supervision / activity type',courseCode:'Course',course:'Course',subjectKey:'Subject',curriculumStage:'Curriculum year / stage',facultyId:'Faculty'};
    const modeLabels={fixed:'Fixed DOE',per_hour:'Per credited hour',per_shift:'Per shift',per_week:'Per week',per_trainee:'Per trainee',tiered:'DOE bands',capped:'Maximum credit (cap)',minimum:'Minimum credit',percentage_of_target:'Fraction of teaching target',prorated:'Prorated by FTE',formula:'Advanced formula'};
    const modeInputs={fixed:[],per_hour:['hours'],per_shift:['shifts'],per_week:['weeks'],per_trainee:['trainees'],tiered:['quantity'],capped:['baseValue'],minimum:['baseValue'],percentage_of_target:['targetDoe'],prorated:['baseDoe','fte']};
    const modeParams={fixed:['fixed'],per_hour:['rate'],per_shift:['rate'],per_week:['rate'],per_trainee:['rate'],tiered:[],capped:['cap'],minimum:['minimum'],percentage_of_target:['rate'],prorated:[]};
    function selectionRule(row){return Boolean(modeInputs[row.calculationMode])&&(row.selectors||[]).every(s=>selectorLabels[s.field]&&['equals','not_equals','in','not_in'].includes(s.operator)&&s.valueType!=='number')&&(row.inputs||[]).every(i=>Object.values(modeInputs).flat().includes(typeof i==='string'?i:i.inputName));}
    function choicesFor(name){
      const presets={category:['teaching','assigned_teaching','course_coordination','hicc','visc','rotation','supervision','reserve','approved_activity','target','other'],sessionType:['LEC','LAB','SRL','Quiz/Midterm','OSCE','Exam','CCC'],roleType:['Course Coordinator','Course Coordinator / HICC','HICC','VISC','Rotation Participant','Designated Rotation Coordinator','Rotation / Week Lead','CCC','Trainee / Supervision','Special Project','Other'],teachingRole:['Lecturer','Lead','Co-Instructor','Instructor','Facilitator','TA'],activityType:['Undergraduate Supervision','VETM 506','4th Year Preceptor','IM','Graduate Primary Supervisor','Graduate Co-supervisor','Postdoctoral Fellow'],curriculumStage:['Year 1','Year 2','Year 3','Year 4']};
      let pairs=(presets[name]||[]).map(v=>[v,v]);
      if(name==='courseCode'||name==='course')pairs=(bundle.courseMappings||[]).map(m=>[m.courseCode,m.courseCode]);
      if(name==='subjectKey')pairs=(bundle.subjectMappings||[]).map(m=>[m.subjectKey,m.subjectName||m.subjectKey]);
      if(name==='facultyId')pairs=getFaculty().map(f=>[f.facultyId,window.PAWS_FACULTY_NAME?.format(f)||f.preferredName||f.hrName||f.displayName||f.name||f.facultyId]);
      if(name==='teachingRole')pairs=[];
      if(name==='curriculumStage')pairs=(bundle.courseMappings||[]).filter(m=>m.curriculumStage).map(m=>[m.curriculumStage,m.curriculumStage]);
      for(const r of bundle.rules||[])for(const s of r.selectors||[])if(s.field===name){for(const v of Array.isArray(s.values)?s.values:[s.valueText])if(v!=null&&v!=='')pairs.push([String(v),String(v)]);}
      return [['','Choose an option…'],...pairs.filter(([v],i,a)=>v&&a.findIndex(([other])=>other===v)===i)];
    }
    function selectorControls(row,key,index){
      const choices=choicesFor(row.field),isSet=['in','not_in'].includes(row.operator);
      const main=isSet?`<label class="field"><span class="field-label">${esc(selectorLabels[row.field])}</span><select class="select" multiple data-field="values" data-path="selectors" aria-label="${esc(selectorLabels[row.field])}" ${editable()?'':'disabled'} required>${[...choices.filter(([v])=>v),...(Array.isArray(row.values)?row.values:[]).filter(v=>!choices.some(([known])=>known===v)).map(v=>[v,v])].map(([v,l])=>`<option value="${esc(v)}" ${row.values?.includes(v)?'selected':''}>${esc(l)}</option>`).join('')}</select><small class="doe-field-example">Select all applicable options. Each selected value uses the same DOE rule.</small></label>${inputHtml({...schemas.selectors[3],type:'text'},row.valueText,key,true)}`:inputHtml({...schemas.selectors[3],type:'select',label:selectorLabels[row.field],choices,required:true,help:'Choose the matching workload item from existing options. The saved value uses its canonical identifier.'},row.valueText,key,!editable());
      return `${inputHtml({...schemas.selectors[1],label:'Applies to',help:'Choose one item, several items, or exclude selected items.',choices:[['equals','Only this option'],['not_equals','All except this option'],['in','Any of selected options'],['not_in','All except selected options']]},row.operator,key,!editable())}${main}<details class="doe-parameter-details" data-disclosure="selector-${index}"><summary>Advanced condition</summary><div class="doe-editor-grid">${schemas.selectors.filter(d=>!['valueText','operator'].includes(d.key)&&(!isSet||d.key!=='values')).map(d=>inputHtml(d,row[d.key],key,!editable())).join('')}</div></details>`;
    }
    function updateMode(row,mode,modeInputHistory={}){
      const oldInputs=new Set(modeInputs[row.calculationMode]||[]),oldParams=new Set(modeParams[row.calculationMode]||[]);row.calculationMode=mode;
      if(!modeInputs[mode])return;
      const retained=(row.inputs||[]).filter(i=>!oldInputs.has(typeof i==='string'?i:i.inputName));
      const priorForMode=modeInputHistory[mode]||[];
      const inputFor=name=>retained.find(i=>(typeof i==='string'?i:i.inputName)===name)
        ||(row.inputs||[]).find(i=>(typeof i==='string'?i:i.inputName)===name)
        ||priorForMode.find(i=>(typeof i==='string'?i:i.inputName)===name)
        ||{inputName:name,required:true,source:''};
      row.inputs=[...retained,...modeInputs[mode].filter(name=>!retained.some(i=>(typeof i==='string'?i:i.inputName)===name)).map(inputFor)];
      row.parameters=(row.parameters||[]).filter(p=>!oldParams.has(p.name)||modeParams[mode].includes(p.name));
      for(const name of modeParams[mode])if(!(row.parameters||[]).some(p=>p.name===name))row.parameters.push({name,valueNumber:null,valueText:null});
    }
    function transitionCalculationMode(row,mode,inputHistory={}){
      inputHistory[row.calculationMode]=clone(row.inputs||[]);
      updateMode(row,mode,inputHistory);
      return row;
    }
    function precedenceHtml(row){return `<label class="field doe-precedence"><span class="field-label">When another rule also matches</span><select class="select" data-precedence aria-label="Existing matching rules" ${editable()?'':'disabled'} ${editing.index<0?'required':''}>${[['','Choose how to handle existing rules…'],['keep','Keep current precedence'],['normal','Prefer existing higher-priority rules'],['first','Use this rule before other matching rules']].filter(([v])=>v!=='keep'||editing.index>=0).map(([v,l])=>`<option value="${v}" ${(editing.precedence??(editing.index>=0?'keep':''))===v?'selected':''}>${l}</option>`).join('')}</select><small class="doe-field-example">This sets matching precedence without entering a priority number. Approved exceptions still take precedence. Check Impact Preview before publishing.</small></label>`;}
    function originGuide(row){
      const source=(row.selectors||[]).find(s=>s.field==='category'&&s.operator==='equals')?.valueText||row.category;
      if(['teaching','assigned_teaching'].includes(source))return 'Entry point: Calendar · session/assignment facts supply session type and credited hours. Rules become effective only after policy publication; session changes/recalculation use the Active policy. Existing recorded DOE and overrides are not silently replaced.';
      if(source==='other'||!source)return 'Entry point: determined by your conditions. Verify that Calendar or ADFA Dashboard supplies every declared fact before publication.';
      return 'Entry point: ADFA Dashboard · role/appointment, supervision, target or reserve facts. The rule is used when those matching assignment facts are calculated. Saving a Draft does not change the current faculty DOE; Impact Preview shows what would change.';
    }
    function exampleResult(row){
      const value=name=>{const p=(row.parameters||[]).find(p=>p.name===name);return p?.valueNumber==null||p.valueNumber===''?null:Number(p.valueNumber);};
      const mode=row.calculationMode,fixed=value('fixed'),rate=value('rate');
      if(mode==='fixed'&&Number.isFinite(fixed)&&fixed!==null)return `Using your value: each matching assignment returns ${fixed}% ${row.resultKind==='target'?'target':'DOE'}. Conditions and priority determine whether this rule is selected.`;
      const units={per_hour:[2,'credited hours'],per_week:[4,'weeks'],per_shift:[2,'shifts'],per_trainee:[2,'trainees']};
      if(units[mode]&&rate!==null&&Number.isFinite(rate)){const [quantity,label]=units[mode];return `Illustration using your rate: ${quantity} ${label} × ${rate} = ${Number((quantity*rate).toFixed(6))}% DOE. The quantity is an example, not a supplied assignment fact.`;}
      return 'Enter your actual approved DOE value/rate. Complex formulas, bands, caps and reserve application must be checked with the server Impact Preview; this illustration does not save or apply a calculation.';
    }
    function openRuleChoices(){
      if(locked||!canAddRule())return;
      editing=null;node('doe-rulebook-editor-title').textContent='Add Rule · choose its entry point';
      node('doe-rulebook-editor-fields').innerHTML=`<p class="doe-choice-note">${editable()?'Add to the current working Draft.':'A working Draft will be prepared before editing; Active rules stay read only.'} Choose where the calculation facts originate. Example rates below are not prefilled.</p><div class="doe-rule-choices">${ruleTemplates.map(t=>`<button type="button" class="doe-rule-choice" data-rule-template="${t.id}"><span class="doe-origin-tag">${esc(t.origin)}</span><strong>${esc(t.title)}</strong><span>${esc(t.description)}</span><small>Choose & fill actual values →</small></button>`).join('')}</div>`;
      node('doe-rulebook-editor-error').textContent='';node('doe-rulebook-editor-apply').hidden=true;node('doe-rulebook-editor').showModal();
    }
    function templateRow(template,row){
      const selector=(field,value)=>({field,operator:'equals',valueType:'text',valueText:value,valueNumber:null});
      Object.assign(row,{ruleKey:`${template.id}_${crypto.randomUUID().replace(/-/g,'').slice(0,12)}`,ruleLabel:template.title+' - '+(bundle.version?.academicYear||'annual DOE'),priority:0,category:template.category,activityType:'',calculationMode:template.mode,resultKind:template.category==='target'?'target':'credit',selectors:[selector('category',template.id==='custom'?'':template.category),...(template.fact?[selector(template.fact,'')]:[])],parameters:[{name:template.mode==='fixed'?'fixed':'rate',valueNumber:null,valueText:null}],inputs:template.input?[{inputName:template.input,source:'',required:true}]:[]});
    }
    function conditionSummary(row){
      const operators={equals:'is',not_equals:'is not',in:'is one of',not_in:'is not one of',gt:'is greater than',gte:'is at least',lt:'is less than',lte:'is at most'};
      return (row.selectors||[]).map(s=>`${friendly(s.field)} ${operators[s.operator]||s.operator} ${['in','not_in'].includes(s.operator)?(Array.isArray(s.values)?s.values.join(', '):s.values||'unspecified'):s.valueNumber??s.valueText??'unspecified'}`).join(' · ')||'All matching contexts (no additional conditions)';
    }
    function nestedHtml(key,rows){
      const guided=editing?.key==='rules'&&editing.index<0;
      const selection=editing?.key==='rules'&&selectionRule(editing.row);
      const content=rows.map((raw,index)=>{
        const row=typeof raw==='string'?{inputName:raw,required:true}:raw;
        let fields;
        if(key==='parameters')fields=`${inputHtml({...schemas.parameters[1],required:guided,label:row.name==='fixed'?'Fixed DOE (%)':row.name==='rate'?(modeLabels[editing.row.calculationMode]+' DOE (%)'):row.name==='cap'?'Maximum DOE (%)':row.name==='minimum'?'Minimum DOE (%)':friendly(row.name)||'Numeric value'},row.valueNumber,key,!editable())}<details class="doe-parameter-details" data-disclosure="parameter-${index}"><summary>Advanced parameter</summary><div class="doe-editor-grid">${[schemas.parameters[0],schemas.parameters[2]].map(d=>inputHtml(d,row[d.key],key,!editable())).join('')}</div></details>`;
        else if(selection&&key==='selectors')fields=selectorControls(row,key,index);
        else fields=schemas[key].map(d=>inputHtml(d,row[d.key],key,!editable())).join('');
        if(selection&&key==='selectors'&&row.field==='category')fields=`<details class="doe-parameter-details" data-disclosure="source-category"><summary>Data entry point (set by the selected rule type)</summary>${fields}</details>`;
        return `<div class="doe-nested-row ${key==='parameters'||selection&&key==='selectors'?'doe-parameter-row':''}" data-row="${index}">${fields}${selection&&(key==='parameters'||key==='selectors'&&row.field==='category')?'':`<button class="btn btn-small" data-remove="${key}" data-row="${index}" type="button" ${editable()?'':'disabled'}>Remove restriction</button>`}</div>`;
      }).join('');
      const add=selection&&key==='selectors'?`<div class="doe-scope-add"><label class="field"><span class="field-label">Add an optional restriction</span><select class="select" data-scope-choice aria-label="Additional scope">${[['courseCode','Course'],['subjectKey','Subject'],['facultyId','Faculty'],['curriculumStage','Curriculum year / stage']].map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></label><button class="btn" data-add-scope type="button" ${editable()?'':'disabled'}>Add restriction</button></div>`:`<button class="btn btn-small" data-add-nested="${key}" type="button" ${editable()?'':'disabled'}>Add ${esc(key==='inputs'?'input':key.replace(/s$/,''))}</button>`;
      return `<fieldset class="doe-nested"><legend>${esc(key==='inputs'?'Required data (automatic from calculation method)':key==='selectors'?'Where this rule applies':key==='parameters'?'DOE values & rates':key)}</legend><div data-nested="${key}">${content}</div>${selection&&key==='parameters'?'':add}</fieldset>`;
    }
    function drawEditor(){
      const {key,row}=editing;
      const expanded=[...node('doe-rulebook-editor-fields').querySelectorAll('details[open][data-disclosure]')].map(d=>d.dataset.disclosure);
      node('doe-rulebook-editor-title').textContent=`${editing.index<0?'Add':editable()?'Edit':'View'} ${labels[key]}`;
      const fields=defs=>defs.map(d=>inputHtml({...d,...(d.key==='calculationMode'?{choices:modes.map(v=>[v,modeLabels[v]])}:{}),required:d.required||key==='rules'&&editing.index<0&&d.key==='referenceId'},row[d.key],'root',!editable())).join('');
      if(key==='rules'){
        node('doe-rulebook-editor-fields').innerHTML=editorRuleMarkup(row,editing,fields);
      }else node('doe-rulebook-editor-fields').innerHTML=`<div class="doe-editor-grid">${fields(schemas[key])}</div>`;
      node('doe-rulebook-editor-fields').querySelectorAll('details[data-disclosure]').forEach(d=>{if(expanded.includes(d.dataset.disclosure))d.open=true;});
      node('doe-rulebook-editor-apply').hidden=!editable();
      node('doe-rulebook-editor-error').textContent='';
    }
    function readEditor(validate=true){
      const {key,row}=editing,result=readFields(node('doe-rulebook-editor-fields'),schemas[key],row,validate);
      if(key==='rules')for(const nested of ['selectors','inputs','parameters','tiers']){
        const container=node('doe-rulebook-editor-fields').querySelector(`[data-nested="${nested}"]`);
        result[nested]=container?[...container.querySelectorAll(':scope > [data-row]')].map((element,index)=>readFields(element,schemas[nested],typeof row[nested]?.[index]==='string'?{inputName:row[nested][index]}:row[nested]?.[index]||{},validate)):clone(row[nested]||[]);
      }
      if(key==='rules'){
        result.mappingRequirement=result.mappingRequirement||null;
        if(validate)for(const selector of result.selectors){
          if(['in','not_in'].includes(selector.operator)){
            if(!Array.isArray(selector.values)||!selector.values.length)throw new Error('Set selectors require a nonempty JSON array of values.');
          }else{
            delete selector.values;delete selector.valuesJson;
            if(selector.valueType==='number')selector.valueText=null;else selector.valueNumber=null;
          }
        }
      }
      if(key==='rules'&&simpleWeightRule(row)&&simpleWeightRule(result)&&result.calculationMode===row.calculationMode){
        result.parameters=clone(row.parameters||[]);
        const rootFields=node('doe-rulebook-editor-fields');
        if(sessionWeightRule(row))applySessionWeight(result,row,rootFields,validate);
        else {
          const weight=rootFields.querySelector('[data-doe-simple-weight]')?.value;
          Object.assign(result,applySimpleRate(result,{weight,mode:row.calculationMode},validate));
        }
      }
      if(key==='exceptions')result.facultyId=result.facultyId||null;
      return result;
    }
    function openEditor(key,index,template=null){
      if(locked)return;
      if(index<0&&!editable())return;
      const original=key==='reservePolicy'?bundle.reservePolicy||{}:bundle[key]?.[index];
      const row=clone(original||{reviewStatus:'needs_review',enabled:true});
      if(!original&&key!=='reservePolicy')row[key==='rules'?'ruleId':key==='references'?'referenceId':key==='exceptions'?'exceptionId':'mappingId']=crypto.randomUUID();
      if(key==='rules'&&!original){const groupCategory={assigned:'assigned_teaching',coordination:'course_coordination',clinical:'rotation',supervision:'supervision',hicc:'hicc',reserve:'reserve',other:'approved_activity'};const initialCategory=groupCategory[group]||(category==='role'?'course_coordination':category==='supervision'?'supervision':category==='target'?'target':'teaching');Object.assign(row,{category:initialCategory,calculationMode:'fixed',resultKind:initialCategory==='target'?'target':'credit',priority:0,selectors:[],inputs:[],parameters:[],tiers:[]});}
      if(template)templateRow(template,row);
      editing={key,index,row,initialPriority:row.priority,modeInputHistory:{}};node('doe-rulebook-editor-fields').innerHTML='';drawEditor();node('doe-rulebook-editor').showModal();
    }
    function mount(host){
      root=host;
      root.innerHTML=`<nav class="doe-rulebook-tabs" id="doe-rulebook-tabs" aria-label="Rule Book tables">${[['rules','Rule Book'],['courseMappings','Course Mapping'],['subjectMappings','VISC Subjects'],['references','References'],['reservePolicy','Reserve Logic']].map(([key,label])=>`<button class="btn" type="button" data-panel="${key}">${label}</button>`).join('')}</nav><div class="doe-rulebook-filters" id="doe-rulebook-filters"><label class="field"><span class="field-label">Category</span><select class="select" id="doe-rulebook-category">${categories.map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></label><label class="field"><span class="field-label">Rule group</span><select class="select" id="doe-rulebook-group">${groups.map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></label><label class="field"><span class="field-label">Find rule</span><input class="input" id="doe-rulebook-search" type="search" placeholder="Key, selector, reference…"></label></div><div class="doe-rulebook-table-actions"><button type="button" class="btn" id="doe-rulebook-add">Add Rule</button><span class="aux-note" id="doe-rulebook-dirty"></span></div><div id="doe-rulebook-content"></div><dialog class="doe-rule-dialog" id="doe-rulebook-editor" aria-labelledby="doe-rulebook-editor-title"><form id="doe-rulebook-editor-form"><div class="doe-dialog-heading"><h3 id="doe-rulebook-editor-title"></h3><button type="button" class="btn" data-close-editor aria-label="Close editor">Close</button></div><p class="aux-note">Apply changes to the working Draft, then Save Draft to persist them. Unedited fields and identities are preserved.</p><div id="doe-rulebook-editor-fields"></div><p id="doe-rulebook-editor-error" class="error" role="alert"></p><div class="form-actions"><button type="button" class="btn" data-close-editor>Cancel</button><button type="submit" class="btn btn-primary" id="doe-rulebook-editor-apply">Apply to Draft</button></div></form></dialog>`;
      root.querySelectorAll('[id]').forEach(element=>{element.id=idPrefix+element.id;});
      root.querySelectorAll('[aria-labelledby]').forEach(element=>{element.setAttribute('aria-labelledby',element.getAttribute('aria-labelledby').split(' ').map(id=>idPrefix+id).join(' '));});
      root.addEventListener('click',async event=>{
        const button=event.target.closest('button');if(!button)return;
        try{
          if(button.dataset.panel){panel=button.dataset.panel;render();}
          else if(button.dataset.edit)openEditor(button.dataset.edit,Number(button.dataset.index));
          else if(button.id===idPrefix+'doe-rulebook-add'){if(panel==='rules'&&category!=='exceptions')openRuleChoices();else openEditor(category==='exceptions'&&panel==='rules'?'exceptions':panel,-1);}
          else if(button.dataset.ruleTemplate){
            const template=ruleTemplates.find(t=>t.id===button.dataset.ruleTemplate);if(!template||locked||!canAddRule())return;
            node('doe-rulebook-editor').close();
            if(!editable()&&!await onStartDraft())throw new Error('A writable Draft is required. Select a Draft or check your DOE administrator permissions.');
            openEditor('rules',-1,template);
          }
          else if(button.hasAttribute('data-close-editor'))node('doe-rulebook-editor').close();
          else if(button.hasAttribute('data-add-scope')){
            const current=readEditor(false),field=node('doe-rulebook-editor-fields').querySelector('[data-scope-choice]').value;
            current.selectors.push({field,operator:'equals',valueType:'text',valueText:'',valueNumber:null});editing.row=current;drawEditor();
          }
          else if(button.dataset.addNested||button.dataset.remove){
            const key=button.dataset.addNested||button.dataset.remove;editing.row=readEditor(false);
            if(button.dataset.addNested)editing.row[key].push(key==='inputs'?{required:true}:key==='selectors'?{operator:'equals',valueType:'text'}:key==='tiers'?{tierOrder:editing.row[key].length,fromValue:0}:{});
            else editing.row[key].splice(Number(button.dataset.row),1);
            drawEditor();
            const added=node('doe-rulebook-editor-fields').querySelector(`[data-nested="${key}"]`);
            for(let parent=added?.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;
            if(button.dataset.addNested)added?.lastElementChild?.querySelector('details')?.setAttribute('open','');
          }
        }catch(error){node('doe-rulebook-editor-error').textContent=error.message;onError(error.message);}
      });
      root.addEventListener('change',event=>handleInlineRateChange(event.target));
      node('doe-rulebook-editor-fields').addEventListener('change',event=>{
        if(editing?.key!=='rules')return;
        const target=event.target;
        try{
          if(target.hasAttribute('data-precedence')){
            const row=readEditor(false);editing.precedence=target.value;
            if(target.value==='keep')row.priority=editing.initialPriority;
            if(target.value==='normal')row.priority=0;
            if(target.value==='first'){row.priority=Math.max(0,...(bundle.rules||[]).map(r=>Number(r.priority)||0))+1;if(!Number.isSafeInteger(row.priority)||row.priority>2147483647)throw new Error('Current priorities require advanced review.');}
            editing.row=row;drawEditor();
          }else if(target.dataset.field==='calculationMode'&&modes.includes(target.value)){
            const mode=target.value;
            // Collect pending Weight/Unit edits before replacing their controls.
            target.value=editing.row.calculationMode;
            const current=readEditor(false);target.value=mode;
            transitionCalculationMode(current,mode,editing.modeInputHistory);editing.row=current;drawEditor();
          }else if(target.dataset.field==='operator'&&target.dataset.path==='selectors'){
            editing.row=readEditor(false);drawEditor();
          }
        }catch(error){node('doe-rulebook-editor-error').textContent=error.message;}
      });
      node('doe-rulebook-editor-fields').addEventListener('invalid',event=>{
        for(let parent=event.target.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;
      },true);
      node('doe-rulebook-editor-fields').addEventListener('input',()=>{
        if(editing?.key!=='rules')return;
        if(editing.index<0)node('doe-rulebook-editor-fields').querySelectorAll('[data-nested="selectors"] > [data-row]').forEach(element=>{
          const set=['in','not_in'].includes(element.querySelector('[data-field="operator"]').value),numeric=element.querySelector('[data-field="valueType"]').value==='number';
          element.querySelector('[data-field="valueText"]').required=!set&&!numeric;
          element.querySelector('[data-field="valueNumber"]').required=!set&&numeric;
          element.querySelector('[data-field="values"]').required=set;
        });
        const current=readEditor(false);node('doe-rule-condition-summary').textContent=conditionSummary(current);
        node('doe-rule-entry-guide').textContent=originGuide(current);node('doe-rule-example-result').textContent=exampleResult(current);
        if(current.calculationMode==='formula')node('doe-rulebook-editor-fields').querySelector('[data-disclosure="formula"]').open=true;
        if(current.calculationMode==='tiered')node('doe-rulebook-editor-fields').querySelector('[data-disclosure="tiers"]').open=true;
      });
      node('doe-rulebook-category').addEventListener('change',event=>{category=event.target.value;render();});
      node('doe-rulebook-group').addEventListener('change',event=>{group=event.target.value;render();});
      node('doe-rulebook-search').addEventListener('input',event=>{search=event.target.value.toLowerCase();render();});
      node('doe-rulebook-editor-form').addEventListener('submit',event=>{
        event.preventDefault();if(!editable()||locked)return;
        try{
          const row=readEditor(),{key,index}=editing;
          if(key==='courseMappings')row.courseCode=text(row.courseCode).toUpperCase();
          if(key==='reservePolicy'){
            if(!(row.splitRatio>=0&&row.splitRatio<=1)||!(row.rollingAverageYears>=1&&row.rollingAverageYears<=10&&Number.isInteger(row.rollingAverageYears))||['splitThreshold','highTeachingTraineeCeiling','teachingFocusedTraineeCeiling'].some(k=>row[k]<0||row[k]>100))throw new Error('Reserve requires percentages between 0 and 100, ratio between 0 and 1, and a whole rolling year count between 1 and 10.');
            if(!(bundle.rules||[]).some(r=>r.category==='reserve'))throw new Error('Add a Reserve rule and its reference in Rule Book before configuring Reserve Logic.');
            bundle.reservePolicy=row;
            const reserve=bundle.rules.find(r=>r.category==='reserve');
            reserve.referenceId=row.referenceId||null;reserve.reviewStatus=row.reviewStatus;
            reserve.parameters=[...(reserve.parameters||[]).filter(p=>!reserveKeys.includes(p.name)),...reserveKeys.map(name=>({...(reserve.parameters||[]).find(p=>p.name===name),name,valueNumber:row[name],valueText:null}))];
          }else{
            bundle[key] ||= [];if(index<0)bundle[key].push(row);else bundle[key][index]=row;
            if(key==='rules'&&row.category==='reserve')bundle.reservePolicy={...Object.fromEntries((row.parameters||[]).filter(p=>reserveKeys.includes(p.name)&&p.valueNumber!=null).map(p=>[p.name,p.valueNumber])),referenceId:row.referenceId,reviewStatus:row.reviewStatus};
          }
          mark();render();node('doe-rulebook-editor').close();
        }catch(error){node('doe-rulebook-editor-error').textContent=error.message;}
      });
      render();
    }
    return Object.freeze({mount,describeRule:row=>({group:ruleGroupName(row),rate:rateSummary(row),quickSession:sessionWeightRule(row),simple:simpleWeightRule(row),unit:simpleUnitLabel(row.calculationMode)}),applySessionWeight,applySimpleRate,transitionCalculationMode,renderSimpleRow:(row,index=0)=>inlineWeightFields(row,index),renderGroupedRows:rows=>groupedRuleTable(rows),setBundle(value){bundle=clone(value||{});inlineModeInputHistory.clear();const reserve=(bundle.rules||[]).find(r=>r.category==='reserve');if(reserve){if(!bundle.reservePolicy)bundle.reservePolicy=Object.fromEntries((reserve.parameters||[]).filter(p=>reserveKeys.includes(p.name)&&p.valueNumber!=null).map(p=>[p.name,p.valueNumber]));bundle.reservePolicy={...bundle.reservePolicy,referenceId:reserve.referenceId,reviewStatus:reserve.reviewStatus};}dirty=false;node('doe-rulebook-editor')?.close();render();},refresh:render,isDirty:()=>dirty,editorOpen:()=>Boolean(node('doe-rulebook-editor')?.open),setLocked(value){const next=Boolean(value);if(next!==locked){locked=next;render();}},getPatch(){
      const patch={};for(const key of ['rules','references','courseMappings','subjectMappings','exceptions'])patch[key]=clone(bundle[key]||[]);
      for(const rule of patch.rules)for(const selector of rule.selectors||[]){if(Array.isArray(selector.values))selector.valuesJson=JSON.stringify(selector.values);}
      for(const key of ['courseMappings','subjectMappings'])for(const row of patch[key])if(row.mappingFacts)row.mappingFactsJson=JSON.stringify(row.mappingFacts);
      if(bundle.reservePolicy&&(bundle.rules||[]).some(r=>r.category==='reserve'))patch.reservePolicy=Object.fromEntries(reserveKeys.filter(k=>bundle.reservePolicy[k]!=null).map(k=>[k,bundle.reservePolicy[k]]));
      return patch;
    }});
  }
  window.UCVM_FACULTY_DOE_RULEBOOK=Object.freeze({create});
})();
