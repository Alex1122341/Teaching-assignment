(function(root,factory){
 'use strict';const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PAWS_ACTIVITY_PLACEMENT=api;
})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const DEFAULT_START='08:30',DEFAULT_END='16:30',MAX_ROWS=5000;
 const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
 const validTime=value=>typeof value==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
 const isScheduledActivity=row=>['ccc','rotation_participant'].includes(row?.category);
 const otherActivities=rows=>(Array.isArray(rows)?rows:[]).filter(row=>row&&typeof row==='object'&&!isScheduledActivity(row)&&row.category!=='remote_work');
 function matchesYear(row,year){
  if(year==='all')return true;
  if(year==='rotation')return row?.isWorkingActivity===true&&row.activityCategory==='rotation_participant';
  return !row?.isWorkingActivity&&String(row?.year)===String(year);
 }
 function projectSessions(rows,{start,end,maxRows=MAX_ROWS}={}){
  if(!validDate(start)||!validDate(end)||start>=end||!Number.isInteger(maxRows)||maxRows<1||maxRows>MAX_ROWS)throw Error('Choose a valid bounded calendar date range.');
  const result=[],seen=new Set();
  for(const row of Array.isArray(rows)?rows:[]){
   if(!isScheduledActivity(row))continue;
   if(!row.activityId||!validDate(row.startDate)||!validDate(row.endDate)||row.startDate>row.endDate)throw Error('A scheduled activity has an invalid source date range.');
   const first=row.startDate>start?row.startDate:start,last=row.endDate<end?row.endDate:end;
   const evidence=new Map();
   for(const value of Array.isArray(row.timeEvidence)?row.timeEvidence:[]){
    if(validDate(value.date)&&validTime(value.startTime)&&validTime(value.endTime)&&value.startTime<value.endTime)evidence.set(value.date,value);
   }
   for(let day=Date.parse(first),lastDay=Date.parse(last);day<=lastDay&&day<Date.parse(end);day+=86400000){
    const date=new Date(day).toISOString().slice(0,10),id='activity:'+row.activityId+':'+date;
    if(seen.has(id))continue;if(result.length>=maxRows)throw Error('Too many activity days; narrow the calendar range.');seen.add(id);
    const time=evidence.get(date),rotation=row.category==='rotation_participant';
    result.push({id,date,year:null,course:String(row.courseCode||(rotation?'Rotation':'CCC')),courseName:rotation?'Rotation':'CCC',
     type:rotation?'Rotation':'CCC',topic:String(row.label||row.blockLabel||(rotation?'Rotation':'CCC'))+(time?'':' · Default time'),
     instructor:row.staffingKind==='unassigned'?'Locum':String(row.facultyDisplayName||'Not provided'),assignments:[],room:'',
     start:time?time.startTime:DEFAULT_START,end:time?time.endTime:DEFAULT_END,timeUnknown:false,timeDefaulted:!time,
     sourceSystem:'VetMed-Ops CalendarActivity',sourceActivity:row,activityCategory:row.category,isWorkingActivity:true,readOnlyActivity:true});
   }
  }
  return result.sort((a,b)=>a.date.localeCompare(b.date)||a.start.localeCompare(b.start)||a.id.localeCompare(b.id));
 }
 return Object.freeze({DEFAULT_START,DEFAULT_END,MAX_ROWS,isScheduledActivity,otherActivities,matchesYear,projectSessions});
});
