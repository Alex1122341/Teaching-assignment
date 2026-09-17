'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const api=require('../index-maintenance.js');

function raceDb(){
 const collections={
  faculty:new Map([['f1',{preferredFullName:'Faculty One',active:true}]]),
  sessions:new Map([['s1',{course:'301',date:'2026-09-08',assignments:[{ucid:'f1',doeCredit:2}]}]]),
  settings:new Map([
   ['faculty_swap_index',{schemaVersion:'ucvm-faculty-swap-index-v1',entries:[{key:'stable',name:'Faculty One',aliases:['Faculty One'],unavailableRanges:[]}]}],
   ['faculty_swap_map',{schemaVersion:'ucvm-faculty-swap-map-v1',entries:[{key:'stable',facultyId:'f1'}]}]
  ])
 };
 let generated=0,commits=0;
 const snapshot=(id,value)=>({id,data:()=>JSON.parse(JSON.stringify(value))});
 return{
  get commits(){return commits},
  collection(name){
   const rows=collections[name];if(!rows)throw Error(`unexpected collection ${name}`);
   return{
    doc(id){
     if(id===undefined)return{id:`generated-${++generated}`};
     return{id,get:async()=>rows.has(id)?{exists:true,id,data:()=>JSON.parse(JSON.stringify(rows.get(id)))}:{exists:false,id,data:()=>undefined}};
    },
    async get(){return{docs:[...rows].map(([id,value])=>snapshot(id,value))}}
   };
  },
  batch(){
   const writes=[];
   return{
    set(ref,data){writes.push({id:ref.id,data:JSON.parse(JSON.stringify(data))})},
    async commit(){
     for(const write of writes)collections.settings.set(write.id,write.data);
     commits++;
     collections.sessions.set('s1',{course:'999',date:'2026-09-08',assignments:[{ucid:'f1',doeCredit:2}]});
    }
   };
  }
 };
}

test('post-rebuild verification rejects a concurrent source change',async()=>{
 const db=raceDb();
 await assert.rejects(
  ()=>api.rebuildDerivedIndexes(db,{uid:'general',name:'General'}),
  error=>error?.code==='derived-index-post-verify-failed'&&error?.report?.severity==='mismatch'
 );
 assert.equal(db.commits,1);
});
