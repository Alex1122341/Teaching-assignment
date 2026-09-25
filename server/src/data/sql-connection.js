'use strict';

const DEFAULT_SERVER='ucvm-teaching-lab-xz-20260911.database.windows.net';
const DEFAULT_DATABASE='teaching-assignment-lab';
const SQL_RESOURCE='https://database.windows.net/';
const text=value=>String(value??'').trim();

async function appServiceManagedIdentityToken({env=process.env,fetchImpl=globalThis.fetch}={}){
  const endpoint=text(env.IDENTITY_ENDPOINT),header=text(env.IDENTITY_HEADER);
  if(!endpoint||!header||typeof fetchImpl!=='function'){
    throw Object.assign(Error('Azure App Service managed identity is not available.'),{code:'SQL_IDENTITY_UNAVAILABLE',statusCode:503});
  }
  const url=new URL(endpoint);
  url.searchParams.set('resource',SQL_RESOURCE);
  url.searchParams.set('api-version','2019-08-01');
  const response=await fetchImpl(url,{method:'GET',headers:{'X-IDENTITY-HEADER':header}});
  if(!response.ok){
    throw Object.assign(Error('Azure managed identity token request failed.'),{code:'SQL_IDENTITY_TOKEN_FAILED',statusCode:503});
  }
  const payload=await response.json();
  const token=text(payload?.access_token);
  if(!token)throw Object.assign(Error('Azure managed identity returned no SQL access token.'),{code:'SQL_IDENTITY_TOKEN_MISSING',statusCode:503});
  return token;
}

function createSqlPoolRunner({
  sqlModule=null,
  connectionString='',
  tokenProvider=appServiceManagedIdentityToken,
  server=DEFAULT_SERVER,
  database=DEFAULT_DATABASE
}={}){
  const secret=text(connectionString);
  const serverName=text(server)||DEFAULT_SERVER;
  const databaseName=text(database)||DEFAULT_DATABASE;
  return async function run(work){
    if(typeof work!=='function')throw new Error('SQL pool work callback is required.');
    const sql=sqlModule||require('mssql');
    const config=secret?secret:{
      server:serverName,
      database:databaseName,
      port:1433,
      options:{encrypt:true,trustServerCertificate:false,enableArithAbort:true},
      authentication:{type:'azure-active-directory-access-token',options:{token:await tokenProvider()}}
    };
    const pool=new sql.ConnectionPool(config);
    await pool.connect();
    try{return await work(pool,sql)}
    finally{try{await pool.close()}catch{}}
  };
}

module.exports={DEFAULT_SERVER,DEFAULT_DATABASE,SQL_RESOURCE,appServiceManagedIdentityToken,createSqlPoolRunner};
