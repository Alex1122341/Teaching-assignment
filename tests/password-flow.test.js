'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../password.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../password.html'),'utf8');

function setup({updatePasswordError=null,profileUpdateError=null,resetError=null,providerData=[{providerId:'password'}]}={}){
 const calls=[];
 const changeButton={disabled:false},resetButton={disabled:false};
 const elements={
  signout:{onclick:null,hidden:true},identity:{textContent:''},'password-note':{textContent:''},content:{hidden:false},status:{textContent:''},
  'password-change-section':{hidden:true},'password-change-unavailable':{hidden:true,textContent:''},'password-reset-section':{hidden:false},
  'password-reset-email':{value:''},'password-new':{value:'new-password-123'},'password-confirm':{value:'new-password-123'},'password-current':{value:'old-password-123'}
 };
 const changeForm={onsubmit:null,querySelector:()=>changeButton,reset:()=>{calls.push('changeReset')}};
 const resetForm={onsubmit:null,querySelector:()=>resetButton,reset:()=>{calls.push('resetFormReset');elements['password-reset-email'].value=''}};
 elements['password-form']=changeForm;elements['password-reset-form']=resetForm;
 const currentUser={uid:'u1',email:'u1@ucvm.test',providerData,reauthenticateWithCredential:async()=>{calls.push('reauth')},updatePassword:async()=>{calls.push('updatePassword');if(updatePasswordError)throw updatePasswordError;}};
 let authListener;
 const auth={currentUser,signOut:async()=>{calls.push('signOut')},sendPasswordResetEmail:async email=>{calls.push(`reset:${email}`);if(resetError)throw resetError;},onAuthStateChanged:fn=>{authListener=fn}};
 const db={doc:()=>({get:async()=>({data:()=>({active:true,name:'User One'})}),update:async()=>{calls.push('profileUpdate');if(profileUpdateError)throw profileUpdateError;}})};
 const context={UCVM:{init:()=>({auth,db})},document:{getElementById:id=>elements[id]},firebase:{auth:{EmailAuthProvider:{credential:()=>({})}},firestore:{FieldValue:{serverTimestamp:()=>({server:true})}}},Error};
 vm.runInNewContext(source,context,{filename:'password.js'});
 return {calls,elements,changeForm,resetForm,changeButton,resetButton,currentUser,auth,triggerAuth:u=>authListener(u)};
}
async function submitChange(env){await env.changeForm.onsubmit({preventDefault(){},target:env.changeForm})}
async function submitReset(env){await env.resetForm.onsubmit({preventDefault(){},target:env.resetForm})}

test('password page exposes signed-out reset without redirecting away',async()=>{
 const env=setup();env.auth.currentUser=null;await env.triggerAuth(null);
 assert.equal(env.elements.identity.textContent,'Not signed in');
 assert.equal(env.elements.signout.hidden,true);
 assert.equal(env.elements['password-reset-section'].hidden,false);
 assert.equal(env.elements['password-change-section'].hidden,true);
});

test('reset email uses privacy-preserving success text even when Firebase reports user-not-found',async()=>{
 const env=setup({resetError:{code:'auth/user-not-found',message:'No user'}});env.elements['password-reset-email'].value='Unknown@UCVM.Test';
 await submitReset(env);
 assert.deepEqual(env.calls,['reset:unknown@ucvm.test']);
 assert.match(env.elements.status.textContent,/If an account exists for that email/);
 assert.doesNotMatch(env.elements.status.textContent,/No user/);
 assert.equal(env.resetButton.disabled,false);
});

test('signed-in email account sees change-password and reset email is prefilled',async()=>{
 const env=setup();await env.triggerAuth(env.currentUser);
 assert.equal(env.elements['password-change-section'].hidden,false);
 assert.equal(env.elements['password-reset-email'].value,'u1@ucvm.test');
 assert.equal(env.elements.signout.hidden,false);
});

test('non-password provider does not get the current-password form',async()=>{
 const env=setup({providerData:[{providerId:'phone'}]});await env.triggerAuth(env.currentUser);
 assert.equal(env.elements['password-change-section'].hidden,true);
 assert.equal(env.elements['password-change-unavailable'].hidden,false);
});

test('profile completion marker is not cleared when Firebase Auth password update fails',async()=>{
 const env=setup({updatePasswordError:new Error('password update failed')});await submitChange(env);
 assert.deepEqual(env.calls,['reauth','updatePassword']);
 assert.equal(env.elements.status.textContent,'password update failed');
 assert.equal(env.changeButton.disabled,false);
});

test('password success is not misreported as failure when the profile marker update fails',async()=>{
 const env=setup({profileUpdateError:new Error('profile update failed')});await submitChange(env);
 assert.deepEqual(env.calls,['reauth','updatePassword','profileUpdate','changeReset','signOut']);
 assert.match(env.elements.status.textContent,/Password changed successfully, but the account profile could not be updated/);
 assert.doesNotMatch(env.elements.status.textContent,/Password change failed/);
 assert.equal(env.elements['password-change-section'].hidden,true);
});

test('successful password change updates the profile marker only after Firebase Auth and then signs out',async()=>{
 const env=setup();await submitChange(env);
 assert.deepEqual(env.calls,['reauth','updatePassword','profileUpdate','changeReset','signOut']);
 assert.equal(env.elements['password-change-section'].hidden,true);
 assert.equal(env.elements.status.textContent,'Password changed. Please sign in again with your new password.');
 assert.equal(env.changeButton.disabled,false);
});

test('password HTML contains both signed-in change and reset-email forms',()=>{
 for(const id of ['password-change-section','password-form','password-reset-section','password-reset-form','password-reset-email'])assert.match(html,new RegExp(`id="${id}"`));
 assert.match(html,/For privacy, the confirmation message does not reveal whether the email is registered/);
 assert.match(html,/<title>UCVM · Password Help<\/title>/);
});
