'use strict';

const text=value=>String(value??'').trim();
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(text(value));
const facultyRoles=new Set(['faculty','hicc','visc']);

function createDataRoutes({sessionReadService}={}){
  if(!sessionReadService?.listSessions)throw new Error('sessionReadService.listSessions is required.');
  return{
    async handle({method,path,actor,query={}}={}){
      if(method!=='GET'||path!=='/api/data/sessions')return null;
      const start=text(query.start),end=text(query.end);
      if(!validDate(start)||!validDate(end)||start>end){
        return{statusCode:400,body:{code:'INVALID_DATE_RANGE',message:'start and end must be YYYY-MM-DD and start must not be after end.'}};
      }
      const role=text(actor?.role).toLowerCase();
      const facultyEmail=facultyRoles.has(role)?text(actor?.email).toLowerCase():'';
      if(facultyRoles.has(role)&&!facultyEmail){
        return{statusCode:403,body:{code:'FACULTY_IDENTITY_REQUIRED',message:'Faculty-linked session reads require an authenticated email identity.'}};
      }
      const sessions=await sessionReadService.listSessions({start,end,facultyEmail});
      return{statusCode:200,body:{source:'azure-sql',count:sessions.length,sessions}};
    }
  };
}

module.exports={createDataRoutes};
