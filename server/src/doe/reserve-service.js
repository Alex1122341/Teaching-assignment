'use strict';

class ReservePolicyError extends Error{
  constructor(code,message,details={}){super(message);this.name='ReservePolicyError';this.code=code;Object.assign(this,details)}
}
const finite=value=>{const n=Number(value);return Number.isFinite(n)?n:null};
const round=value=>Number(Number(value).toFixed(6));
function requireNumber(policy,key,{min=0,max=Infinity}={}){
  const value=finite(policy?.[key]);
  if(value===null||value<min||value>max)throw new ReservePolicyError('RESERVE_POLICY_INVALID',`Reserve policy ${key} must be a finite number between ${min} and ${max}.`,{parameter:key});
  return value;
}
function normalizePolicy(policy={}){
  const splitThreshold=requireNumber(policy,'splitThreshold',{min:0,max:100});
  const splitRatio=requireNumber(policy,'splitRatio',{min:0,max:1});
  const highTeachingTraineeCeiling=requireNumber(policy,'highTeachingTraineeCeiling',{min:0,max:100});
  const teachingFocusedTraineeCeiling=requireNumber(policy,'teachingFocusedTraineeCeiling',{min:0,max:100});
  const rollingAverageYears=requireNumber(policy,'rollingAverageYears',{min:1,max:10});
  if(!Number.isInteger(rollingAverageYears))throw new ReservePolicyError('RESERVE_POLICY_INVALID','Reserve policy rollingAverageYears must be an integer.',{parameter:'rollingAverageYears'});
  return{splitThreshold,splitRatio,highTeachingTraineeCeiling,teachingFocusedTraineeCeiling,rollingAverageYears};
}
function applyTeachingReserve({teachingTarget,stream,rawSupervision,assignedTeaching,policy}={}){
  const config=normalizePolicy(policy);
  const target=finite(teachingTarget),supervision=finite(rawSupervision),assigned=finite(assignedTeaching);
  if(target===null||target<0||supervision===null||supervision<0||assigned===null||assigned<0)throw new ReservePolicyError('RESERVE_INPUT_INVALID','Teaching target, supervision, and assigned teaching must be finite non-negative numbers.');
  let initialTraineeReserve;
  if(String(stream||'').toLowerCase()==='teaching_focused')initialTraineeReserve=Math.min(target,config.teachingFocusedTraineeCeiling);
  else if(target<=config.splitThreshold)initialTraineeReserve=target*config.splitRatio;
  else initialTraineeReserve=Math.min(target,config.highTeachingTraineeCeiling);
  const initialAssignedTeachingReserve=Math.max(0,target-initialTraineeReserve);
  const roomAfterAssigned=Math.max(0,target-assigned);
  const flexible=String(stream||'').toLowerCase()!=='teaching_focused'&&target<=config.splitThreshold;
  const supervisionCeiling=flexible?target:initialTraineeReserve;
  const appliedSupervision=Math.min(supervision,supervisionCeiling,roomAfterAssigned);
  const maxAssignedTeaching=Math.max(0,target-appliedSupervision);
  const totalAppliedTeaching=assigned+appliedSupervision;
  return{
    teachingTarget:round(target),stream:String(stream||''),rawSupervision:round(supervision),assignedTeaching:round(assigned),
    initialTraineeReserve:round(initialTraineeReserve),initialAssignedTeachingReserve:round(initialAssignedTeachingReserve),
    appliedSupervision:round(appliedSupervision),unappliedSupervision:round(Math.max(0,supervision-appliedSupervision)),
    maxAssignedTeaching:round(maxAssignedTeaching),totalAppliedTeaching:round(totalAppliedTeaching),
    remainingToTarget:round(target-totalAppliedTeaching),policy:config
  };
}
function rollingAverageCount({currentCount,historyCounts,years}={}){
  const windowSize=finite(years);
  if(windowSize===null||!Number.isInteger(windowSize)||windowSize<1)throw new ReservePolicyError('RESERVE_POLICY_INVALID','Rolling-average years must be a positive integer.');
  const current=finite(currentCount);
  if(current===null||current<0)throw new ReservePolicyError('SUPERVISION_COUNT_INVALID','Current trainee count must be finite and non-negative.');
  const values=(Array.isArray(historyCounts)?historyCounts:[]).map(finite).filter(value=>value!==null&&value>=0);
  if(values.length<windowSize)return current;
  const selected=values.slice(-windowSize);
  return round(selected.reduce((sum,value)=>sum+value,0)/selected.length);
}
module.exports={ReservePolicyError,normalizePolicy,applyTeachingReserve,rollingAverageCount};
