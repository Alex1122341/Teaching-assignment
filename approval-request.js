'use strict';
window.UCVM_APPROVAL_REQUEST=(()=>{
  const routing=window.UCVM_APPROVAL_ROUTING;
  if(!routing)throw Error('UCVM approval routing is required.');
  const PUBLIC_FIELDS=['course','courseName','year','semester','week','date','start','end','timeUnknown','type','topic','room','instructor'];
  const own=(object,key)=>Object.prototype.hasOwnProperty.call(object||{},key);
  const text=value=>String(value??'').trim();
  const same=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);

  function publicSession(source={}){
    return{
      course:text(source.course),courseName:text(source.courseName),year:Number.isFinite(Number(source.year))?Number(source.year):null,
      semester:text(source.semester),week:Number.isFinite(Number(source.week))?Number(source.week):null,date:text(source.date).slice(0,10),
      start:text(source.start),end:text(source.end),timeUnknown:source.timeUnknown===true,type:text(source.type),topic:text(source.topic),room:text(source.room),
      instructor:text(source.instructor)
    };
  }

  function publicPatch(patch={}){
    const output={};
    for(const field of PUBLIC_FIELDS){
      if(!own(patch,field))continue;
      if(field==='year'||field==='week')output[field]=Number.isFinite(Number(patch[field]))?Number(patch[field]):null;
      else if(field==='timeUnknown')output[field]=patch[field]===true;
      else if(field==='date')output[field]=text(patch[field]).slice(0,10);
      else output[field]=text(patch[field]);
    }
    return output;
  }

  function privateFacultyRef(ref={}){
    const output={};
    for(const field of ['facultyId','candidateKey','kind'])if(text(ref[field]))output[field]=text(ref[field]);
    return output;
  }

  function opaqueFacultySignature(value){
    const input=text(value),encoder=typeof TextEncoder!=='undefined'?new TextEncoder():null;
    const bytes=encoder?encoder.encode(input):Array.from(input,ch=>ch.charCodeAt(0)&255);
    let hash=0xcbf29ce484222325n;
    for(const byte of bytes){hash^=BigInt(byte);hash=BigInt.asUintN(64,hash*0x100000001b3n);}
    return `faculty-v1:${hash.toString(16).padStart(16,'0')}`;
  }

  function facultyScopeSignature(displayName=''){return opaqueFacultySignature(`display:${text(displayName).toLowerCase()}`);}

  function facultyEditFromChoice(choice='',entries=[]){
    const selected=text(choice);
    if(selected.startsWith('special:')){
      const kind=selected.slice('special:'.length).toLowerCase();
      if(!['sessional','other'].includes(kind))throw Error('Choose a valid Faculty replacement.');
      const displayName=kind==='sessional'?'Sessional':'Other';
      return{displayName,privateTarget:{kind},scopeSignature:facultyScopeSignature(displayName)};
    }
    if(!selected.startsWith('candidate:'))throw Error('Choose a Faculty replacement.');
    const candidateKey=selected.slice('candidate:'.length),candidate=(entries||[]).find(row=>text(row?.key)===candidateKey);
    if(!candidate||!text(candidate.name))throw Error('The selected Faculty replacement is no longer available.');
    const displayName=text(candidate.name);return{displayName,privateTarget:{candidateKey},scopeSignature:facultyScopeSignature(displayName)};
  }

  function changesFor(base,patch){
    return Object.keys(patch).filter(field=>!same(base?.[field],patch[field])).sort().map(field=>({field,before:base?.[field]??null,after:patch[field]}));
  }

  function buildRecords({requestId='',requester={},payload={},now=null}={}){
    const id=text(requestId);
    if(!id)throw Error('Request id is required.');
    const requestType=text(payload.requestType);
    if(!['session_edit','faculty_swap'].includes(requestType))throw Error('Unsupported request type.');
    const basePublic=publicSession(payload.base||{});
    let patchPublic=publicPatch(payload.patch||{}),routeBase=basePublic,routePatch=patchPublic;
    let currentFacultyName='',proposedFacultyName='',privateRecord=null;
    if(requestType==='faculty_swap'){
      currentFacultyName=text(payload.fromFaculty?.name)||text(basePublic.instructor).split(';')[Number(payload.assignmentIndex)||0]?.trim()||'';
      proposedFacultyName=text(payload.toFaculty?.name);
      patchPublic={...patchPublic,instructor:proposedFacultyName};
      routeBase={...basePublic,assignments:[]};
      routePatch={...patchPublic,assignments:[{name:proposedFacultyName}]};
      privateRecord={
        requestId:id,requesterUid:text(requester.uid),revision:1,
        assignmentChange:{assignmentIndex:Number.isInteger(Number(payload.assignmentIndex))?Number(payload.assignmentIndex):0,from:privateFacultyRef(payload.fromFaculty),to:privateFacultyRef(payload.toFaculty)},
        updatedAt:now
      };
    }
    const plan=routing.build({base:routeBase,patch:routePatch});
    if(requestType==='faculty_swap')plan.scopeSignatures.adfa=facultyScopeSignature(proposedFacultyName);
    const publicRecord={
      requestSchema:'office-routing-v1',requesterUid:text(requester.uid),requesterName:text(requester.name),requesterRole:text(requester.role),
      sessionId:text(payload.sessionId),requestType,scope:text(payload.scope),groupId:text(payload.groupId),groupName:text(payload.groupName),status:'pending',revision:1,
      basePublic,patchPublic,currentFacultyName,proposedFacultyName,
      editableFields:[],requesterMessage:'',reason:text(payload.reason),
      course:basePublic.course,date:basePublic.date,topic:basePublic.topic,requestedAt:now,updatedAt:now
    };
    const workflow={
      requestId:id,revision:1,requiredOffices:[...plan.requiredOffices],hasFacultyChange:plan.hasFacultyChange,finalType:plan.finalType,
      scopes:{adc:[...plan.scopes.adc],lab:[...plan.scopes.lab],adfa:[...plan.scopes.adfa]},
      scopeSignatures:{...plan.scopeSignatures},updatedAt:now
    };
    const approvals=plan.requiredOffices.map(office=>({
      id:`${id}_${office}`,requestId:id,office,revision:1,fields:[...plan.scopes[office]],scopeSignature:plan.scopeSignatures[office],
      status:'pending',decidedBy:'',decidedByName:'',decidedAt:null,pushBackReason:'',updatedAt:now
    }));
    return{publicRecord,workflow,approvals,privateRecord};
  }


  async function submit({db,requester={},payload={},now=null}={}){
    if(!db?.collection||!db?.batch)throw Error('Firestore is required.');
    const requestRef=db.collection('change_requests').doc();
    const records=buildRecords({requestId:requestRef.id,requester,payload,now});
    const batch=db.batch();
    batch.set(requestRef,records.publicRecord);
    batch.set(db.collection('change_request_workflow').doc(requestRef.id),records.workflow);
    for(const approval of records.approvals)batch.set(db.collection('change_request_approvals').doc(approval.id),approval);
    if(records.privateRecord)batch.set(db.collection('change_request_private').doc(requestRef.id),records.privateRecord);
    batch.set(db.collection('change_request_audit').doc(),{requestId:requestRef.id,event:'request_submitted',revision:1,status:'pending',changedBy:text(requester.uid),changedByName:text(requester.name),changedAt:now});
    const notifications=window.UCVM_WORKFLOW_NOTIFICATIONS;
    if(notifications)for(const office of records.workflow.requiredOffices)notifications.emitBatch(batch,db,{kind:'request_assigned',office,request:{id:requestRef.id,...records.publicRecord},session:{id:records.publicRecord.sessionId,...records.publicRecord.basePublic,...records.publicRecord.patchPublic}},now);
    await batch.commit();
    return requestRef.id;
  }

  return{PUBLIC_FIELDS,publicSession,publicPatch,facultyScopeSignature,facultyEditFromChoice,buildRecords,submit};
})();
