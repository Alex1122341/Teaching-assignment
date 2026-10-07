'use strict';
// Reuse the existing demo smoke; no cloud seed or deployment.
const {execFileSync}=require('node:child_process');
const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
for(const args of [
 ['tools/build-static.js'],
 ['tools/stage-github-pages.js','--directory','.deploy-static','--pr','1','--head-sha',sha,'--build-sha',sha],
 ['tools/browser-smoke.js','--demo']
])execFileSync(process.execPath,args,{stdio:'inherit'});
