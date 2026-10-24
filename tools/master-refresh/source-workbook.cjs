'use strict';
const ExcelJS=require('exceljs'),JSZip=require('jszip'),unzipper=require('unzipper'),{createHash}=require('node:crypto');
const {academicBounds,isoDate,normalizeAppointmentPeriods,createFacultyResolver,manifestHash,text}=require('../../server/src/master-refresh/master-source-domain');
const fail=code=>Object.assign(new Error('The MASTER source could not be validated.'),{code});
async function cellOnlyArchive(bytes){
 const archive=await unzipper.Open.buffer(bytes),seen=new Set();let total=0;
 if(archive.files.length>4096)throw fail('MASTER_SOURCE_LIMIT');
 for(const entry of archive.files){
  const name=entry.path;
  if(!name||name.length>1024||name.startsWith('/')||/[\\:]/.test(name)||name.split('/').some(p=>p==='..'||p==='.')||seen.has(name)||/vbaproject\.bin$/i.test(name)||(entry.flags&1))throw fail('MASTER_LAYOUT_INVALID');
  seen.add(name);if(entry.type==='Directory')continue;
  const stream=entry.stream();let actual=0;
  try{for await(const chunk of stream){actual+=chunk.length;total+=chunk.length;if(total>128*1024*1024){stream.destroy();throw fail('MASTER_SOURCE_LIMIT');}}}catch(e){stream.destroy();throw e;}
  if(actual!==entry.uncompressedSize)throw fail('MASTER_LAYOUT_INVALID');
 }
 const zip=await JSZip.loadAsync(bytes,{checkCRC32:true});
 // Presentation/filter metadata is not source cell data. ExcelJS 4.4 cannot
 // read multiple dateGroupItem filters. Strip table parts only in this
 // in-memory read projection; provenance always hashes the original bytes.
 for(const name of Object.keys(zip.files))if(/^xl\/tables\//.test(name))zip.remove(name);
 return zip.generateAsync({type:'nodebuffer'});
}
function evidence(cell){
 const raw=cell?.value;
 if(raw&&typeof raw==='object'&&!(raw instanceof Date)){
  if(Object.hasOwn(raw,'formula')||Object.hasOwn(raw,'sharedFormula'))return {formula:raw.formula??raw.sharedFormula,cached:cell.result??raw.result??null};
  if(raw.richText)return {formula:null,cached:raw.richText.map(p=>p.text||'').join('')};
  if(raw.error)return {formula:null,cached:null,error:raw.error};
  if(Object.hasOwn(raw,'text'))return {formula:null,cached:raw.text};
 }
 return {formula:null,cached:raw??null};
}
async function readMasterSource(bytes,context={}){
 const bounds=academicBounds(context.academicYear);
 if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>16*1024*1024)throw fail('MASTER_SOURCE_LIMIT');
 const sha=createHash('sha256').update(bytes).digest('hex').toUpperCase();
 if(!/^[0-9a-f]{64}$/i.test(context.expectedSourceSha256||'')||sha!==context.expectedSourceSha256.toUpperCase())throw fail('SOURCE_HASH_MISMATCH');
 const book=new ExcelJS.Workbook();try{await book.xlsx.load(await cellOnlyArchive(bytes),{ignoreNodes:['tableParts','autoFilter']});}catch(e){if(e.code==='MASTER_SOURCE_LIMIT')throw e;throw fail('MASTER_LAYOUT_INVALID');}
 const headers={HICCs:{A2:'Course',B2:'HICC',D2:'Course Units',E2:'DOE %'},VISCs:{A2:'Subject Area',B2:'VISC',C2:'DOE %'},Rotations:{A1:'Rotation',B1:'Rotation Participant',C1:'Weeks',E1:'DOE %',H1:'Designated Clinical Rotation',I1:'Designated Clinical Rotation Coordinator'},CCC:{A5:'CCC Date',C5:'Faculty #1',D5:'Faculty #2',N1:'CCC Faculty',Q1:'# of shifts'},'# Trainees':{A1:'HR FULL Name',B1:'TOTAL Number of Trainees',AA1:'Trainee DOE (Sum)'}};
 for(const [name,expected]of Object.entries(headers)){const s=book.getWorksheet(name);if(!s||Object.entries(expected).some(([cell,label])=>text(evidence(s.getCell(cell)).cached)!==label))throw fail('MASTER_LAYOUT_INVALID');}
 const source={schemaVersion:1,academicYear:context.academicYear,sourceSha256:sha,appointments:[],roleDefinitions:[],rotations:[],cccSlots:[],cccAllocations:[],trainees:[],issues:[]};
 const resolver=createFacultyResolver(context);
 const ref=(sheet,row,column)=>({sha256:sha,sheet,row,column});
 const issue=(code,sourceRef,extra={})=>source.issues.push({code,sourceRef,...extra});
 const val=(row,col)=>evidence(row.getCell(col)).cached;
 const number=(row,col,sheet)=>{const e=evidence(row.getCell(col)),v=e.cached;if(e.error){issue('SOURCE_CELL_ERROR',ref(sheet,row.number,col));return null;}if(v==null||v==='')return null;if(typeof v!=='number'||!Number.isFinite(v)||v<0){issue('INVALID_QUANTITY',ref(sheet,row.number,col));return null;}return v;};
 const identity=(name,sourceRef)=>{const resolved=resolver(name);if(resolved.issueCode)issue(resolved.issueCode,sourceRef,{sourceName:name});return {facultyId:resolved.facultyId,identityStatus:resolved.identityStatus};};
 for(const [name,type,doeCol,startCol,endCol,noteCol,detailCol]of [['HICCs','HICC','E','I','J','F','N'],['VISCs','VISC','C','G','H','D','L']]){
  book.getWorksheet(name).eachRow((row,n)=>{
   if(n<3)return;const scope=val(row,'A'),person=val(row,'B');if(typeof scope!=='string'||!text(scope)||['Course','Subject Area'].includes(text(scope)))return;
   const sourceRef=ref(name,n,'B'),periods=normalizeAppointmentPeriods({academicYear:context.academicYear,startCell:val(row,startCol),endCell:val(row,endCol),roleDateNotes:val(row,noteCol)});
   for(const code of periods.issues)issue(code,sourceRef);
   const base={sourceRef,sourceName:text(person),roleType:type,scope:text(scope),sourceDoe:number(row,doeCol,name),periods:periods.periods,periodBasis:periods.periodBasis,facts:type==='HICC'?{units:number(row,'D',name)}:{subjectCount:1},privateNotes:{roleDates:val(row,noteCol),notes:val(row,detailCol)},cellEvidence:{doe:evidence(row.getCell(doeCol))}};
   if(!text(person)){source.roleDefinitions.push({...base,facultyId:null,identityStatus:'unassigned'});return;}
   source.appointments.push({...base,...identity(person,sourceRef)});
  });
 }
 const rotation=book.getWorksheet('Rotations');
 rotation.eachRow((row,n)=>{
  if(n<2)return;
  for(const [scopeCol,nameCol,doeCol,detailsCol,notesCol,type]of [['A','B','E','D','F','Rotation Participant'],['H','I','K','J','L','Designated Rotation Coordinator']]){
   const scope=val(row,scopeCol),name=val(row,nameCol);if(typeof scope!=='string'||!text(scope)||/# of CCC day\/shifts/i.test(text(val(row,detailsCol))))continue;
   const base={sourceRef:ref('Rotations',n,nameCol),sourceName:text(name),scope:text(scope),roleType:type,sourceDoe:number(row,doeCol,'Rotations'),facts:type==='Rotation Participant'?{weeks:number(row,'C','Rotations')}:{uniqueRotationTypes:1},privateNotes:{details:val(row,detailsCol),notes:val(row,notesCol)},periods:[{startDate:bounds.startDate,endDate:bounds.endDate}],periodBasis:'default_year',workingDates:[],workingDateStatus:'needs_review',cellEvidence:{doe:evidence(row.getCell(doeCol))}};
   if(!text(name)){source.roleDefinitions.push({...base,facultyId:null,identityStatus:'unassigned'});continue;}
   source.rotations.push({...base,...identity(name,base.sourceRef)});
  }
 });
 book.getWorksheet('CCC').eachRow((row,n)=>{
  const name=val(row,'N');
  if(n>=2&&typeof name==='string'&&text(name)&&text(val(row,'Q')).toUpperCase()!=='TOTAL'){
   const shifts=number(row,'Q','CCC');
   if(shifts!==null){const sourceRef=ref('CCC',n,'N');source.cccAllocations.push({sourceRef,sourceName:text(name),...identity(name,sourceRef),shifts,halfDays:number(row,'T','CCC'),halfDayDeduction:number(row,'U','CCC'),sourceDoe:number(row,'S','CCC'),periods:[{startDate:bounds.startDate,endDate:bounds.endDate}],periodBasis:'default_year',cellEvidence:{shifts:evidence(row.getCell('Q')),doe:evidence(row.getCell('S')),halfDayDeduction:evidence(row.getCell('U'))}});}
  }
  if(n<=5)return;const day=isoDate(val(row,'A'));if(!day)return;
  for(const column of ['C','D','E']){
   const staff=val(row,column);if(staff==null||staff==='')continue;const sourceRef=ref('CCC',n,column);
   if(typeof staff!=='string'){issue('INVALID_STAFFING_LABEL',sourceRef);continue;}
   const unassigned=text(staff)==='Locum',resolved=unassigned?{facultyId:null,identityStatus:'unassigned'}:identity(staff,sourceRef);
   if(day<bounds.startDate||day>bounds.endDate)issue('OUTSIDE_ACADEMIC_YEAR',sourceRef);
   source.cccSlots.push({slotKey:`CCC!${column}${n}`,sourceRef,sourceName:text(staff),...resolved,staffingKind:unassigned?'unassigned':'assigned',staffingLabel:unassigned?'Locum':null,startDate:day,endDate:day,blockLabel:val(row,'B'),privateNotes:val(row,'F'),closureText:val(row,'H')});
  }
 });
 book.getWorksheet('# Trainees').eachRow((row,n)=>{
  const name=val(row,'A');if(n<3||typeof name!=='string'||!text(name))return;
  const sourceRef=ref('# Trainees',n,'A');source.trainees.push({sourceRef,sourceName:text(name),...identity(name,sourceRef),rawCounts:['D','F','H','K','N','P','R'].map(c=>number(row,c,'# Trainees')),categoryDoe:['T','U','V','W','X','Y','Z'].map(c=>number(row,c,'# Trainees')),sourceDoe:number(row,'AA','# Trainees'),sourceTotal:number(row,'B','# Trainees'),privateNotes:Object.fromEntries(['E','G','I','J','L','M','O','Q','S'].map(c=>[c,val(row,c)])),cellEvidence:{sourceDoe:evidence(row.getCell('AA')),sourceTotal:evidence(row.getCell('B'))}});
 });
 source.manifestSha256=manifestHash(source);return source;
}
module.exports={readMasterSource};
