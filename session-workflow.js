/* Canonical session workflow scope definition.
 *
 * This is the single source of truth for "what required work is still missing on
 * a session, and which office owns it". The Work Queue, Select Sessions field
 * locking and the approval stage order must all consume this module instead of
 * re-deriving their own rules.
 *
 * Pure logic only: no DOM, no Firebase. Safe to load in Node for tests.
 *
 * Stage order is fixed: ADC -> LAB -> ADFA. Stages never run in parallel.
 */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.UCVM_SESSION_WORKFLOW=api;
})(typeof window!=='undefined'?window:null,function(){
 'use strict';

 const STAGES=['adc','lab','adfa'];
 const ORDER={adc:0,lab:1,adfa:2};
 const STAGE_LABEL={adc:'ADC',lab:'LAB',adfa:'ADFA'};

 // Session types that have a spec-defined workflow scope.
 const SCOPED_TYPES=['LEC','SRL','LAB'];

 const text=value=>String(value??'').trim();
 const sessionType=session=>text(session?.type).toUpperCase();
 const isScopedType=type=>SCOPED_TYPES.includes(text(type).toUpperCase());

 const present=(session,key)=>{
  const value=session?.[key];
  if(value===null||value===undefined)return false;
  if(typeof value==='string')return value.trim().length>0;
  if(typeof value==='number')return Number.isFinite(value);
  if(Array.isArray(value))return value.length>0;
  return true;
 };
 const hasTopic=session=>{
  const value=text(session?.topic),normalized=value.toLowerCase().replace(/[^a-z0-9]+/g,'');
  return Boolean(value)&&normalized!=='tbd'&&normalized!=='tobedetermined';
 };
 const hasDate=session=>/^\d{4}-\d{2}-\d{2}$/.test(text(session?.date).slice(0,10));
 const hasAssignments=session=>Array.isArray(session?.assignments)&&session.assignments.some(row=>text(row?.facultyId||row?.ucid));
 const groupIds=session=>[...new Set((Array.isArray(session?.labGroupIds)?session.labGroupIds:[]).map(text).filter(Boolean))];
 const suggestionFor=(context,office)=>Array.isArray(context?.suggestions?.[office])&&context.suggestions[office].length>0;
 const rosterIds=(context,groupId)=>Array.isArray(context?.rosters?.[groupId]?.studentIds)?context.rosters[groupId].studentIds.filter(id=>text(id)):[];
 const hasEveryRoster=(session,context)=>{
  const ids=groupIds(session);
  if(!ids.length)return false;
  const groups=new Map((context?.labGroups||[]).map(group=>[text(group?.groupId),group]));
  return ids.every(groupId=>{
   const group=groups.get(groupId),privateRoster=context?.rosters?.[groupId];
   if(group&&(group.active===false||(text(group.course)&&text(group.course)!==text(session?.course))))return false;
   if(privateRoster){
    const complete=rosterIds(context,groupId).length>0;
    return complete&&(!group||group.rosterComplete===true);
   }
   return group?.active===true&&group.rosterComplete===true;
  });
 };

 const field=(stage,key,label,required,complete)=>({stage,key,label,required,owner:stage,complete});

 /* Canonical scope definition for a session type. */
 function definitionForSession(session){
  const type=sessionType(session);
  if(type==='LEC'||type==='SRL'){
   return Object.freeze({
    type,
    scoped:true,
    stages:Object.freeze({
     adc:Object.freeze({applicable:true,fields:Object.freeze([
      field('adc','date','Date',true,hasDate),
      field('adc','year','Year',true,s=>present(s,'year')),
      field('adc','course','Course',true,s=>present(s,'course')),
      field('adc','type','Type',true,s=>sessionType(s)===type),
      field('adc','start','Start',true,s=>present(s,'start')),
      field('adc','end','End',true,s=>present(s,'end')),
      field('adc','topic','Topic',true,hasTopic),
      field('adc','room','Room',true,s=>present(s,'room')),
      field('adc','facultySuggestion','Faculty suggestion',false,(s,c)=>suggestionFor(c,'adc'))
     ])}),
     lab:Object.freeze({applicable:false,fields:Object.freeze([])}),
     adfa:Object.freeze({applicable:true,fields:Object.freeze([
      field('adfa','assignments','Faculty assignment',true,hasAssignments)
     ])})
    })
   });
  }
  if(type==='LAB'){
   return Object.freeze({
    type,
    scoped:true,
    stages:Object.freeze({
     adc:Object.freeze({applicable:true,fields:Object.freeze([
      field('adc','date','Date',true,hasDate),
      field('adc','year','Year',true,s=>present(s,'year')),
      field('adc','course','Course',true,s=>present(s,'course')),
      field('adc','type','Type',true,s=>sessionType(s)==='LAB'),
      field('adc','start','Start',true,s=>present(s,'start')),
      field('adc','end','End',true,s=>present(s,'end')),
      field('adc','facultySuggestion','Faculty suggestion',false,(s,c)=>suggestionFor(c,'adc'))
     ])}),
     lab:Object.freeze({applicable:true,fields:Object.freeze([
      field('lab','topic','Topic',true,hasTopic),
      field('lab','labGroups','LAB group',true,s=>groupIds(s).length>0),
      field('lab','labRoster','Group roster',true,hasEveryRoster),
      field('lab','facultySuggestion','Faculty suggestion',false,(s,c)=>suggestionFor(c,'lab'))
     ])}),
     adfa:Object.freeze({applicable:true,fields:Object.freeze([
      field('adfa','assignments','Faculty assignment',true,hasAssignments)
     ])})
    })
   });
  }
  // Quiz / Midterm / OSCE / Exam and anything else: no new scope is invented.
  // Existing behaviour and safety boundaries are preserved untouched.
  return Object.freeze({
   type,
   scoped:false,
   stages:Object.freeze({
    adc:Object.freeze({applicable:false,fields:Object.freeze([])}),
    lab:Object.freeze({applicable:false,fields:Object.freeze([])}),
    adfa:Object.freeze({applicable:false,fields:Object.freeze([])})
   })
  });
 }

 function stageForRole(role){
  const name=text(role).toLowerCase();
  if(name==='developer')return 'all';
  // 'adfa' is the office name; the operational roles that own that office are the
  // ADFA administrative roles. 'adc' and 'lab' are both role and office names.
  if(name==='adfa')return 'adfa';
  if(['owner','administrator','admin','adfa_general','adfa_regular'].includes(name))return 'adfa';
  if(name==='adc')return 'adc';
  if(name==='lab')return 'lab';
  return '';
 }

 function applicableStages(definition){
  return STAGES.filter(stage=>definition?.stages?.[stage]?.applicable===true);
 }

 function missingRequiredFields(session,stage,context={}){
  const definition=definitionForSession(session),scope=definition.stages?.[stage];
  if(!scope||scope.applicable!==true)return [];
  return scope.fields.filter(item=>item.required===true&&!item.complete(session,context));
 }

 function optionalFields(session,stage,context={}){
  const definition=definitionForSession(session),scope=definition.stages?.[stage];
  if(!scope||scope.applicable!==true)return [];
  return scope.fields.filter(item=>item.required!==true);
 }

 function isStageComplete(session,stage,context={}){
  const definition=definitionForSession(session),scope=definition.stages?.[stage];
  if(!scope||scope.applicable!==true)return true;
  return missingRequiredFields(session,stage,context).length===0;
 }

 function previousApplicableStage(session,stage){
  const list=applicableStages(definitionForSession(session));
  const index=list.indexOf(stage);
  return index>0?list[index-1]:'';
 }

 function nextApplicableStage(session,stage){
  const list=applicableStages(definitionForSession(session));
  const index=list.indexOf(stage);
  return index>=0&&index<list.length-1?list[index+1]:'';
 }

 /* Per-stage status. See spec section 7.
  *   not_applicable -> stage does not belong to this session
  *   complete       -> every required field for the stage is filled
  *   ready          -> required work missing AND every previous applicable stage is complete
  *   waiting        -> required work missing AND a previous applicable stage is incomplete
  */
 function stageStatus(session,stage,context={}){
  const definition=definitionForSession(session),scope=definition.stages?.[stage];
  if(!scope||scope.applicable!==true)return{status:'not_applicable',missing:[],waitingFor:''};
  const missing=missingRequiredFields(session,stage,context);
  if(!missing.length)return{status:'complete',missing:[],waitingFor:''};
  const list=applicableStages(definition),index=list.indexOf(stage);
  const blocker=list.slice(0,index).find(previous=>!isStageComplete(session,previous,context));
  return blocker
   ?{status:'waiting',missing,waitingFor:STAGE_LABEL[blocker]}
   :{status:'ready',missing,waitingFor:''};
 }

 function evaluateSessionWorkflow(session,context={}){
  const definition=definitionForSession(session);
  const stages={};
  for(const stage of STAGES)stages[stage]={stage,applicable:definition.stages[stage].applicable,...stageStatus(session,stage,context)};
  const applicable=applicableStages(definition);
  const active=applicable.filter(stage=>stages[stage].status!=='complete');
  return{
   sessionId:text(session?.id||session?.sessionId),
   type:definition.type,
   scoped:definition.scoped,
   stages,
   complete:active.length===0,
   activeStages:active
  };
 }

 /* Work items for one office (or every office for Developer / Owner).
  * Identity is always sessionId + stage; the caller must re-resolve live session
  * data when rendering rather than trusting a stored snapshot.
  */
 function workflowItemsForRole(sessions,role,context={}){
  const target=stageForRole(role);
  if(!target)return [];
  const wanted=target==='all'?STAGES:[target];
  const items=[];
  for(const session of Array.isArray(sessions)?sessions:[]){
   const evaluation=evaluateSessionWorkflow(session,context);
   if(!evaluation.scoped)continue;
   for(const stage of wanted){
    const row=evaluation.stages[stage];
    if(!row||row.applicable!==true)continue;
    if(row.status!=='ready'&&row.status!=='waiting')continue;
    items.push({
     sessionId:evaluation.sessionId,
     sessionType:evaluation.type,
     office:stage,
     stage,
     status:row.status,
     waitingFor:row.waitingFor,
     missing:row.missing.map(item=>item.key),
     missingLabels:row.missing.map(item=>item.label),
     // Point-in-time resolution only. Renderers must re-read the session.
     session
    });
   }
  }
  return items;
 }

 function countItemsForRole(sessions,role,context={}){
  const items=workflowItemsForRole(sessions,role,context);
  return items.reduce((totals,item)=>{totals[item.stage]=(totals[item.stage]||0)+1;totals.total+=1;return totals;},{adc:0,lab:0,adfa:0,total:0});
 }

 return Object.freeze({
  STAGES,ORDER,STAGE_LABEL,SCOPED_TYPES,
  definitionForSession,stageForRole,applicableStages,
  missingRequiredFields,optionalFields,isStageComplete,
  previousApplicableStage,nextApplicableStage,stageStatus,
  evaluateSessionWorkflow,workflowItemsForRole,countItemsForRole,
  isScopedType,sessionType
 });
});
