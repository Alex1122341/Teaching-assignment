'use strict';
const {createApp}=require('./app.js');
const {createFirebaseAuthProvider}=require('./auth/firebase-auth.js');
const {firebaseAdminOptionsFromEnv,createFirebaseAdminClients}=require('./auth/firebase-admin.js');
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

function createProductionDependencies({adminModule,env=process.env}={}){
  const {firestore,adminAuth}=createFirebaseAdminClients({adminModule,env,includeFirestore:true});
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
