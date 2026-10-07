'use strict';

(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(!root)return;

  const tokenProvider=async()=>{
    const user=root.firebase?.auth?.().currentUser;
    if(!user||typeof user.getIdToken!=='function'){
      throw Object.assign(Error('Authentication is required.'),{code:'AUTH_REQUIRED',statusCode:401});
    }
    return user.getIdToken();
  };

  const fetchImpl=(...args)=>{
    if(typeof root.fetch!=='function'){
      throw Object.assign(Error('Browser fetch is unavailable.'),{code:'FETCH_UNAVAILABLE',statusCode:503});
    }
    return root.fetch(...args);
  };

  root.UCVM_PAWS_DATA_FACTORY=Object.freeze(api);
  root.UCVM_PAWS_DATA=api.createPawsDataClient({
    backend:root.UCVM_PAWS_SESSION_BACKEND||'firestore',
    tokenProvider,
    fetchImpl
  });
})(typeof window!=='undefined'?window:null,function(){
  const text=value=>String(value??'').trim();
  const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(text(value));

  function normalizeBackend(value){
    const backend=text(value).toLowerCase()||'firestore';
    if(!['firestore','azure-sql'].includes(backend)){
      throw Object.assign(Error('Unsupported PAWS session backend.'),{code:'INVALID_SESSION_BACKEND'});
    }
    return backend;
  }

  function createPawsDataClient({backend='firestore',tokenProvider,fetchImpl}={}){
    const selected=normalizeBackend(backend);

    async function listSessions({start,end}={}){
      const from=text(start),to=text(end);
      if(!validDate(from)||!validDate(to)||from>to){
        throw Object.assign(Error('start and end must be YYYY-MM-DD and start must not be after end.'),{code:'INVALID_DATE_RANGE',statusCode:400});
      }
      if(selected!=='azure-sql'){
        throw Object.assign(Error('Firestore session reads remain owned by the timetable runtime.'),{code:'FIRESTORE_SESSION_READ_OWNED_BY_TIMETABLE'});
      }
      if(typeof tokenProvider!=='function'||typeof fetchImpl!=='function'){
        throw Object.assign(Error('Authenticated API transport is unavailable.'),{code:'API_TRANSPORT_UNAVAILABLE',statusCode:503});
      }

      const token=await tokenProvider();
      const url=`/api/v1/sessions?start=${encodeURIComponent(from)}&end=${encodeURIComponent(to)}`;
      const response=await fetchImpl(url,{
        method:'GET',
        headers:{Authorization:`Bearer ${token}`,'Accept':'application/json'}
      });
      let payload={};
      try{payload=await response.json()}catch{}
      if(!response.ok){
        const error=Error(text(payload?.message)||'PAWS data service is unavailable.');
        error.code=text(payload?.code)||'API_REQUEST_FAILED';
        error.statusCode=Number(response.status)||503;
        throw error;
      }
      return Array.isArray(payload?.sessions)?payload.sessions:[];
    }

    return Object.freeze({
      listSessions,
      sessionBackend:()=>selected,
      sessionWritesEnabled:()=>selected==='firestore'
    });
  }

  return Object.freeze({createPawsDataClient,normalizeBackend});
});
