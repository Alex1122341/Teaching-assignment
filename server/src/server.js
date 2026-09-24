'use strict';
const {createApp}=require('./app.js');
const {createFirebaseAuthProvider}=require('./auth/firebase-auth.js');
const {createFirebaseSqlAuthProvider,bootstrapProfilesFromEnv}=require('./auth/firebase-sql-auth.js');
const {createRepository}=require('./doe/firestore-repository.js');
const {createCalculationService}=require('./doe/calculation-service.js');
const {createRulebookService}=require('./doe/rulebook-service.js');
const {createWorksheetService}=require('./doe/worksheet-service.js');
const {createWorkflowPreviewService}=require('./doe/workflow-preview-service.js');
const {createPolicyAdminService}=require('./doe/policy-admin-service.js');
const {createTargetService}=require('./doe/target-service.js');
const {createDatasetProvider,createRecalculationWriter}=require('./doe/legacy-policy-runtime.js');
const LEGACY_FIRESTORE=require('../../doe-policy-firestore.js');
const LEGACY_SERVICE=require('../../doe-policy-service.js');
const INDEX_MAINTENANCE=require('../../index-maintenance.js');
const DOE_ENGINE=require('../../doe-policy-engine.js');
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

function createProductionServices({firestore,engine=DOE_ENGINE,sessionReadService=null}={}){
  const repository=createRepository(firestore);
  const calculationService=createCalculationService({repository,engine});
  const worksheetService=createWorksheetService({repository});
  const rulebookService=createRulebookService({repository,engine});
  const legacyRepository=LEGACY_FIRESTORE.createFirestoreRepository({db:firestore});
  const datasetProvider=createDatasetProvider({db:firestore});
  const recalculationWriter=createRecalculationWriter({db:firestore,repository:legacyRepository});
  const serviceFor=actor=>LEGACY_SERVICE.createService({
    repository:legacyRepository,engine,actorProvider:()=>actor,datasetProvider,recalculationWriter,
    derivedIndexRefresh:async progress=>{
      if(INDEX_MAINTENANCE?.refreshCoreDerivedIndexes)await INDEX_MAINTENANCE.refreshCoreDerivedIndexes(firestore,actor);
      if(typeof firestore.batch==='function'){
        await firestore.collection('doe_recalculation_batches').doc(String(progress.batchId||'')).set({
          status:'completed',completedRows:Number(progress.completedRows||0),totalRows:Number(progress.totalRows||0),
          changedBy:String(actor?.uid||''),changedByName:String(actor?.name||''),updatedAt:new Date().toISOString()
        },{merge:true});
      }
    }
  });
  const policyAdminService=createPolicyAdminService({serviceFor,repositoryFor:()=>legacyRepository,engine,annualRulebookService:rulebookService});
  const targetService=createTargetService({repository});
  return{
    repository,calculationService,worksheetService,rulebookService,policyAdminService,targetService,sessionReadService,
    workflowPreviewService:createWorkflowPreviewService({repository,calculationService,worksheetService})
  };
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
