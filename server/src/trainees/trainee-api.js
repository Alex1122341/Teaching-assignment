'use strict';
const {resolveScope}=require('../data/dashboard-api');
const {academicBounds}=require('../master-refresh/master-source-domain');
const {CATEGORIES}=require('./trainee-service');
const fail=(status,code,message)=>({status,body:{error:{code,message}}});
function filters(p,exporting){
 if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!['academicYear','query','category',...(exporting?[]:['cursor','limit'])].includes(k)))throw Error();
 academicBounds(p.academicYear);
 if(p.query!==undefined&&(typeof p.query!=='string'||p.query.length>200)||p.category!==undefined&&p.category!==null&&!CATEGORIES.includes(p.category)||p.cursor!==undefined&&p.cursor!==null&&(typeof p.cursor!=='string'||p.cursor.length>1024))throw Error();
 const limit=p.limit===undefined?25:typeof p.limit==='number'?p.limit:typeof p.limit==='string'&&/^[1-9]\d{0,2}$/.test(p.limit)?Number(p.limit):0;
 if(!Number.isInteger(limit)||limit<1||limit>100)throw Error();
 return{academicYear:p.academicYear,query:(p.query||'').trim(),category:p.category??null,...(!exporting?{cursor:p.cursor??null,limit}:{})};
}
function createTraineeApi({verifyToken,findUser,repository}){
 async function authorize(token){
  let decoded;try{decoded=token&&await verifyToken(token);}catch(_){}
  if(typeof decoded?.uid!=='string'||!decoded.uid||decoded.uid.length>128)return{error:fail(401,'UNAUTHENTICATED','A valid bearer token is required.')};
  const scope=resolveScope(await findUser(decoded.uid));if(scope.status)return{error:scope};
  return{uid:decoded.uid,role:scope.role,facultyId:scope.facultyId};
 }
 async function run(token,p,exporting){
  try{
   const auth=await authorize(token);if(auth.error)return auth.error;
   let input;try{input=filters(p,exporting);}catch(_){return fail(400,'INVALID_TRAINEE_FILTER','Use a valid academic year, category and bounded search.');}
   const result=await repository[exporting?'exportTrainees':'listTrainees']({actorFirebaseUid:auth.uid,expectedScope:{role:auth.role,facultyId:auth.facultyId},...input});
   const current=await authorize(token);if(current.error)return current.error;if(JSON.stringify(current)!==JSON.stringify(auth))return fail(403,'ROLE_DENIED','Your access changed. Refresh the page.');
   return exporting?{status:200,body:result,headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="trainees-${input.academicYear}.csv"`,'Cache-Control':'private, no-store'}}:{status:200,body:result,headers:{'Cache-Control':'private, no-store'}};
  }catch(e){
   const number=Number(e?.number??e?.originalError?.info?.number);
   if(number===55401)return fail(403,'ROLE_DENIED','Your account cannot read this trainee scope.');
   if(e.code==='TRAINEE_CURSOR_CONFLICT')return fail(409,'TRAINEE_CURSOR_CONFLICT','Results changed. Refresh the filters.');
   return fail(503,'TRAINEE_UNAVAILABLE','Trainee records are temporarily unavailable.');
  }
 }
 return Object.freeze({list:(token,p)=>run(token,p,false),export:(token,p)=>run(token,p,true)});
}
module.exports={createTraineeApi};
