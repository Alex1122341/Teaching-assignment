(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.UCVM_SCHEDULING=api;
})(typeof window!=='undefined'?window:null,function(){
 'use strict';
  function parseTime(value){
    const raw=String(value??'').trim();
    const match=raw.match(/^(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i);
    if(!match)return null;
    let hour=Number(match[1]);
    const minute=Number(match[2]);
    if(!Number.isInteger(minute)||minute<0||minute>59)return null;
    const meridiem=String(match[3]||'').toUpperCase();
    if(meridiem){
      if(hour<1||hour>12)return null;
      if(hour===12)hour=0;
      if(meridiem==='PM')hour+=12;
    }else if(hour<0||hour>23)return null;
    return hour*60+minute;
  }

  function formatTime(minutes){
    if(!Number.isInteger(minutes)||minutes<0||minutes>=1440)return null;
    return `${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
  }

  function normalizeDate(value){
    const raw=String(value??'').slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return null;
    const date=new Date(`${raw}T12:00:00`);
    if(Number.isNaN(date.getTime()))return null;
    const [year,month,day]=raw.split('-').map(Number);
    return date.getFullYear()===year&&date.getMonth()+1===month&&date.getDate()===day?raw:null;
  }

  function validateInterval(start,end,{timeUnknown=false}={}){
    if(timeUnknown)return{status:'unknown',reason:'time_unknown',startMinutes:null,endMinutes:null};
    const startMinutes=parseTime(start),endMinutes=parseTime(end);
    if(startMinutes===null||endMinutes===null)return{status:'invalid',reason:'invalid_time',startMinutes,endMinutes};
    if(endMinutes<=startMinutes)return{status:'invalid',reason:'end_not_after_start',startMinutes,endMinutes};
    return{status:'valid',reason:'clear',startMinutes,endMinutes};
  }

  function durationMinutes(start,end,options={}){
    const check=validateInterval(start,end,options);
    return check.status==='valid'?check.endMinutes-check.startMinutes:null;
  }

  function durationHours(start,end,options={}){
    const minutes=durationMinutes(start,end,options);
    return minutes===null?null:minutes/60;
  }

  function intervalsOverlap(aStart,aEnd,bStart,bEnd){
    const a=validateInterval(aStart,aEnd),b=validateInterval(bStart,bEnd);
    if(a.status!=='valid'||b.status!=='valid')return null;
    return a.startMinutes<b.endMinutes&&b.startMinutes<a.endMinutes;
  }

  function validateSessionTiming(session={}){
    const date=normalizeDate(session.date);
    if(!date)return{status:'invalid',reason:'invalid_date',date:null};
    return{date,...validateInterval(session.start,session.end,{timeUnknown:session.timeUnknown===true})};
  }

  function validateSessionTimingChange(base={},patch={}){
    const fields=['date','start','end','timeUnknown'],changedFields=fields.filter(field=>Object.prototype.hasOwnProperty.call(patch||{},field)&&JSON.stringify(base?.[field]??null)!==JSON.stringify(patch?.[field]??null));
    if(!changedFields.length)return{status:'unchanged',reason:'no_timing_change',changedFields};
    return{...validateSessionTiming({...base,...patch}),changedFields};
  }

  function findFacultyConflicts({date,start,end,timeUnknown=false,sessions=[],excludeSessionId='',isAssigned=()=>false}){
    const normalizedDate=normalizeDate(date);
    const target=validateInterval(start,end,{timeUnknown});
    const sameDay=(Array.isArray(sessions)?sessions:[]).filter(session=>
      (!excludeSessionId||String(session?.id||'')!==String(excludeSessionId))&&
      normalizeDate(session?.date)===normalizedDate&&
      isAssigned(session)
    );
    if(!normalizedDate||target.status!=='valid')return{status:'check_needed',conflicts:[],possibleConflicts:sameDay,reason:'target_time'};
    const conflicts=[],possibleConflicts=[];
    for(const session of sameDay){
      const check=validateInterval(session?.start,session?.end,{timeUnknown:session?.timeUnknown===true});
      if(check.status!=='valid'){
        possibleConflicts.push(session);
        continue;
      }
      if(target.startMinutes<check.endMinutes&&check.startMinutes<target.endMinutes)conflicts.push(session);
    }
    if(conflicts.length)return{status:'conflict',conflicts,possibleConflicts,reason:'overlap'};
    if(possibleConflicts.length)return{status:'check_needed',conflicts,possibleConflicts,reason:'other_time_unknown'};
    return{status:'clear',conflicts,possibleConflicts,reason:'clear'};
  }

  return{parseTime,formatTime,normalizeDate,validateInterval,durationMinutes,durationHours,intervalsOverlap,validateSessionTiming,validateSessionTimingChange,findFacultyConflicts};
});
