'use strict';
// Firebase Lab DOE reader — READ-ONLY by design.
//
// This adapter exists so the Rule Book can render real Firestore DOE policy
// data from the isolated lab project (`vista-teaching-lab`). It deliberately
// exposes no write capability: authoritative DOE writes require the trusted
// backend, and `firestore.rules` intentionally denies browser writes to these
// collections. Every write method fails closed with TRUSTED_DOE_BACKEND_REQUIRED.
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.UCVM_DOE_FIREBASE_LAB=api;
})(typeof window!=='undefined'?window:null,function(){
  const LAB_PROJECT_ID='vista-teaching-lab';
  const WRITE_ERROR_CODE='TRUSTED_DOE_BACKEND_REQUIRED';

  const COLLECTIONS=Object.freeze({
    policies:'doe_policies',
    versions:'doe_policy_versions',
    rules:'doe_rules',
    selectors:'doe_rule_selectors',
    parameters:'doe_rule_parameters',
    tiers:'doe_rule_tiers',
    inputs:'doe_rule_inputs',
    exceptions:'doe_exceptions',
    references:'doe_reference_sources',
    courseMappings:'doe_course_mappings',
    subjectMappings:'doe_subject_mappings',
    impactRuns:'doe_impact_runs',
    impactRows:'doe_impact_rows',
    publications:'doe_publications',
    calculations:'doe_calculation_records',
    audit:'doe_audit_log'
  });

  const WRITE_METHODS=Object.freeze([
    'saveRule','testRule','saveException','createPolicyYear','cloneAsDraft','validateDraft',
    'runImpactPreview','publish','archive','previewRecalculate','runRecalculate','copyPolicyYear',
    'saveCourseMapping','saveSubjectMapping','saveReference','saveReservePolicy'
  ]);

  function writeBlocked(action){
    const error=new Error(`${action} requires the trusted DOE backend. Firebase Lab mode renders live DOE policy data but cannot write authoritative DOE policy.`);
    error.code=WRITE_ERROR_CODE;
    return error;
  }

  function text(value){return String(value??'').trim()}

  function toObject(snapshot){
    if(!snapshot)return null;
    const data=typeof snapshot.data==='function'?snapshot.data():snapshot.data;
    if(!data)return null;
    return Object.assign({id:snapshot.id},data);
  }

  function timestampText(value){
    if(!value)return '';
    if(typeof value==='string')return value;
    if(typeof value.toDate==='function')return value.toDate().toISOString();
    if(value instanceof Date)return value.toISOString();
    return '';
  }

  async function select(firestore,collection,filters){
    let reference=firestore.collection(collection);
    for(const filter of filters){
      if(filter&&filter.field)reference=reference.where(filter.field,filter.operator||'==',filter.value);
    }
    const snapshot=await reference.get();
    const docs=typeof snapshot.docs!=='undefined'?snapshot.docs:[];
    return docs.map(toObject).filter(Boolean);
  }

  function byTextAscending(field){
    return (a,b)=>text(a[field]).localeCompare(text(b[field]));
  }

  function byTimestampDescending(fields){
    return (a,b)=>{
      for(const field of fields){
        const left=timestampText(a[field]),right=timestampText(b[field]);
        if(left!==right)return left<right?1:-1;
      }
      return 0;
    };
  }

  function requireFirestore(firestore){
    if(!firestore||typeof firestore.collection!=='function'){
      const error=new Error('Firebase Lab DOE reader requires a Cloud Firestore instance from vista-teaching-lab.');
      error.code='FIREBASE_LAB_FIRESTORE_UNAVAILABLE';
      throw error;
    }
    return firestore;
  }

  function createService(options={}){
    const firestore=options.firestore;
    const resolve=typeof firestore==='function'?firestore:()=>firestore;
    const db=()=>requireFirestore(resolve());

    const api={
      readOnly:true,
      labOnly:true,
      authoritative:false,
      backend:'firebase-lab-firestore',
      projectId:LAB_PROJECT_ID,
      doeLabel:'DOE policy data LIVE · authoritative writer OFF',
      isConfigured:()=>true,
      collections:COLLECTIONS,

      async listPolicies(){
        const policies=await select(db(),COLLECTIONS.policies,[]);
        return policies.sort(byTextAscending('academicYear'));
      },

      async listVersions(policyId){
        const id=text(policyId);
        if(!id)return [];
        const versions=await select(db(),COLLECTIONS.versions,[{field:'policyId',value:id}]);
        return versions.sort((a,b)=>Number(b.versionNumber||0)-Number(a.versionNumber||0));
      },

      async loadPolicyBundle(policyVersionId){
        const versionId=text(policyVersionId);
        if(!versionId)return null;
        const versionSnapshot=await db().collection(COLLECTIONS.versions).doc(versionId).get();
        const version=toObject(versionSnapshot);
        if(!version)return null;
        const policyId=text(version.policyId);
        const policy=policyId?toObject(await db().collection(COLLECTIONS.policies).doc(policyId).get()):null;

        const [rules,exceptions,references,courseMappings,subjectMappings]=await Promise.all([
          select(db(),COLLECTIONS.rules,[{field:'policyVersionId',value:versionId}]),
          select(db(),COLLECTIONS.exceptions,[{field:'policyVersionId',value:versionId}]),
          select(db(),COLLECTIONS.references,[{field:'policyVersionId',value:versionId}]),
          select(db(),COLLECTIONS.courseMappings,[{field:'policyVersionId',value:versionId}]),
          select(db(),COLLECTIONS.subjectMappings,[{field:'policyVersionId',value:versionId}])
        ]);

        const [selectors,parameters,tiers,inputs]=await Promise.all([
          select(db(),COLLECTIONS.selectors,[{field:'policyVersionId',value:versionId}]),
          select(db(),COLLECTIONS.parameters,[{field:'policyVersionId',value:versionId}]),
          select(db(),COLLECTIONS.tiers,[{field:'policyVersionId',value:versionId}]),
          select(db(),COLLECTIONS.inputs,[{field:'policyVersionId',value:versionId}])
        ]);

        const groupByRule=list=>{
          const map=new Map();
          for(const row of list){
            const key=text(row.ruleId);
            if(!key)continue;
            if(!map.has(key))map.set(key,[]);
            map.get(key).push(row);
          }
          return map;
        };
        const selectorMap=groupByRule(selectors),parameterMap=groupByRule(parameters),
          tierMap=groupByRule(tiers),inputMap=groupByRule(inputs);

        const hydratedRules=rules
          .map(rule=>Object.assign({},rule,{
            selectors:(selectorMap.get(text(rule.ruleId))||[]).slice(),
            parameters:(parameterMap.get(text(rule.ruleId))||[]).slice(),
            tiers:(tierMap.get(text(rule.ruleId))||[]).slice(),
            inputs:(inputMap.get(text(rule.ruleId))||[]).slice()
          }))
          .sort((a,b)=>Number(a.priority||0)-Number(b.priority||0)||byTextAscending('ruleKey')(a,b));

        return{
          policy:policy||{policyId,academicYear:version.academicYear},
          version,
          references,
          rules:hydratedRules,
          exceptions,
          courseMappings,
          subjectMappings
        };
      },

      async listAudit(policyVersionId){
        const versionId=text(policyVersionId);
        if(!versionId)return [];
        const rows=await select(db(),COLLECTIONS.audit,[{field:'policyVersionId',value:versionId}]);
        return rows.sort(byTimestampDescending(['changedAt','createdAt'])).slice(0,50);
      },

      async getImpactPreview(policyVersionId){
        const versionId=text(policyVersionId);
        if(!versionId)return null;
        const runs=await select(db(),COLLECTIONS.impactRuns,[{field:'policyVersionId',value:versionId}]);
        if(!runs.length)return null;
        const run=runs.slice().sort(byTimestampDescending(['completedAt','startedAt','createdAt']))[0];
        const runId=text(run.impactRunId||run.runId||run.id);
        const rows=runId?await select(db(),COLLECTIONS.impactRows,[{field:'impactRunId',value:runId}]):[];
        return{run,rows};
      },

      async listPublications(policyVersionId){
        const versionId=text(policyVersionId);
        const filters=versionId?[{field:'policyVersionId',value:versionId}]:[];
        return select(db(),COLLECTIONS.publications,filters);
      },

      async listCalculationRecords(policyVersionId){
        const versionId=text(policyVersionId);
        const filters=versionId?[{field:'policyVersionId',value:versionId}]:[];
        return select(db(),COLLECTIONS.calculations,filters);
      }
    };

    for(const name of WRITE_METHODS){
      api[name]=async()=>{throw writeBlocked(name)};
    }

    return Object.freeze(api);
  }

  function browserService(){
    const root2=typeof window!=='undefined'?window:null;
    return createService({firestore:()=>{
      const sdk=root2&&root2.firebase;
      if(!sdk||typeof sdk.firestore!=='function'){
        const error=new Error('Firebase Lab mode requires the Firebase Web SDK.');
        error.code='FIREBASE_LAB_FIRESTORE_UNAVAILABLE';
        throw error;
      }
      return sdk.firestore();
    }});
  }

  return{
    COLLECTIONS,
    WRITE_METHODS,
    WRITE_ERROR_CODE,
    LAB_PROJECT_ID,
    createService,
    browserService,
    writeBlocked
  };
});
