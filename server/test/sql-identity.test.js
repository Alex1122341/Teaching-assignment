'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {appServiceManagedIdentityToken,appServiceManagedIdentityTokenWithExpiry}=require('../src/data/sql-identity.js');

test('managed identity token provider uses the App Service local identity endpoint',async()=>{
  const calls=[];
  const token=await appServiceManagedIdentityToken({
    env:{IDENTITY_ENDPOINT:'http://127.0.0.1:41741/MSI/token',IDENTITY_HEADER:'secret-header'},
    fetchImpl:async(url,options)=>{calls.push({url:String(url),options});return{ok:true,json:async()=>({access_token:'sql-token'})}}
  });
  assert.equal(token,'sql-token');
  assert.match(calls[0].url,/resource=https%3A%2F%2Fdatabase\.windows\.net%2F/);
  assert.match(calls[0].url,/api-version=2019-08-01/);
  assert.equal(calls[0].options.headers['X-IDENTITY-HEADER'],'secret-header');
});

test('the expiry-aware provider returns the token with the reported expiry',async()=>{
  const result=await appServiceManagedIdentityTokenWithExpiry({
    env:{IDENTITY_ENDPOINT:'http://127.0.0.1:41741/MSI/token',IDENTITY_HEADER:'secret-header'},
    fetchImpl:async()=>({ok:true,json:async()=>({access_token:'sql-token',expires_on:'1800000000'})})
  });
  assert.deepEqual(result,{token:'sql-token',expiresOn:'1800000000'});
});

test('managed identity fails closed when unavailable or rejected',async()=>{
  await assert.rejects(
    ()=>appServiceManagedIdentityToken({env:{},fetchImpl:async()=>{}}),
    error=>error.code==='SQL_IDENTITY_UNAVAILABLE'
  );
  await assert.rejects(
    ()=>appServiceManagedIdentityToken({
      env:{IDENTITY_ENDPOINT:'http://127.0.0.1:41741/MSI/token',IDENTITY_HEADER:'h'},
      fetchImpl:async()=>({ok:false,json:async()=>({})})
    }),
    error=>error.code==='SQL_IDENTITY_TOKEN_FAILED'
  );
  await assert.rejects(
    ()=>appServiceManagedIdentityToken({
      env:{IDENTITY_ENDPOINT:'http://127.0.0.1:41741/MSI/token',IDENTITY_HEADER:'h'},
      fetchImpl:async()=>({ok:true,json:async()=>({})})
    }),
    error=>error.code==='SQL_IDENTITY_TOKEN_MISSING'
  );
});
