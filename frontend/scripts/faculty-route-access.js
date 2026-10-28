(function(root,factory){
 'use strict';const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PAWS_FACULTY_ROUTE_ACCESS=api;
})(typeof window==='undefined'?null:window,function(){
 'use strict';
 // Navigation projection only. Existing route controllers and the API enforce access.
 const aliases=Object.freeze({owner:'adfa_general',administrator:'adfa_regular',admin:'adfa_regular',editor:'faculty',viewer:'faculty'});
 const raw=value=>String(value||'').toLowerCase();
 function canOpenFacultyDashboard(profile){const role=raw(profile?.role);return ['developer','adfa_general','adfa_regular','faculty','hicc','visc'].includes(aliases[role]||role);}
 function canOpenTeachingAssignments(profile){return ['owner','administrator','admin','adfa_general','adfa_regular','hicc','visc','faculty'].includes(raw(profile?.role||profile?.baseRole).trim());}
 return Object.freeze({canOpenFacultyDashboard,canOpenTeachingAssignments});
});
