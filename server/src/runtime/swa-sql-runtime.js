'use strict';

const {createFirebaseAdminClients}=require('../auth/firebase-admin.js');
const {bootstrapProfilesFromEnv,createFirebaseSqlAuthProvider}=require('../auth/firebase-sql-auth.js');
const {createSqlPoolRunner}=require('../data/sql-connection.js');
const {createSqlSessionRepository}=require('../data/sql-session-repository.js');
const {createSqlUserRepository}=require('../data/sql-user-repository.js');
const {createDataApi}=require('../data/data-api.js');

const text=value=>String(value??'').trim();

function required(env,name){
  const value=text(env?.[name]);
  if(!value){
    throw Object.assign(Error(`${name} is required for the SWA Azure SQL beta runtime.`),{
      code:'SWA_SQL_CONFIG_REQUIRED',
      statusCode:503
    });
  }
  return value;
}

function createSwaSqlRuntime({env=process.env,adminModule,sqlModule}={}){
  const connectionString=required(env,'PAWS_SQL_CONNECTION_STRING');
  required(env,'FIREBASE_PROJECT_ID');
  required(env,'FIREBASE_SERVICE_ACCOUNT_JSON');

  const {adminAuth}=createFirebaseAdminClients({adminModule,env,includeFirestore:false});
  const poolRunner=createSqlPoolRunner({sqlModule,connectionString});
  const userRepository=createSqlUserRepository({poolRunner});
  const sessionReadService=createSqlSessionRepository({poolRunner});
  const bootstrapProfiles=bootstrapProfilesFromEnv(env.PAWS_ACCOUNT_BOOTSTRAP_JSON);
  const authProvider=createFirebaseSqlAuthProvider({adminAuth,userRepository,bootstrapProfiles});
  const api=createDataApi({authProvider,sessionReadService});
  return Object.freeze({handle:api.handle});
}

module.exports={createSwaSqlRuntime};
