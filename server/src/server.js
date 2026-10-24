'use strict';
const {createApp}=require('./app.js');
const {createFirebaseAuthProvider}=require('./auth/firebase-auth.js');
const {createFirebaseSqlAuthProvider,bootstrapProfilesFromEnv}=require('./auth/firebase-sql-auth.js');
const {createSqlSessionRepository}=require('./data/sql-session-repository.js');
const {createSqlUserRepository}=require('./data/sql-user-repository.js');


function allowedOriginsFromEnv(value=process.env.ALLOWED_ORIGINS){
  return String(value||'').split(',').map(item=>item.trim()).filter(Boolean);
}

function firebaseAdminOptionsFromEnv(env=process.env){
  const projectId=String(env?.FIREBASE_PROJECT_ID||'').trim();
  const raw=String(env?.FIREBASE_SERVICE_ACCOUNT_JSON||'').trim();
  let serviceAccount=null;
  if(raw){
    try{serviceAccount=JSON.parse(raw)}
    catch(cause){
      const error=Error('FIREBASE_SERVICE_ACCOUNT_JSON must be valid JSON.');
      error.code='FIREBASE_CONFIG_INVALID';
      error.cause=cause;
      throw error;
    }
    if(!serviceAccount||typeof serviceAccount!=='object'||!String(serviceAccount.client_email||'').trim()||!String(serviceAccount.private_key||'').trim()){
      const error=Error('FIREBASE_SERVICE_ACCOUNT_JSON must include client_email and private_key.');
      error.code='FIREBASE_CONFIG_INVALID';
      throw error;
    }
  }
  return{projectId,serviceAccount};
}

function createProductionDependencies({adminModule,env=process.env}={}){
  let admin=adminModule;
  try{
    if(!admin)admin={
      app:require('firebase-admin/app'),
      auth:require('firebase-admin/auth'),
      firestore:require('firebase-admin/firestore')
    };
  }catch(error){
    error.message=`firebase-admin is required to start the DOE API: ${error.message}`;
    throw error;
  }
  const config=firebaseAdminOptionsFromEnv(env);
  let firestore,adminAuth;
  if(admin?.app&&admin?.auth&&admin?.firestore&&typeof admin.app.getApps==='function'){
    const options={};
    if(config.projectId)options.projectId=config.projectId;
    if(config.serviceAccount)options.credential=admin.app.cert(config.serviceAccount);
    const apps=admin.app.getApps();
    const app=apps.length?apps[0]:admin.app.initializeApp(options);
    firestore=admin.firestore.getFirestore(app);
    adminAuth=admin.auth.getAuth(app);
  }else if(Array.isArray(admin?.apps)&&typeof admin.initializeApp==='function'){
    if(!admin.apps.length){
      const options={};
      if(config.projectId)options.projectId=config.projectId;
      if(config.serviceAccount)options.credential=admin.credential.cert(config.serviceAccount);
      admin.initializeApp(options);
    }
    firestore=admin.firestore();
    adminAuth=admin.auth();
  }else throw Error('Firebase Admin SDK shape is unsupported.');
  return{authProvider:createFirebaseAuthProvider({adminAuth,firestore}),firestore,adminAuth};
}

// The Firestore-era DOE service stack was retired together with the old engine.
// DOE is served by the ported SQL runtime under /api/v1/doe/*, so this legacy
// API process now keeps only authentication and the SQL session read path.
function createProductionServices({firestore,sessionReadService=null}={}){
  return{firestore,sessionReadService};
}

if(require.main===module){
  const deps=createProductionDependencies();
  const sqlReads=String(process.env.PAWS_SQL_READS||'on').trim().toLowerCase()!=='off';
  const sqlAuth=String(process.env.PAWS_SQL_AUTH||'off').trim().toLowerCase()==='on';
  const sqlOptions={server:process.env.AZURE_SQL_SERVER,database:process.env.AZURE_SQL_DATABASE};
  const sessionReadService=sqlReads?createSqlSessionRepository(sqlOptions):null;
  const userRepository=sqlAuth?createSqlUserRepository(sqlOptions):null;
  const authProvider=sqlAuth?createFirebaseSqlAuthProvider({adminAuth:deps.adminAuth,userRepository,bootstrapProfiles:bootstrapProfilesFromEnv(process.env.PAWS_ACCOUNT_BOOTSTRAP_JSON)}):deps.authProvider;
  const services=createProductionServices({firestore:deps.firestore,sessionReadService});
  const port=Number(process.env.PORT)||3000;
  const app=createApp({authProvider,services,allowedOrigins:allowedOriginsFromEnv()});
  app.listen(port,()=>process.stdout.write(`UCVM DOE API listening on ${port}\n`));
}

module.exports={createProductionDependencies,createProductionServices,allowedOriginsFromEnv,firebaseAdminOptionsFromEnv};
