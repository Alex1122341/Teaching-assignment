'use strict';
// Owner-directed transcription of the current 2026-27 sources into a NEW Draft.
// No publication, recalculation, source-data updates or existing Draft edits.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),os=require('node:os');
const runtime=process.argv[2],mode=process.argv[3]||'Plan',out=process.argv[4];
if(!runtime||!out||!['Plan','Apply'].includes(mode))throw Error('Usage: node populate-current-doe-rulebook.cjs <server-root> Plan|Apply <output-directory>');
if(os.hostname().toUpperCase()!=='ITAPPVETOPSDB01')throw Error('Run on ITAPPVETOPSDB01 only');
const year='2026-27',label='2026-27 Current Rules - Guidelines 2025-12-23 + MASTER (Draft)';
const actor='codex:owner-directed-rulebook-transcription:2026-10-11';
const {createSqlConnection}=require(path.join(runtime,'src/data/sql-connection'));
const {createSqlDoePolicyRepository}=require(path.join(runtime,'src/data/sql-doe-policy-repository'));
const {createDoePolicyService}=require(path.join(runtime,'src/doe/doe-policy-service'));
const engine=require(path.join(runtime,'src/domain/doe-policy-engine'));
const {normalizePolicy}=require(path.join(runtime,'src/doe/doe-reserve-service'));
const catalog=require(path.join(runtime,'src/domain/doe-course-catalog-2026-27'));
const sql=require(path.join(runtime,'node_modules/mssql/msnodesqlv8'));
const db=createSqlConnection({connectionString:'Server=ITAPPVETOPSDB01.uc.ucalgary.ca,1433;Database=VetMed-Ops;Encrypt=True;TrustServerCertificate=False;',driver:'msnodesqlv8',sql});
const id=key=>{const h=crypto.createHash('sha256').update('paws:current-rules:2026-27:20261011:'+key).digest('hex').slice(0,32);return [h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-');};
const policyId=id('policy'),source='UCVM Workload Guidelines, updated 2025-12-23, effective 2025-04-01; Teaching Assignments 2026 27 MASTER (8).xlsx; current accepted calculator/source snapshots; transcription only, not published.';
const ref=(key,title,section,tableName,pageNumber,notes)=>({referenceId:id('reference:'+key),title,section,tableName,pageNumber,effectiveDate:title.startsWith('UCVM')?'2025-04-01':null,sourceReference:source,documentLink:null,notes,reviewStatus:'approved'});
const refs=[
 ref('teaching','UCVM Workload Guidelines - updated 2025-12-23','6.2','Table 1',3,'Teaching rates and coordination tiers. Inputs must be confirmed; stored/negotiated allocations retain their provenance.'),
 ref('supervision','UCVM Workload Guidelines - updated 2025-12-23','6.3','Table 2',4,'Graduate supervision uses the current and previous two years when available; otherwise current-year evidence. Missing supervision data does not mean zero.'),
 ref('development','UCVM Workload Guidelines - updated 2025-12-23','6.4','Table 3',5,'2026-27 VISC rate only. HICC development eligibility must be explicitly mapped; development credit ends when curriculum development is finalized. Negotiated prorating stays manual.'),
 ref('reserve','UCVM Workload Guidelines - updated 2025-12-23','6.3','Trainee reserve',4,'Reserve parameters transcribed from the accepted DoeWorkloadSource. Flexible transfer between assigned teaching and supervision follows the existing reserve service.'),
 ref('master','Teaching Assignments 2026 27 MASTER (8).xlsx','DOE Calculator / Course Coordinator / HICCs',null,null,'CCC shift reference and exact course-unit/development mappings already used by the accepted calculator. Stored DOE and overrides remain authoritative and are not overwritten.'),
 ref('trainees','Teaching Assignments 2026 27 MASTER (8).xlsx','# Trainees',null,null,'Owner-confirmed existing formulas: VETM 506 and IM counts below 1 give zero; exactly 1 gives 0.5%; more than 1 gives 1%. Current-year source evidence retained.'),
 ref('manual','Owner-authorized manual DOE assignment workflow','Role / Appointment negotiated DOE',null,null,'Signed negotiated manual adjustments are added once after source reserve calculation. Positive and negative values are allowed. This rule documents manual facts; it does not create automatic prorating or alter current ManualDoeAssignment records.')
];
const references=Object.fromEntries(['teaching','supervision','development','reserve','master','trainees','manual'].map((key,i)=>[key,refs[i].referenceId]));
const selector=(field,value,operator='equals')=>({selectorId:id('selector:'+field+':'+value+':'+operator),field,operator,valueType:'text',valueText:String(value)});
const rules=[];
function rule(key,category,activityType,mode,refKey,parameters={},inputs=[],selectors=[],extra={}){
 const ruleId=id('rule:'+key);
 const r={ruleId,ruleKey:key+'_2026_27',category,activityType,ruleLabel:activityType+' - 2026-27',priority:100,calculationMode:mode,tierStrategy:null,formulaText:null,mappingRequirement:null,resultKind:'credit',referenceId:references[refKey],enabled:true,reviewStatus:'approved',selectors:selectors.map((s,i)=>({...s,selectorId:id(key+':selector:'+i)})),parameters:Object.entries(parameters).map(([name,valueNumber])=>({name,valueNumber,valueText:null})),inputs:inputs.map(inputName=>({inputName,required:true,source:'Confirmed source fact; '+refs.find(r=>r.referenceId===references[refKey]).title})),tiers:[],...extra};
 rules.push(r);return r;
}
for(const [key,role,rate] of [['lecture','Lecture',.3],['srl','SRL',.3],['lab_primary','Lab Primary',.21],['lab_secondary','Lab Secondary',.19]])
 rule('teaching_'+key,'teaching',role,'per_hour','teaching',{rate},['hours'],[selector('teachingRole',role)]);
for(const type of ['Quiz/Midterm','OSCE'])
 rule('no_credit_'+type.toLowerCase().replace(/\W/g,'_'),'teaching',type+' (no DOE credit)','fixed','master',{fixed:0},[],[selector('sessionType',type)],{priority:1000});
const cc=rule('course_coordination','course_coordination','Course Coordinator: <3=1.75%; 3-5=3.5%; 6-9=7%; 10-14=10%; 15+=15%','tiered','teaching',{},['quantity'],[selector('roleType','Course Coordinator')],{mappingRequirement:'course',tierStrategy:'lookup'});
cc.tiers=[[0,3,1.75],[3,6,3.5],[6,10,7],[10,15,10],[15,null,15]].map(([fromValue,toValue,fixedCredit],i)=>({tierId:id('cc-tier:'+i),tierOrder:i+1,fromValue,toValue,fixedCredit,rate:null}));
rule('hicc_development','hicc','HICC development: 2% per unit','formula','development',{rate:2},['units'],[selector('roleType','HICC'),selector('hiccEligible','true')],{formulaText:'units * rate',mappingRequirement:'course'});
rule('hicc_finalized','hicc','HICC finalized curriculum: development credit 0%','fixed','development',{fixed:0},[],[selector('roleType','HICC'),selector('hiccEligible','false')]);
rule('visc_subject','visc','VISC subject development: 5% per confirmed subject','formula','development',{rate:5},['subjectCount'],[selector('roleType','VISC')],{formulaText:'subjectCount * rate',mappingRequirement:'subject'});
rule('rotation_participant','rotation','Rotation Participant: 2.5% per week','per_week','teaching',{rate:2.5},['weeks'],[selector('roleType','Rotation Participant')]);
rule('rotation_coordinator','rotation','Designated Rotation Coordinator: +2% per unique rotation type','formula','teaching',{rate:2},['uniqueRotationTypes'],[selector('roleType','Designated Rotation Coordinator')],{formulaText:'uniqueRotationTypes * rate'});
rule('ccc_shift','rotation','CCC: 0.5% per confirmed shift','per_shift','master',{rate:.5},['shifts'],[selector('roleType','CCC')]);
for(const [key,type,rate] of [['undergraduate','Undergraduate Supervision',1],['preceptor','4th Year Preceptor',.75],['graduate_primary','Graduate Primary Supervisor',3],['graduate_co','Graduate Co-supervisor',2],['postdoctoral','Postdoctoral Fellow',1.5]])
 rule('supervision_'+key,'supervision',type,'per_trainee','supervision',{rate},['trainees'],[selector('activityType',type)]);
for(const type of ['VETM 506','IM'])
 rule('supervision_'+type.toLowerCase().replace(/\W/g,'_'),'supervision',type+': 0 trainees=0%; 1=0.5%; >1=1%','formula','trainees',{rate:.5},['trainees'],[selector('activityType',type)],{formulaText:'(min(1, floor(trainees)) + min(1, ceil(max(0, trainees - 1)))) * rate'});
rule('manual_negotiated','adjustment','Negotiated manual DOE: signed approved value, including reductions','formula','manual',{},['approvedDoe'],[selector('activityType','Negotiated DOE')],{formulaText:'approvedDoe',resultKind:'adjustment'});
async function summary(){
 return {active:await db.query("SELECT CONVERT(nvarchar(36),PolicyVersionId) id,Revision,Status,VersionLabel FROM paws.DoePolicyVersion WHERE AcademicYear=@year AND Active=1",{year}),
 counts:await db.query("SELECT (SELECT COUNT_BIG(*) FROM paws.DoeCalculationRecord) calculations,(SELECT COUNT_BIG(*) FROM paws.DoeAssignmentFact) facts,(SELECT COUNT_BIG(*) FROM paws.RoleAssignment) roles,(SELECT COUNT_BIG(*) FROM paws.ManualDoeAssignment) manualAssignments,(SELECT COUNT_BIG(*) FROM paws.DoeFacultyTarget) targets,(SELECT COUNT_BIG(*) FROM paws.DoeSupervisionSourceSnapshot) supervisionSnapshots")};
}
(async()=>{
 try{
  fs.mkdirSync(out,{recursive:true});
  const workload=await db.query('SELECT ParametersJson parametersJson,SourceReference sourceReference FROM paws.DoeWorkloadSource WHERE AcademicYear=@year',{year});
  if(workload.length!==1)throw Error('Expected one accepted annual workload source');
  const reservePolicy=normalizePolicy(JSON.parse(workload[0].parametersJson));
  rule('reserve_policy','reserve','Flexible trainee reserve and three-year history window','fixed','reserve',reservePolicy,[],[selector('activityType','reserve_policy')],{priority:0});
  const courses=new Map();
  for(const [name,unitCount] of Object.entries(catalog.COURSE_UNITS)){
   const courseCode=name.split(':')[0].trim(),eligible=catalog.HICC_DEVELOPMENT_APPLICABILITY[name]??null;
   const previous=courses.get(courseCode);
   if(previous&&previous.unitCount!==unitCount)throw Error('Conflicting source course units');
   if(previous&&previous.hiccEligible!==null&&eligible!==null&&previous.hiccEligible!==eligible)throw Error('Conflicting source development eligibility');
   courses.set(courseCode,{mappingId:id('course:'+courseCode),courseCode,unitCount,curriculumStage:null,hiccEligible:eligible??previous?.hiccEligible??null,mappingFacts:{sourceCourseLabel:name,quantity:unitCount},referenceId:references.master,reviewStatus:'approved',enabled:true});
  }
  const bundle={version:{policyVersionId:policyId,academicYear:year,versionLabel:label,sourceReference:source,status:'draft',revision:0},rules,references:refs,reservePolicy,exceptions:[],courseMappings:[...courses.values()],subjectMappings:[]};
  const validation=engine.validatePolicy(bundle);
  if(!validation.valid)throw Error('Draft schema validation failed: '+JSON.stringify(validation.errors));
  const before=await summary(),repo=createSqlDoePolicyRepository(db),service=createDoePolicyService({repository:repo});
  fs.writeFileSync(path.join(out,'plan.json'),JSON.stringify(bundle,null,2));
  fs.writeFileSync(path.join(out,'before.json'),JSON.stringify(before,null,2));
  console.log(JSON.stringify({mode,policyVersionId:policyId,label,rules:rules.length,references:refs.length,courseMappings:courses.size,reservePolicy,ruleKeys:rules.map(r=>r.ruleKey)}));
  if(mode==='Plan')return;
  const existing=await db.query('SELECT Status,Revision,VersionLabel FROM paws.DoePolicyVersion WHERE PolicyVersionId=@policyId',{policyId});
  if(existing.length)throw Error('Draft already exists; inspect it instead of rerunning import');
  const version=await repo.saveDraft({policyVersionId:policyId,academicYear:year,expectedRevision:0,actorUid:actor,bundle,createVersion:true});
  const checked=await service.validateDraft({policyVersionId:policyId,expectedRevision:Number(version.revision),actorUid:actor});
  const saved=await repo.getPolicyVersion(policyId),after=await summary();
  fs.writeFileSync(path.join(out,'saved.json'),JSON.stringify(saved,null,2));
  fs.writeFileSync(path.join(out,'after.json'),JSON.stringify(after,null,2));
  fs.writeFileSync(path.join(out,'validation.json'),JSON.stringify(checked,null,2));
  if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Active policy or business counts changed unexpectedly');
  if(saved.version.status!=='draft'||saved.rules.length!==rules.length||!checked.valid)throw Error('Saved Draft acceptance failed');
  console.log(JSON.stringify({saved:true,policyVersionId:policyId,status:saved.version.status,revision:saved.version.revision,ruleCount:saved.rules.length,validation:checked,activePolicyUnchanged:true,businessCountsUnchanged:true}));
 }finally{await db.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
