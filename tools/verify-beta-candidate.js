'use strict';
// Strict frozen Beta runtime verification.
//
// BETA-R4D-11D promotes one immutable Git baseline for both static and API
// runtimes. The old intentional-drift exception model is REMOVED: there is no
// whitelist and any protected runtime drift fails.
//
// This wrapper delegates to tools/beta-freeze.js, which reads immutable Git
// objects from the baseline commit, so a coordinated edit of a runtime file plus
// tools/beta-baseline.json (or the static asset manifest) still fails.
const freeze=require('./beta-freeze');
const apiFreeze=require('./beta-api-freeze');
const staticResult=freeze.verifyFreeze();
const apiResult=apiFreeze.verifyFreeze();
const result={static:staticResult,api:apiResult,ok:staticResult.ok&&apiResult.ok};
if(!result.ok){
  console.error('frozen Beta runtime check FAILED: protected runtime drift is forbidden');
  console.error(JSON.stringify(result,null,2));
  process.exit(1);
}
console.log(JSON.stringify({
  ok:true,
  baselineCommit:staticResult.baselineCommit,
  static:{protected:staticResult.protected,drift:[]},
  api:{runtimeFiles:apiResult.runtimeFiles,buildDefinitionFiles:apiResult.buildDefinitionFiles,drift:[]}
},null,2));
