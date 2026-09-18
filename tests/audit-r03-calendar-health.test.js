'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const plain=value=>JSON.parse(JSON.stringify(value));

function load(){
 const window={};
 vm.runInNewContext(fs.readFileSync(path.join(root,'calendar-session.js'),'utf8'),{window});
 vm.runInNewContext(fs.readFileSync(path.join(root,'calendar-session-maintenance.js'),'utf8'),{window});
 return window.UCVM_CALENDAR_SESSION_MAINTENANCE;
}

const sourceData={course:'505',courseName:'Clinical Skills III',year:3,semester:'winter',week:8,date:'2027-03-22',start:'14:45',end:'16:15',timeUnknown:false,type:'LAB',topic:'Suturing',room:'CSB 116',instructor:'Jane Smith'};
const cleanData={sessionId:'s1',course:'505',courseName:'Clinical Skills III',year:3,semester:'winter',week:8,date:'2027-03-22',start:'14:45',end:'16:15',timeUnknown:false,type:'LAB',topic:'Suturing',room:'CSB 116',instructorNames:['Jane Smith'],instructor:'Jane Smith'};

function fakeDb({source=sourceData,calendar=cleanData}={}){
 const state={
  sessions:new Map(source===null?[]:[['s1',structuredClone(source)]]),
  calendar_sessions:new Map(calendar===null?[]:[['s1',structuredClone(calendar)]])
 };
 const docRef=(collection,id)=>({collection,id});
 return {
  state,
  collection(name){
   return {
    async get(){
     return {docs:[...state[name].entries()].map(([id,data])=>({id,data:()=>structuredClone(data)}))};
    },
    doc(id){return docRef(name,String(id));}
   };
  },
  async runTransaction(fn){
   const tx={
    async get(ref){const data=state[ref.collection].get(ref.id);return {exists:data!==undefined,data:()=>structuredClone(data)};},
    set(ref,data){state[ref.collection].set(ref.id,structuredClone(data));},
    delete(ref){state[ref.collection].delete(ref.id);}
   };
   return fn(tx);
  }
 };
}

test('R03 verify treats Firestore document ids as metadata, not calendar payload fields',async()=>{
 const report=await load().verify(fakeDb());
 assert.deepEqual(plain({ok:report.ok,mismatchCount:report.mismatchCount,mismatches:report.mismatches}),{ok:true,mismatchCount:0,mismatches:[]});
});

test('R03 verify still rejects a stored id field inside calendar data',async()=>{
 const report=await load().verify(fakeDb({calendar:{...cleanData,id:'should-not-be-stored'}}));
 assert.equal(report.ok,false);
 assert.deepEqual(plain(report.mismatches[0]),{id:'s1',kind:'private_field',field:'id'});
});

test('R03 repair returns healthy after replacing a contaminated calendar document',async()=>{
 const db=fakeDb({calendar:{...cleanData,facultyIds:['private-faculty-id']}});
 const before=await load().verify(db);
 assert.equal(before.ok,false);
 assert.equal(before.mismatches[0].kind,'private_field');
 const after=await load().repair(db,before,{uid:'owner-1'});
 assert.deepEqual(plain({ok:after.ok,mismatchCount:after.mismatchCount,mismatches:after.mismatches}),{ok:true,mismatchCount:0,mismatches:[]});
 assert.deepEqual(db.state.calendar_sessions.get('s1'),cleanData);
});
