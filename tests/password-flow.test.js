'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../password.js'),'utf8');

function setup({updatePasswordError=null}={}){
 const calls=[];
 const button={disabled:false};
 const elements={
  signout:{onclick:null},identity:{textContent:''},'password-note':{textContent:''},content:{hidden:false},status:{textContent:''},
  'password-new':{value:'new-password-123'},'password-confirm':{value:'new-password-123'},'password-current':{value:'old-password-123'}
 };
 const form={onsubmit:null,querySelector:()=>button,reset:()=>{calls.push('reset')}};
 elements['password-form']=form;
 const currentUser={
  uid:'u1',email:'u1@ucvm.test',
  reauthenticateWithCredential:async()=>{calls.push('reauth')},
  updatePassword:async()=>{calls.push('updatePassword');if(updatePasswordError)throw updatePasswordError;}
 };
 const auth={
  currentUser,
  signOut:async()=>{calls.push('signOut')},
  onAuthStateChanged:()=>{}
 };
 const db={doc:()=>({get:async()=>({data:()=>({active:true})}),update:async()=>{calls.push('profileUpdate')}})};
 const context={
  UCVM:{init:()=>({auth,db})},
  document:{getElementById:id=>elements[id]},
  firebase:{auth:{EmailAuthProvider:{credential:()=>({})}},firestore:{FieldValue:{serverTimestamp:()=>({server:true})}}},
  location:{replace:()=>{}},
  Error
 };
 vm.runInNewContext(source,context,{filename:'password.js'});
 return {calls,elements,form,button};
}

async function submit(env){
 await env.form.onsubmit({preventDefault(){},target:env.form});
}

test('profile completion marker is not cleared when Firebase Auth password update fails',async()=>{
 const env=setup({updatePasswordError:new Error('password update failed')});
 await submit(env);
 assert.deepEqual(env.calls,['reauth','updatePassword']);
 assert.equal(env.elements.status.textContent,'password update failed');
 assert.equal(env.button.disabled,false);
});

test('successful password change updates the profile marker only after Firebase Auth and then signs out',async()=>{
 const env=setup();
 await submit(env);
 assert.deepEqual(env.calls,['reauth','updatePassword','profileUpdate','reset','signOut']);
 assert.equal(env.elements.content.hidden,true);
 assert.equal(env.elements.status.textContent,'Password changed. Please sign in again with your new password.');
 assert.equal(env.button.disabled,false);
});
