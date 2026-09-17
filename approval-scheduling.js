(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.UCVM_APPROVAL_SCHEDULING=api;
})(typeof window!=='undefined'?window:null,function(){
 'use strict';
 const text=value=>String(value??'');
 const requiresOverride=check=>check?.status==='conflict';
 function overrideAudit(actor={},conflicts=[]){
  return{
   type:'faculty_time_conflict',
   confirmed:true,
   confirmedBy:text(actor.uid),
   confirmedByName:text(actor.name),
   conflicts:(Array.isArray(conflicts)?conflicts:[]).map(session=>({
    id:text(session?.id),course:text(session?.course),date:text(session?.date).slice(0,10),start:text(session?.start),end:text(session?.end)
   }))
  };
 }
 return{requiresOverride,overrideAudit};
});
