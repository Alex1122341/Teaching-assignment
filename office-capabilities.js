/* Office tool capabilities. This is not a substitute for Firestore authorization. */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.UCVM_OFFICE_CAPABILITIES=api;
})(typeof window!=='undefined'?window:null,function(){
 'use strict';
 const normalize=role=>String(role||'').trim().toLowerCase();
 const adfaRoles=['owner','administrator','admin','adfa_general','adfa_regular'];
 const facultyRoles=['faculty','hicc','visc','editor','viewer'];
 function officeForRole(role){role=normalize(role);return adfaRoles.includes(role)?'adfa':['adc','lab'].includes(role)?role:'';}
 function isOfficeAccount(role){return Boolean(officeForRole(role))||normalize(role)==='other_office';}
 function forRole(role){
  role=normalize(role);
  const c={canViewCalendar:false,canAddSessions:false,canAddOneSession:false,canSelectSessions:false,
   canEditCourseFields:false,canEditInstructor:false,canEditLabTopic:false,
   canReviewAdcScope:false,canReviewLabScope:false,canReviewAdfaScope:false,canViewFullApprovalOverview:false};
  c.canViewCalendar=isOfficeAccount(role)||facultyRoles.includes(role);
  if(adfaRoles.includes(role))Object.assign(c,{canAddSessions:true,canAddOneSession:true,canSelectSessions:true,canEditCourseFields:true,canEditInstructor:true,canEditLabTopic:true,canReviewAdfaScope:true,canViewFullApprovalOverview:true});
  else if(role==='adc')Object.assign(c,{canAddSessions:true,canAddOneSession:true,canSelectSessions:true,canEditCourseFields:true,canReviewAdcScope:true});
  else if(role==='lab')Object.assign(c,{canSelectSessions:true,canEditLabTopic:true,canReviewLabScope:true});
  return Object.freeze(c);
 }
 return Object.freeze({forRole,officeForRole,isOfficeAccount});
});
