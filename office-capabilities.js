/* Office tool capabilities. This is not a substitute for Firestore authorization.
 *
 * Operational timetable ownership is deliberately narrow:
 *   ADC  - the only normal business role that schedules sessions.
 *   LAB  - works from the Work Queue and owns LAB topic / groups / rosters only.
 *   ADFA - FACULTY ASSIGNMENT ONLY. An ADFA account is not a general timetable
 *          editor even when it holds DOE Administration authority.
 *
 * Owner and Developer keep an explicit administrative override, and Owner's
 * User Management / DOE administration authority is governed elsewhere and is
 * intentionally not reduced here.
 */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.UCVM_OFFICE_CAPABILITIES=api;
})(typeof window!=='undefined'?window:null,function(){
 'use strict';
 const normalize=role=>String(role||'').trim().toLowerCase();
 // Roles that act on the ADFA office for timetable operational scope. Developer
 // keeps the ADFA office mapping for cross-office testing, but is handled by its
 // own full-authority branch below.
 const adfaRoles=['developer','owner','administrator','admin','adfa_general','adfa_regular'];
 const facultyRoles=['faculty','hicc','visc','editor','viewer'];
 function officeForRole(role){role=normalize(role);return adfaRoles.includes(role)?'adfa':['adc','lab'].includes(role)?role:'';}
 function isOfficeAccount(role){return Boolean(officeForRole(role))||normalize(role)==='other_office';}
 function blank(){
  return{canViewCalendar:false,
   canAddSessions:false,canAddOneSession:false,canSelectSessions:false,
   canEditCourseFields:false,canEditInstructor:false,
   canEditLabTopic:false,canEditLabGroups:false,canEditLabRoster:false,
   canSuggestFaculty:false,
   canReviewAdcScope:false,canReviewLabScope:false,canReviewAdfaScope:false,
   canViewFullApprovalOverview:false,
   canOverride:false};
 }
 function forRole(role){
  role=normalize(role);
  const c=blank();
  c.canViewCalendar=isOfficeAccount(role)||facultyRoles.includes(role);
  if(role==='developer')Object.keys(c).forEach(key=>{c[key]=true});
  else if(adfaRoles.includes(role))Object.assign(c,{
   // Faculty assignment only. No session creation, no general selection and no
   // course / topic / time / room / LAB group editing.
   canEditInstructor:true,
   canReviewAdfaScope:true,
   canViewFullApprovalOverview:true,
   canOverride:role==='owner'||role==='adfa_general'
  });
  else if(role==='adc')Object.assign(c,{
   // Scheduling owner: creates sessions and owns the ADC scheduling fields.
   canAddSessions:true,canAddOneSession:true,canSelectSessions:true,
   canEditCourseFields:true,canSuggestFaculty:true,canReviewAdcScope:true
  });
  else if(role==='lab')Object.assign(c,{
   // Work Queue first: LAB does not get unrestricted session selection.
   canEditLabTopic:true,canEditLabGroups:true,canEditLabRoster:true,
   canSuggestFaculty:true,canReviewLabScope:true
  });
  return Object.freeze(c);
 }
 return Object.freeze({forRole,officeForRole,isOfficeAccount});
});
