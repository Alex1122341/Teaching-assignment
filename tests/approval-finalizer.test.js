'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
function load(){
 const context={window:{}};
 for(const file of ['scheduling-core.js','calendar-session.js','approval-finalizer.js'])vm.runInNewContext(fs.readFileSync(path.join(root,file),'utf8'),context);
 return context.window.UCVM_APPROVAL_FINALIZER;
}

test('public finalizer protects stale changed fields and preserves display-only instructor data',()=>{
 const api=load();
 const request={id:'r1',sessionId:'s1',basePublic:{date:'2027-03-22',topic:'Old',instructor:'Dr A'},patchPublic:{date:'2027-03-23',topic:'New'}};
 const calendar={sessionId:'s1',course:'505',date:'2027-03-22',start:'09:00',end:'10:00',timeUnknown:false,type:'LAB',topic:'Old',room:'R1',instructor:'Dr A',instructorNames:['Dr A']};
 const plan=api.planPublicApply({request,calendar});
 assert.equal(plan.sourcePatch.date,'2027-03-23');
 assert.equal(plan.calendar.topic,'New');
 assert.equal(plan.calendar.instructor,'Dr A');
 assert.deepEqual(Array.from(plan.calendar.instructorNames),['Dr A']);
 assert.throws(()=>api.planPublicApply({request,calendar:{...calendar,date:'2027-03-21'}}),/changed after the request/);
});

test('faculty swap finalizer changes only the selected assignment and preserves private IDs outside public request',()=>{
 const api=load();
 const source={id:'s1',course:'505',date:'2027-03-22',start:'09:00',end:'10:00',type:'LEC',topic:'Topic',room:'R1',assignments:[{ucid:'f1',name:'Dr Old',doeCredit:1},{ucid:'f9',name:'Dr Other'}],facultyIds:['f1','f9'],instructor:'Dr Old; Dr Other'};
 const request={id:'r1',sessionId:'s1',basePublic:{course:'505',date:'2027-03-22',start:'09:00',end:'10:00',type:'LEC',topic:'Topic',room:'R1',instructor:'Dr Old; Dr Other'},patchPublic:{instructor:'Dr New'},proposedFacultyName:'Dr New'};
 const privateRecord={assignmentChange:{assignmentIndex:0,from:{facultyId:'f1'},to:{candidateKey:'opaque'}}};
 const plan=api.planFacultySwap({request,source,privateRecord,resolved:{facultyId:'f2',name:'Dr New',kind:'faculty'}});
 assert.equal(plan.sourcePatch.assignments[0].ucid,'f2');
 assert.equal(plan.sourcePatch.assignments[1].ucid,'f9');
 assert.deepEqual(Array.from(plan.sourcePatch.facultyIds),['f2','f9']);
 assert.equal(plan.sourcePatch.instructor,'Dr New; Dr Other');
 assert.equal(JSON.stringify(request).includes('f2'),false);
});

test('faculty swap blocks if the outgoing assignment or public stale base changed',()=>{
 const api=load(),source={id:'s1',date:'2027-03-22',start:'09:00',end:'10:00',type:'LEC',topic:'Topic',room:'R1',course:'505',assignments:[{ucid:'x',name:'Someone'}],instructor:'Someone'};
 const request={sessionId:'s1',basePublic:{course:'505',date:'2027-03-22',start:'09:00',end:'10:00',type:'LEC',topic:'Topic',room:'R1',instructor:'Dr Old'},patchPublic:{instructor:'Dr New'}};
 const privateRecord={assignmentChange:{assignmentIndex:0,from:{facultyId:'f1'},to:{candidateKey:'opaque'}}};
 assert.throws(()=>api.planFacultySwap({request,source,privateRecord,resolved:{facultyId:'f2',name:'Dr New'}}),/changed after the request|outgoing instructor/);
});
