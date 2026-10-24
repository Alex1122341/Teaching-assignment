'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createSqlConnection,buildPoolConfig,normalizeTokenResult}=require('../src/data/sql-connection.js');
const {createSqlSessionRepository}=require('../src/data/sql-session-repository.js');

// A minimal stand-in for the `mssql` surface this module actually uses.
function createFakeSql({failQuery=false}={}){
  const state={poolConstructions:0,connectCalls:0,closedPools:[],bound:[],statements:[],transactions:[]};
  class Request{
    constructor(owner){this.owner=owner;this.inputs=[]}
    input(name,value){this.inputs.push([name,value]);state.bound.push([name,value]);return this}
    async query(statement){
      state.statements.push(statement);
      if(failQuery)throw Object.assign(Error('boom'),{code:'SQL_FAULT'});
      return {recordset:[{ok:1}]};
    }
  }
  class Transaction{
    constructor(pool){this.pool=pool;this.ended=null;this.handlers={}}
    on(event,fn){this.handlers[event]=fn}
    async begin(level){this.level=level;state.transactions.push(this)}
    async commit(){this.ended='commit'}
    async rollback(){this.ended='rollback';this.handlers.rollback?.()}
  }
  class ConnectionPool{
    constructor(config){this.config=config;this.closed=false;state.poolConstructions++}
    async connect(){state.connectCalls++;return this}
    request(){return new Request(this)}
    async close(){this.closed=true;state.closedPools.push(this)}
  }
  return {module:{ConnectionPool,Transaction,Request,ISOLATION_LEVEL:{SERIALIZABLE:'SERIALIZABLE'}},state};
}

test('a single pool serves every query instead of one handshake per call',async()=>{
  const {module,state}=createFakeSql();
  const connection=createSqlConnection({sqlModule:module,tokenProvider:async()=>'token',server:'srv',database:'db'});
  await connection.query('SELECT 1');
  await connection.query('SELECT 2');
  await connection.query('SELECT 3');
  assert.equal(state.poolConstructions,1);
  assert.equal(state.connectCalls,1);
  await connection.close();
});

test('concurrent first callers share one connection attempt',async()=>{
  const {module,state}=createFakeSql();
  let release;
  const gate=new Promise(resolve=>{release=resolve});
  const connection=createSqlConnection({
    sqlModule:module,
    tokenProvider:async()=>{await gate;return 'token'},
    server:'srv',database:'db'
  });
  const all=Promise.all([connection.query('SELECT 1'),connection.query('SELECT 2'),connection.query('SELECT 3')]);
  release();
  await all;
  // Without the shared in-flight attempt this would be 3 pools and 3 handshakes.
  assert.equal(state.poolConstructions,1);
  assert.equal(state.connectCalls,1);
  await connection.close();
});

test('the pool is rebuilt before the bound token expires',async()=>{
  const {module,state}=createFakeSql();
  let clock=1_000_000;
  let issued=0;
  const connection=createSqlConnection({
    sqlModule:module,
    tokenProvider:async()=>{issued++;return {token:`token-${issued}`,expiresOn:(clock+60000)/1000}},
    server:'srv',database:'db',
    now:()=>clock
  });
  await connection.query('SELECT 1');
  assert.equal(state.poolConstructions,1);
  // Still inside the token lifetime: no rebuild.
  clock+=30000;
  await connection.query('SELECT 2');
  assert.equal(state.poolConstructions,1);
  // Past expiry: the stale pool must be replaced, not reused.
  clock+=60000;
  await connection.query('SELECT 3');
  assert.equal(state.poolConstructions,2);
  assert.equal(state.closedPools.length,1,'the expired pool must be closed');
  assert.equal(issued,2);
  await connection.close();
});

test('token results are normalised whether they arrive as a string or with an expiry',()=>{
  const now=1_000_000;
  assert.deepEqual(normalizeTokenResult('abc',60000,now),{token:'abc',expiresAt:now+60000});
  // Epoch seconds.
  assert.deepEqual(normalizeTokenResult({token:'t',expiresOn:2_000_000},60000,now),{token:'t',expiresAt:2_000_000_000});
  // Epoch milliseconds (Azure also reports this shape).
  assert.deepEqual(normalizeTokenResult({token:'t',expiresOn:1_700_000_000_000},60000,now),{token:'t',expiresAt:1_700_000_000_000});
  assert.deepEqual(normalizeTokenResult({access_token:'t'},60000,now),{token:'t',expiresAt:now+60000});
  assert.throws(()=>normalizeTokenResult('',60000,now),error=>error.code==='SQL_IDENTITY_TOKEN_MISSING');
  assert.throws(()=>normalizeTokenResult(null,60000,now),error=>error.code==='SQL_IDENTITY_TOKEN_INVALID');
});

test('a transaction commits on success and rolls back on failure',async()=>{
  const {module,state}=createFakeSql();
  const connection=createSqlConnection({sqlModule:module,tokenProvider:async()=>'token',server:'srv',database:'db'});
  const value=await connection.transaction(async tx=>{await tx.query('UPDATE a');return 42});
  assert.equal(value,42);
  assert.equal(state.transactions[0].ended,'commit');
  assert.equal(state.transactions[0].level,'SERIALIZABLE');

  await assert.rejects(
    ()=>connection.transaction(async tx=>{await tx.query('UPDATE b');throw Object.assign(Error('nope'),{code:'NOPE'})}),
    error=>error.code==='NOPE'
  );
  assert.equal(state.transactions[1].ended,'rollback');
  await connection.close();
});

test('parameters bind explicit nulls and skip only undefined',async()=>{
  const {module,state}=createFakeSql();
  const connection=createSqlConnection({sqlModule:module,tokenProvider:async()=>'token',server:'srv',database:'db'});
  await connection.query('SELECT @a,@b,@c',{a:'x',b:null,c:undefined});
  assert.deepEqual(state.bound,[['a','x'],['b',null]]);
  await connection.close();
});

test('closing the connection closes the pool and refuses further work',async()=>{
  const {module,state}=createFakeSql();
  const connection=createSqlConnection({sqlModule:module,tokenProvider:async()=>'token',server:'srv',database:'db'});
  await connection.query('SELECT 1');
  await connection.close();
  assert.equal(state.closedPools.length,1);
  await assert.rejects(()=>connection.query('SELECT 2'),error=>error.code==='SQL_CONNECTION_CLOSED');
});

test('configuration is validated rather than defaulted silently',()=>{
  assert.throws(()=>createSqlConnection({tokenProvider:async()=>'t'}),error=>error.code==='SQL_CONFIG_INVALID');
  assert.throws(()=>createSqlConnection({tokenProvider:async()=>'t',server:'srv',database:'db',requestTimeoutMs:10}),error=>error.code==='SQL_CONFIG_INVALID');
  assert.throws(()=>createSqlConnection({tokenProvider:async()=>'t',server:'srv',database:'db',tokenRefreshMs:1}),error=>error.code==='SQL_CONFIG_INVALID');
  assert.throws(()=>buildPoolConfig({server:'',database:'db',token:'t'}),error=>error.code==='SQL_CONFIG_INVALID');
  assert.throws(()=>buildPoolConfig({server:'srv',database:'',token:'t'}),error=>error.code==='SQL_CONFIG_INVALID');
  const config=buildPoolConfig({server:'srv',database:'db',token:'t',requestTimeoutMs:5000});
  assert.equal(config.authentication.type,'azure-active-directory-access-token');
  assert.equal(config.authentication.options.token,'t');
  assert.equal(config.options.encrypt,true);
  assert.equal(config.options.trustServerCertificate,false);
  assert.equal(config.requestTimeout,5000);
});

test('the session repository reuses one pool across reads and filters a supplied year only',async()=>{
  const {module,state}=createFakeSql();
  const repository=createSqlSessionRepository({sqlModule:module,tokenProvider:async()=>'token'});
  await repository.listSessions({start:'2027-03-22',end:'2027-03-22'});
  await repository.listSessions({start:'2027-03-22',end:'2027-03-23',facultyEmail:'f@x.test'});
  // Regression guard for the per-request pool that used to exist here.
  assert.equal(state.poolConstructions,1);

  const unfiltered=state.statements[0];
  assert.doesNotMatch(unfiltered,/v\.AcademicYear = @academicYear/);
  assert.deepEqual(state.bound.slice(0,2),[['start','2027-03-22'],['end','2027-03-22']]);

  await repository.listSessions({start:'2027-03-22',end:'2027-03-23',academicYear:'2026-27'});
  const filtered=state.statements[2];
  assert.match(filtered,/v\.AcademicYear = @academicYear/);
  assert.deepEqual(state.bound.slice(-1),[['academicYear','2026-27']]);
  await repository.close();
});
