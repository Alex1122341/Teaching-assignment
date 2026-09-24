/* Office tool capabilities. This is not a substitute for Firestore authorization.
 *
 * Primary account roles and operational office access are deliberately separate.
 * The primary role controls system/admin authority. officeAccess controls which
 * ADC / LAB / ADFA work the account may perform, so office responsibilities can
 * be reassigned without changing account identity or system role.
 *
 * Profiles created before officeAccess existed keep the historical role defaults.
 */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.UCVM_OFFICE_CAPABILITIES=api;
})(typeof window!=='undefined'?window:null,function(){
 'use strict';
 const OFFICES=Object.freeze(['adc','lab','adfa']);
 const normalize=role=>String(role||'').trim().toLowerCase();
 const adfaRoles=['developer','owner','administrator','admin','adfa_general','adfa_regular','adfa'];
 const facultyRoles=['faculty','hicc','visc','editor','viewer'];
 const configurableRoles=['owner','administrator','admin','adfa_general','adfa_regular','adc','lab'];
 function roleOf(profileOrRole){return normalize(profileOrRole&&typeof profileOrRole==='object'?profileOrRole.role:profileOrRole);}
 function defaultOfficeAccess(profileOrRole){
  const role=roleOf(profileOrRole);
  if(role==='developer')return OFFICES.slice();
  if(role==='adc')return['adc'];
  if(role==='lab')return['lab'];
  if(adfaRoles.includes(role))return['adfa'];
  return[];
 }
 function allowedOfficesForRole(role){role=roleOf(role);if(role==='developer'||['owner','administrator','admin','adfa_general','adfa_regular'].includes(role))return OFFICES.slice();if(role==='adc'||role==='lab')return['adc','lab'];return[];}
 function normalizeOfficeAccess(value,allowed=OFFICES){
  return[...new Set((Array.isArray(value)?value:[]).map(normalize).filter(name=>allowed.includes(name)))];
 }
 function officesForProfile(profileOrRole){
  const role=roleOf(profileOrRole);
  if(role==='developer')return OFFICES.slice();
  if(profileOrRole&&typeof profileOrRole==='object'&&Array.isArray(profileOrRole.officeAccess)){
   if(!configurableRoles.includes(role))return[];
   return normalizeOfficeAccess(profileOrRole.officeAccess,allowedOfficesForRole(role));
  }
  return defaultOfficeAccess(role);
 }
 function hasOfficeAccess(profileOrRole,office){return officesForProfile(profileOrRole).includes(normalize(office));}
 function officeForRole(role){role=roleOf(role);return role==='adc'?'adc':role==='lab'?'lab':adfaRoles.includes(role)?'adfa':'';}
 function isOfficeAccount(profileOrRole){return officesForProfile(profileOrRole).length>0;}
 function blank(){
  return{canViewCalendar:false,
   canAddSessions:false,canAddOneSession:false,canSelectSessions:false,
   canEditCourseFields:false,canEditInstructor:false,
   canEditLabTopic:false,canEditLabGroups:false,canEditLabRoster:false,
   canSuggestFaculty:false,
   canReviewAdcScope:false,canReviewLabScope:false,canReviewAdfaScope:false,
   canViewTeachingAssignmentWorking:false,
   canViewHiccPackage:false,canEditHiccTopic:false,canSuggestHiccFaculty:false,
   canSubmitHiccPackage:false,canReviseHiccPackage:false,canFinalSubmitHiccPackage:false,
   canViewViscPackages:false,canApproveViscPackage:false,canPushBackViscPackage:false,
   canPublishTimetable:false,
   canViewFullApprovalOverview:false,
   canOverride:false};
 }
 function applyOffice(c,office){
  if(office==='adc')Object.assign(c,{
   canAddSessions:true,canAddOneSession:true,canSelectSessions:true,
   canEditCourseFields:true,canSuggestFaculty:true,canReviewAdcScope:true
  });
  else if(office==='lab')Object.assign(c,{
   canEditLabTopic:true,canEditLabGroups:true,canEditLabRoster:true,
   canSuggestFaculty:true,canReviewLabScope:true
  });
  else if(office==='adfa')Object.assign(c,{canEditInstructor:true,canReviewAdfaScope:true});
 }
 function forProfile(profileOrRole,options={}){
  const role=roleOf(profileOrRole),c=blank();
  c.canViewCalendar=isOfficeAccount(profileOrRole)||facultyRoles.includes(role);
  if(role==='developer'){Object.keys(c).forEach(key=>{c[key]=true});return Object.freeze(c)}
  const granted=officesForProfile(profileOrRole),stage=normalize(options.stage);
  const active=stage?(granted.includes(stage)?[stage]:[]):granted;
  for(const office of active)applyOffice(c,office);
  const ta=options?.teachingAssignment&&typeof options.teachingAssignment==='object'?options.teachingAssignment:{},taState=normalize(ta.state);
  const hiccCurrent=ta.hiccAssigned===true&&ta.ownsPackage===true&&ta.hasAcademicScope===true;
  if(hiccCurrent){
   c.canViewTeachingAssignmentWorking=true;c.canViewHiccPackage=true;c.canEditHiccTopic=true;c.canSuggestHiccFaculty=true;
   if(taState==='draft'||taState==='changes_requested')c.canSubmitHiccPackage=true;
   if(taState==='changes_requested')c.canReviseHiccPackage=true;
   if(taState==='visc_approved'&&ta.viscApprovalCurrent===true)c.canFinalSubmitHiccPackage=true;
  }
  const viscCurrent=ta.viscAssigned===true&&ta.leadsGroup===true;
  if(viscCurrent){
   c.canViewTeachingAssignmentWorking=true;c.canViewViscPackages=true;
   if(taState==='visc_review'){c.canApproveViscPackage=true;c.canPushBackViscPackage=true}
  }
  // System-level overview, timetable publication and override authority stay tied
  // to high-trust primary roles, never to an office checkbox or responsibility.
  if(['owner','administrator','admin','adfa_general','adfa_regular'].includes(role))c.canViewFullApprovalOverview=true;
  if(role==='owner'||role==='adfa_general'){c.canOverride=true;c.canPublishTimetable=true}
  return Object.freeze(c);
 }
 function forRole(role){return forProfile({role});}
 return Object.freeze({OFFICES,forRole,forProfile,allowedOfficesForRole,defaultOfficeAccess,normalizeOfficeAccess,officesForProfile,hasOfficeAccess,officeForRole,isOfficeAccount});
});
