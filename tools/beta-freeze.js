'use strict';
// Frozen PAWS Beta runtime enforcement.
//
// The immutable trust anchor is the frozen baseline Git commit, not any file in
// the working tree. Every shipped application file listed by the static asset
// manifest is compared byte-for-byte against the blob stored in that commit, so
// editing a runtime file together with `tools/beta-baseline.json` (or with the
// manifest itself) can never produce a green result.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');

// Reviewed faculty presentation-only names are the immutable trust anchor:
// display "Last, First" without changing the SQL identity, ownership, or write
// behavior of the accepted CCC, Availability and Dashboard History release.
// Prior AFC, DOE Rule Book / Lookup UI, Selected Schedule Export, DOE Calculator,
// AUTH-1, P3, P2, P1, W1M and earlier anchors remain immutable historical
// evidence in governance tests.
const BASELINE_COMMIT='58daab3a2401af69c2298cc1f078d78aad069ea9';
const MANIFEST_PATH='tools/static-assets.json';
const { assetSourcePath, sourcePathAtCommit } = require('./build/frontend-paths');

function defaultRoot(){
  return path.resolve(__dirname,'..');
}

// Line-ending canonicalisation: Git stores text with LF while a Windows
// checkout materialises CRLF. Binary assets have no CRLF sequence, so the
// canonical form is identical to the stored blob.
function normalize(buffer){
  const source=Buffer.isBuffer(buffer)?buffer:Buffer.from(String(buffer),'utf8');
  const out=Buffer.allocUnsafe(source.length);
  let length=0;
  for(let i=0;i<source.length;i+=1){
    if(source[i]===0x0d&&source[i+1]===0x0a){
      out[length]=0x0a;
      length+=1;
      i+=1;
      continue;
    }
    out[length]=source[i];
    length+=1;
  }
  return out.subarray(0,length);
}

function sha256Canonical(buffer){
  return crypto.createHash('sha256').update(normalize(buffer),'utf8').digest('hex');
}

function gitBlob(root,ref){
  return execFileSync('git',['cat-file','blob',ref],{cwd:root,maxBuffer:256*1024*1024});
}

function baselineCommitExists(root,baselineCommit){
  try{
    execFileSync('git',['cat-file','-e',`${baselineCommit}^{commit}`],{cwd:root,stdio:'pipe'});
    return true;
  }catch(error){
    return false;
  }
}

function readBaselineFile({root=defaultRoot(),baselineCommit=BASELINE_COMMIT,file}={}){
  return gitBlob(root,`${baselineCommit}:${sourcePathAtCommit(root,baselineCommit,file)}`);
}

function readWorkingFile({root=defaultRoot(),file}={}){
  return fs.readFileSync(assetSourcePath(root,file));
}

function readCurrentManifest({root=defaultRoot(),manifestPath=MANIFEST_PATH}={}){
  return JSON.parse(fs.readFileSync(path.join(root,manifestPath),'utf8'));
}

function readBaselineManifest({root=defaultRoot(),baselineCommit=BASELINE_COMMIT,manifestPath=MANIFEST_PATH}={}){
  return JSON.parse(gitBlob(root,`${baselineCommit}:${manifestPath}`).toString('utf8'));
}

// The protected set is the union of the shipped files named by the current
// manifest and by the manifest recorded in the frozen baseline commit. Removing
// a path from the mutable manifest therefore cannot remove it from the freeze.
function protectedPaths(options={}){
  const root=options.root||defaultRoot();
  const baselineCommit=options.baselineCommit||BASELINE_COMMIT;
  const manifestPath=options.manifestPath||MANIFEST_PATH;
  const current=options.readManifest
    ? options.readManifest()
    : readCurrentManifest({root,manifestPath});
  let historical=[];
  try{
    historical=options.readBaselineManifest
      ? options.readBaselineManifest()
      : readBaselineManifest({root,baselineCommit,manifestPath});
  }catch(error){
    historical=[];
  }
  return [...new Set([...current,...historical])].sort();
}

function bytesMatch(expected,actual){
  const a=Buffer.isBuffer(expected)?expected:Buffer.from(expected);
  const b=Buffer.isBuffer(actual)?actual:Buffer.from(actual);
  if(a.equals(b))return true;
  return normalize(a).equals(normalize(b));
}

function verifyFreeze(options={}){
  const root=options.root||defaultRoot();
  const baselineCommit=options.baselineCommit||BASELINE_COMMIT;
  if(!options.skipCommitCheck&&!baselineCommitExists(root,baselineCommit)){
    throw new Error(`frozen baseline commit ${baselineCommit} is not available in this repository`);
  }
  const files=options.files||protectedPaths({
    root,
    baselineCommit,
    manifestPath:options.manifestPath,
    readManifest:options.readManifest,
    readBaselineManifest:options.readBaselineManifest
  });
  const readBaseline=options.readBaselineFile||(({file})=>readBaselineFile({root,baselineCommit,file}));
  const readWorking=options.readWorking||(({file})=>readWorkingFile({root,file}));
  const drift=[];
  for(const file of files){
    let baseline;
    try{
      baseline=readBaseline({root,baselineCommit,file});
    }catch(error){
      drift.push({file,reason:'missing-at-baseline'});
      continue;
    }
    let actual;
    try{
      actual=readWorking({root,baselineCommit,file});
    }catch(error){
      drift.push({file,reason:'missing-in-verified-copy'});
      continue;
    }
    if(!bytesMatch(baseline,actual))drift.push({file,reason:'content-drift'});
  }
  return {
    baselineCommit,
    protected:files.length,
    checked:files.length,
    drift,
    ok:drift.length===0
  };
}

module.exports={
  BASELINE_COMMIT,
  MANIFEST_PATH,
  baselineCommitExists,
  bytesMatch,
  normalize,
  protectedPaths,
  readBaselineFile,
  readBaselineManifest,
  readCurrentManifest,
  readWorkingFile,
  sha256Canonical,
  verifyFreeze
};

if(require.main===module){
  const argv=process.argv.slice(2);
  const artifactAt=argv.indexOf('--artifact');
  const baselineAt=argv.indexOf('--baseline');
  const options={};
  if(baselineAt>=0&&argv[baselineAt+1]){
    options.baselineCommit=argv[baselineAt+1];
    if(options.baselineCommit!==BASELINE_COMMIT){
      console.error(`refusing to use baseline ${options.baselineCommit}: the frozen baseline is ${BASELINE_COMMIT}`);
      process.exit(1);
    }
  }
  if(artifactAt>=0){
    const artifact=path.resolve(argv[artifactAt+1]||'');
    // Frozen artifact verification checks every shipped static asset via protectedPaths().
    // The retired Azure SWA routing config was never a shipped Firebase manifest asset.
    if(!fs.existsSync(artifact)||!fs.statSync(artifact).isDirectory()){
      console.error(`frozen artifact check failed: ${artifact} is not a directory`);
      process.exit(1);
    }
    options.readWorking=({file})=>fs.readFileSync(path.join(artifact,file));
  }
  const result=verifyFreeze(options);
  if(!result.ok){
    console.error('frozen Azure beta baseline check FAILED');
    console.error(JSON.stringify(result,null,2));
    process.exit(1);
  }
  console.log(JSON.stringify({
    ok:true,
    baselineCommit:result.baselineCommit,
    protected:result.protected
  }));
}
