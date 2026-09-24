'use strict';
const http=require('node:http');
const {errorPayload,statusFor}=require('./http/errors.js');
const {createDoeRoutes}=require('./routes/doe-routes.js');
const {createDataRoutes}=require('./routes/data-routes.js');

function jsonBody(req){
  return new Promise((resolve,reject)=>{
    let data='';
    req.setEncoding('utf8');
    req.on('data',chunk=>{
      data+=chunk;
      if(data.length>1024*1024){
        reject(Object.assign(Error('Request body exceeds 1 MB.'),{code:'PAYLOAD_TOO_LARGE',statusCode:413}));
        req.destroy();
      }
    });
    req.on('end',()=>{
      if(!data)return resolve({});
      try{resolve(JSON.parse(data))}
      catch(error){reject(Object.assign(Error('Request body must be valid JSON.'),{code:'INVALID_JSON',statusCode:400,cause:error}))}
    });
    req.on('error',reject);
  });
}

function writeJson(res,statusCode,payload){
  const body=JSON.stringify(payload);
  res.writeHead(statusCode,{'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(body)});
  res.end(body);
}

function createHandler({authProvider,services={},allowedOrigins=[]}={}){
  if(!authProvider?.verify)throw new Error('authProvider.verify is required.');
  const originAllowlist=new Set((Array.isArray(allowedOrigins)?allowedOrigins:[]).map(value=>String(value||'').trim().replace(/\/+$/,'')).filter(Boolean));
  const doeRoutes=services.doeRoutes||(services.calculationService?createDoeRoutes({calculationService:services.calculationService,rulebookService:services.rulebookService,worksheetService:services.worksheetService,workflowPreviewService:services.workflowPreviewService,policyAdminService:services.policyAdminService,targetService:services.targetService}):null);
  const dataRoutes=services.dataRoutes||(services.sessionReadService?createDataRoutes({sessionReadService:services.sessionReadService}):null);
  return async function handler(req,res){
    try{
      const url=new URL(req.url,'http://localhost');
      const origin=String(req.headers.origin||'').trim().replace(/\/+$/,'');
      if(origin){
        if(!originAllowlist.has(origin))return writeJson(res,403,{code:'ORIGIN_NOT_ALLOWED',message:'Request origin is not allowed.'});
        res.setHeader('access-control-allow-origin',origin);
        res.setHeader('vary','Origin');
        res.setHeader('access-control-allow-headers','Authorization, Content-Type');
        res.setHeader('access-control-allow-methods','GET, POST, PUT, OPTIONS');
      }
      if(req.method==='OPTIONS'){res.writeHead(204);return res.end()}
      if(req.method==='GET'&&url.pathname==='/api/health'){
        return writeJson(res,200,{ok:true,service:'ucvm-doe-api'});
      }
      if(!url.pathname.startsWith('/api/doe/')&&!url.pathname.startsWith('/api/data/')){
        return writeJson(res,404,{code:'NOT_FOUND',message:'Route not found.'});
      }
      const header=String(req.headers.authorization||'');
      if(!header.startsWith('Bearer ')){
        return writeJson(res,401,{code:'AUTH_REQUIRED',message:'Authentication is required.'});
      }
      const actor=await authProvider.verify(header.slice(7));
      if(!actor?.uid){
        return writeJson(res,401,{code:'AUTH_REQUIRED',message:'Authentication is required.'});
      }
      req.actor=actor;
      req.body=await jsonBody(req);
      if(dataRoutes&&url.pathname.startsWith('/api/data/')){
        const routed=await dataRoutes.handle({method:req.method,path:url.pathname,actor:req.actor,body:req.body,query:Object.fromEntries(url.searchParams.entries())});
        if(routed)return writeJson(res,routed.statusCode,routed.body);
      }
      if(doeRoutes){
        const routed=await doeRoutes.handle({method:req.method,path:url.pathname,actor:req.actor,body:req.body,query:Object.fromEntries(url.searchParams.entries())});
        if(routed)return writeJson(res,routed.statusCode,routed.body);
      }
      if(req.method==='POST'&&url.pathname==='/api/doe/calculate')return writeJson(res,501,{code:'NOT_IMPLEMENTED',message:'DOE calculation service is not configured.'});
      return writeJson(res,404,{code:'NOT_FOUND',message:'Route not found.'});
    }catch(error){
      return writeJson(res,statusFor(error),errorPayload(error));
    }
  };
}

function inject(handler,{method='GET',url='/',headers={},payload}={}){
  return new Promise((resolve,reject)=>{
    const server=http.createServer(handler);
    server.on('error',reject);
    server.listen(0,'127.0.0.1',()=>{
      const address=server.address();
      const body=payload===undefined?'':JSON.stringify(payload);
      const request=http.request({
        hostname:'127.0.0.1',port:address.port,path:url,method,
        headers:{...headers,...(body?{'content-type':'application/json','content-length':Buffer.byteLength(body)}:{})}
      },response=>{
        let data='';
        response.setEncoding('utf8');
        response.on('data',chunk=>{data+=chunk});
        response.on('end',()=>{
          server.close(()=>resolve({
            statusCode:response.statusCode,
            headers:response.headers,
            body:data,
            json:()=>data?JSON.parse(data):null
          }));
        });
      });
      request.on('error',error=>server.close(()=>reject(error)));
      if(body)request.write(body);
      request.end();
    });
  });
}

function createApp(options={}){
  const handler=createHandler(options);
  return{
    handler,
    inject:request=>inject(handler,request),
    listen:(...args)=>http.createServer(handler).listen(...args)
  };
}

module.exports={createApp,createHandler};
