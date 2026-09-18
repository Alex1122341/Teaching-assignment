'use strict';
window.UCVM_APPROVAL_LIFECYCLE=(()=>{
  const state=window.UCVM_APPROVAL_STATE,routing=window.UCVM_APPROVAL_ROUTING,scheduling=window.UCVM_SCHEDULING;
  if(!state||!routing||!scheduling)throw Error('UCVM approval state, routing, and scheduling core are required.');
  const text=value=>String(value??'').trim();
  const copy=value=>value&&typeof value==='object'?JSON.parse(JSON.stringify(value)):value;
  const approvalStatus=value=>typeof value==='string'?value:text(value?.status||'pending');
  const unfinished=status=>['pending','push_back'].includes(status);
  const normalizeMessage=message=>text(message).slice(0,1000);
  function assertTimingPatch(base,patch){
    const check=scheduling.validateSessionTimingChange(base,patch);
    if(check.status==='invalid')throw Error(`Invalid session timing (${check.reason}).`);
    return check;
  }

  function requiredApproved(workflow={},approvals={}){
    return (workflow.requiredOffices||[]).every(office=>{
      const row=approvals[office];
      if(approvalStatus(row)!=='approved')return false;
      if(!row||typeof row==='string')return false;
      return JSON.stringify(row.fields||[])===JSON.stringify(workflow?.scopes?.[office]||[])&&text(row.scopeSignature)===text(workflow?.scopeSignatures?.[office]);
    });
  }

  function planDecision({request={},workflow={},approvals={},office='',decision='',message='',actor={},now=null}={}){
    office=text(office);decision=text(decision);
    if(!(workflow.requiredOffices||[]).includes(office))throw Error('This office is not required for the request.');
    const reason=normalizeMessage(message);
    if(decision==='push_back'&&!reason)throw Error('Push Back requires a message.');
    const current={...request,approvals:copy(approvals)};
    const next=state.decide(current,{office,decision,fields:workflow?.scopes?.[office]||[]});
    const publicPatch={status:next.status||request.status||'pending',updatedAt:now};
    if(decision==='push_back')Object.assign(publicPatch,{status:'update_required',editableFields:[...(next.editableFields||[])],requesterMessage:reason});
    if(decision==='reject')Object.assign(publicPatch,{status:'rejected',editableFields:[],requesterMessage:reason});
    const approvalPatches={};
    for(const key of workflow.requiredOffices||[]){
      const before=approvalStatus(approvals[key]),after=approvalStatus(next.approvals?.[key]);
      if(before===after)continue;
      const patch={status:after,updatedAt:now};
      if(key===office){Object.assign(patch,{decidedBy:text(actor.uid),decidedByName:text(actor.name),decidedAt:now,pushBackReason:decision==='push_back'?reason:''});}
      approvalPatches[key]=patch;
    }
    const merged={...approvals};
    for(const [key,patch] of Object.entries(approvalPatches))merged[key]={...(approvals[key]||{}),...patch};
    return{
      publicPatch,approvalPatches,allRequiredApproved:requiredApproved(workflow,merged),
      audit:{requestId:text(request.id||workflow.requestId),event:`office_${decision}`,office,revision:Number(request.revision||workflow.revision)||1,message:reason,changedBy:text(actor.uid),changedByName:text(actor.name),changedAt:now}
    };
  }

  function planWithdrawal({request={},approvals={},actor={},now=null}={}){
    state.withdraw(request);
    const approvalPatches={};
    for(const [office,row] of Object.entries(approvals||{}))if(unfinished(approvalStatus(row)))approvalPatches[office]={status:'cancelled',updatedAt:now};
    return{
      publicPatch:{status:'withdrawn',editableFields:[],requesterMessage:'',withdrawnBy:text(actor.uid),withdrawnAt:now,updatedAt:now},
      approvalPatches,
      audit:{requestId:text(request.id),event:'request_withdrawn',revision:Number(request.revision)||1,changedBy:text(actor.uid),changedByName:text(actor.name),changedAt:now}
    };
  }

  function planResubmission({request={},workflow={},approvals={},publicEdits={},facultyEdit={},hasAssignedFaculty=false,now=null}={}){
    if(request.status!=='update_required')throw Error('Only an update-required request can be resubmitted.');
    const editable=new Set(request.editableFields||[]),edits={};
    for(const [field,value] of Object.entries(publicEdits||{})){
      if(!editable.has(field))throw Error(`Field ${field} is not editable in this revision.`);
      edits[field]=value;
    }
    const facultyReturned=editable.has('assignments')||editable.has('instructor');
    const facultyDisplayName=text(facultyEdit?.displayName);
    const hasFacultyEdit=facultyReturned&&Boolean(facultyDisplayName);
    if(!Object.keys(edits).length&&!hasFacultyEdit)throw Error('Enter at least one returned-field change.');
    const patchPublic={...(request.patchPublic||{}),...edits};
    if(hasFacultyEdit)patchPublic.instructor=facultyDisplayName;
    assertTimingPatch(request.basePublic||{},patchPublic);
    const route=routing.build({base:request.basePublic||{},patch:patchPublic});
    if(workflow.hasFacultyChange){
      route.scopes.adfa=[...(workflow.scopes?.adfa||[])];
      route.scopeSignatures.adfa=hasFacultyEdit?text(facultyEdit.scopeSignature):(workflow.scopeSignatures?.adfa||approvals.adfa?.scopeSignature||'');
      if(hasFacultyEdit&&!route.scopeSignatures.adfa)throw Error('Faculty replacement revision requires a private scope signature.');
      route.hasFacultyChange=true;
      if(route.scopes.adfa.length&&!route.requiredOffices.includes('adfa'))route.requiredOffices.push('adfa');
    }else if((workflow.requiredOffices||[]).includes('adfa')&&approvals.adfa){
      // A prior ADFA review may exist for schedule-dependent assignment validity even without an assignment patch.
      if(!route.requiredOffices.includes('adfa'))route.requiredOffices.push('adfa');
      route.scopes.adfa=[...(workflow.scopes?.adfa||[])];
      route.scopeSignatures.adfa=workflow.scopeSignatures?.adfa||approvals.adfa.scopeSignature||'';
    }
    const order={adc:0,lab:1,adfa:2};route.requiredOffices.sort((a,b)=>(order[a]??9)-(order[b]??9));
    const changedFields=Object.keys(edits).filter(field=>JSON.stringify(request.patchPublic?.[field]??null)!==JSON.stringify(edits[field]??null));
    if(hasFacultyEdit){
      if(!changedFields.includes('assignments'))changedFields.push('assignments');
      if(JSON.stringify(request.patchPublic?.instructor??null)!==JSON.stringify(facultyDisplayName)&&!changedFields.includes('instructor'))changedFields.push('instructor');
    }
    const revisionPlan=state.planRevision({
      status:request.status,revision:request.revision,requiredOffices:route.requiredOffices,approvals,
      oldSignatures:workflow.scopeSignatures||{},newSignatures:route.scopeSignatures,changedFields,hasAssignedFaculty
    });
    const nextApprovals={};
    for(const office of route.requiredOffices){
      const previous=approvals[office]||{};
      const planned=revisionPlan.approvals[office]||{};
      nextApprovals[office]={...previous,requestId:text(request.id||workflow.requestId),office,revision:revisionPlan.revision,fields:[...(route.scopes[office]||[])],scopeSignature:route.scopeSignatures[office]||'',status:planned.status||'pending',decidedBy:planned.status==='approved'?text(previous.decidedBy):'',decidedByName:planned.status==='approved'?text(previous.decidedByName):'',decidedAt:planned.status==='approved'?(previous.decidedAt??null):null,pushBackReason:'',updatedAt:now};
    }
    return{
      publicPatch:{patchPublic,...(hasFacultyEdit?{proposedFacultyName:facultyDisplayName}:{}),status:'pending',revision:revisionPlan.revision,editableFields:[],requesterMessage:'',updatedAt:now},
      workflow:{...workflow,revision:revisionPlan.revision,requiredOffices:[...route.requiredOffices],hasFacultyChange:route.hasFacultyChange,finalType:route.finalType,scopes:copy(route.scopes),scopeSignatures:copy(route.scopeSignatures),updatedAt:now},
      approvals:nextApprovals,
      audit:{requestId:text(request.id||workflow.requestId),event:'request_resubmitted',revision:revisionPlan.revision,changedFields,changedAt:now}
    };
  }

  function routedPublicPlan(request={},patchPublic={},facultyScopeSignature=''){
    const route=routing.build({base:request.basePublic||{},patch:patchPublic||{}});
    if(request.requestType==='faculty_swap'){
      route.scopes.adfa=['assignments','instructor'];
      route.scopeSignatures.adfa=text(facultyScopeSignature);
      route.hasFacultyChange=true;
      if(!route.requiredOffices.includes('adfa'))route.requiredOffices.push('adfa');
      const order={adc:0,lab:1,adfa:2};route.requiredOffices.sort((a,b)=>(order[a]??9)-(order[b]??9));
    }
    return route;
  }

  function planRequesterWithdrawal({request={},actor={},now=null}={}){
    state.withdraw(request);
    const route=routedPublicPlan(request,request.patchPublic||{},'');
    return{
      publicPatch:{status:'withdrawn',editableFields:[],requesterMessage:'',withdrawnBy:text(actor.uid),withdrawnAt:now,updatedAt:now},
      cancelOffices:[...(route.requiredOffices||[])],
      audit:{requestId:text(request.id),event:'request_withdrawn',revision:Number(request.revision)||1,changedBy:text(actor.uid),changedByName:text(actor.name),changedAt:now}
    };
  }

  function planRequesterResubmission({request={},publicEdits={},facultyEdit={},facultyScopeSignature='',reason=undefined,now=null}={}){
    if(request.status!=='update_required')throw Error('Only an update-required request can be resubmitted.');
    const editable=new Set(request.editableFields||[]),edits={};
    for(const [field,value] of Object.entries(publicEdits||{})){
      if(!editable.has(field))throw Error(`Field ${field} is not editable in this revision.`);
      edits[field]=value;
    }
    const facultyReturned=editable.has('assignments')||editable.has('instructor');
    const facultyDisplayName=text(facultyEdit?.displayName);
    const hasFacultyEdit=facultyReturned&&Boolean(facultyDisplayName);
    if(!Object.keys(edits).length&&!hasFacultyEdit)throw Error('Enter at least one returned-field change.');
    const oldPatch={...(request.patchPublic||{})},nextPatch={...oldPatch,...edits};
    if(hasFacultyEdit)nextPatch.instructor=facultyDisplayName;
    assertTimingPatch(request.basePublic||{},nextPatch);
    const oldRoute=routedPublicPlan(request,oldPatch,facultyScopeSignature);
    const nextFacultySignature=hasFacultyEdit?text(facultyEdit.scopeSignature):text(facultyScopeSignature);
    if(request.requestType==='faculty_swap'&&!nextFacultySignature)throw Error('Faculty replacement revision requires a safe scope signature.');
    const nextRoute=routedPublicPlan(request,nextPatch,nextFacultySignature);
    const returnedOffices=new Set();
    for(const office of oldRoute.requiredOffices||[]){
      const fields=oldRoute.scopes?.[office]||[];
      if(fields.some(field=>editable.has(field))||(office==='adfa'&&facultyReturned))returnedOffices.add(office);
    }
    const changedFields=Object.keys(edits).filter(field=>JSON.stringify(oldPatch?.[field]??null)!==JSON.stringify(edits[field]??null));
    if(hasFacultyEdit){changedFields.push('assignments');if(JSON.stringify(oldPatch.instructor??null)!==JSON.stringify(facultyDisplayName))changedFields.push('instructor');}
    const scheduleChanged=['date','start','end'].some(field=>changedFields.includes(field));
    if(scheduleChanged&&nextRoute.hasFacultyChange)returnedOffices.add('adfa');
    const approvalWrites={};
    const newOffices=new Set((nextRoute.requiredOffices||[]).filter(office=>!(oldRoute.requiredOffices||[]).includes(office)));
    for(const office of nextRoute.requiredOffices||[]){
      if(!returnedOffices.has(office)&&!newOffices.has(office))continue;
      approvalWrites[office]={id:`${text(request.id)}_${office}`,requestId:text(request.id),office,revision:Number(request.revision||0)+1,fields:[...(nextRoute.scopes?.[office]||[])],scopeSignature:nextRoute.scopeSignatures?.[office]||'',status:'pending',decidedBy:'',decidedByName:'',decidedAt:null,pushBackReason:'',updatedAt:now};
    }
    const cancelOffices=(oldRoute.requiredOffices||[]).filter(office=>!(nextRoute.requiredOffices||[]).includes(office));
    const revision=Number(request.revision||0)+1;
    return{
      publicPatch:{patchPublic:nextPatch,...(hasFacultyEdit?{proposedFacultyName:facultyDisplayName,...(reason===undefined?{}:{reason:normalizeMessage(reason)})}:{}),status:'pending',revision,editableFields:[],requesterMessage:'',updatedAt:now},
      workflow:{requestId:text(request.id),revision,requiredOffices:[...(nextRoute.requiredOffices||[])],hasFacultyChange:nextRoute.hasFacultyChange,finalType:nextRoute.finalType,scopes:copy(nextRoute.scopes),scopeSignatures:copy(nextRoute.scopeSignatures),updatedAt:now},
      approvalWrites,cancelOffices,
      audit:{requestId:text(request.id),event:'request_resubmitted',revision,changedFields:[...new Set(changedFields)],changedAt:now}
    };
  }

  return{requiredApproved,planDecision,planWithdrawal,planResubmission,planRequesterWithdrawal,planRequesterResubmission};
})();
