'use strict';
const {validateAuthorizedProfile}=require('../data/data-api');
const fail=(status,code,message)=>({status,body:{error:{code,message}}});
const validYear=value=>{
 if(typeof value!=='string'||!/^20[0-9]{2}-[0-9]{2}$/.test(value))return false;
 const start=Number(value.slice(0,4));
 return start>=2020&&start<=2097&&value.slice(5)===String((start+1)%100).padStart(2,'0');
};
const validDate=value=>typeof value==='string'&&/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)&&
 !Number.isNaN(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
// Bounds mirror the SQL contract that produces these values. A name is either
// CONCAT(PreferredFirstName,' ',PreferredLastName) over two nvarchar(128)
// columns (<=257) or the nvarchar(260) DisplayName fallback, so 260 is the real
// maximum. A tighter ceiling would turn one long but legitimate source name into
// a 503 for the entire academic year instead of rendering it.
const FACULTY_NAME_MAX=260;
const BLOCK_LABEL_MAX=1000;
const COURSE_CODE_MAX=64;
function sanitizeEntry(row){
 if(!row||!validDate(row.date)||!validDate(row.endDate)||row.date>row.endDate
   ||typeof row.facultyName!=='string'||!row.facultyName.trim()||row.facultyName.length>FACULTY_NAME_MAX
   ||row.blockLabel!=null&&(typeof row.blockLabel!=='string'||row.blockLabel.length>BLOCK_LABEL_MAX)
   ||row.courseCode!=null&&(typeof row.courseCode!=='string'||row.courseCode.length>COURSE_CODE_MAX)
   ||![true,false,0,1].includes(row.halfDay))throw Error('Invalid CCC read result.');
 return {
  date:row.date,endDate:row.endDate,blockLabel:row.blockLabel??null,
  courseCode:row.courseCode??null,facultyName:row.facultyName,halfDay:row.halfDay===true||row.halfDay===1
 };
}
function createCccScheduleApi({verifyToken,findUser,repository}={}){
 if(typeof verifyToken!=='function'||typeof findUser!=='function'||typeof repository?.list!=='function')throw Error('CCC read dependencies required.');
 return Object.freeze({
  async list(token,query={}){
   if(typeof token!=='string'||!token)return fail(401,'UNAUTHENTICATED','Sign in to view the CCC schedule.');
   let decoded;try{decoded=await verifyToken(token);}catch(_){return fail(401,'UNAUTHENTICATED','Sign in to view the CCC schedule.');}
   if(typeof decoded?.uid!=='string'||!decoded.uid||decoded.uid.length>128)return fail(401,'UNAUTHENTICATED','Sign in to view the CCC schedule.');
   let validated;try{validated=validateAuthorizedProfile(await findUser(decoded.uid));}
   catch(caught){return backendFailure(caught) || fail(503,'SERVICE_UNAVAILABLE','Unable to validate PAWS access.');}
   if(validated.status)return validated;
   if(!query||typeof query!=='object'||Array.isArray(query)||Object.keys(query).some(key=>key!=='academicYear')
     ||!validYear(query.academicYear))return fail(400,'INVALID_QUERY','Select a valid CCC academic year.');
   try{
    const value=await repository.list({actorFirebaseUid:decoded.uid,academicYear:query.academicYear});
    if(!value||!Array.isArray(value.entries)||value.entries.length>2500)throw Error('Invalid CCC read result.');
    const entries=value.entries.map(sanitizeEntry);
    return {status:200,body:{academicYear:query.academicYear,entries}};
   }catch(error){
    const number=Number(error?.number??error?.originalError?.info?.number);
    if(number===55701)return fail(403,'ROLE_DENIED','CCC schedule access is not authorized.');
    if(number===55702)return fail(400,'INVALID_QUERY','Select a valid CCC academic year.');
    return fail(503,'SERVICE_UNAVAILABLE','CCC schedule is temporarily unavailable.');
   }
  }
 });
}
module.exports={createCccScheduleApi,validYear,sanitizeEntry};
