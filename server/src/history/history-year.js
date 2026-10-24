'use strict';
const yearOfDate=value=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)return null;const n=Number(value.slice(0,4))-(value.slice(5,7)<'05'?1:0);return n>=1900&&n<=9998?`${n}-${String((n+1)%100).padStart(2,'0')}`:null;};
function calgaryAcademicYear(value){const d=new Date(value);if(!Number.isFinite(d.getTime()))return null;const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Edmonton',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d).map(p=>[p.type,p.value]));return yearOfDate(`${parts.year}-${parts.month}-${parts.day}`);}
const validYear=value=>typeof value==='string'&&/^\d{4}-\d{2}$/.test(value)&&Number(value.slice(0,4))>=1900&&Number(value.slice(0,4))<=9998&&String((Number(value.slice(0,4))+1)%100).padStart(2,'0')===value.slice(5);
function overlapsYear(start,end,year){return validYear(year)&&Boolean(yearOfDate(start)&&yearOfDate(end))&&start<=end&&start<`${Number(year.slice(0,4))+1}-05-01`&&end>=year.slice(0,4)+'-05-01';}
function yearsInRange(start,end){
 const first=yearOfDate(start),last=yearOfDate(end);if(!first||!last||start>end)return [];
 const years=[];for(let n=Number(first.slice(0,4));n<=Number(last.slice(0,4));n++)years.push(`${n}-${String((n+1)%100).padStart(2,'0')}`);return years;
}
const endpoint=(row,end=false)=>{const date=row[end?'endDate':'startDate'],time=row[end?'endTime':'startTime'];return date?(date+(time?' '+time:'')):'N/A';};
module.exports={calgaryAcademicYear,yearOfDate,validYear,overlapsYear,yearsInRange,endpoint};
