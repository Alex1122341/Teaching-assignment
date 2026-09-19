(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.UCVM_FACULTY_DOE=api;
})(typeof window!=='undefined'?window:null,function(){
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
 function worksheetTarget(faculty){
  const summary=faculty?.__doeWorksheetSummary;
  if(!summary||typeof summary!=='object')return null;
  const value=number(summary.effectiveTargetDOE??summary.effectiveTargetDoe??summary.targetDoe);
  if(value===null)return null;
  return{value,source:'worksheet',reason:text(summary.targetReason),policyVersionId:text(summary.policyVersionId)};
 }
 function effectiveTarget(faculty){
  const worksheet=worksheetTarget(faculty);if(worksheet)return worksheet;
  const approved=override(faculty);if(approved.value!==null)return{value:approved.value,source:'override',reason:approved.reason};
  const base=contract(faculty);if(base!==null)return{value:base,source:'contract',reason:''};
  return{value:null,source:'none',reason:''};
 }
 function targetLabel(faculty){
  const target=effectiveTarget(faculty);
  if(target.value===null)return'DOE unavailable';
  const label=target.source==='override'?'Override DOE':target.source==='worksheet'?'Worksheet DOE':'Contract DOE';
  return`${label} ${target.value.toFixed(2)}%${target.reason?` · ${target.reason}`:''}`;
 }
 return{override,contract,effectiveTarget,targetLabel};
});
