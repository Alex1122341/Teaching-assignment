'use strict';
window.UCVM_APPROVAL_OFFICE_VIEW=(()=>{
  const text=value=>String(value??'').trim();
  const same=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
  const PUBLIC_FIELDS=['course','courseName','year','semester','week','date','start','end','timeUnknown','type','topic','room','instructor'];
  const status=value=>text(value||'pending').toLowerCase();

  function queueLabel(office,count=0){
    const n=Number(count)||0;
    if(office==='adc')return `ADC Approvals (${n})`;
    if(office==='lab')return `LAB Approvals (${n})`;
    return `Approvals (${n})`;
  }

  function canUsePrivateFacultyContext(office){return office==='adfa';}

  function requestView({office='',request={},workflow={},approvalMatrix={}}={}){
    const base=request.basePublic&&typeof request.basePublic==='object'?request.basePublic:{};
    const patch=request.patchPublic&&typeof request.patchPublic==='object'?request.patchPublic:{};
    const owned=new Set(workflow?.scopes?.[office]||[]);
    const fields=[];
    for(const field of PUBLIC_FIELDS){
      if(!Object.prototype.hasOwnProperty.call(patch,field)||same(base[field],patch[field]))continue;
      fields.push({field,before:base[field]??null,after:patch[field]??null,owned:owned.has(field)});
    }
    const proposedName=text(request.proposedFacultyName)||((fields.find(row=>row.field==='instructor')?.after)||'');
    const currentName=text(request.currentFacultyName)||text(base.instructor);
    return{
      id:text(request.id),requestType:text(request.requestType),status:status(request.status),revision:Number(request.revision)||1,
      sessionId:text(request.sessionId),course:text(base.course||request.course),date:text(base.date||request.date),topic:text(base.topic||request.topic),
      fields,
      faculty:{currentName,proposedName,adfaStatus:status(approvalMatrix.adfa)},
      canUsePrivateFacultyContext:canUsePrivateFacultyContext(office)
    };
  }

  return{queueLabel,requestView,canUsePrivateFacultyContext};
})();
