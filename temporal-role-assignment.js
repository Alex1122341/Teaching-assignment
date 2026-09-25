/* Pure temporal role-assignment helpers shared by the Faculty Dashboard and DOE server.
 * Date windows are half-open: [activeDate, expirationDate).
 */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.UCVM_TEMPORAL_ROLE_ASSIGNMENT=api;
})(typeof window!=='undefined'?window:null,function(){
 'use strict';
 const text=value=>String(value??'').trim();
 function dateParts(value){
  const raw=text(value),match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if(!match)return null;
  const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
  const d=new Date(Date.UTC(year,month-1,day));
  if(d.getUTCFullYear()!==year||d.getUTCMonth()!==month-1||d.getUTCDate()!==day)return null;
  return{raw,year,month,day,ms:d.getTime()};
 }
 function startYear(academicYear){
  const match=/^(\d{4})-(\d{2})$/.exec(text(academicYear));
  if(!match)return null;
  const start=Number(match[1]),end=Number(match[2]);
  return Number(String(start+1).slice(-2))===end?start:null;
 }
 function defaultWindow(academicYear){
  const year=startYear(academicYear);
  if(year===null)throw Error('Academic Year must use YYYY-YY and end in the following year.');
  return{activeDate:`${year}-09-01`,expirationDate:`${year+1}-05-01`};
 }
 function normalizeWindow(input={}){
  const defaults=defaultWindow(input.academicYear),activeDate=text(input.activeDate)||defaults.activeDate,expirationDate=text(input.expirationDate)||defaults.expirationDate;
  const start=dateParts(activeDate),end=dateParts(expirationDate);
  if(!start)throw Error('Active date must be a valid YYYY-MM-DD date.');
  if(!end)throw Error('Expiration date must be a valid YYYY-MM-DD date.');
  if(end.ms<=start.ms)throw Error('Expiration date must be later than active date.');
  return{activeDate:start.raw,expirationDate:end.raw};
 }
 function dateInTimeZone(value=new Date(),timeZone='America/Edmonton'){
  const date=value instanceof Date?value:new Date(value);
  if(Number.isNaN(date.getTime()))throw Error('A valid instant is required.');
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  const map=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return `${map.year}-${map.month}-${map.day}`;
 }
 function dateTimeParts(value,timeZone='America/Edmonton'){
  const date=value instanceof Date?value:new Date(value);
  if(Number.isNaN(date.getTime()))throw Error('A valid instant is required.');
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date);
  const map=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return{year:Number(map.year),month:Number(map.month),day:Number(map.day),hour:Number(map.hour),minute:Number(map.minute),second:Number(map.second)};
 }
 function dateBoundaryInstant(value,timeZone='America/Edmonton'){
  const target=dateParts(value);
  if(!target)throw Error('Date boundary must use a valid YYYY-MM-DD date.');
  const targetUtc=Date.UTC(target.year,target.month-1,target.day,0,0,0);
  let guess=targetUtc;
  for(let i=0;i<4;i++){
   const local=dateTimeParts(new Date(guess),timeZone);
   const localAsUtc=Date.UTC(local.year,local.month-1,local.day,local.hour,local.minute,local.second);
   const delta=localAsUtc-targetUtc;
   if(delta===0)return new Date(guess);
   guess-=delta;
  }
  const check=dateTimeParts(new Date(guess),timeZone);
  if(check.year!==target.year||check.month!==target.month||check.day!==target.day||check.hour!==0||check.minute!==0||check.second!==0)throw Error('Could not resolve local date boundary.');
  return new Date(guess);
 }
 function dateBoundaryIso(value,timeZone='America/Edmonton'){return dateBoundaryInstant(value,timeZone).toISOString()}
 function statusAt(input={},asOfDate){
  if(input.active===false)return'inactive';
  const asOf=dateParts(asOfDate);
  if(!asOf)throw Error('Status date must be a valid YYYY-MM-DD date.');
  const window=normalizeWindow(input),start=dateParts(window.activeDate),end=dateParts(window.expirationDate);
  if(asOf.ms<start.ms)return'scheduled';
  if(asOf.ms>=end.ms)return'expired';
  return'active';
 }
 function isActiveAt(input={},asOfDate){return statusAt(input,asOfDate)==='active'}
 function normalizeDoeOverride(value){
  if(value===undefined||value===null||value==='')return null;
  const number=Number(value);
  if(!Number.isFinite(number))throw Error('DOE override must be a finite number.');
  return number;
 }
 function effectiveDoe(calculatedDoe,overrideDoe){
  const calculated=calculatedDoe===undefined||calculatedDoe===null||calculatedDoe===''?null:Number(calculatedDoe);
  if(calculated!==null&&!Number.isFinite(calculated))throw Error('Calculated DOE must be a finite number.');
  const override=normalizeDoeOverride(overrideDoe);
  return override===null?calculated:override;
 }
 function shiftDateYears(value,delta){
  const source=dateParts(value),years=Number(delta);
  if(!source||!Number.isInteger(years))throw Error('Date shift requires a valid date and integer year delta.');
  const targetYear=source.year+years;
  let day=source.day;
  while(day>0){
   const candidate=dateParts(`${targetYear}-${String(source.month).padStart(2,'0')}-${String(day).padStart(2,'0')}`);
   if(candidate)return candidate.raw;
   day-=1;
  }
  throw Error('Could not shift date.');
 }
 function shiftWindow(input={},sourceYear,targetYear){
  const sourceStart=startYear(sourceYear),targetStart=startYear(targetYear);
  if(sourceStart===null||targetStart===null)throw Error('Source and target Academic Years must use YYYY-YY.');
  const current=normalizeWindow({...input,academicYear:sourceYear}),delta=targetStart-sourceStart;
  return{activeDate:shiftDateYears(current.activeDate,delta),expirationDate:shiftDateYears(current.expirationDate,delta)};
 }
 return Object.freeze({dateParts,dateInTimeZone,dateBoundaryInstant,dateBoundaryIso,startYear,defaultWindow,normalizeWindow,statusAt,isActiveAt,normalizeDoeOverride,effectiveDoe,shiftDateYears,shiftWindow});
});
