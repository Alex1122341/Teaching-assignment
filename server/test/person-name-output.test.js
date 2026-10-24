'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const names=require('../src/domain/person-name');
const {renderHistoryExport}=require('../src/history/change-history-export');
const {traineeCsv}=require('../src/trainees/trainee-service');
const {buildDirectory}=require('../src/roles/leadership-directory-api');

test('new history exports format attribution without rewriting audit From/To values or source rows',async()=>{
 const row=Object.freeze({actor:'David Hall',affectedFaculty:'Mary Smith; David Hall',previousValue:'David Hall',updatedValue:'Mary Smith'});
 const csv=(await renderHistoryExport([row],'csv')).bytes.toString('utf8');
 assert.match(csv,/"Hall, David"/);assert.match(csv,/"Smith, Mary; Hall, David"/);
 assert.match(csv,/"David Hall"/);assert.match(csv,/"Mary Smith"/);
 assert.equal(row.actor,'David Hall');
 const operation=Object.freeze({actor:'David Hall',affectedFaculty:'Mary Smith',records:[{affectedFaculty:'Mary Smith',changes:[{field:'Faculty',previousValue:'David Hall',updatedValue:'Mary Smith'}]}]});
 const grouped=(await renderHistoryExport([operation],'csv',{grouped:true})).bytes.toString('utf8');
 assert.match(grouped,/Hall, David/);assert.match(grouped,/Record 1 \| Smith, Mary/);
 assert.match(grouped,/Faculty: David Hall → Mary Smith/);
});

test('new trainee CSV labels follow the shared rule and retain formula protection',()=>{
 const csv=traineeCsv([{displayName:'David Hall',rawCounts:[0,0,0,0,0,0,0]},{displayName:'=DANGEROUS()',rawCounts:[0,0,0,0,0,0,0]}],{academicYear:'2026-27'}).toString('utf8');
 assert.match(csv,/"Hall, David"/);assert.match(csv,/'=DANGEROUS/);
});

test('leadership projection keeps structured complete and partial names without exposing internal components',()=>{
 const directory=buildDirectory([
  {roleType:'VISC',facultyKey:'one',facultyName:'Mary Jane de la Cruz',facultyFirstName:'Mary Jane',facultyLastName:'de la Cruz'},
  {roleType:'VISC',facultyKey:'two',facultyName:'de la Cruz',facultyFirstName:null,facultyLastName:'de la Cruz'}
 ],{academicYear:'2026-27',asOfDate:'2026-10-23'});
 assert.deepEqual(directory.visc.map(r=>r.facultyName),['de la Cruz','de la Cruz, Mary Jane']);
 assert.equal(directory.visc.some(r=>Object.hasOwn(r,'facultyFirstName')||Object.hasOwn(r,'facultyLastName')),false);
});
