/* Allowlisted calendar read model. Never spread source or assignment objects here. */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.UCVM_CALENDAR_SESSION=api;
})(typeof window!=='undefined'?window:null,function(){
 'use strict';
 const text=value=>typeof value==='string'?value:typeof value==='number'&&Number.isFinite(value)?String(value):'';
 const numeric=value=>value===null||value===undefined||value===''?null:Number.isFinite(Number(value))?Number(value):null;
 function fromSource(source={},id=''){
  // Rules anchor this field to the source's public instructor string. A stale/missing
  // display string must be corrected at its writer, not reconstructed from private data.
  const instructor=text(source.instructor),instructorNames=[...new Set(instructor.split(';').map(name=>name.trim()).filter(Boolean))];
  return{
   sessionId:text(id||source.id),course:text(source.course),courseName:text(source.courseName),year:numeric(source.year),
   semester:text(source.semester),week:numeric(source.week),date:text(source.date).slice(0,10),
   start:text(source.start),end:text(source.end),timeUnknown:source.timeUnknown===true,
   type:text(source.type),topic:text(source.topic),room:text(source.room),instructorNames,instructor
  };
 }
 return Object.freeze({fromSource});
});
