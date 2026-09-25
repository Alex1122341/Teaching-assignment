'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createSqlPoolRunner}=require('../src/data/sql-connection.js');

test('SQL pool runner uses a server-side connection string without requesting managed identity',async()=>{
  const seen=[];
  class ConnectionPool{
    constructor(config){seen.push(config)}
    async connect(){return this}
    async close(){}
  }
  const run=createSqlPoolRunner({
    sqlModule:{ConnectionPool},
    connectionString:'fixture-sql-connection-string',
    tokenProvider:async()=>{throw Error('managed identity must not run')}
  });
  await run(async()=>true);
  assert.equal(seen[0],'fixture-sql-connection-string');
});

test('SQL pool runner keeps managed identity when connection string is absent',async()=>{
  const seen=[];
  class ConnectionPool{
    constructor(config){seen.push(config)}
    async connect(){return this}
    async close(){}
  }
  const run=createSqlPoolRunner({
    sqlModule:{ConnectionPool},
    connectionString:'',
    tokenProvider:async()=> 'entra-token',
    server:'server.database.windows.net',
    database:'db'
  });
  await run(async()=>true);
  assert.equal(seen[0].authentication.type,'azure-active-directory-access-token');
  assert.equal(seen[0].authentication.options.token,'entra-token');
});

test('SQL pool runner closes the pool after work throws',async()=>{
  let closed=false;
  class ConnectionPool{
    async connect(){return this}
    async close(){closed=true}
  }
  const run=createSqlPoolRunner({
    sqlModule:{ConnectionPool},
    connectionString:'fixture-sql-connection-string'
  });
  await assert.rejects(()=>run(async()=>{throw Error('work failed')}),/work failed/);
  assert.equal(closed,true);
});
