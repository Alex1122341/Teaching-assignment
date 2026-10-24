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
 function effectiveTarget(faculty){
  const approved=override(faculty);
  if(approved.value!==null)return{value:approved.value,source:'override',reason:approved.reason};
  const value=contract(faculty);
  return value===null?{value:null,source:'none',reason:''}:{value,source:'contract',reason:''};
 }
 function targetLabel(faculty){
  const target=effectiveTarget(faculty);
  if(target.value===null)return'DOE unavailable';
  return`${target.source==='override'?'Override DOE':'Contract DOE'} ${target.value.toFixed(2)}%${target.reason?` · ${target.reason}`:''}`;
 }
 return{override,contract,effectiveTarget,targetLabel};
});
