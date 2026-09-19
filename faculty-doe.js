(function(root,factory){
 const engine=typeof module==='object'&&module.exports?require('./doe-policy-engine.js'):(root&&root.UCVM_DOE_POLICY_ENGINE);
 const api=factory(engine);
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.UCVM_FACULTY_DOE=api;
})(typeof window!=='undefined'?window:null,function(DEFAULT_ENGINE){
 'use strict';
 const text=value=>String(value??'').trim();
 const number=value=>{if(value===null||value===undefined||value==='')return null;const parsed=Number(value);return Number.isFinite(parsed)?parsed:null};
 function override(faculty){
  const raw=faculty?.doeOverride2026_27;
  const object=raw&&typeof raw==='object';
  const value=number(object?raw.value:(raw??faculty?.overrideDOE));
  const reason=text(object?raw.reason:faculty?.overrideReason);
  const notes=text(object?raw.notes:'');
  return{value,reason,notes};
 }
 function contract(faculty){
  return[faculty?.doe?.teaching,faculty?.doeTeaching,faculty?.teachingDOE,faculty?.contractTeachingDOE].map(number).find(value=>value!==null)??null;
 }
 function compatibilityTargetBundle(faculty){
  const approved=override(faculty),baseDoe=contract(faculty);
  return{
   bundle:{
    version:{policyVersionId:'compatibility-target-sources-v1',academicYear:text(faculty?.academicYear||'2026-27'),status:'active'},
    rules:[
     {ruleId:'compat-target-override',ruleKey:'target.override.approved',category:'target',calculationMode:'formula',formulaText:'overrideDoe',resultKind:'target',priority:200,enabled:true,selectors:[{field:'hasOverride',operator:'equals',valueText:true}],inputs:[{inputName:'overrideDoe',required:true}],parameters:[]},
     {ruleId:'compat-target-contract',ruleKey:'target.contract.source',category:'target',calculationMode:'formula',formulaText:'contractTeachingDoe',resultKind:'target',priority:100,enabled:true,selectors:[],inputs:[{inputName:'contractTeachingDoe',required:true}],parameters:[]}
    ],
    exceptions:[]
   },
   context:{
    ...(faculty&&typeof faculty==='object'?faculty:{}),
    facultyId:text(faculty?.id||faculty?.facultyId||faculty?.ucid||faculty?.__id),
    contractTeachingDoe:baseDoe,
    baseDoe,
    fte:number(faculty?.fte)??1,
    overrideDoe:approved.value,
    overrideReason:approved.reason,
    hasOverride:approved.value!==null
   },
   approved
  };
 }
 function effectiveTarget(faculty,options={}){
  const engine=options.engine||DEFAULT_ENGINE;
  if(!engine||typeof engine.calculateTarget!=='function')throw new Error('Canonical DOE policy engine is required for target calculation.');
  if(options&&options.policyBundle){
   const approved=override(faculty),baseDoe=contract(faculty),fte=number(faculty?.fte)??1;
   const context={...(faculty&&typeof faculty==='object'?faculty:{}),facultyId:text(faculty?.id||faculty?.facultyId||faculty?.ucid||faculty?.__id),baseDoe,contractTeachingDoe:baseDoe,fte,overrideDoe:approved.value,overrideReason:approved.reason,hasOverride:approved.value!==null};
   const result=engine.calculateTarget(options.policyBundle,context);
   return{value:result.resultDoe,source:'policy',reason:'',policyVersionId:result.policyVersionId,ruleId:result.ruleId,ruleKey:result.ruleKey};
  }
  const compatibility=compatibilityTargetBundle(faculty);
  try{
   const result=engine.calculateTarget(compatibility.bundle,compatibility.context);
   const isOverride=result.ruleKey==='target.override.approved';
   return{value:result.resultDoe,source:isOverride?'override':'contract',reason:isOverride?compatibility.approved.reason:''};
  }catch(error){
   if(error&&['INPUT_MISSING','RULE_NOT_FOUND'].includes(error.code))return{value:null,source:'none',reason:''};
   throw error;
  }
 }
 function targetLabel(faculty,options={}){
  const target=effectiveTarget(faculty,options);
  if(target.value===null)return'DOE unavailable';
  const label=target.source==='override'?'Override DOE':target.source==='policy'?'Policy DOE':'Contract DOE';
  return`${label} ${target.value.toFixed(2)}%${target.reason?` · ${target.reason}`:''}`;
 }
 return{override,contract,effectiveTarget,targetLabel};
});
