'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {validateDefinition,runTable,catalog}=require('../src/reports/report-definition');
const query=(dataset={})=>({academicYear:'2026-2027',datasets:[{source:'workload',columns:['remainingDoe','facultyName'],search:'Example Alex',match:'all',filters:[{field:'remainingDoe',op:'gte',value:0}],...dataset}]});
test('selected columns, independent name words and typed zero filter yield the exact ordered preview',()=>{
 const definition=validateDefinition(query());assert.equal(definition.academicYear,'2026-27');assert.equal(definition.start,'2026-05-01');assert.equal(definition.end,'2027-05-01');
 const result=runTable('workload',[{_key:'a',facultyName:'Example, Alex',remainingDoe:0,privateId:'DO-NOT-EXPORT'},{_key:'b',facultyName:'Example, Alex',remainingDoe:null},{_key:'c',facultyName:'Other, Pat',remainingDoe:10}],definition.datasets[0]);
 assert.deepEqual(result.columns.map(c=>c.id),['remainingDoe','facultyName']);assert.deepEqual(result.rows,[[0,'Example, Alex']]);assert.equal(result.total,1);assert.doesNotMatch(JSON.stringify(result),/privateId|DO-NOT-EXPORT/);
});
test('AND/OR and explicit blank conditions preserve null versus zero and stable numeric sorting',()=>{
 const rows=[{_key:'b',facultyName:'Beta, Bea',remainingDoe:0,status:'calculated'},{_key:'a',facultyName:'Alpha, Ana',remainingDoe:-2,status:'calculated'},{_key:'c',facultyName:'Gamma, Gus',remainingDoe:null,status:'needs_review'}];
 const execute=dataset=>runTable('workload',rows,validateDefinition(query({search:'',...dataset})).datasets[0]).rows;
 assert.deepEqual(execute({match:'any',filters:[{field:'remainingDoe',op:'lt',value:0},{field:'status',op:'eq',value:'NEEDS_REVIEW'}],sort:{field:'remainingDoe',direction:'desc'}}),[[-2,'Alpha, Ana'],[null,'Gamma, Gus']]);
 assert.deepEqual(execute({filters:[{field:'remainingDoe',op:'ne',value:0}]}),[[-2,'Alpha, Ana']]);
 assert.deepEqual(execute({filters:[{field:'remainingDoe',op:'isEmpty'}]}),[[null,'Gamma, Gus']]);
 assert.deepEqual(execute({filters:[],sort:{field:'remainingDoe',direction:'desc'}}),[[0,'Beta, Bea'],[-2,'Alpha, Ana'],[null,'Gamma, Gus']]);
 assert.deepEqual(execute({match:'any',filters:[]}).map(row=>row[1]),['Alpha, Ana','Beta, Bea','Gamma, Gus']);
});
test('date intervals, reordered text words and incomplete source values remain typed',()=>{
 const input={academicYear:'2026-27',datasets:[{source:'roles',columns:['facultyName','startDate','effectiveDoe'],filters:[{field:'startDate',op:'between',value:['2026-02-01','2026-02-28']},{field:'facultyName',op:'contains',value:'Ana Cruz'}]}]};
 const rows=[{facultyName:'de la Cruz, Ana',startDate:'2026-02-14',effectiveDoe:null},{facultyName:'de la Cruz, Ana',startDate:'2026-03-01',effectiveDoe:0},{facultyName:'de la Cruz, Ana',startDate:'2026-02-30',effectiveDoe:4}];
 assert.deepEqual(runTable('roles',rows,validateDefinition(input).datasets[0]).rows,[['de la Cruz, Ana','2026-02-14',null]]);
 input.datasets[0].filters[0].value=['2026-02-30','2026-03-01'];assert.throws(()=>validateDefinition(input),{code:'INVALID_REPORT_QUERY'});
});
test('result limits never return a truncated success and empty previews retain selected headers',()=>{
 const definition=validateDefinition(query({search:'',filters:[]})).datasets[0];
 assert.throws(()=>runTable('workload',Array.from({length:5001},()=>({facultyName:'Example, Alex',remainingDoe:0})),definition),{code:'REPORT_LIMIT',status:413});
 const empty=runTable('workload',[],definition);assert.equal(empty.total,0);assert.equal(empty.columns.length,2);assert.deepEqual(empty.rows,[]);
});
test('closed query definitions reject unknown paths, duplicate selections and untyped or excessive conditions',()=>{
 const invalids=[null,[],{},query({source:'constructor'}),query({source:'unknown'}),query({columns:[]}),query({columns:['facultyName','facultyName']}),query({columns:['facultyId']}),query({search:[]}),query({match:'xor'}),query({filters:[{field:'remainingDoe',op:'gte',value:'0'}]}),query({filters:[{field:'facultyName',op:'gt',value:'A'}]}),query({filters:[{field:'remainingDoe',op:'isEmpty',value:0}]}),query({filters:[{field:'remainingDoe',op:'gte',value:null}]}),query({filters:Array.from({length:21},()=>({field:'remainingDoe',op:'gte',value:0}))}),query({sort:{field:'privateId',direction:'asc'}}),query({sort:{field:'remainingDoe',direction:'random'}}),{...query(),academicYear:'2026-28'},{...query(),sql:'SELECT * FROM paws.Faculty'},query({extra:true})];
 const duplicate=query();duplicate.datasets.push(duplicate.datasets[0]);invalids.push(duplicate);
 for(const input of invalids)assert.throws(()=>validateDefinition(input),{code:'INVALID_REPORT_QUERY',status:400},JSON.stringify(input));
 assert.equal(validateDefinition(query({filters:Array.from({length:20},()=>({field:'remainingDoe',op:'gte',value:0}))})).datasets[0].filters.length,20);
});
test('catalog exposes all three selectable families and independent history without identity/private fields',()=>{
 const sources=catalog().sources;assert.deepEqual(sources.map(s=>s.id),['workload','schedule','roles','history']);
 for(const source of sources){assert.ok(source.fields.length>5);assert.ok(source.defaults.length);for(const id of source.defaults)assert.ok(source.fields.some(f=>f.id===id));assert.ok(source.fields.every(f=>Array.isArray(f.operators)&&f.operators.length));}
 assert.ok(sources[0].fields.some(f=>f.id==='recordedDoeTotal'));assert.ok(sources[0].fields.some(f=>f.id==='assignedTeachingDoe'));assert.ok(sources[2].fields.some(f=>f.id==='effectiveDoe'&&f.additive===false));
 assert.doesNotMatch(JSON.stringify(sources),/\b(?:ucid|email|facultyId|privateNotes|metadataJson)\b/i);
 const copy=catalog();copy.sources[0].fields[0].label='Changed';assert.notEqual(catalog().sources[0].fields[0].label,'Changed');
});
