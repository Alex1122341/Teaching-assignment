'use strict';

const PREFIX='/api/v1/teaching-assignments';
const bearer=request=>{const h=request.headers?.get?.('authorization')||'';return /^Bearer /i.test(h)?h.slice(7):'';};
const reply=result=>({status:result.status,jsonBody:result.body});
const json=async request=>{try{return typeof request.json==='function'?await request.json():request.body;}catch(_){return null;}};

function createTeachingAssignmentFunctions({api}) {
  return async request=>{
    try {
      const url=new URL(request.url); const pathname=url.pathname.replace(/\/+$/,'')||'/'; const token=bearer(request);
      if(pathname===`${PREFIX}/write-capabilities`) {
        if(request.method!=='GET')return {status:405,headers:{Allow:'GET'},jsonBody:{error:{code:'METHOD_NOT_ALLOWED',message:'GET required.'}}};
        return reply(await api.writeCapabilities(token));
      }
      if (pathname===`${PREFIX}/work-queue`) {
        if(request.method!=='GET')return {status:405,headers:{Allow:'GET'},jsonBody:{error:{code:'METHOD_NOT_ALLOWED',message:'GET required.'}}};
        return reply(await api.workQueue(token,{academicYear:url.searchParams.get('academicYear')}));
      }
      if (pathname===`${PREFIX}/contribution-targets`) {
        if(request.method!=='GET')return {status:405,headers:{Allow:'GET'},jsonBody:{error:{code:'METHOD_NOT_ALLOWED',message:'GET required.'}}};
        return reply(await api.contributionTargets(token,{academicYear:url.searchParams.get('academicYear')}));
      }
      if (pathname===`${PREFIX}/published`) {
        if(request.method!=='GET')return {status:405,headers:{Allow:'GET'},jsonBody:{error:{code:'METHOD_NOT_ALLOWED',message:'GET required.'}}};
        return reply(await api.published(token,{academicYear:url.searchParams.get('academicYear')}));
      }
      if(pathname===`${PREFIX}/publications/history`) {
        if(request.method!=='GET')return {status:405,headers:{Allow:'GET'},jsonBody:{error:{code:'METHOD_NOT_ALLOWED',message:'GET required.'}}};
        return reply(await api.publicationHistory(token,{academicYear:url.searchParams.get('academicYear')}));
      }
      if (pathname===`${PREFIX}/publications`) {
        if(request.method!=='POST')return {status:405,headers:{Allow:'POST'},jsonBody:{error:{code:'METHOD_NOT_ALLOWED',message:'POST required.'}}};
        const payload=await json(request);if(payload===null)return {status:400,jsonBody:{error:{code:'INVALID_JSON',message:'Request JSON is invalid.'}}};
        return reply(await api.publish(token,payload));
      }
      const match=new RegExp(`^${PREFIX}/packages/([^/]+)(?:/(draft|contributions|submit|reviews|final-submit|finalization|history))?$`).exec(pathname);
      if(!match)return {status:404,jsonBody:{error:{code:'NOT_FOUND',message:'Route not found.'}}};
      let packageId;try{packageId=decodeURIComponent(match[1]);}catch(_){return {status:400,jsonBody:{error:{code:'INVALID_PACKAGE_ID',message:'The package identifier is invalid.'}}};}
      const action=match[2];
      if(action==='history') {
        if(request.method!=='GET')return {status:405,headers:{Allow:'GET'},jsonBody:{error:{code:'METHOD_NOT_ALLOWED',message:'GET required.'}}};
        return reply(await api.history(token,packageId));
      }
      if(!action) {
        if(request.method!=='GET')return {status:405,headers:{Allow:'GET'},jsonBody:{error:{code:'METHOD_NOT_ALLOWED',message:'GET required.'}}};
        return reply(await api.getPackage(token,packageId));
      }
      if(request.method!=='POST')return {status:405,headers:{Allow:'POST'},jsonBody:{error:{code:'METHOD_NOT_ALLOWED',message:'POST required.'}}};
      const payload=await json(request);if(payload===null)return {status:400,jsonBody:{error:{code:'INVALID_JSON',message:'Request JSON is invalid.'}}};
      if(action==='draft')return reply(await api.saveDraft(token,{...payload,packageId}));
      if(action==='contributions')return reply(await api.addContribution(token,packageId,payload));
      if(action==='submit')return reply(await api.submit(token,packageId,payload));
      if(action==='reviews')return reply(await api.review(token,packageId,payload));
      if(action==='final-submit')return reply(await api.finalSubmit(token,packageId,payload));
      return reply(await api.saveFinalization(token,packageId,payload));
    } catch(_) { return {status:503,jsonBody:{error:{code:'SERVICE_UNAVAILABLE',message:'The workflow service is temporarily unavailable.'}}}; }
  };
}

module.exports={createTeachingAssignmentFunctions};
