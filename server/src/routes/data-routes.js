'use strict';

const { canonicalAcademicYear } = require('../data/academic-year.js');

const text=value=>String(value??'').trim();
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(text(value));
const facultyRoles=new Set(['faculty','hicc','visc']);

function createDataRoutes({sessionReadService}={}){
  if(!sessionReadService?.listSessions)throw new Error('sessionReadService.listSessions is required.');
  return{
    async handle({method,path,actor,query={}}={}){
      if(method!=='GET'||!['/api/data/sessions','/api/v1/sessions'].includes(path))return null;
      const start=text(query.start),end=text(query.end);
      if(!validDate(start)||!validDate(end)||start>end){
        return{statusCode:400,body:{code:'INVALID_DATE_RANGE',message:'start and end must be YYYY-MM-DD and start must not be after end.'}};
      }
      const role=text(actor?.role).toLowerCase();
      const facultyEmail=facultyRoles.has(role)?text(actor?.email).toLowerCase():'';
      if(facultyRoles.has(role)&&!facultyEmail){
        return{statusCode:403,body:{code:'FACULTY_IDENTITY_REQUIRED',message:'Faculty-linked session reads require an authenticated email identity.'}};
      }
      // Academic year is optional and opt-in. When it is absent the request
      // keeps its current unfiltered semantics; when it is present it must be a
      // real academic year, canonicalised to the stored `YYYY-YY` form. An
      // explicit-but-malformed value throws and becomes a 400 rather than
      // quietly returning a different year's timetable.
      const academicYear=text(query.academicYear);
      const input={start,end,facultyEmail};
      if(academicYear)input.academicYear=canonicalAcademicYear(academicYear);
      const sessions=await sessionReadService.listSessions(input);
      return{statusCode:200,body:{source:'azure-sql',count:sessions.length,sessions}};
    }
  };
}

module.exports={createDataRoutes};
