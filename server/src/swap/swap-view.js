'use strict';

// Presentation only: SQL owns row scope, route flags, decisions and final apply.
const names=require('../domain/person-name');
const {FIELDS}=require('./swap-domain');
const list=value=>Array.isArray(value)?value:[];
const text=value=>typeof value==='string'?value:'';
const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>value?.[key]!==undefined).map(key=>[key,value[key]]));
const STAGES={target:'Replacement consent',visc:'VISC review',adc:'ADC / DVM review',lab:'LAB review',adfa:'ADFA final approval'};
function person(value){
  const record=typeof value==='string'?{displayName:value}:pick(value,['firstName','lastName','displayName']);
  if(Object.values(record).some(part=>typeof part==='string'&&part.includes('@')))return 'PAWS user';
  return names.format(record)||'Not provided';
}
function personList(value){return text(value).split(/([;\r\n]+)/).map(part=>/^[;\r\n]+$/.test(part)?part:person(part)).join('');}
function publicRequest(row={}){
  const out=pick(row,['requestId','sessionId','assignmentId','snapshotToken','revision','status','nextStage','courseCode','date','academicYear','topic','createdAtUtc','updatedAtUtc']);
  out.changes=pick(row.changes,FIELDS);out.note=text(row.note);out.notifyReplacement=row.notifyReplacement===true;
  out.isMine=row.isMine===true;out.requesterName=person(row.requester||row.requesterName);
  out.replacementDisplayName=row.replacement||row.replacementDisplayName?person(row.replacement||row.replacementDisplayName):null;
  if(row.original){
    out.original=pick(row.original,['courseCode','date','startTime','endTime','sessionType','topic','room']);
    out.original.assignmentDisplayName=row.original.assignment?person(row.original.assignment):personList(row.original.assignmentDisplayName)||'Not provided';
  }
  return out;
}
function historyRows(rows){return list(rows).map(row=>({...pick(row,['revision','stage','decision','createdAtUtc']),comment:text(row.comment),overrideReason:text(row.overrideReason),actorName:person(row.actor||row.actorName)}));}
function workflow(request={},history=[]){
  const route=request.routing;
  if(!route||!['needsAdc','needsLab','needsVisc','notifyReplacement'].every(key=>typeof route[key]==='boolean'))return {available:false,complete:false,stages:[],reason:'Detailed approval routing is not supplied by this API. Existing request permissions still apply.'};
  const keys=[...(route.notifyReplacement?['target']:[]),...(route.needsVisc?['visc']:[]),...(route.needsAdc?['adc']:[]),...(route.needsLab?['lab']:[]),'adfa'];
  const current=list(history).filter(row=>row.revision===request.revision);
  const override=request.status==='applied'?current.find(row=>row.decision==='approve'&&row.stage!=='target'&&keys.includes(row.stage)&&text(row.overrideReason).trim()):null;
  const overrideIndex=override?keys.indexOf(override.stage):-1;
  const stages=keys.map((key,index)=>{
    const decision=current.filter(row=>row.stage===key).at(-1);
    const status=decision?.decision==='approve'?'approved':decision?.decision==='reject'?'rejected':decision?.decision==='push_back'?'changes_requested':overrideIndex>=0&&index>overrideIndex?'bypassed':request.status==='pending'&&request.nextStage===key?'current':['rejected','withdrawn'].includes(request.status)?'cancelled':'waiting';
    return {key,label:STAGES[key],status,...(decision?{actorName:decision.actorName,decidedAtUtc:decision.createdAtUtc,comment:decision.comment}: {})};
  });
  const index=keys.indexOf(request.nextStage);
  const consistent=request.status==='pending'?index>=0&&stages.every((row,i)=>row.status===(i<index?'approved':i===index?'current':'waiting')):request.status==='applied'?stages.every((row,i)=>row.status==='approved'||overrideIndex>=0&&i>overrideIndex&&row.status==='bypassed'):['changes_requested','rejected','withdrawn'].includes(request.status);
  return {available:true,policy:'session-swap-v1',stages,currentStage:request.nextStage||null,finalStage:'adfa',complete:request.status==='applied'&&consistent,appliedByOverride:Boolean(override)&&consistent,verified:consistent};
}
function capabilities(value={}){
  return {canRevise:value.canRevise===true,canWithdraw:value.canWithdraw===true,canDecide:value.canDecide===true,canOverride:value.canOverride===true,requiresOverride:value.requiresOverride===true,decisions:list(value.decisions).filter(key=>['approve','reject','push_back'].includes(key)),editableFields:list(value.editableFields).filter(key=>FIELDS.includes(key))};
}
function detail(body={}){
  const history=historyRows(body.history);
  return {request:publicRequest(body.request),capabilities:capabilities(body.capabilities),workflow:workflow(body.request,history),history,
    revisions:list(body.revisions).map(row=>({...pick(row,['revision','createdAtUtc']),actorName:person(row.actor||row.actorName)})),
    notifications:list(body.notifications).map(row=>pick(row,['revision','status']))};
}
function queue(body={}){
  return {requests:list(body.requests).map(row=>({...publicRequest(row),canDecide:row.canDecide===true,requiresOverride:row.requiresOverride===true})),notifications:list(body.notifications).map(row=>pick(row,['requestId','revision','status']))};
}
module.exports={detail,queue};
