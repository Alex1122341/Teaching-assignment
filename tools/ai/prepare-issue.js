'use strict';
// Runs only on the default branch in the read-only artifact workflow.
const fs=require('node:fs'),path=require('node:path');
const {id}=require('./safety.js'),task=require('./task.js');
const {issueFromGitHub}=require('./cli.js');
const REPO='Alex1122341/Teaching-assignment';
async function prepare(env=process.env){
 if(env.GITHUB_REPOSITORY!==REPO)throw Error('Unexpected repository');
 const event=JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH,'utf8'));
 if(event.issue?.pull_request)throw Error('Expected an issue, not PR');
 if(env.GITHUB_EVENT_NAME==='issues'&&event.label?.name!=='ai-ready')throw Error('Expected ai-ready label');
 const number=id(env.AI_ISSUE_NUMBER||event.issue?.number);
 const actor=env.GITHUB_ACTOR;
 if(!/^[A-Za-z0-9-]+$/.test(actor||''))throw Error('Invalid actor');
 const response=await fetch('https://api.github.com/repos/'+REPO+'/collaborators/'+actor+'/permission',{
  headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+env.GH_TOKEN,'User-Agent':'vista-ai-v1'},
  signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('Cannot verify actor repository permission');
 const access=await response.json();
 if(!['admin','maintain','write'].includes(access.permission))throw Error('Only repository maintainers can generate issue artifacts');
 const issue=await issueFromGitHub(number,env.GH_TOKEN);
 if(issue.state!=='open')throw Error('Issue is not open');
 const root=path.resolve(__dirname,'../..');
 task.init(root,issue);task.prompt(root,number,'architect');
 console.log('Prepared task '+number+'; download the artifact, review it, then commit on your own task branch.');
}
if(require.main===module)prepare().catch(e=>{console.error(e.message);process.exitCode=1});
module.exports={prepare};
