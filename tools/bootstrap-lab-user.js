'use strict';

const path=require('node:path');
const {createRequire}=require('node:module');

const LAB_PROJECT_ID='vista-teaching-lab';
const ROLES=new Set(['developer','owner','administrator','other_office','adfa_general','adfa_regular','admin','editor','viewer','hicc','visc','faculty','adc','lab']);
const FACULTY_ROLES=new Set(['hicc','visc','faculty']);
const OFFICE_ROLES=new Set(['other_office','adc','lab']);
const text=value=>String(value??'').trim();

function readArg(argv,name,fallback=''){
  const index=argv.indexOf(name);
  return index>=0&&argv[index+1]!==undefined?argv[index+1]:fallback;
}

function parseArgs(argv=process.argv.slice(2)){
  return{
    email:text(readArg(argv,'--email')).toLowerCase(),
    displayName:text(readArg(argv,'--display-name')),
    role:text(readArg(argv,'--role')).toLowerCase(),
    facultyId:text(readArg(argv,'--faculty-id')),
    officeName:text(readArg(argv,'--office-name')),
    confirmation:text(readArg(argv,'--confirmation'))
  };
}

function expectedConfirmation(options={}){
  return `BOOTSTRAP:${text(options.email).toLowerCase()}:${text(options.role).toLowerCase()}`;
}

function validateOptions(options,{projectId=process.env.FIREBASE_PROJECT_ID}={}){
  const normalized={
    email:text(options?.email).toLowerCase(),
    displayName:text(options?.displayName),
    role:text(options?.role).toLowerCase(),
    facultyId:text(options?.facultyId),
    officeName:text(options?.officeName),
    confirmation:text(options?.confirmation)
  };
  if(text(projectId)!==LAB_PROJECT_ID)throw Error(`Lab bootstrap is locked to Firebase project "${LAB_PROJECT_ID}".`);
  if(!/^[^@\s]+@ucalgary\.ca$/i.test(normalized.email))throw Error('Lab bootstrap email must be an @ucalgary.ca address.');
  if(!normalized.displayName)throw Error('Display name is required.');
  if(!ROLES.has(normalized.role))throw Error('Unsupported lab account role.');
  if(FACULTY_ROLES.has(normalized.role)&&!normalized.facultyId)throw Error(`Role "${normalized.role}" requires Faculty ID.`);
  const expected=expectedConfirmation(normalized);
  if(normalized.confirmation!==expected)throw Error(`Lab bootstrap requires exact confirmation "${expected}".`);
  if(OFFICE_ROLES.has(normalized.role)&&!normalized.officeName)normalized.officeName=normalized.displayName;
  return normalized;
}

function parseServiceAccount(raw){
  const value=text(raw);
  if(!value)throw Error('FIREBASE_SERVICE_ACCOUNT_JSON is required for lab bootstrap.');
  let account;
  try{account=JSON.parse(value)}catch{throw Error('FIREBASE_SERVICE_ACCOUNT_JSON must be valid JSON.');}
  if(text(account?.project_id)!==LAB_PROJECT_ID)throw Error(`Service account must belong to "${LAB_PROJECT_ID}".`);
  if(!text(account?.client_email)||!text(account?.private_key))throw Error('Service account must include client_email and private_key.');
  return account;
}

function actorFromEnv(env=process.env){
  const runId=text(env.GITHUB_RUN_ID)||'local';
  const login=text(env.GITHUB_ACTOR)||'local-admin';
  return{
    uid:`github-actions:${runId}`,
    name:`Firebase Lab Bootstrap (${login})`
  };
}

function buildProfile(options,{actor=actorFromEnv(),now=new Date()}={}){
  const profile={
    name:options.displayName,
    email:options.email,
    role:options.role,
    active:true,
    mustChangePassword:false,
    updatedBy:actor.uid,
    updatedByName:actor.name,
    updatedAt:now
  };
  if(FACULTY_ROLES.has(options.role)){
    profile.facultyId=options.facultyId;
    profile.facultyRoles=[options.role];
  }
  if(OFFICE_ROLES.has(options.role)){
    profile.officeName=options.officeName||options.displayName;
    profile.officeEmail=options.email;
  }
  return profile;
}

function loadFirebaseAdmin(){
  const root=path.resolve(__dirname,'..');
  const requireFromServer=createRequire(path.join(root,'server','package.json'));
  try{return requireFromServer('firebase-admin')}
  catch(error){
    error.message=`firebase-admin is required for lab bootstrap. Run "npm --prefix server ci". ${error.message}`;
    throw error;
  }
}

async function execute(options,{env=process.env,adminModule}={}){
  const normalized=validateOptions(options,{projectId:env.FIREBASE_PROJECT_ID});
  const serviceAccount=parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const admin=adminModule||loadFirebaseAdmin();
  if(!admin.apps.length){
    admin.initializeApp({
      projectId:LAB_PROJECT_ID,
      credential:admin.credential.cert(serviceAccount)
    });
  }
  const auth=admin.auth();
  const firestore=admin.firestore();
  const actor=actorFromEnv(env);
  let user;
  let createdAuth=false;
  try{
    try{user=await auth.getUserByEmail(normalized.email)}
    catch(error){
      if(error?.code!=='auth/user-not-found')throw error;
      user=await auth.createUser({email:normalized.email,displayName:normalized.displayName,emailVerified:false,disabled:false});
      createdAuth=true;
    }
    if(!createdAuth)user=await auth.updateUser(user.uid,{displayName:normalized.displayName,disabled:false});

    const ref=firestore.collection('users').doc(user.uid);
    const existing=await ref.get();
    const profile=buildProfile(normalized,{actor,now:new Date()});
    const remove=admin.firestore.FieldValue.delete();
    if(!FACULTY_ROLES.has(normalized.role)){
      profile.facultyId=remove;
      profile.facultyRoles=remove;
    }
    if(!OFFICE_ROLES.has(normalized.role)){
      profile.officeName=remove;
      profile.officeEmail=remove;
    }
    if(!existing.exists)profile.createdAt=new Date();
    await ref.set(profile,{merge:true});

    return{uid:user.uid,email:normalized.email,role:normalized.role,createdAuth,profileCreated:!existing.exists};
  }finally{
    if(typeof firestore?.terminate==='function')await firestore.terminate().catch(()=>{});
  }
}

async function main(){
  const result=await execute(parseArgs());
  console.log(JSON.stringify(result,null,2));
  console.log('No password was created or logged. Use the Firebase password-reset flow to establish the initial password.');
}

if(require.main===module){
  main().catch(error=>{console.error(`Firebase lab bootstrap failed: ${error.message}`);process.exit(1);});
}

module.exports={LAB_PROJECT_ID,ROLES,FACULTY_ROLES,OFFICE_ROLES,parseArgs,expectedConfirmation,validateOptions,parseServiceAccount,actorFromEnv,buildProfile,execute,main};
