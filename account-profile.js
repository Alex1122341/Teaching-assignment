/* Testable account form policy; never stores credentials or creates a primary Auth session. */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.UCVM_ACCOUNT_PROFILE=api;
})(typeof window!=='undefined'?window:null,function(){
 'use strict';
 const text=value=>String(value??'').trim();
 const facultyFacingRole=role=>['faculty','hicc','visc'].includes(role);
 const rolesAllowed=['faculty','hicc','visc','adc','lab','other_office','administrator','owner','developer'];
 const officeRoles=['adc','lab','administrator','owner','developer'];
 const normalizeOfficeAccess=value=>[...new Set((Array.isArray(value)?value:[]).map(item=>text(item).toLowerCase()).filter(item=>['adc','lab','adfa'].includes(item)))];
 const defaultOfficeAccess=role=>role==='developer'?['adc','lab','adfa']:role==='adc'?['adc']:role==='lab'?['lab']:['administrator','owner'].includes(role)?['adfa']:[];
 function officeAccessFor({role,current=null,officeAccess}={}){
  if(role==='developer')return['adc','lab','adfa'];
  if(!officeRoles.includes(role))return null;
  if(Array.isArray(officeAccess))return normalizeOfficeAccess(officeAccess);
  if(current&&Array.isArray(current.officeAccess))return normalizeOfficeAccess(current.officeAccess);
  return defaultOfficeAccess(role);
 }
 function build({role,faculty=null,roles=[],current=null,office={},officeAccess,active=false,mustChangePassword=true}={}){
  if(!rolesAllowed.includes(role))throw Error('Choose a valid account role.');
  const profile={};
  if(facultyFacingRole(role)){
   profile.facultyId=text(faculty?.id||faculty?.__id||faculty?.ucid||current?.facultyId);
   if(!profile.facultyId)throw Error('Choose a faculty record for a faculty-facing role.');
   profile.name=text(faculty?.preferredFullName||faculty?.name||faculty?.hrFullName||current?.name);
   profile.email=text(faculty?.email||current?.email).toLowerCase();
   profile.facultyRoles=[...new Set([role,...roles.filter(facultyFacingRole)])];
  }else{
   profile.name=text(office.name);profile.email=text(office.email).toLowerCase();
  }
  if(!profile.name||profile.name.length>120)throw Error('Enter an account display name with 1 to 120 characters.');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email))throw Error('Enter a valid account email.');
  Object.assign(profile,{role,active:active===true,mustChangePassword:current?mustChangePassword===true:true});
  const access=officeAccessFor({role,current,officeAccess});if(access!==null)profile.officeAccess=access;
  return profile;
 }
 function existingUid(value){
  const uid=text(value);
  if(uid&&(uid.length>128||/[\s/]/.test(uid)))throw Error('The existing Authentication UID must be at most 128 characters with no spaces or slashes.');
  return uid;
 }
 async function resolveNewUid({existingUid:value='',email,password='',readProfile,createAuthenticationUser}){
  const uid=existingUid(value);
  if(uid){
   if(typeof readProfile!=='function')throw Error('A live profile check is required before linking an existing UID.');
   const snapshot=await readProfile(uid);
   if(!snapshot||typeof snapshot.exists!=='boolean')throw Error('Could not verify whether this UID already has a profile.');
   if(snapshot?.exists)throw Error('This UID already has a user profile. Use Edit on that account instead.');
   return uid;
  }
  if(typeof password!=='string'||password.length<8)throw Error('Enter a temporary password with at least 8 characters.');
  return createAuthenticationUser(email,password);
 }
 return Object.freeze({facultyFacingRole,normalizeOfficeAccess,defaultOfficeAccess,officeAccessFor,build,existingUid,resolveNewUid});
});
