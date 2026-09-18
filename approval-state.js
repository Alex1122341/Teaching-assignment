'use strict';
window.UCVM_APPROVAL_STATE=(()=>{
  const copyApprovals=input=>Object.fromEntries(Object.entries(input||{}).map(([office,value])=>[office,typeof value==='string'?value:{...(value||{})}]));
  const uniqueSorted=values=>[...new Set(values||[])].sort();

  function decide(current={},action={}){
    if(!['pending','update_required'].includes(current.status))throw Error('This request is not open for office decisions.');
    const approvals=copyApprovals(current.approvals);
    const office=String(action.office||'');
    if(!office||!(office in approvals))throw Error('This office is not required for the request.');
    if(action.decision==='reject'){
      for(const key of Object.keys(approvals)){
        const value=approvals[key];
        const status=typeof value==='string'?value:value.status;
        if(key===office)approvals[key]=typeof value==='string'?'rejected':{...value,status:'rejected'};
        else if(status==='pending'||status==='push_back')approvals[key]=typeof value==='string'?'cancelled':{...value,status:'cancelled'};
      }
      return{...current,status:'rejected',editableFields:[],approvals};
    }
    if(action.decision==='push_back'){
      const fields=uniqueSorted([...(current.editableFields||[]),...(action.fields||[])]);
      if(!fields.length)throw Error('Push Back requires at least one field.');
      const value=approvals[office];
      approvals[office]=typeof value==='string'?'push_back':{...value,status:'push_back'};
      return{...current,status:'update_required',editableFields:fields,approvals};
    }
    if(action.decision==='approve'){
      const value=approvals[office];
      approvals[office]=typeof value==='string'?'approved':{...value,status:'approved'};
      return{...current,approvals};
    }
    throw Error('Unsupported approval decision.');
  }

  function planRevision(input={}){
    if(input.status!=='update_required')throw Error('Only an update-required request can be resubmitted.');
    const required=new Set(input.requiredOffices||[]);
    const changed=new Set(input.changedFields||[]);
    const scheduleChanged=['date','start','end'].some(field=>changed.has(field));
    const approvals={};
    for(const office of required){
      const previous=input.approvals?.[office]||{};
      const oldSignature=input.oldSignatures?.[office]??previous.scopeSignature??'';
      const newSignature=input.newSignatures?.[office]??oldSignature;
      const unchanged=oldSignature===newSignature;
      const wasApproved=previous.status==='approved';
      const forceAdfa=office==='adfa'&&input.hasAssignedFaculty===true&&scheduleChanged;
      approvals[office]={...previous,status:wasApproved&&unchanged&&!forceAdfa?'approved':'pending',scopeSignature:newSignature};
    }
    return{revision:Number(input.revision||0)+1,status:'pending',editableFields:[],approvals};
  }

  function withdraw(current={}){
    if(!['pending','update_required'].includes(current.status))throw Error('This request can no longer be withdrawn.');
    return{...current,status:'withdrawn',editableFields:[]};
  }

  function canFinalize({office='',hasFacultyChange=false,allRequiredApproved=false}={}){
    if(!allRequiredApproved)return false;
    if(hasFacultyChange)return office==='adfa';
    return ['adc','lab','adfa'].includes(office);
  }

  return{decide,planRevision,withdraw,canFinalize};
})();
