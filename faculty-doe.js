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
 function effectiveTarget(faculty,options={}){
  if(options&&options.policyBundle){
   const engine=options.engine||DEFAULT_ENGINE;
   if(!engine||typeof engine.calculateTarget!=='function')throw new Error('Canonical DOE policy engine is required for policy target calculation.');
   const approved=override(faculty);
   const baseDoe=contract(faculty);
   const fte=number(faculty?.fte)??1;
   const context={
    ...(faculty&&typeof faculty==='object'?faculty:{}),
    facultyId:text(faculty?.id||faculty?.facultyId),
    baseDoe,
    contractTeachingDoe:baseDoe,
    fte,
    overrideDoe:approved.value,
    overrideReason:approved.reason
   };
   const result=engine.calculateTarget(options.policyBundle,context);
   return{
    value:result.resultDoe,
    source:'policy',
    reason:'',
    policyVersionId:result.policyVersionId,
    ruleId:result.ruleId,
    ruleKey:result.ruleKey
   };
  }
  const approved=override(faculty);
  if(approved.value!==null)return{value:approved.value,source:'override',reason:approved.reason};
  const value=contract(faculty);
  return value===null?{value:null,source:'none',reason:''}:{value,source:'contract',reason:''};
 }
 function targetLabel(faculty,options={}){
  const target=effectiveTarget(faculty,options);
  if(target.value===null)return'DOE unavailable';
  const label=target.source==='override'?'Override DOE':target.source==='policy'?'Policy DOE':'Contract DOE';
  return`${label} ${target.value.toFixed(2)}%${target.reason?` · ${target.reason}`:''}`;
 }
 return{override,contract,effectiveTarget,targetLabel};
});
