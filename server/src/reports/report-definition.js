'use strict';
const {canonicalAcademicYear}=require('../data/academic-year');
const REPORT_LIMITS=Object.freeze({columns:32,conditions:20,sourceRows:10000,rowsPerSource:5000,totalRows:10000,cells:200000,bytes:6*1024*1024,pageSize:50,ttlMs:600000});
const OPERATORS={text:['contains','eq','ne','startsWith','isEmpty','isNotEmpty'],number:['eq','ne','gt','gte','lt','lte','between','isEmpty','isNotEmpty'],date:['eq','ne','gt','gte','lt','lte','between','isEmpty','isNotEmpty'],boolean:['eq','ne','isEmpty','isNotEmpty']};
const field=(id,label,type='text',unit='',extra={})=>({id,label,type,...(unit?{unit}:{}),operators:OPERATORS[type],...extra});
const percent=(id,label,extra)=>field(id,label,'number','%',extra);
const person=()=>field('facultyName','Faculty');
const year=()=>field('academicYear','Academic year');
const SOURCES={
 workload:{label:'Faculty annual workload',grain:'One row per active faculty member',defaults:['facultyName','teachingCount','cccCount','rotationCount','otherWorkCount','effectiveTargetDoe','assignedTeachingDoe','remainingDoe','status'],defaultSort:{field:'facultyName',direction:'asc'},fields:[
  person(),field('rank','Rank'),field('stream','Stream'),field('fte','FTE','number'),
  ...[['teachingCount','Teaching sessions'],['cccCount','CCC records'],['rotationCount','Rotation records'],['otherWorkCount','Other work records'],['appointmentCount','Appointments']].map(([id,label])=>field(id,label,'number')),
  ...[['contractTeachingDoe','Contract teaching DOE'],['effectiveTargetDoe','Effective teaching target'],['scheduledTeachingDoe','Worksheet scheduled teaching DOE'],['roleDoe','Worksheet role DOE'],['rawSupervisionDoe','Raw supervision DOE'],['appliedSupervisionDoe','Applied supervision DOE'],['adjustmentDoe','Adjustment DOE'],['assignedTeachingDoe','Worksheet assigned teaching DOE'],['remainingDoe','Remaining teaching DOE'],['recordedTeachingDoe','Recorded teaching DOE'],['recordedRoleDoe','Recorded role DOE'],['recordedDoeTotal','Recorded total DOE'],['effectiveRecordedDoeTotal','Effective recorded DOE']].map(([id,label])=>percent(id,label)),
  field('calculationBasis','Calculation basis'),field('status','DOE status'),field('policyReference','Policy reference'),field('sourceReference','Workload source'),year()
 ]},
 schedule:{label:'Teaching / work details',grain:'One row per teaching session or original work range',defaults:['facultyName','sourceKind','courseCode','type','topic','startDate','endDate','timeDisplay','timeStatus','room'],defaultSort:{field:'startDate',direction:'asc'},fields:[
  person(),field('sourceKind','Source'),field('curriculumYear','Curriculum year'),field('courseCode','Course'),field('courseName','Course name'),field('type','Type'),field('topic','Topic / activity'),field('startDate','Start date','date'),field('endDate','End date','date'),field('timeDisplay','Time'),field('timeEvidence','Recorded time evidence'),field('timeStatus','Time status'),field('room','Room'),year()
 ]},
 roles:{label:'Appointments / roles',grain:'One row per recorded validity period; whole-appointment DOE is not additive across periods',defaults:['facultyName','roleType','area','startDate','endDate','effectiveDoe','status'],defaultSort:{field:'facultyName',direction:'asc'},fields:[
  person(),field('roleType','Role'),field('roleCategory','Category'),field('area','Course / area / rotation'),field('courseName','Course name'),field('details','Details'),field('startDate','Period start','date'),field('endDate','Period end','date'),field('periodStatus','Period status'),field('appointment','Appointment reference'),field('period','Period number','number'),
  ...[['recordedDoe','Recorded DOE (whole appointment)'],['overrideDoe','Override DOE (whole appointment)'],['effectiveDoe','Effective DOE (whole appointment)']].map(([id,label])=>percent(id,label,{additive:false})),
  field('basis','DOE basis'),field('status','DOE status'),year()
 ]},
 history:{label:'Change history',grain:'One row per recorded authorized field change; not reconstructed past state',defaults:['changedAt','operation','domain','facultyName','field','fromValue','toValue','actor'],defaultSort:{field:'changedAt',direction:'desc'},fields:[
  field('changedAt','Time (UTC)'),field('changedOn','Changed on (UTC)','date'),field('operation','Operation'),field('domain','Domain'),field('changeType','Type'),person(),field('courseCode','Course'),field('session','Session'),field('field','Changed field'),field('fromValue','From'),field('toValue','To'),field('startDate','Start','date'),field('endDate','End','date'),field('actor','By whom'),year()
 ]}
};
const invalid=()=>Object.assign(Error('Choose valid report sources, columns and typed filters.'),{status:400,code:'INVALID_REPORT_QUERY'});
const limit=()=>Object.assign(Error('Narrow the report filters or select fewer columns.'),{status:413,code:'REPORT_LIMIT'});
const tokens=value=>String(value||'').toLowerCase().split(/[\s,]+/).filter(Boolean);
const closed=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value))&&Object.keys(value).every(key=>keys.includes(key));
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
function validValue(field,value){
 if(field.type==='number')return typeof value==='number'&&Number.isFinite(value);
 if(field.type==='boolean')return typeof value==='boolean';
 if(field.type==='date')return validDate(value);
 return typeof value==='string'&&value.trim().length>0&&value.length<=256;
}
function catalog(){return {limits:{...REPORT_LIMITS},sources:Object.entries(SOURCES).map(([id,source])=>({id,...JSON.parse(JSON.stringify(source))}))};}
function validateDefinition(input){
 if(!closed(input,['academicYear','datasets']))throw invalid();
 let academicYear;try{academicYear=canonicalAcademicYear(input.academicYear);}catch(_){throw invalid();}
 if(!Array.isArray(input.datasets)||!input.datasets.length||input.datasets.length>Object.keys(SOURCES).length)throw invalid();
 const start=academicYear.slice(0,4)+'-05-01',end=(Number(academicYear.slice(0,4))+1)+'-05-01';
 const seen=new Set();
 const datasets=Array.from(input.datasets,value=>{
  if(!closed(value,['source','columns','search','match','filters','sort'])||typeof value.source!=='string'||!Object.hasOwn(SOURCES,value.source)||seen.has(value.source))throw invalid();seen.add(value.source);
  const source=SOURCES[value.source],fields=new Map(source.fields.map(field=>[field.id,field]));
  if(!Array.isArray(value.columns)||!value.columns.length||value.columns.length>REPORT_LIMITS.columns||new Set(value.columns).size!==value.columns.length||Array.from(value.columns).some(id=>typeof id!=='string'||!fields.has(id)))throw invalid();
  const search=value.search===undefined?'':value.search,match=value.match===undefined?'all':value.match,filters=value.filters===undefined?[]:value.filters,sort=value.sort===undefined?source.defaultSort:value.sort;
  if(typeof search!=='string'||search.length>256||!['all','any'].includes(match)||!Array.isArray(filters)||filters.length>REPORT_LIMITS.conditions)throw invalid();
  const normalized=Array.from(filters,filter=>{
   if(!closed(filter,['field','op','value'])||!fields.has(filter.field)||!fields.get(filter.field).operators.includes(filter.op))throw invalid();
   const field=fields.get(filter.field);
   if(['isEmpty','isNotEmpty'].includes(filter.op)){if(Object.hasOwn(filter,'value'))throw invalid();return {field:field.id,op:filter.op};}
   if(filter.op==='between'){
    if(!Array.isArray(filter.value)||filter.value.length!==2||!filter.value.every(value=>validValue(field,value))||filter.value[0]>filter.value[1])throw invalid();
    return {field:field.id,op:filter.op,value:filter.value.slice()};
   }
   if(!validValue(field,filter.value))throw invalid();
   return {field:field.id,op:filter.op,value:filter.value};
  });
  if(!closed(sort,['field','direction'])||!fields.has(sort.field)||!['asc','desc'].includes(sort.direction))throw invalid();
  return {source:value.source,columns:value.columns.slice(),search:search.trim(),match,filters:normalized,sort:{field:sort.field,direction:sort.direction}};
 });
 return {academicYear,start,end,datasets};
}
function runTable(sourceId,rows,definition){
 const source=Object.hasOwn(SOURCES,sourceId)?SOURCES[sourceId]:null;
 if(!source||!Array.isArray(rows))throw Object.assign(Error('A report source could not be read.'),{code:'REPORT_SOURCE_UNAVAILABLE',status:503});
 if(rows.length>REPORT_LIMITS.sourceRows)throw limit();
 const columns=definition.columns.map(id=>({...source.fields.find(field=>field.id===id)}));
 const words=tokens(definition.search);
 const normalize=(field,value)=>{
  if(value===null||value===undefined)return null;
  if(field.type==='text')return typeof value==='string'?value:null;
  return validValue(field,value)?value:null;
 };
 const normalized=rows.map((row,index)=>{
  if(!row||typeof row!=='object'||Array.isArray(row))throw Object.assign(Error('A report source contains an invalid row.'),{code:'REPORT_SOURCE_UNAVAILABLE',status:503});
  return {index,values:Object.fromEntries(source.fields.map(field=>[field.id,normalize(field,Object.hasOwn(row,field.id)?row[field.id]:null)]))};
 });
 const compare=(a,b,type)=>type==='number'||type==='boolean'?Number(a)-Number(b):String(a).localeCompare(String(b),'en',{numeric:true,sensitivity:'base'});
 const matches=(values,filter)=>{
  const value=values[filter.field],empty=value===null||typeof value==='string'&&!value.trim();
  if(filter.op==='isEmpty')return empty;if(filter.op==='isNotEmpty')return !empty;if(empty)return false;
  const type=source.fields.find(field=>field.id===filter.field).type;
  if(filter.op==='contains')return tokens(filter.value).every(word=>value.toLowerCase().includes(word));
  if(filter.op==='startsWith')return value.toLowerCase().startsWith(filter.value.trim().toLowerCase());
  if(filter.op==='between')return compare(value,filter.value[0],type)>=0&&compare(value,filter.value[1],type)<=0;
  const difference=compare(type==='text'?value.trim():value,type==='text'?filter.value.trim():filter.value,type);
  return {eq:difference===0,ne:difference!==0,gt:difference>0,gte:difference>=0,lt:difference<0,lte:difference<=0}[filter.op]===true;
 };
 const matching=normalized.filter(row=>words.every(word=>Object.values(row.values).join(' ').toLowerCase().includes(word))&&(!definition.filters.length||(definition.match==='any'?definition.filters.some(filter=>matches(row.values,filter)):definition.filters.every(filter=>matches(row.values,filter)))));
 if(matching.length>REPORT_LIMITS.rowsPerSource||matching.length*columns.length>REPORT_LIMITS.cells)throw limit();
 const sort=definition.sort||source.defaultSort,type=source.fields.find(field=>field.id===sort.field).type;
 matching.sort((a,b)=>{const x=a.values[sort.field],y=b.values[sort.field];if(x===null||y===null)return x===y?a.index-b.index:x===null?1:-1;const difference=compare(x,y,type);return (sort.direction==='desc'?-difference:difference)||a.index-b.index;});
 let bytes=Buffer.byteLength(JSON.stringify(columns));
 const output=matching.map(row=>{const values=columns.map(column=>row.values[column.id]);if(values.some(value=>typeof value==='string'&&value.length>32767))throw limit();bytes+=Buffer.byteLength(JSON.stringify(values));if(bytes>REPORT_LIMITS.bytes)throw limit();return values;});
 return {source:sourceId,label:source.label,columns,rows:output,total:matching.length};
}
module.exports={catalog,validateDefinition,runTable,REPORT_LIMITS,invalid,limit};
