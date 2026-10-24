'use strict';
const names=require('../domain/person-name');
const {randomBytes,createHash,createHmac,timingSafeEqual}=require('node:crypto');
const {isAdministratorRole}=require('../auth/role-policy');
const CATEGORIES=Object.freeze(['undergrad','vetm506','preceptor','im','grad_primary','grad_cosupervised','postdoc']);
const LABELS=Object.freeze(['Undergraduate','VETM 506','Fourth-year preceptor','IM','Graduate primary','Graduate co-supervisor','Postdoc']);
const numeric=v=>v===null||v===undefined||v===''?null:typeof v==='number'&&Number.isFinite(v)?v:null;
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const conflict=()=>Object.assign(Error('Trainee results changed. Refresh the filters.'),{code:'TRAINEE_CURSOR_CONFLICT'});
function publicRow(row){
 const rawCounts=Array.isArray(row.rawCounts)&&row.rawCounts.length===7?row.rawCounts.map(numeric):Array(7).fill(null);
 if(rawCounts.some(n=>n!==null&&n<0))throw Object.assign(Error('Invalid supervision counts.'),{code:'TRAINEE_SOURCE_INVALID'});
 const result={facultyId:row.facultyId,displayName:String(row.displayName||'Not provided'),rawCounts,supervisionAssignments:rawCounts.reduce((a,n)=>a+(n??0),0),sourceDoe:numeric(row.sourceDoe),currentRawDoe:numeric(row.currentRawDoe),currentAppliedDoe:numeric(row.currentAppliedDoe),sourceStatus:row.sourceStatus||'not_provided',privateNotes:row.privateNotes&&typeof row.privateNotes==='object'?row.privateNotes:null,sourceRef:row.sourceRef?{sheet:row.sourceRef.sheet,row:row.sourceRef.row,column:row.sourceRef.column}:null};
 return result;
}
function summarizeTrainees(rows,{administrator=false}={}){
 const data=rows.map(publicRow),categories={};
 for(let i=0;i<7;i++){const present=data.map(r=>r.rawCounts[i]).filter(n=>n!==null);categories[CATEGORIES[i]]=!data.length?0:present.length?present.reduce((a,n)=>a+n,0):null;}
 const total=field=>data.some(r=>r[field]===null)?null:data.reduce((a,r)=>a+r[field],0);
 return{supervisionAssignments:data.reduce((a,r)=>a+r.supervisionAssignments,0),categories,missingCountCells:data.reduce((a,r)=>a+r.rawCounts.filter(n=>n===null).length,0),sourceIssues:data.filter(r=>!['matched','current_source'].includes(r.sourceStatus)||r.sourceDoe===null||r.rawCounts.includes(null)).length,rawSupervisionDoe:total('currentRawDoe'),appliedSupervisionDoe:total('currentAppliedDoe'),...(administrator?{facultyWithTrainees:data.filter(r=>r.supervisionAssignments>0).length}:{})};
}
function traineeCsv(rows,{academicYear}){
 const cell=value=>{
  let text=value===null||value===undefined?'N/A':String(value);
  if(/^[\s\uFEFF]*[=+\-@]/.test(text))text="'"+text;
  return /[",\r\n]/.test(text)?'"'+text.replace(/"/g,'""')+'"':text;
 };
 const headers=['Academic year','Faculty',...LABELS,'Supervision assignments','Source DOE','Current raw DOE','Current applied DOE','Source status','Source cell','Notes'];
 const lines=rows.map(publicRow).map(r=>[academicYear,names.format(r.displayName),...r.rawCounts,r.supervisionAssignments,r.sourceDoe,r.currentRawDoe,r.currentAppliedDoe,r.sourceStatus,r.sourceRef?`${r.sourceRef.sheet}!${r.sourceRef.column}${r.sourceRef.row}`:null,r.privateNotes?JSON.stringify(r.privateNotes):null].map(cell).join(','));
 return Buffer.from('\uFEFF'+[headers.map(cell).join(','),...lines].join('\r\n')+'\r\n','utf8');
}
function createTraineeService({secret=randomBytes(32)}={}){
 const sign=body=>createHmac('sha256',secret).update(body).digest('base64url');
 return Object.freeze({
  page({dataset,academicYear,query='',category=null,cursor=null,limit=25}){
   const rows=dataset.rows.map(publicRow).sort((a,b)=>a.displayName.localeCompare(b.displayName)||String(a.facultyId).localeCompare(String(b.facultyId)));
   const binding=hash({academicYear,query,category,scope:dataset.scope}),version=hash({version:dataset.version,rows});let start=0;
   if(cursor){
    try{
     const parts=cursor.split('.');if(parts.length!==2)throw Error();
     const expected=Buffer.from(sign(parts[0]),'base64url'),actual=Buffer.from(parts[1],'base64url');if(expected.length!==actual.length||!timingSafeEqual(expected,actual))throw Error();
     const payload=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));
     if(payload.binding!==binding||payload.version!==version)throw Error();
     const found=rows.findIndex(r=>r.facultyId===payload.lastKey);if(found<0)throw Error();start=found+1;
    }catch(_){throw conflict();}
   }
   const page=rows.slice(start,start+limit);let nextCursor=null;
   if(start+page.length<rows.length){const body=Buffer.from(JSON.stringify({binding,version,lastKey:page.at(-1).facultyId})).toString('base64url');nextCursor=body+'.'+sign(body);}
   return{academicYear,rows:page,summary:summarizeTrainees(rows,{administrator:isAdministratorRole(dataset.scope?.role)}),total:rows.length,nextCursor,coverage:dataset.coverage||[]};
  },
  csv:traineeCsv
 });
}
module.exports={CATEGORIES,LABELS,publicRow,summarizeTrainees,traineeCsv,createTraineeService};
