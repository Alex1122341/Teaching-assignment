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
 const adfaRoles=['developer','owner','administrator','admin','adfa_general','adfa_regular'];
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
 function normalizeOfficeAccess(value){
  return[...new Set((Array.isArray(value)?value:[]).map(normalize).filter(name=>OFFICES.includes(name)))];
 }
 function officesForProfile(profileOrRole){
  const role=roleOf(profileOrRole);
  if(role==='developer')return OFFICES.slice();
  if(profileOrRole&&typeof profileOrRole==='object'&&Array.isArray(profileOrRole.officeAccess)){
   if(!configurableRoles.includes(role))return[];
   return normalizeOfficeAccess(profileOrRole.officeAccess);
  }
  return defaultOfficeAccess(role);
 }
 function hasOfficeAccess(profileOrRole,office){return officesForProfile(profileOrRole).includes(normalize(office));}
 function officeForRole(role){return defaultOfficeAccess(role)[0]||'';}
 function isOfficeAccount(profileOrRole){return officesForProfile(profileOrRole).length>0||roleOf(profileOrRole)==='other_office';}
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
  // System-level overview and override authority stay tied to the primary role,
  // never to an office checkbox.
  if(['owner','administrator','admin','adfa_general','adfa_regular'].includes(role))c.canViewFullApprovalOverview=true;
  if(role==='owner'||role==='adfa_general')c.canOverride=true;
  return Object.freeze(c);
 }
 function forRole(role){return forProfile({role});}
 return Object.freeze({OFFICES,forRole,forProfile,defaultOfficeAccess,normalizeOfficeAccess,officesForProfile,hasOfficeAccess,officeForRole,isOfficeAccount});
});
