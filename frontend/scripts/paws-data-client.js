(function(root,factory){
  'use strict';
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root){
    root.createPawsDataClient=api.createPawsDataClient;
    root.UCVM_PAWS_DATA=api.createPawsDataClient();
  }
})(typeof window==='undefined'?globalThis:window,function(root){
  'use strict';

  const originConfig=root&&root.PAWS_API_ORIGIN_CONFIG
    ?root.PAWS_API_ORIGIN_CONFIG
    :typeof module==='object'&&module.exports?require('./paws-api-origin.js'):null;
  const API_ORIGIN=originConfig&&originConfig.apiOrigin;

  function validateApiOrigin(origin){
    let parsed;
    try{parsed=new URL(origin)}catch(_){throw new Error('The PAWS API origin is invalid.')}
    if(parsed.protocol!=='https:'||parsed.pathname!=='/'||parsed.search||parsed.hash){
      throw new Error('The PAWS API origin must be an HTTPS origin without a path.')
    }
    return parsed.origin;
  }

  // BETA-R4D-12B2A1: the caller may ask for a forced refresh. The Firebase SDK stays
  // responsible for holding and persisting the credential; nothing is cached here.
  function defaultTokenProvider(options){
    if(typeof firebase==='undefined'||!firebase.auth)return Promise.resolve('');
    const user=firebase.auth().currentUser;
    if(!user)return Promise.resolve('');
    return user.getIdToken(options&&options.forceRefresh===true);
  }

  async function safeJson(response){
    try{return await response.json()}catch(_){return{}}
  }

  function createPawsDataClient({
    fetchImpl=(typeof fetch==='function'?fetch.bind(globalThis):null),
    tokenProvider=defaultTokenProvider
  }={}){
    if(!fetchImpl)throw new Error('fetch is required');

    const apiOrigin=validateApiOrigin(API_ORIGIN);
    let writeCapabilities=Object.freeze({});
    let facultyAdminWriteCapability=false;

    // Translates a response into the existing error contract: {status, code, message}.
    async function settle(response){
      const body=await safeJson(response);
      if(!response.ok){
        const error=new Error(body?.error?.message||'The PAWS data service is unavailable.');
        error.code=body?.error?.code||('HTTP_'+response.status);
        error.status=response.status;
        if(body?.error?.details!==undefined)error.details=body.error.details;
        if(Array.isArray(body?.error?.errors))error.errors=body.error.errors;
        if(body?.error?.currentRevision!==undefined)error.currentRevision=body.error.currentRevision;
        if(Array.isArray(body?.rows))error.rows=body.rows;
        throw error;
      }
      return body;
    }

    async function authenticatedResponse(path,{method='GET',body:requestBody,accept='application/json'}={}){
      const url=apiOrigin+path;
      const buildInit=token=>{
        const headers={Authorization:'Bearer '+token,Accept:accept};
        const support=root?.PAWS_SUPPORT?.contextId?.();
        if(support&&!path.startsWith('/api/v1/support'))headers['X-PAWS-Support-Context']=support;
        const init={method,headers,credentials:'omit'};
        if(requestBody!==undefined){headers['Content-Type']='application/json';init.body=JSON.stringify(requestBody)}
        return init;
      };

      const token=await tokenProvider({forceRefresh:false});
      if(!token){
        const error=new Error('Authentication required.');
        error.code='UNAUTHENTICATED';
        throw error;
      }
      const response=await fetchImpl(url,buildInit(token));

      // BETA-R4D-12B2A1 continuity rule: only an explicit HTTP 401 may trigger a forced
      // token refresh and exactly one replay of the same request. 403/404/5xx and
      // transport failures are never replayed, so a non-idempotent write can never be
      // duplicated after an ambiguous partial success. There is no loop and no timer.
      if(response.status!==401)return response;

      let refreshed;
      try{
        refreshed=await tokenProvider({forceRefresh:true});
      }catch(cause){
        const error=new Error('The PAWS session token could not be refreshed.');
        error.code='TOKEN_REFRESH_FAILED';
        error.cause=cause;
        throw error;
      }
      if(!refreshed){
        const error=new Error('The PAWS session could not be re-verified.');
        error.code='SESSION_REAUTH_REQUIRED';
        error.status=401;
        throw error;
      }

      const retryResponse=await fetchImpl(url,buildInit(refreshed));
      if(retryResponse.status===401){
        const body=await safeJson(retryResponse);
        const error=new Error(body?.error?.message||'The PAWS session could not be re-verified.');
        error.code='SESSION_REAUTH_REQUIRED';
        error.status=401;
        throw error;
      }
      return retryResponse;
    }

    async function request(path,options={}){
      const body=await settle(await authenticatedResponse(path,options));
      if(path==='/api/v1/me'&&typeof root?.dispatchEvent==='function'&&typeof root?.CustomEvent==='function')root.dispatchEvent(new root.CustomEvent('paws-profile',{detail:body}));
      return body;
    }

    async function requestBinary(path,options={}){
      const response=await authenticatedResponse(path,{...options,accept:'application/pdf'});
      if(!response.ok)return settle(response);
      const contentType=String(response.headers?.get?.('content-type')||'').split(';',1)[0].trim().toLowerCase();
      if(contentType!=='application/pdf'){
        const error=Error('The PAWS data service returned an invalid artifact response.');
        error.code='INVALID_ARTIFACT_RESPONSE';error.status=response.status;throw error;
      }
      if(typeof response.arrayBuffer!=='function'){
        const error=Error('The PAWS data service returned an invalid artifact response.');
        error.code='INVALID_ARTIFACT_RESPONSE';error.status=response.status;throw error;
      }
      return{
        bytes:new Uint8Array(await response.arrayBuffer()),
        contentType:'application/pdf',
        contentDisposition:String(response.headers?.get?.('content-disposition')||'')
      };
    }

    async function requestTraineeCsv(path){
      const response=await authenticatedResponse(path,{accept:'text/csv'});
      if(!response.ok)return settle(response);
      if(String(response.headers?.get?.('content-type')||'').split(';',1)[0].trim().toLowerCase()!=='text/csv'||typeof response.arrayBuffer!=='function')throw Object.assign(Error('Invalid trainee CSV response.'),{code:'INVALID_ARTIFACT_RESPONSE'});
      const bytes=new Uint8Array(await response.arrayBuffer());
      if(bytes.length>8388608)throw Object.assign(Error('Narrow the trainee filters before exporting.'),{code:'INVALID_ARTIFACT_RESPONSE'});
      return {bytes,contentType:'text/csv; charset=utf-8'};
    }

    function requestPath(id,action=''){
      const value=String(id??'').trim();
      if(!value)throw new Error('afcRequestId is required.');
      return '/api/v1/afc-requests/'+encodeURIComponent(value)+(action?'/'+action:'');
    }

  function pickFields(value,allowed){
      const input=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
      const output={};
      for(const key of allowed){
        if(Object.prototype.hasOwnProperty.call(input,key))output[key]=input[key];
      }
    return output;
  }

  const DOE_FACT_FIELDS = [
    'category','activityType','roleType','teachingRole','courseCode','subjectKey','sessionId','assignmentId',
    'week','year','stage','hours','shifts','weeks','trainees','targetDoe','baseDoe','fte','quantity','date',
    'subjectName','units','courseUnitCount','curriculumStage','hiccEligible','developmentPhase','stream',
    'teachingTarget','rawSupervision','assignedTeaching','scopeText'
  ];
  const doeFacts = facts => pickFields(facts, DOE_FACT_FIELDS);

    async function afcRequestResult(path,options){
      const body=await request(path,options);
      return body.afcRequest&&typeof body.afcRequest==='object'&&!Array.isArray(body.afcRequest)?body.afcRequest:{};
    }

    return Object.freeze({
      reportCatalog:()=>request('/api/v1/reports/catalog'),
      reportQuery:definition=>request('/api/v1/reports/query',{method:'POST',body:definition}),
      reportPage(snapshot,source,offset){return request('/api/v1/reports/page?'+new URLSearchParams({snapshot:String(snapshot),source:String(source),offset:String(offset)}));},
      async reportExport(snapshot,format,source){
        const query=new URLSearchParams({snapshot:String(snapshot),format:String(format)});if(source!==undefined)query.set('source',String(source));
        const file=await request('/api/v1/reports/export?'+query),types={csv:'text/csv',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
        const counts=file?.rowCounts,entries=counts&&typeof counts==='object'&&!Array.isArray(counts)?Object.entries(counts):[];
        if(!types[format]||typeof file?.fileName!=='string'||!/^paws-reports[-a-z0-9]*\.(csv|xlsx)$/.test(file.fileName)||!file.fileName.endsWith('.'+format)||typeof file.contentType!=='string'||file.contentType.split(';')[0]!==types[format]||typeof file.fileBase64!=='string'||file.fileBase64.length>8388608||!file.fileBase64.length||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.fileBase64)||!entries.length||entries.some(([id,count])=>!['workload','schedule','roles','history'].includes(id)||!Number.isSafeInteger(count)||count<0||count>5000)||entries.reduce((sum,[,count])=>sum+count,0)!==file.rowCount||file.rowCount>10000||format==='csv'&&(entries.length!==1||entries[0][0]!==source)){
          const error=new Error('The report download could not be verified. Preview again.');error.code='INVALID_REPORT_ARTIFACT';throw error;
        }
        return file;
      },
      facultyAvailability({facultyId,mode='upcoming',startDate=null,endDate=null,kind='all',cursor=null,limit=50}={}){
        const query=new URLSearchParams({mode,kind,limit:String(limit)});
        if(startDate)query.set('startDate',startDate);
        if(endDate)query.set('endDate',endDate);
        if(cursor)query.set('cursor',String(cursor));
        return request('/api/v1/faculty/'+encodeURIComponent(facultyId||'')+'/availability?'+query.toString());
      },
      dashboardTrainees(filters={}){
        const query=new URLSearchParams();for(const key of ['academicYear','query','category','cursor','limit'])if(filters[key]!==undefined&&filters[key]!==null&&filters[key]!=='')query.set(key,String(filters[key]));
        return request('/api/v1/dashboard/trainees?'+query.toString());
      },
      exportDashboardTrainees(filters={}){
        const query=new URLSearchParams();for(const key of ['academicYear','query','category'])if(filters[key]!==undefined&&filters[key]!==null&&filters[key]!=='')query.set(key,String(filters[key]));
        return requestTraineeCsv('/api/v1/dashboard/trainees/export?'+query.toString());
      },
      changeHistory(filters={}){
        const query=new URLSearchParams();
        for(const key of ['scope','start','end','course','topic','viscSubject','faculty','changeType','academicYear','domain','keyword'])if(typeof filters[key]==='string'&&filters[key])query.set(key,filters[key]);
        return request('/api/v1/change-history?'+query.toString());
      },
      changeHistoryPage(snapshot,offset){return request('/api/v1/change-history/page?'+new URLSearchParams({snapshot:String(snapshot),offset:String(offset)}));},
      changeHistoryExport(snapshot,format){return request('/api/v1/change-history/export?'+new URLSearchParams({snapshot:String(snapshot),format:String(format)}));},
      swapCapabilities:()=>request('/api/v1/swaps/capabilities'),
      async swapFacultyPreview({sessionId,assignmentId,candidateKey,snapshotToken}={}){
        const query=new URLSearchParams({sessionId:String(sessionId||''),assignmentId:String(assignmentId||''),snapshotToken:String(snapshotToken||'')});
        if(candidateKey)query.set('candidateKey',String(candidateKey));
        const body=await request('/api/v1/swaps/faculty-preview?'+query.toString());
        return body.preview&&typeof body.preview==='object'&&!Array.isArray(body.preview)?body.preview:{};
      },
      swapContext(sessionId){
        const id=String(sessionId??'').trim();if(!id)throw new Error('sessionId is required.');
        return request('/api/v1/swaps/context?'+new URLSearchParams({sessionId:id}));
      },
      swapQueue:()=>request('/api/v1/swaps/queue'),
      swapDetail(requestId){return request(swapPath(requestId));},
      createSwap(payload){return request('/api/v1/swaps',{method:'POST',body:payload});},
      reviseSwap(requestId,payload){return request(swapPath(requestId),{method:'PUT',body:payload});},
      decideSwap(requestId,payload){return request(swapPath(requestId)+'/decisions',{method:'POST',body:payload});},
      withdrawSwap(requestId,payload){return request(swapPath(requestId)+'/withdraw',{method:'POST',body:payload});},
      sessionBackend:()=> 'vetmed-ops',
      // Old schedule mutation controls stay closed. API write entry points use
      // their own explicit capabilities below.
      sessionWritesEnabled:()=> false,
      sessionEditEnabled:()=> writeCapabilities.sessionEdit===true,
      sessionCreateEnabled:()=> writeCapabilities.sessionCreate===true,
      afcSingleWriteEnabled:()=> writeCapabilities.afcSingle===true,
      afcBatchWriteEnabled:()=> writeCapabilities.afcBatch===true,
      afcCancelWriteEnabled:()=> writeCapabilities.afcCancel===true,
      async refreshAfcRecordWriteCapabilities(){
        try {
          const body=await request('/api/v1/dashboard/afc-records/write-capabilities');
          const value=body&&typeof body.writeCapabilities==='object'?body.writeCapabilities:{};
          writeCapabilities=Object.freeze({...writeCapabilities,afcSingle:value.afcSingle===true,afcBatch:value.afcBatch===true,afcCancel:value.afcCancel===true});
        } catch (_) {
          writeCapabilities=Object.freeze({...writeCapabilities,afcSingle:false,afcBatch:false,afcCancel:false});
        }
        return {afcSingle:writeCapabilities.afcSingle,afcBatch:writeCapabilities.afcBatch,afcCancel:writeCapabilities.afcCancel};
      },
      async cancelDashboardAfcRecord(afcRecordId,payload={}){
        const id=String(afcRecordId??'').trim();if(!id)throw new Error('AFC record is required.');
        const body=await request('/api/v1/dashboard/afc-records/'+encodeURIComponent(id)+'/cancel',{method:'POST',body:pickFields(payload,['sourceKind','expectedVersion'])});
        return body.afcRecord;
      },
      facultyAdminWriteEnabled:()=> facultyAdminWriteCapability===true,
      doeAdminWriteEnabled:()=> writeCapabilities.doeAdmin===true,
      doeManualAssignmentWriteEnabled:()=> writeCapabilities.doeManualAssignment===true,
      doePolicyPublishEnabled:()=> writeCapabilities.doePolicyPublish===true,
      doeRecalculateEnabled:()=> writeCapabilities.doeRecalculate===true,
      async refreshDoeWriteCapabilities(){
        try{
          const body=await request('/api/v1/doe/write-capabilities');
          const value=body&&typeof body.writeCapabilities==='object'?body.writeCapabilities:{};
          writeCapabilities=Object.freeze({...writeCapabilities,
            doeAdmin:value.doeAdmin===true,
            doeManualAssignment:value.doeManualAssignment===true,
            doePolicyPublish:value.doePolicyPublish===true,
            doeRecalculate:value.doeRecalculate===true
          });
        }catch(_){
          writeCapabilities=Object.freeze({...writeCapabilities,doeAdmin:false,doeManualAssignment:false,doePolicyPublish:false,doeRecalculate:false});
        }
        return {doeAdmin:writeCapabilities.doeAdmin===true,doeManualAssignment:writeCapabilities.doeManualAssignment===true,doePolicyPublish:writeCapabilities.doePolicyPublish===true,doeRecalculate:writeCapabilities.doeRecalculate===true};
      },
      async refreshFacultyAdminWriteCapabilities(){
        try{
          const body=await request('/api/v1/dashboard/faculty-admin/write-capabilities');
          const value=body&&typeof body.writeCapabilities==='object'?body.writeCapabilities:{};
          facultyAdminWriteCapability=value.facultyAdmin===true;
        }catch(_){facultyAdminWriteCapability=false;}
        return facultyAdminWriteCapability===true;
      },
      async refreshWriteCapabilities(){
        const body=await request('/api/v1/afc-requests/write-capabilities');
        const value=body&&typeof body.writeCapabilities==='object'?body.writeCapabilities:{};
        writeCapabilities=Object.freeze({...writeCapabilities,
          sessionEdit:value.sessionEdit===true,
          sessionCreate:value.sessionCreate===true,
          afcSingle:value.afcSingle===true,
          afcBatch:value.afcBatch===true,
          requestLifecycle:value.requestLifecycle===true,
          decisions:value.decisions===true,
          approvedArtifactCreation:value.approvedArtifactCreation===true
        });
        return writeCapabilities;
      },
      async createSession(session={}){
        const body=await request('/api/v1/sessions',{method:'POST',body:pickFields(session,['academicYear','curriculumYear','courseCode','sessionType','date','startTime','endTime','topic','room','assignments'])});
        const saved=body.session&&typeof body.session==='object'&&!Array.isArray(body.session)?{...body.session}:{};
        if(body.doe)saved.doeRecalculation=body.doe;
        return saved;
      },
      async createSessionBatch({requestId,sessions=[]}={}){
        const body=await request('/api/v1/sessions/batch',{method:'POST',body:{requestId:String(requestId??''),sessions:Array.isArray(sessions)?sessions.map(session=>pickFields(session,['academicYear','curriculumYear','courseCode','sessionType','date','startTime','endTime','topic','room','assignments'])):[]}});
        return {sessions:Array.isArray(body.sessions)?body.sessions:[],idempotentReplay:body.idempotentReplay===true,doe:Array.isArray(body.doe)?body.doe:[]};
      },
      async replaceSessionAssignments(sessionId,assignments=[]){
        const id=String(sessionId??'').trim();
        if(!id)throw new Error('sessionId is required.');
        const body=await request('/api/v1/sessions/'+encodeURIComponent(id)+'/assignments',{method:'PATCH',body:{assignments:Array.isArray(assignments)?assignments.map(row=>pickFields(row,['facultyId','teachingRole'])):[]}});
        const saved=body.session&&typeof body.session==='object'&&!Array.isArray(body.session)?{...body.session}:{};
        if(body.doe)saved.doeRecalculation=body.doe;
        return saved;
      },
      async currentUser(){
        const body=await request('/api/v1/me');
        return body.profile;
      },
      async teachingAssignmentWriteCapabilities(){
        const body=await request('/api/v1/teaching-assignments/write-capabilities');
        return body.writeCapabilities&&typeof body.writeCapabilities==='object'?body.writeCapabilities:{};
      },
      async teachingAssignmentWorkQueue({academicYear}={}){
        const query=new URLSearchParams({academicYear:String(academicYear||'')});
        const body=await request('/api/v1/teaching-assignments/work-queue?'+query.toString());
        return Array.isArray(body.workQueue)?body.workQueue:[];
      },
      async teachingAssignmentContributionTargets({academicYear}={}){
        const query=new URLSearchParams({academicYear:String(academicYear||'')});
        const body=await request('/api/v1/teaching-assignments/contribution-targets?'+query.toString());
        return Array.isArray(body.targets)?body.targets:[];
      },
      async teachingAssignmentPackage(packageId){
        const id=String(packageId||'').trim();if(!id)throw new Error('packageId is required.');
        return request('/api/v1/teaching-assignments/packages/'+encodeURIComponent(id));
      },
      async teachingAssignmentHistory(packageId){
        const id=String(packageId||'').trim();if(!id)throw new Error('packageId is required.');
        return request('/api/v1/teaching-assignments/packages/'+encodeURIComponent(id)+'/history');
      },
      async saveTeachingAssignmentDraft(packageId,{expectedWorkingRevision,sessions,revisionNote=null}={}){
        const id=String(packageId||'').trim();if(!id)throw new Error('packageId is required.');
        return request('/api/v1/teaching-assignments/packages/'+encodeURIComponent(id)+'/draft',{method:'POST',body:{expectedWorkingRevision,sessions,revisionNote}});
      },
      async submitTeachingAssignment(packageId,expectedWorkingRevision){
        return request('/api/v1/teaching-assignments/packages/'+encodeURIComponent(String(packageId||''))+'/submit',{method:'POST',body:{expectedWorkingRevision}});
      },
      async addTeachingAssignmentContribution(packageId,{revisionNumber,sessionId,candidateKey,suggestedDisplayName,note=null}={}){
        return request('/api/v1/teaching-assignments/packages/'+encodeURIComponent(String(packageId||''))+'/contributions',{method:'POST',body:{revisionNumber,sessionId,candidateKey,suggestedDisplayName,note}});
      },
      async reviewTeachingAssignment(packageId,{revisionNumber,decision,comment=null}={}){
        return request('/api/v1/teaching-assignments/packages/'+encodeURIComponent(String(packageId||''))+'/reviews',{method:'POST',body:{revisionNumber,decision,comment}});
      },
      async finalSubmitTeachingAssignment(packageId,expectedWorkingRevision){
        return request('/api/v1/teaching-assignments/packages/'+encodeURIComponent(String(packageId||''))+'/final-submit',{method:'POST',body:{expectedWorkingRevision}});
      },
      async saveTeachingAssignmentFinalization(packageId,{expectedWorkingRevision,assignments,finalNote=null}={}){
        return request('/api/v1/teaching-assignments/packages/'+encodeURIComponent(String(packageId||''))+'/finalization',{method:'POST',body:{expectedWorkingRevision,assignments,finalNote}});
      },
      async publishTeachingAssignmentRelease({academicYear,publicationNote=null}={}){
        return request('/api/v1/teaching-assignments/publications',{method:'POST',body:{academicYear,publicationNote}});
      },
      async teachingAssignmentPublished({academicYear}={}){
        const query=new URLSearchParams({academicYear:String(academicYear||'')});
        return request('/api/v1/teaching-assignments/published?'+query.toString());
      },
      async teachingAssignmentPublicationHistory({academicYear}={}){
        const query=new URLSearchParams({academicYear:String(academicYear||'')});
        const body=await request('/api/v1/teaching-assignments/publications/history?'+query.toString());
        return Array.isArray(body.releases)?body.releases:[];
      },
      async listSessions({start=null,end=null}={}){
        const query=new URLSearchParams();
        if(start)query.set('start',String(start));
        if(end)query.set('end',String(end));
        const suffix=query.toString()?'?'+query.toString():'';
        const body=await request('/api/v1/sessions'+suffix);
        return Array.isArray(body.sessions)?body.sessions:[];
      },
      async patchSession(sessionId, patch){
        const id=String(sessionId??'').trim();
        if(!id)throw new Error('sessionId is required.');
        const body=await request('/api/v1/sessions/'+encodeURIComponent(id),{method:'PATCH',body:pickFields(patch,['date','startTime','endTime','courseCode','sessionType','topic','room'])});
        const saved=body.session&&typeof body.session==='object'&&!Array.isArray(body.session)?{...body.session}:{};
        if(body.doe)saved.doeRecalculation=body.doe;
        return saved;
      },
      async dashboardSummary({academicYear=null}={}){
        const query=new URLSearchParams();
        if(String(academicYear??'').trim())query.set('academicYear',String(academicYear));
        const suffix=query.toString()?'?'+query.toString():'';
        const body=await request('/api/v1/dashboard/summary'+suffix);
        return body.summary&&typeof body.summary==='object'&&!Array.isArray(body.summary)?body.summary:{};
      },
      async dashboardFaculty({academicYear=null,search=null,limit=null,status=null}={}){
        const query=new URLSearchParams();
        if(String(academicYear??'').trim())query.set('academicYear',String(academicYear));
        if(String(search??'').trim())query.set('search',String(search));
        if(String(limit??'').trim())query.set('limit',String(limit));
        if(String(status??'').trim())query.set('status',String(status));
        const suffix=query.toString()?'?'+query.toString():'';
        const body=await request('/api/v1/dashboard/faculty'+suffix);
        return Array.isArray(body.faculty)?body.faculty:[];
      },
      async dashboardFacultyById(facultyId,{academicYear=null}={}){
        const id=String(facultyId??'').trim();
        if(!id)throw new Error('facultyId is required.');
        const query=new URLSearchParams();
        if(String(academicYear??'').trim())query.set('academicYear',String(academicYear));
        const suffix=query.toString()?'?'+query.toString():'';
        return request('/api/v1/dashboard/faculty/'+encodeURIComponent(id)+suffix);
      },
      async updateRolePeriods(roleAssignmentId,payload={}){
        return request('/api/v1/dashboard/roles/'+encodeURIComponent(roleAssignmentId)+'/periods',{method:'PUT',body:payload});
      },
      async updateDashboardFaculty(facultyId,payload={}){
        const id=String(facultyId??'').trim();if(!id)throw new Error('facultyId is required.');
        return request('/api/v1/dashboard/faculty/'+encodeURIComponent(id),{method:'PATCH',body:payload});
      },
      async deactivateDashboardFaculty(facultyId,{expectedUpdatedAtUtc,confirm=false}={}){
        const id=String(facultyId??'').trim();if(!id)throw new Error('facultyId is required.');
        return request('/api/v1/dashboard/faculty/'+encodeURIComponent(id)+'/deactivate',{method:'POST',body:{expectedUpdatedAtUtc,confirm}});
      },
      async restoreDashboardFaculty(facultyId,{expectedUpdatedAtUtc}={}){
        const id=String(facultyId??'').trim();if(!id)throw new Error('facultyId is required.');
        return request('/api/v1/dashboard/faculty/'+encodeURIComponent(id)+'/restore',{method:'POST',body:{expectedUpdatedAtUtc}});
      },
      async dashboardTeachingSummary({academicYear=null}={}){
        const query=new URLSearchParams();
        if(String(academicYear??'').trim())query.set('academicYear',String(academicYear));
        const suffix=query.toString()?'?'+query.toString():'';
        const body=await request('/api/v1/dashboard/teaching-summary'+suffix);
        return Array.isArray(body.teachingSummary)?body.teachingSummary:[];
      },
      async dashboardRoles({academicYear=null}={}){
        const query=new URLSearchParams();
        if(String(academicYear??'').trim())query.set('academicYear',String(academicYear));
        const suffix=query.toString()?'?'+query.toString():'';
        const body=await request('/api/v1/dashboard/roles'+suffix);
        return Array.isArray(body.roles)?body.roles:[];
      },
      async dashboardDoeOverview({academicYear=null}={}){
        const query=new URLSearchParams();
        if(String(academicYear??'').trim())query.set('academicYear',String(academicYear));
        const suffix=query.toString()?'?'+query.toString():'';
        const body=await request('/api/v1/dashboard/doe-overview'+suffix);
        return body.doeOverview&&typeof body.doeOverview==='object'&&!Array.isArray(body.doeOverview)?body.doeOverview:{};
      },
      async doeActivePolicy({academicYear}={}){
        const query=new URLSearchParams({academicYear:String(academicYear||'')});
        const body=await request('/api/v1/doe/policy?'+query.toString());
        return body.policy&&typeof body.policy==='object'&&!Array.isArray(body.policy)?body.policy:{};
      },
      async doePolicyVersion({policyVersionId}={}){
        const query=new URLSearchParams({policyVersionId:String(policyVersionId||'')});
        const body=await request('/api/v1/doe/policy-version?'+query.toString());
        return body.policy&&typeof body.policy==='object'&&!Array.isArray(body.policy)?body.policy:{};
      },
      async doePolicyHistory({academicYear}={}){
        const query=new URLSearchParams({academicYear:String(academicYear||'')});
        const body=await request('/api/v1/doe/history?'+query.toString());
        return Array.isArray(body.history)?body.history:[];
      },
      async createDoePolicyDraft(payload={}){
        const body=await request('/api/v1/doe/policies/draft',{method:'POST',body:payload});
        return body.policy&&typeof body.policy==='object'&&!Array.isArray(body.policy)?body.policy:{};
      },
      async copyDoePolicy(payload={}){
        const body=await request('/api/v1/doe/policies/copy',{method:'POST',body:payload});
        return body.policy&&typeof body.policy==='object'&&!Array.isArray(body.policy)?body.policy:{};
      },
      async saveDoePolicyDraft(policyVersionId,payload={}){
        const id=String(policyVersionId??'').trim();if(!id)throw new Error('policyVersionId is required.');
        const body=await request('/api/v1/doe/policies/'+encodeURIComponent(id)+'/draft',{method:'PUT',body:payload});
        return body.policy&&typeof body.policy==='object'&&!Array.isArray(body.policy)?body.policy:{};
      },
      async validateDoePolicyDraft(policyVersionId,payload={}){
        const id=String(policyVersionId??'').trim();if(!id)throw new Error('policyVersionId is required.');
        const body=await request('/api/v1/doe/policies/'+encodeURIComponent(id)+'/validate',{method:'POST',body:payload});
        return body.validation&&typeof body.validation==='object'&&!Array.isArray(body.validation)?body.validation:{};
      },
      async previewDoePolicyImpact(policyVersionId,payload={}){
        const id=String(policyVersionId??'').trim();if(!id)throw new Error('policyVersionId is required.');
        const body=await request('/api/v1/doe/policies/'+encodeURIComponent(id)+'/impact',{method:'POST',body:payload});
        return body.impact&&typeof body.impact==='object'&&!Array.isArray(body.impact)?body.impact:{};
      },
      async publishDoePolicyDraft(policyVersionId,payload={}){
        const id=String(policyVersionId??'').trim();if(!id)throw new Error('policyVersionId is required.');
        const body=await request('/api/v1/doe/policies/'+encodeURIComponent(id)+'/publish',{method:'POST',body:payload});
        return body.publication&&typeof body.publication==='object'&&!Array.isArray(body.publication)?body.publication:{};
      },
      async archiveDoePolicy(policyVersionId,payload={}){
        const id=String(policyVersionId??'').trim();if(!id)throw new Error('policyVersionId is required.');
        const body=await request('/api/v1/doe/policies/'+encodeURIComponent(id)+'/archive',{method:'POST',body:payload});
        return body.policy&&typeof body.policy==='object'&&!Array.isArray(body.policy)?body.policy:{};
      },
      async recalculateDoe({academicYear,limit,preview,expectedPolicyVersionId,expectedPolicyRevision}={}){
        const body=await request('/api/v1/doe/recalculate',{method:'POST',body:{academicYear,limit,...(preview===true?{preview:true}:{}),...(expectedPolicyVersionId?{expectedPolicyVersionId}:{}),...(expectedPolicyRevision!==undefined?{expectedPolicyRevision}:{})}});
        return body.recalculation&&typeof body.recalculation==='object'&&!Array.isArray(body.recalculation)?body.recalculation:{};
      },
      async doePreview({academicYear,facts}={}){
        const body=await request('/api/v1/doe/preview',{method:'POST',body:{academicYear,facts:doeFacts(facts)}});
        return body.preview&&typeof body.preview==='object'&&!Array.isArray(body.preview)?body.preview:{};
      },
      async doeWorkflowPreview({sessionId,outgoingFacultyId,incomingFacultyId}={}){
        const body=await request('/api/v1/doe/workflow-preview',{method:'POST',body:{sessionId:String(sessionId||''),outgoingFacultyId:String(outgoingFacultyId||''),incomingFacultyId:String(incomingFacultyId||'')}});
        return body.preview&&typeof body.preview==='object'&&!Array.isArray(body.preview)?body.preview:{};
      },
      async doeWorksheet({facultyId,academicYear}={}){
        const query=new URLSearchParams({facultyId:String(facultyId||''),academicYear:String(academicYear||'')});
        const body=await request('/api/v1/doe/worksheet?'+query.toString());
        return body.worksheet&&typeof body.worksheet==='object'&&!Array.isArray(body.worksheet)?body.worksheet:{};
      },
      async doeWorksheets({academicYear}={}){
        const query=new URLSearchParams({academicYear:String(academicYear||'')});
        const body=await request('/api/v1/doe/worksheets?'+query.toString());
        return Array.isArray(body.worksheets)?body.worksheets:[];
      },
      async saveDoeAssignment({academicYear,facultyId,facts,notes='',trigger='faculty_edit'}={}){
        const body=await request('/api/v1/doe/assignments',{method:'POST',body:{academicYear,facultyId,facts:doeFacts(facts),notes:String(notes||''),trigger}});
        return body.assignment&&typeof body.assignment==='object'&&!Array.isArray(body.assignment)?body.assignment:{};
      },
      async manualDoeScopeSuggestions({academicYear}={}){
        const body=await request('/api/v1/doe/manual-scope-suggestions?'+new URLSearchParams({academicYear:String(academicYear||'')}));
        return Array.isArray(body.suggestions)?body.suggestions:[];
      },
      async saveManualDoeAssignment(assignmentId,payload){
        const id=String(assignmentId||'').trim();
        const body=await request('/api/v1/doe/manual-assignments'+(id?'/'+encodeURIComponent(id):''),{method:id?'PATCH':'POST',body:payload});
        return body.assignment||{};
      },
      async deactivateManualDoeAssignment(assignmentId,payload){
        const id=String(assignmentId||'').trim();if(!id)throw new Error('Assignment ID required.');
        const body=await request('/api/v1/doe/manual-assignments/'+encodeURIComponent(id),{method:'DELETE',body:payload});
        return body.assignment||{};
      },
      async updateDoeAssignment(assignmentFactId,{academicYear,facultyId,expectedRevision,facts,notes='',trigger='faculty_edit'}={}){
        const id=String(assignmentFactId??'').trim();if(!id)throw new Error('assignmentFactId is required.');
        const body=await request('/api/v1/doe/assignments/'+encodeURIComponent(id),{method:'PATCH',body:{academicYear,facultyId,expectedRevision,facts:doeFacts(facts),notes:String(notes||''),trigger}});
        return body.assignment&&typeof body.assignment==='object'&&!Array.isArray(body.assignment)?body.assignment:{};
      },
      async deactivateDoeAssignment(assignmentFactId,{academicYear,facultyId,expectedRevision,reason=''}={}){
        const id=String(assignmentFactId??'').trim();if(!id)throw new Error('assignmentFactId is required.');
        const body=await request('/api/v1/doe/assignments/'+encodeURIComponent(id),{method:'DELETE',body:{academicYear,facultyId,expectedRevision,reason:String(reason||'')}});
        return body.assignment&&typeof body.assignment==='object'&&!Array.isArray(body.assignment)?body.assignment:{};
      },
      async saveDoeTargetOverride(facultyId,{academicYear,override=null}={}){
        const id=String(facultyId??'').trim();if(!id)throw new Error('facultyId is required.');
        const body=await request('/api/v1/doe/targets/'+encodeURIComponent(id),{method:'PUT',body:{academicYear,override}});
        return body.target&&typeof body.target==='object'&&!Array.isArray(body.target)?body.target:{};
      },
      afcFormCapabilities(){return request('/api/v1/afc-forms/capabilities');},
      listAfcForms(input={}){const q=new URLSearchParams();for(const k of ['facultyId','cursor','limit'])if(input[k]!=null)q.set(k,String(input[k]));return request('/api/v1/afc-forms?'+q);},
      uploadAfcForm(input={}){return request('/api/v1/afc-forms',{method:'POST',body:pickFields(input,['facultyId','requestId','fileName','contentType','fileBase64'])});},
      getAfcFormDocument(id){return requestBinary('/api/v1/afc-forms/'+encodeURIComponent(String(id))+'/document');},
      cccReplacementCapabilities(){return request('/api/v1/ccc-replacements/capabilities');},
      cccReplacementTemplate(){return request('/api/v1/ccc-replacements/template');},
      stageCccReplacement(input={}){return request('/api/v1/ccc-replacements',{method:'POST',body:pickFields(input,['requestId','sourceSha256','academicYear','dataset','fileName','fileBase64'])});},
      getCccReplacement(id){return request('/api/v1/ccc-replacements/'+encodeURIComponent(String(id)));},
      previewCccReplacement(id,input={}){return request('/api/v1/ccc-replacements/'+encodeURIComponent(String(id))+'/preview',{method:'POST',body:pickFields(input,['expectedVersion'])});},
      commitCccReplacement(id,input={}){return request('/api/v1/ccc-replacements/'+encodeURIComponent(String(id))+'/commit',{method:'POST',body:pickFields(input,['academicYear','dataset','expectedVersion','manifestSha256','sourceSha256','idempotencyKey','confirm','completeDataset'])});},
      async dashboardAfcRecords({search=null,reason=null,active=null,limit=null}={}){
        const query=new URLSearchParams();
        if(String(search??'').trim())query.set('search',String(search));
        if(String(reason??'').trim())query.set('reason',String(reason));
        if(active===true||active===false)query.set('active',String(active));
        if(String(limit??'').trim())query.set('limit',String(limit));
        const suffix=query.toString()?'?'+query.toString():'';
        const body=await request('/api/v1/dashboard/afc-records'+suffix);
        return Array.isArray(body.afcRecords)?body.afcRecords:[];
      },
      async createDashboardAfcRecord(payload={}){
        const input=payload&&typeof payload==='object'?payload:{};
        const body=await request('/api/v1/dashboard/afc-records',{method:'POST',body:{
          facultyId:String(input.facultyId??'').trim(),
          startDate:String(input.startDate??'').trim(),
          endDate:String(input.endDate??'').trim(),
          reasonCode:String(input.reasonCode??'').trim(),
          notes:input.notes===undefined||input.notes===null?'':String(input.notes),
          ...(input.documentId?{documentId:String(input.documentId).trim()}:{})
        }});
        return body.afcRecord&&typeof body.afcRecord==='object'?body.afcRecord:{};
      },
      async createDashboardAfcManualBatch(payload={}){
        const input=payload&&typeof payload==='object'?payload:{};
        const rows=Array.isArray(input.rows)?input.rows.map(row=>({
          facultyId:String(row?.facultyId??'').trim(),
          startDate:String(row?.startDate??'').trim(),
          endDate:String(row?.endDate??'').trim(),
          purpose:typeof row?.purpose==='string'?row.purpose:''
        })):[];
        const body=await request('/api/v1/dashboard/afc-records/batch',{method:'POST',body:{
          requestId:String(input.requestId??'').trim(),
          rows
        }});
        return {requestId:body.requestId||String(input.requestId??''),idempotentReplay:body.idempotentReplay===true,rows:Array.isArray(body.rows)?body.rows:[]};
      },
      schedulingTasks(input={}){
        const query=new URLSearchParams();for(const key of ['academicYear','start','end','undated','facultyKey','courseCode','type','reviewStatus','cursor','limit'])if(input[key]!==undefined&&input[key]!==null&&input[key]!=='')query.set(key,String(input[key]));
        return request('/api/v1/scheduling-tasks'+(query.size?'?'+query.toString():''));
      },
      reviewSchedulingTask(issueKey,input={}){return request('/api/v1/scheduling-tasks/'+encodeURIComponent(String(issueKey))+'/review',{method:'POST',body:pickFields(input,['academicYear','expectedEvidenceVersion','expectedReviewVersion','reviewStatus'])});},
      cccSchedule(academicYear){return request('/api/v1/ccc-schedule?academicYear='+encodeURIComponent(String(academicYear)));},
      // Read-only HICC–CC / VISC directory (server-side allow-listed projection; no DOE fields).
      leadershipDirectory(academicYear){return request('/api/v1/dashboard/leadership-directory?academicYear='+encodeURIComponent(String(academicYear)));},
      async listCalendarActivities(input={}){
        const query=new URLSearchParams();for(const key of ['start','end','facultyKey','category','cursor','limit','includeFacultyKeys'])if(input[key]!==undefined&&input[key]!==null&&input[key]!=='')query.set(key,String(input[key]));
        return request('/api/v1/calendar-activities'+(query.size?'?'+query.toString():''));
      },
      calendarActivityCapabilities(){return request('/api/v1/calendar-activities/capabilities');},
      stageCalendarActivityImport(input={}){return request('/api/v1/calendar-activity-imports',{method:'POST',body:pickFields(input,['requestId','sourceSha256','fileName','fileBase64'])});},
      getCalendarActivityImport(batchId){return request('/api/v1/calendar-activity-imports/'+encodeURIComponent(String(batchId)));},
      previewCalendarActivityImport(batchId,input={}){return request('/api/v1/calendar-activity-imports/'+encodeURIComponent(String(batchId))+'/preview',{method:'POST',body:pickFields(input,['expectedVersion'])});},
      commitCalendarActivityImport(batchId,input={}){return request('/api/v1/calendar-activity-imports/'+encodeURIComponent(String(batchId))+'/commit',{method:'POST',body:pickFields(input,['expectedVersion','manifestSha256','sourceSha256','idempotencyKey','confirm'])});},
      resolveCalendarActivityTime(activityId,input={}){return request('/api/v1/calendar-activities/'+encodeURIComponent(String(activityId))+'/time-evidence',{method:'POST',body:pickFields(input,['expectedVersion','date','startTime','endTime','evidenceRef','evidenceNote'])});},
      async listAfcRequests(){
        const body=await request('/api/v1/afc-requests');
        return Array.isArray(body.afcRequests)?body.afcRequests:[];
      },
      async afcWriteCapabilities(){
        const capabilities=await this.refreshWriteCapabilities();
        return {requestLifecycle:capabilities.requestLifecycle===true,decisions:capabilities.decisions===true,approvedArtifactCreation:capabilities.approvedArtifactCreation===true};
      },
      async submitAfcRequest(payload={}){
        const body=pickFields(payload,[
          'startDate','endDate','reason','purposeDestination','coverage','contactAddress','contactPhone',
          'termsAccepted','termsVersion','termsSource','applicantSignature'
        ]);
        return afcRequestResult('/api/v1/afc-requests',{method:'POST',body});
      },
      async withdrawAfcRequest(afcRequestId){
        return afcRequestResult(requestPath(afcRequestId,'withdraw'),{method:'POST'});
      },
      async recommendAfcRequest(afcRequestId,payload={}){
        const body=pickFields(payload,['signature']);
        return afcRequestResult(requestPath(afcRequestId,'recommend'),{method:'POST',body});
      },
      async rejectAfcRequest(afcRequestId,payload={}){
        const body=pickFields(payload,['signature','rejectionReason']);
        return afcRequestResult(requestPath(afcRequestId,'reject'),{method:'POST',body});
      },
      async approveAfcRequest(afcRequestId,payload={}){
        const body=pickFields(payload,['signature']);
        return afcRequestResult(requestPath(afcRequestId,'approve'),{method:'POST',body});
      },
      async getApprovedAfcArtifact(afcRequestId){
        return requestBinary(requestPath(afcRequestId,'approved-artifact'));
      },
      async createApprovedAfcArtifact(afcRequestId){
        return requestBinary(requestPath(afcRequestId,'approved-artifact'),{method:'POST'});
      }
    });
  }

  function swapPath(requestId){
    const id=String(requestId??'').trim();if(!id)throw new Error('requestId is required.');
    return '/api/v1/swaps/'+encodeURIComponent(id);
  }

  return {createPawsDataClient};
});
