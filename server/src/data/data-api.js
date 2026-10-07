'use strict';

const {errorPayload,statusFor}=require('../http/errors.js');
const {createDataRoutes}=require('../routes/data-routes.js');

function bearer(headers={}){
  const raw=String(headers.authorization||headers.Authorization||'');
  return raw.startsWith('Bearer ')?raw.slice(7):'';
}

function createDataApi({authProvider,sessionReadService=null,dataRoutes=null}={}){
  if(!authProvider?.verify)throw new Error('authProvider.verify is required.');
  const routes=dataRoutes||(sessionReadService?createDataRoutes({sessionReadService}):null);
  return{
    async handle({method='GET',path='/',headers={},query={}}={}){
      try{
        if(method==='GET'&&path==='/api/health/sql'){
          if(!sessionReadService?.ping){
            return{statusCode:503,body:{ok:false,service:'ucvm-doe-api',dependency:'azure-sql',code:'SQL_HEALTH_UNAVAILABLE'}};
          }
          await sessionReadService.ping();
          return{statusCode:200,body:{ok:true,service:'ucvm-doe-api',dependency:'azure-sql'}};
        }

        const supported=path==='/api/v1/me'||path==='/api/v1/sessions'||path==='/api/data/sessions';
        if(!supported)return null;

        const token=bearer(headers);
        if(!token)return{statusCode:401,body:{code:'AUTH_REQUIRED',message:'Authentication is required.'}};
        const actor=await authProvider.verify(token);
        if(!actor?.uid)return{statusCode:401,body:{code:'AUTH_REQUIRED',message:'Authentication is required.'}};

        if(method==='GET'&&path==='/api/v1/me'){
          return{statusCode:200,body:{
            uid:actor.uid,email:actor.email,name:actor.name,role:actor.role,
            facultyId:actor.facultyId||'',officeName:actor.officeName||'',
            mustChangePassword:actor.mustChangePassword===true
          }};
        }

        if(!routes){
          return{statusCode:503,body:{code:'SQL_READ_UNAVAILABLE',message:'Azure SQL session reads are unavailable.'}};
        }
        const routed=await routes.handle({method,path,actor,body:{},query});
        return routed||{statusCode:404,body:{code:'NOT_FOUND',message:'Route not found.'}};
      }catch(error){
        const status=statusFor(error);
        if(status>=400&&status<500){
          return{statusCode:status,body:errorPayload(error)};
        }
        return{
          statusCode:503,
          body:{code:'SQL_UNAVAILABLE',message:'Azure SQL data service is unavailable.'}
        };
      }
    }
  };
}

module.exports={createDataApi};
