'use strict';

(function(root,factory){
  const api=factory(root);
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root){
    const tracker=api.createTracker();
    tracker.createTracker=api.createTracker;
    tracker.STAGES=api.STAGES;
    root.UCVM_LOGIN_PERFORMANCE=tracker;
  }
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  const STAGES=['T0','T1','T2','T3','T4','T5','T6','T7'];
  const METHODS=new Set(['email','phone','firebase']);
  const FLOWS=new Set(['interactive','restored-session']);
  const FAILURE_KINDS=new Set(['transient','authorization-denied','reauth-required','password-change-required','unexpected','firebase-auth','identity-policy','session-guard','access-routing']);

  function defaultNow(){
    if(root&&root.performance&&typeof root.performance.now==='function')return root.performance.now();
    return 0;
  }

  function createTracker(options={}){
    const now=typeof options.now==='function'?options.now:defaultNow;
    let attempt=null;

    function cleanMethod(value){return METHODS.has(value)?value:'firebase';}
    function cleanFlow(value){return FLOWS.has(value)?value:'interactive';}
    function copyStages(){return attempt?{...attempt.stages}:{};}

    function begin(meta={}){
      const flow=cleanFlow(meta.flow);
      attempt={
        method:cleanMethod(meta.method),
        flow,
        status:'active',
        stages:{},
        failureKind:null
      };
      if(flow==='interactive')attempt.stages.T0=Number(now());
      return snapshot();
    }

    function expectedStage(){
      if(!attempt)return null;
      const present=STAGES.filter(stage=>Object.prototype.hasOwnProperty.call(attempt.stages,stage));
      if(!present.length)return attempt.flow==='restored-session'?'T2':'T0';
      const last=present[present.length-1];
      return STAGES[STAGES.indexOf(last)+1]||null;
    }

    function mark(stage){
      if(!attempt)throw new Error('No active login attempt.');
      if(!STAGES.includes(stage))throw new Error('Unknown login stage.');
      if(Object.prototype.hasOwnProperty.call(attempt.stages,stage))return attempt.stages[stage];
      if(attempt.status!=='active')throw new Error('Login attempt is terminal.');
      const expected=expectedStage();
      if(stage!==expected)throw new Error(`Login stage order violation: expected ${expected||'complete'}, received ${stage}.`);
      const value=Number(now());
      const present=STAGES.filter(name=>Object.prototype.hasOwnProperty.call(attempt.stages,name));
      if(present.length){
        const prior=attempt.stages[present[present.length-1]];
        if(value<prior)throw new Error('Login stage order violation: monotonic clock moved backwards.');
      }
      attempt.stages[stage]=value;
      return value;
    }

    function durations(){
      if(!attempt)return{};
      const s=attempt.stages;
      const between=(a,b)=>Number.isFinite(s[a])&&Number.isFinite(s[b])?s[b]-s[a]:null;
      return {
        firebaseAuth:between('T0','T2'),
        pawsAuthorization:between('T2','T4'),
        profileAccess:between('T4','T5'),
        clientBootstrapRender:between('T5','T7'),
        totalInteractive:between('T0','T7')
      };
    }

    function deltas(){
      if(!attempt)return{};
      const out={};
      for(let i=1;i<STAGES.length;i++){
        const a=STAGES[i-1],b=STAGES[i];
        if(Number.isFinite(attempt.stages[a])&&Number.isFinite(attempt.stages[b]))out[`${a}_${b}`]=attempt.stages[b]-attempt.stages[a];
      }
      return out;
    }

    function snapshot(){
      if(!attempt)return null;
      return {
        method:attempt.method,
        flow:attempt.flow,
        status:attempt.status,
        stages:copyStages(),
        deltas:deltas(),
        durations:durations(),
        ...(attempt.failureKind?{failureKind:attempt.failureKind}:{})
      };
    }

    function fail(info={}){
      if(!attempt)return null;
      if(attempt.status!=='active')return snapshot();
      attempt.status='failed';
      const kind=String(info.kind||'unexpected');
      attempt.failureKind=FAILURE_KINDS.has(kind)?kind:'unexpected';
      return snapshot();
    }

    function complete(){
      if(!attempt)return null;
      if(attempt.status!=='active')return snapshot();
      if(attempt.flow==='interactive'&&!Object.prototype.hasOwnProperty.call(attempt.stages,'T7'))throw new Error('Interactive login cannot complete before T7.');
      attempt.status='complete';
      return snapshot();
    }

    return {begin,mark,fail,complete,snapshot};
  }

  return {STAGES:[...STAGES],createTracker};
});
