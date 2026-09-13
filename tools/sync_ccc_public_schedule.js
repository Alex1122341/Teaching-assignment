'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const project='tester-teaching',root=`projects/${project}/databases/(default)/documents`,base=`https://firestore.googleapis.com/v1/${root}`;
const config=JSON.parse(fs.readFileSync(path.join(process.env.USERPROFILE,'.config','configstore','firebase-tools.json'),'utf8'));
const token=config.tokens?.access_token;if(!token)throw Error('Firebase CLI access token unavailable. Run firebase login first.');
const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
async function api(url,opt={}){const response=await fetch(url,{...opt,headers:{...headers,...opt.headers}});if(!response.ok)throw Error(`${response.status} ${await response.text()}`);return response.status===204?{}:response.json()}
function decode(value){if(!value)return null;if('stringValue'in value)return value.stringValue;if('booleanValue'in value)return value.booleanValue;if('integerValue'in value)return Number(value.integerValue);if('timestampValue'in value)return value.timestampValue;if('arrayValue'in value)return(value.arrayValue.values||[]).map(decode);if('mapValue'in value){const out={};for(const[k,v]of Object.entries(value.mapValue.fields||{}))out[k]=decode(v);return out}return null}
function field(document,key){return decode(document.fields?.[key])}
async function list(collection){let documents=[],pageToken='';do{const url=new URL(`${base}/${collection}`);url.searchParams.set('pageSize','300');if(pageToken)url.searchParams.set('pageToken',pageToken);const json=await api(url);documents.push(...(json.documents||[]));pageToken=json.nextPageToken||''}while(pageToken);return documents}
const sv=value=>({stringValue:String(value)}),iv=value=>({integerValue:String(value)}),tv=value=>({timestampValue:value});
const mv=fields=>({mapValue:{fields}}),av=values=>({arrayValue:{values}});
(async()=>{
  const [faculty,users]=await Promise.all([list('faculty'),list('users')]);
  const owner=users.find(user=>['adfa_general','owner'].includes(String(field(user,'role')||'').toLowerCase())&&field(user,'active')===true);
  if(!owner)throw Error('No active ADFA General or owner profile found.');
  const actorUid=owner.name.split('/').pop(),actorName=field(owner,'name')||field(owner,'email')||actorUid;
  const events=[];
  for(const document of faculty){
    const facultyId=document.name.split('/').pop(),facultyName=field(document,'preferredFullName')||field(document,'hrFirstLast')||field(document,'hrFullName')||facultyId;
    const records=field(document,'awayFromCampusRecords');
    if(!Array.isArray(records))continue;
    records.forEach((record,index)=>{
      const purpose=String(record?.purpose||'');
      if(!/\bCCC\b/i.test(purpose)||!record?.startDate||!record?.endDate)return;
      const stable=crypto.createHash('sha256').update(`${facultyId}|${record.startDate}|${record.endDate}|${record.sourceRow||index}`).digest('hex').slice(0,20);
      events.push({id:stable,facultyId,facultyName,startDate:String(record.startDate),endDate:String(record.endDate),purpose:'CCC Day'});
    });
  }
  events.sort((a,b)=>a.startDate.localeCompare(b.startDate)||a.facultyName.localeCompare(b.facultyName)||a.id.localeCompare(b.id));
  const unique=[...new Map(events.map(event=>[event.id,event])).values()];
  const values=unique.map(event=>mv({id:sv(event.id),facultyId:sv(event.facultyId),facultyName:sv(event.facultyName),startDate:sv(event.startDate),endDate:sv(event.endDate),purpose:sv(event.purpose)}));
  const now=new Date().toISOString(),documentName=`${root}/public_schedule/ccc_events`;
  const body={writes:[{update:{name:documentName,fields:{events:av(values),count:iv(unique.length),facultyCount:iv(new Set(unique.map(x=>x.facultyId)).size),source:sv('Sanitized AFC CCC records'),updatedBy:sv(actorUid),updatedByName:sv(actorName),updatedAt:tv(now)}}}]};
  await api(`https://firestore.googleapis.com/v1/${root}:commit`,{method:'POST',body:JSON.stringify(body)});
  console.log(JSON.stringify({ok:true,records:unique.length,faculty:new Set(unique.map(x=>x.facultyId)).size,first:unique[0]?.startDate||null,last:unique[unique.length-1]?.endDate||null}));
})().catch(error=>{console.error(error.message);process.exit(1)});
