'use strict';

const LAB_PROJECT_ID='vista-teaching-lab';
const TARGET_EMAIL='adfa@ucalgary.ca';
const PASSWORD_ENV='LAB_SYNTHETIC_ACCOUNT_PASSWORD';

function text(value){return String(value??'').trim();}

function parseArgs(argv=process.argv.slice(2)){
  const options={email:'',confirmation:''};
  for(let i=0;i<argv.length;i+=2){
    const name=argv[i];
    if(name==='--password')throw Error(`Password must be provided only through ${PASSWORD_ENV}.`);
    if(name!=='--email'&&name!=='--confirmation')throw Error('Only --email and --confirmation are accepted.');
    if(argv[i+1]===undefined)throw Error(`Missing value for ${name}.`);
    options[name.slice(2)]=text(argv[i+1]);
  }
  return options;
}

function expectedConfirmation(email=TARGET_EMAIL){
  return `SET-LAB-PASSWORD:${text(email).toLowerCase()}:${LAB_PROJECT_ID}`;
}

function validateOptions(options,{projectId=process.env.FIREBASE_PROJECT_ID}={}){
  const email=text(options?.email).toLowerCase();
  const confirmation=text(options?.confirmation);
  if(text(projectId)!==LAB_PROJECT_ID)throw Error(`Password provisioning is locked to Firebase project "${LAB_PROJECT_ID}".`);
  if(!/^[^@\s]+@ucalgary\.ca$/i.test(email))throw Error('Password provisioning accepts only an @ucalgary.ca email.');
  if(email!==TARGET_EMAIL)throw Error(`Password provisioning is locked to the existing synthetic account ${TARGET_EMAIL}.`);
  if(confirmation!==expectedConfirmation(email))throw Error(`Password provisioning requires exact confirmation "${expectedConfirmation(email)}".`);
  return{email,confirmation};
}

function getPassword(env=process.env){
  const password=env?.[PASSWORD_ENV];
  if(typeof password!=='string'||password.length===0)throw Error(`${PASSWORD_ENV} is required in the protected firebase-lab-admin environment.`);
  return password;
}

function parseServiceAccount(raw){
  if(typeof raw!=='string'||raw.length===0)throw Error('FIREBASE_SERVICE_ACCOUNT_JSON is required in the protected firebase-lab-admin environment.');
  let account;
  try{account=JSON.parse(raw)}catch{throw Error('FIREBASE_SERVICE_ACCOUNT_JSON is invalid.');}
  if(text(account?.project_id)!==LAB_PROJECT_ID)throw Error(`Service account must belong to "${LAB_PROJECT_ID}".`);
  if(!text(account?.client_email)||!text(account?.private_key))throw Error('Service account is incomplete.');
  return account;
}

function loadFirebaseAdmin(){
  const path=require('node:path');
  const {createRequire}=require('node:module');
  const root=path.resolve(__dirname,'..');
  const requireFromServer=createRequire(path.join(root,'server','package.json'));
  try{return requireFromServer('firebase-admin')}
  catch{throw Error('firebase-admin is unavailable; install the server dependencies first.');}
}

async function execute(options,{env=process.env,adminModule}={}){
  const normalized=validateOptions(options,{projectId:env.FIREBASE_PROJECT_ID});
  const password=getPassword(env);
  const serviceAccount=parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const admin=adminModule||loadFirebaseAdmin();
  if(admin.apps.length){
    let currentApp;
    try{currentApp=admin.app()}
    catch{throw Error('The initialized Firebase Admin app could not be verified.');}
    if(text(currentApp?.options?.projectId)!==LAB_PROJECT_ID)throw Error(`Initialized Firebase Admin app must belong to "${LAB_PROJECT_ID}".`);
  }else{
    admin.initializeApp({projectId:LAB_PROJECT_ID,credential:admin.credential.cert(serviceAccount)});
  }
  const auth=admin.auth();
  let existing;
  try{existing=await auth.getUserByEmail(normalized.email)}
  catch(error){
    if(error?.code==='auth/user-not-found')throw Error('The existing Firebase Auth user was not found; no user was created.');
    throw Error('Could not look up the existing Firebase Auth user.');
  }
  if(!existing?.uid||text(existing.email).toLowerCase()!==normalized.email)throw Error('The existing Firebase Auth user did not match the requested account.');
  const uid=existing.uid;
  try{await auth.updateUser(uid,{password})}
  catch{throw Error('Firebase Admin password update failed.');}
  let verified;
  try{verified=await auth.getUser(uid)}
  catch{throw Error('Password update completed, but existing user verification failed.');}
  if(verified?.uid!==uid||text(verified?.email).toLowerCase()!==normalized.email)throw Error('Password update completed, but the existing UID continuity check failed.');
  return{projectId:LAB_PROJECT_ID,email:normalized.email,uidPreserved:true,passwordUpdated:true};
}

async function main(){
  const result=await execute(parseArgs());
  console.log(JSON.stringify(result));
}

if(require.main===module){
  main().catch(()=>{console.error('Lab password provisioning failed.');process.exitCode=1;});
}

module.exports={LAB_PROJECT_ID,TARGET_EMAIL,PASSWORD_ENV,parseArgs,expectedConfirmation,validateOptions,getPassword,parseServiceAccount,execute,main};
