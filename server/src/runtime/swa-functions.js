'use strict';

const {createSwaSqlRuntime}=require('./swa-sql-runtime.js');

function readHeader(request,name){
  if(request?.headers?.get)return String(request.headers.get(name)||'');
  return String(request?.headers?.[name]||request?.headers?.[name.toLowerCase()]||'');
}

function readQuery(request,name){
  if(request?.query?.get)return String(request.query.get(name)||'');
  return String(request?.query?.[name]||'');
}

function registerSwaFunctions({app,runtimeFactory=createSwaSqlRuntime}={}){
  if(!app?.http)throw new Error('Azure Functions app.http is required.');
  let runtime=null;
  const getRuntime=()=>runtime||(runtime=runtimeFactory());

  const register=(name,route,path,queryKeys=[])=>{
    app.http(name,{
      route,
      methods:['GET'],
      authLevel:'anonymous',
      handler:async request=>{
        try{
          const api=getRuntime();
          const query=Object.fromEntries(queryKeys.map(key=>[key,readQuery(request,key)]));
          const result=await api.handle({
            method:String(request?.method||'GET').toUpperCase(),
            path,
            headers:{authorization:readHeader(request,'authorization')},
            query
          });
          return{
            status:result?.statusCode||500,
            jsonBody:result?.body||{code:'INTERNAL_ERROR',message:'Unexpected server error.'},
            headers:{'cache-control':'no-store'}
          };
        }catch(error){
          return{
            status:Number(error?.statusCode)||503,
            jsonBody:{
              code:String(error?.code||'SWA_RUNTIME_UNAVAILABLE'),
              message:'PAWS data service is unavailable.'
            },
            headers:{'cache-control':'no-store'}
          };
        }
      }
    });
  };

  register('pawsSqlHealth','health/sql','/api/health/sql');
  register('pawsMe','v1/me','/api/v1/me');
  register('pawsSessions','v1/sessions','/api/v1/sessions',['start','end']);
}

module.exports={registerSwaFunctions};
