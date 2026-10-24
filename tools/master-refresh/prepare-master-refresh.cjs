'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {readMasterSource}=require('./source-workbook.cjs');
const {reconcileMasterSource}=require('../../server/src/master-refresh/master-source-domain');
async function prepare({sourcePath,snapshotPath,academicYear,expectedSourceSha256,outputDirectory}){
 const [bytes,snapshotBytes]=await Promise.all([fs.readFile(sourcePath),fs.readFile(snapshotPath)]),snapshot=JSON.parse(snapshotBytes);
 const source=await readMasterSource(bytes,{...snapshot,academicYear,expectedSourceSha256}),comparison=reconcileMasterSource(source,snapshot);
 await fs.mkdir(outputDirectory,{recursive:true});
 await fs.writeFile(path.join(outputDirectory,'master-source.private.json'),JSON.stringify(source,null,2),{flag:'wx'});
 await fs.writeFile(path.join(outputDirectory,'master-comparison.private.json'),JSON.stringify(comparison,null,2),{flag:'wx'});
 const summary={mode:'Plan',academicYear,sourceSha256:source.sourceSha256,manifestSha256:source.manifestSha256,appointments:source.appointments.length,rotations:source.rotations.length,cccSlots:source.cccSlots.length,locumSlots:source.cccSlots.filter(s=>s.staffingKind==='unassigned').length,cccAllocations:source.cccAllocations.length,trainees:source.trainees.length,issues:source.issues.length,operations:comparison.operations.length,heldIssues:comparison.heldIssues.length,databaseWrites:false};
 await fs.writeFile(path.join(outputDirectory,'summary.json'),JSON.stringify(summary,null,2),{flag:'wx'});return summary;
}
if(require.main===module){const args=process.argv.slice(2),fields={'--source':'sourcePath','--snapshot':'snapshotPath','--year':'academicYear','--expected-sha256':'expectedSourceSha256','--output':'outputDirectory'},options={};try{for(let i=0;i<args.length;i+=2){if(!fields[args[i]]||!args[i+1]||options[fields[args[i]]])throw Error('Invalid arguments');options[fields[args[i]]]=args[i+1];}if(Object.keys(options).length!==5)throw Error('Missing arguments');prepare(options).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.code||'MASTER_PREPARE_FAILED');process.exitCode=1;});}catch(_){console.error('Usage: prepare-master-refresh.cjs --source <private.xlsx> --snapshot <private.json> --year YYYY-YY --expected-sha256 <hash> --output <new-private-directory>');process.exitCode=1;}}
module.exports={prepare};
