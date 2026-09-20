'use strict';

const path=require('node:path');
const {createRequire}=require('node:module');
const {buildDataset}=require('./seed/dataset.js');
const {parseServiceAccount}=require('./bootstrap-lab-user.js');

const LAB_PROJECT_ID='vista-teaching-lab';
const MODES=new Set(['verify','seed']);
const text=value=>String(value??'').trim();

function readArg(argv,name,fallback=''){
  const index=argv.indexOf(name);
  return index>=0&&argv[index+1]!==undefined?argv[index+1]:fallback;
}

function parseArgs(argv=process.argv.slice(2)){
  return{mode:text(readArg(argv,'--mode','verify')).toLowerCase()||'verify'};
}

function validateOptions(options,{projectId=process.env.FIREBASE_PROJECT_ID}={}){
  const mode=text(options?.mode||'verify').toLowerCase();
  if(text(projectId)!==LAB_PROJECT_ID)throw Error(`Firebase lab data setup is locked to "${LAB_PROJECT_ID}".`);
  if(!MODES.has(mode))throw Error('Unknown Firebase lab data mode.');
  return{mode};
}

function chunkDocuments(documents=[],size=400){
  const chunks=[];
  for(let index=0;index<documents.length;index+=size)chunks.push(documents.slice(index,index+size));
  return chunks;
}

function loadFirebaseAdmin(){
  const root=path.resolve(__dirname,'..');
  const requireFromServer=createRequire(path.join(root,'server','package.json'));
  try{return requireFromServer('firebase-admin')}
  catch(error){
    error.message=`firebase-admin is required. Run "npm --prefix server ci". ${error.message}`;
    throw error;
  }
}

function initializeAdmin(serviceAccount,{adminModule}={}){
  const admin=adminModule||loadFirebaseAdmin();
  if(!admin.apps.length){
    admin.initializeApp({
      projectId:LAB_PROJECT_ID,
      credential:admin.credential.cert(serviceAccount)
    });
  }
  return{admin,firestore:admin.firestore()};
}

async function verifyDataset(firestore,dataset=buildDataset()){
  let present=0;
  const missing=[];
  for(const chunk of chunkDocuments(dataset.documents,100)){
    const refs=chunk.map(document=>firestore.doc(document.path));
    const snapshots=await firestore.getAll(...refs);
    snapshots.forEach((snapshot,index)=>{
      if(snapshot.exists)present+=1;
      else missing.push(chunk[index].path);
    });
  }
  return{total:dataset.documents.length,present,missing,ok:missing.length===0};
}

async function seedDataset(firestore,dataset=buildDataset()){
  let written=0;
  const chunks=chunkDocuments(dataset.documents,400);
  for(const chunk of chunks){
    const batch=firestore.batch();
    for(const document of chunk){
      batch.set(firestore.doc(document.path),document.data);
    }
    await batch.commit();
    written+=chunk.length;
  }
  return{written,total:dataset.documents.length,batches:chunks.length};
}

async function execute(options,{env=process.env,adminModule,dataset=buildDataset()}={}){
  const normalized=validateOptions(options,{projectId:env.FIREBASE_PROJECT_ID});
  const serviceAccount=parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const {firestore}=initializeAdmin(serviceAccount,{adminModule});
  try{
    if(normalized.mode==='verify'){
      const verification=await verifyDataset(firestore,dataset);
      if(!verification.ok){
        const error=Error(`Lab seed verification failed: ${verification.missing.length} document(s) missing.`);
        error.code='LAB_SEED_INCOMPLETE';
        error.details=verification;
        throw error;
      }
      return{mode:'verify',verification};
    }
    const seeded=await seedDataset(firestore,dataset);
    const verification=await verifyDataset(firestore,dataset);
    if(!verification.ok)throw Error('Lab seed completed but verification still found missing documents.');
    return{mode:'seed',seeded,verification};
  }finally{
    if(typeof firestore?.terminate==='function')await firestore.terminate().catch(()=>{});
  }
}

async function main(){
  const result=await execute(parseArgs());
  console.log(JSON.stringify(result,null,2));
}

if(require.main===module){
  main().catch(error=>{
    console.error(`Firebase lab data setup failed: ${error.message}`);
    if(error?.details?.missing?.length)console.error(`Missing sample: ${error.details.missing.slice(0,10).join(', ')}`);
    process.exit(1);
  });
}

module.exports={
  LAB_PROJECT_ID,MODES,parseArgs,validateOptions,chunkDocuments,
  initializeAdmin,verifyDataset,seedDataset,execute,main
};
