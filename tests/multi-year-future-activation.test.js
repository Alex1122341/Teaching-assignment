'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{createEngine}=require('../frontend/scripts/multi-year-demo-model.js');
test('Future Faculty are not assigned before their official activation date in a new year',()=>{
 const source={faculty:[{facultyId:'future',displayName:'Future Faculty',active:true,appointmentValid:true,activationDate:'2027-06-01'}],
 users:[{firebaseUid:'owner',baseRole:'owner'},{firebaseUid:'adfa',baseRole:'adfa_general'}],
 courses:[{courseCode:'VTMD 123',courseName:'Example Course'}],sessions:[],
 roles:[{roleAssignmentId:'r1',facultyId:'future',roleType:'HICC',courseOrSubjectOrRotation:'VTMD 123',effectiveDate:'2026-05-01',expirationDate:'2027-04-30'}]};
 const demo=createEngine({source,storage:null,now:()=>new Date('2026-11-01T00:00:00Z')});
 const owner={uid:'owner',role:'owner'},adfa={uid:'adfa',role:'adfa_general'};
 demo.createYear(owner,'2027-28');
 assert.equal(demo.getState().roles['2027-28'][0].status,'draft');
 assert.equal(demo.getState().roles['2027-28'][0].rolloverReason,'future Faculty activation');
 demo.addCourse(adfa,'2027-28','VTMD 123');
 assert.throws(()=>demo.addSession(adfa,'2027-28','VTMD 123',{date:'2027-05-20',assignments:[{facultyId:'future',doeCredit:3}]}),/activation date/);
 const early=demo.addSession(adfa,'2027-28','VTMD 123',{date:'2027-05-20',assignments:[]});
 assert.throws(()=>demo.editAssignment(adfa,'2027-28','VTMD 123',early,'future'),/activation date/);
 assert.ok(demo.addSession(adfa,'2027-28','VTMD 123',{date:'2027-06-03',assignments:[{facultyId:'future',doeCredit:3}]}));
});
