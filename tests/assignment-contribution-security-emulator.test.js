'use strict';
const {test,before,after,beforeEach}=require('node:test');
const {assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const {PACKAGE,packageRow,session,meta,setup,seed}=require('./helpers/teaching-assignment-security');
const PROJECT_ID='demo-ucvm-t7-contributions';
const enabled=Boolean(process.env.FIRESTORE_EMULATOR_HOST);let env;
const check=(name,fn)=>test('T7 contribution: '+name,{skip:!enabled},fn);
const id=uid=>'ac-v1__s1__'+uid+'__'+uid;
const row=(uid,patch={})=>({id:id(uid),sessionId:'s1',sourceRole:uid,actorUid:uid,suggestions:[],note:'Private working note',...meta(uid),...patch});
const db=uid=>env.authenticatedContext(uid).firestore();
async function write(uid,patch={},bump=false,docId=id(uid)){
 const fire=db(uid),batch=fire.batch();batch.set(fire.doc('session_assignment_contributions/'+docId),row(uid,patch));
 if(bump)batch.update(fire.doc('teaching_assignment_submissions/'+PACKAGE),{workingRevision:typeof bump==='number'?bump:1,workingChange:{kind:'contribution',id:docId},...meta(uid)});
 return batch.commit();
}
before(async()=>{if(enabled)env=await setup(PROJECT_ID);});
beforeEach(async()=>{if(env)await seed(env,async fire=>{
 await fire.doc('teaching_assignment_submissions/'+PACKAGE).set(packageRow());
 await fire.doc('sessions/s1').set(session());
 for(const uid of ['adc','lab','hicc'])await fire.doc('session_assignment_contributions/'+id(uid)).delete();
});});
after(async()=>{if(env)await env.cleanup();});
check('each exact ADC LAB and current HICC actor can write notes without advancing review generation',async()=>{
 for(const uid of ['adc','lab','hicc'])await assertSucceeds(write(uid));
 await assertFails(write('visc'));
 await assertFails(write('adc',{actorUid:'lab'}));
 await assertFails(write('lab',{sourceRole:'adc'}));
 await assertFails(write('adc',{},false,'arbitrary-id'));
});
check('suggestion changes require atomic generation while nested private fields always fail',async()=>{
 const safe={candidateKey:'opaque-a',displayName:'Faculty A'};
 await assertFails(write('adc',{suggestions:[safe]}));
 await assertSucceeds(write('adc',{suggestions:[safe]},true));
 for(const extra of [{email:'private@example.test'},{ucid:'12345678'},{doe:44},{metadata:{afcReason:'private'}}])
  await assertFails(write('lab',{suggestions:[{...safe,...extra}]},2));
 // The identical actor, source and next generation succeed without private data.
 await assertSucceeds(write('lab',{suggestions:[safe]},2));
});
check('identity and source session provenance are immutable and unknown payload fields are denied',async()=>{
 await seed(env,fire=>fire.doc('sessions/s2').set(session()));
 await assertSucceeds(write('adc'));
 for(const patch of [{sessionId:'s2'},{sourceRole:'lab'},{actorUid:'lab'},{facultyId:'private'}])
  await assertFails(db('adc').doc('session_assignment_contributions/'+id('adc')).update({...patch,...meta('adc')}));
 await assertFails(write('adc',{suggestions:[{candidateKey:'x',displayName:{email:'private'}}]},true));
 await assertSucceeds(write('adc',{suggestions:[{candidateKey:'x',displayName:'Faculty X'}]},true));
});
check('Working contribution privacy permits owner, led VISC and owning HICC while ordinary Faculty cannot read',async()=>{
 await assertSucceeds(write('adc'));
 for(const uid of ['adc','owner','admin','hicc','visc'])await assertSucceeds(db(uid).doc('session_assignment_contributions/'+id('adc')).get());
 for(const uid of ['faculty','other','expired'])await assertFails(db(uid).doc('session_assignment_contributions/'+id('adc')).get());
});
check('frozen packages reject suggestions and stale counters but permit note-only updates',async()=>{
 await assertSucceeds(write('adc'));
 for(const status of ['visc_review','submitted_to_adfad','adfad_finalized']){
  await seed(env,fire=>fire.doc('teaching_assignment_submissions/'+PACKAGE).set(packageRow({status})));
  await assertSucceeds(write('adc',{note:status}));
  await assertFails(write('adc',{suggestions:[{candidateKey:'opaque-a',displayName:'Faculty A'}]},true));
 }
});
check('deleting suggestions requires and accepts the next atomic generation',async()=>{
 await assertSucceeds(write('adc',{suggestions:[{candidateKey:'opaque-a',displayName:'Faculty A'}]},true));
 await assertFails(db('adc').doc('session_assignment_contributions/'+id('adc')).delete());
 const fire=db('adc'),batch=fire.batch();batch.delete(fire.doc('session_assignment_contributions/'+id('adc')));
 batch.update(fire.doc('teaching_assignment_submissions/'+PACKAGE),{workingRevision:2,workingChange:{kind:'contribution',id:id('adc')},...meta('adc')});
 await assertSucceeds(batch.commit());
});
check('canonical underscore identities work and encoded aliases or unsupported source identities fail closed',async()=>{
 await seed(env,async fire=>{
  await fire.doc('sessions/s_1').set(session());
  await fire.doc('sessions/s 1').set(session());
  await fire.doc('users/adc_actor').set({role:'adc',active:true,mustChangePassword:false});
 });
 const encoded='ac-v1__s%5F1__adc__adc%5Factor',patch={id:encoded,sessionId:'s_1',sourceRole:'adc',actorUid:'adc_actor'};
 await assertSucceeds(write('adc_actor',patch,false,encoded));
 for(const alias of ['ac-v1__s_1__adc__adc_actor','ac-v1__s%5f1__adc__adc%5factor'])
  await assertFails(write('adc_actor',{...patch,id:alias},false,alias));
 const unsupported='ac-v1__s%201__adc__adc';
 await assertFails(write('adc',{id:unsupported,sessionId:'s 1'},false,unsupported));
});
check('Other Office remains denied even with forged office access and an effective stable duty',async()=>{
 await seed(env,async fire=>{
  await fire.doc('users/retired').set({role:'other_office',active:true,mustChangePassword:false,officeAccess:['adc','lab','adfa']});
  const current=(await fire.doc('teaching_responsibilities/hicc-surgery/years/2026-27/assignees/hicc').get()).data();
  await fire.doc('teaching_responsibilities/hicc-surgery/years/2026-27/assignees/retired').set({...current,assigneeUid:'retired'});
 });
 await assertSucceeds(write('adc'));
 await assertFails(db('retired').doc('session_assignment_contributions/'+id('adc')).get());
 for(const sourceRole of ['adc','lab','hicc']){
  const docId=`ac-v1__s1__${sourceRole}__retired`;
  await assertFails(write('retired',{id:docId,sourceRole},false,docId));
 }
});
check('a note-only contribution change cannot witness a generation increment',async()=>{
 await assertSucceeds(write('adc'));
 await assertFails(write('adc',{note:'New internal note'},true));
 await assertSucceeds(write('adc',{note:'New internal note'}));
});
check('eight safe suggestions fit the current HICC write budget',async()=>{
 const {Timestamp}=require('firebase/firestore'),now=Date.now();
 await seed(env,async fire=>{
  await fire.doc('settings/system_state').set({teachingDataWriteLocked:false});
  const ref=fire.doc('teaching_responsibilities/hicc-surgery/years/2026-27/assignees/hicc'),current=(await ref.get()).data();
  const windows=Array.from({length:4},(_,i)=>({...current.windows[0],activeAt:Timestamp.fromMillis(now-(8-i*2)*3600000),expiresAt:Timestamp.fromMillis(now-(7-i*2)*3600000)}));
  windows[3].expiresAt=Timestamp.fromMillis(now+3600000);await ref.update({windows});
 });
 const suggestions=Array.from({length:8},(_,i)=>({candidateKey:'candidate-'+i,displayName:'Faculty '+i}));
 await assertSucceeds(write('hicc',{suggestions},true));
 await assertFails(write('hicc',{suggestions:[...suggestions,{candidateKey:'ninth',displayName:'Ninth'}]},2));
});
