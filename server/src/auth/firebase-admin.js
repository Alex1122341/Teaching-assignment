'use strict';

const text=value=>String(value??'').trim();

function firebaseAdminOptionsFromEnv(env=process.env){
  const projectId=text(env?.FIREBASE_PROJECT_ID);
  const raw=text(env?.FIREBASE_SERVICE_ACCOUNT_JSON);
  let serviceAccount=null;
  if(raw){
    try{serviceAccount=JSON.parse(raw)}
    catch(cause){
      const error=Error('FIREBASE_SERVICE_ACCOUNT_JSON must be valid JSON.');
      error.code='FIREBASE_CONFIG_INVALID';
      error.cause=cause;
      throw error;
    }
    if(!serviceAccount||typeof serviceAccount!=='object'||!text(serviceAccount.client_email)||!text(serviceAccount.private_key)){
      const error=Error('FIREBASE_SERVICE_ACCOUNT_JSON must include client_email and private_key.');
      error.code='FIREBASE_CONFIG_INVALID';
      throw error;
    }
    const accountProject=text(serviceAccount.project_id);
    if(projectId&&accountProject&&accountProject!==projectId){
      const error=Error('Firebase Admin service account project does not match FIREBASE_PROJECT_ID.');
      error.code='FIREBASE_PROJECT_MISMATCH';
      throw error;
    }
  }
  return{projectId,serviceAccount};
}

function createFirebaseAdminClients({adminModule,env=process.env,includeFirestore=true}={}){
  const config=firebaseAdminOptionsFromEnv(env);
  let admin=adminModule;
  try{
    if(!admin){
      admin={
        app:require('firebase-admin/app'),
        auth:require('firebase-admin/auth')
      };
      if(includeFirestore)admin.firestore=require('firebase-admin/firestore');
    }
  }catch(error){
    error.message=`firebase-admin is required to start the PAWS API: ${error.message}`;
    throw error;
  }
  let firestore=null,adminAuth;

  const modular=admin?.app&&admin?.auth&&typeof admin.app.getApps==='function'&&
    (!includeFirestore||admin?.firestore);
  if(modular){
    const options={};
    if(config.projectId)options.projectId=config.projectId;
    if(config.serviceAccount)options.credential=admin.app.cert(config.serviceAccount);
    const apps=admin.app.getApps();
    const app=apps.length?apps[0]:admin.app.initializeApp(options);
    adminAuth=admin.auth.getAuth(app);
    if(includeFirestore)firestore=admin.firestore.getFirestore(app);
  }else if(Array.isArray(admin?.apps)&&typeof admin.initializeApp==='function'&&typeof admin.auth==='function'){
    if(!admin.apps.length){
      const options={};
      if(config.projectId)options.projectId=config.projectId;
      if(config.serviceAccount)options.credential=admin.credential.cert(config.serviceAccount);
      admin.initializeApp(options);
    }
    adminAuth=admin.auth();
    if(includeFirestore){
      if(typeof admin.firestore!=='function')throw Error('Firebase Admin Firestore export is required.');
      firestore=admin.firestore();
    }
  }else{
    throw Error('Firebase Admin SDK shape is unsupported.');
  }
  return{firestore,adminAuth};
}

module.exports={firebaseAdminOptionsFromEnv,createFirebaseAdminClients};
