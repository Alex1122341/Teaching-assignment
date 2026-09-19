'use strict';

function cleanBaseUrl(value){
  const text=String(value||'').trim().replace(/\/+$/,'');
  if(!text)throw Error('Production DOE API base URL is missing.');
  let url;
  try{url=new URL(text)}catch{throw Error('Production DOE API base URL is invalid.')}
  if(url.protocol!=='https:')throw Error('Production DOE API base URL must use HTTPS.');
  if(['localhost','127.0.0.1','0.0.0.0'].includes(url.hostname.toLowerCase()))throw Error('Production DOE API base URL must not target localhost.');
  if(url.username||url.password||url.search||url.hash)throw Error('Production DOE API base URL must not contain credentials, query parameters, or a fragment.');
  return text;
}

function cleanOrigin(value){
  const text=String(value||'').trim().replace(/\/+$/,'');
  if(!text)throw Error('Production frontend origin is missing.');
  let url;
  try{url=new URL(text)}catch{throw Error('Production frontend origin is invalid.')}
  if(url.protocol!=='https:'||url.pathname!=='/'||url.search||url.hash)throw Error('Production frontend origin must be an HTTPS origin without a path, query, or fragment.');
  return text;
}

async function verifyDoeApi({
  baseUrl=process.env.PRODUCTION_DOE_API_BASE_URL,
  origin=process.env.PRODUCTION_FRONTEND_ORIGIN,
  fetchImpl=globalThis.fetch
}={}){
  const base=cleanBaseUrl(baseUrl),allowedOrigin=cleanOrigin(origin);
  if(typeof fetchImpl!=='function')throw Error('Fetch is unavailable.');
  const response=await fetchImpl(`${base}/api/health`,{
    method:'GET',
    headers:{Origin:allowedOrigin,Accept:'application/json'},
    redirect:'error',
    signal:typeof AbortSignal?.timeout==='function'?AbortSignal.timeout(10000):undefined
  });
  const text=await response.text();
  let payload={};
  try{payload=text?JSON.parse(text):{}}catch{throw Error('DOE API health response is not valid JSON.')}
  if(!response.ok)throw Error(`DOE API health check returned HTTP ${response.status}.`);
  if(payload.ok!==true||payload.service!=='ucvm-doe-api')throw Error('DOE API health response does not identify the expected service.');
  const cors=String(response.headers.get('access-control-allow-origin')||'').trim().replace(/\/+$/,'');
  if(cors!==allowedOrigin)throw Error('DOE API does not allow the production frontend origin.');
  return{ok:true,service:payload.service,origin:allowedOrigin};
}

async function main(){
  await verifyDoeApi();
  console.log('Production DOE API health and CORS verified.');
}

if(require.main===module){
  main().catch(error=>{console.error(`Production DOE API verification failed: ${error.message}`);process.exit(1)});
}

module.exports={cleanBaseUrl,cleanOrigin,verifyDoeApi,main};
