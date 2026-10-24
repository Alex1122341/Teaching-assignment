'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
test('additive history schema captures event-time evidence without backfilling current assignments',()=>{
 const sql=fs.readFileSync(path.join(root,'database/azure-sql/047_change_history.sql'),'utf8');
 assert.match(sql,/CREATE TABLE paws\.ChangeHistoryContext/);assert.match(sql,/AFTER INSERT/);assert.match(sql,/FROM inserted/);
 assert.match(sql,/CREATE PROCEDURE paws_api\.ListChangeHistoryEvents/);assert.match(sql,/MustChangePassword=0/);assert.match(sql,/paws_api\.HistoryAffectedFaculty/);
 assert.doesNotMatch(sql,/ALTER ROLE.*ADD MEMBER|UPDATE paws\.(?:Session|Faculty|AuditEvent)|DELETE FROM paws\./i);
 const trigger=sql.split('CREATE TRIGGER')[1].split('\nGO')[0];assert.match(trigger,/FROM inserted/);assert.doesNotMatch(trigger,/FROM paws\.AuditEvent/);
 assert.match(sql,/TOP\s*\(10001\)/);assert.match(sql,/paws_runtime_history_read/);
});
test('draft and publication audit snapshots are captured inside existing transactions',()=>{
 const source=fs.readFileSync(path.join(root,'server/src/data/sql-doe-policy-repository.js'),'utf8');
 assert.match(source,/JSON_MODIFY\(@beforeJson,N?'\$\.ruleBook'/);
 assert.match(source,/publishedRuleBook/);assert.match(source,/paws_api\.DoeHistoryPolicySnapshot/);
 assert.match(source,/JSON_QUERY\(paws_api\.DoeHistoryPolicySnapshot\(@policyVersionId\)\) AS ruleBook/);
});
test('forward VISC context uses explicit ownership and the existing DOE roles can invoke the audit snapshot',()=>{
 const sql=fs.readFileSync(path.join(root,'database/azure-sql/047_change_history.sql'),'utf8');
 assert.ok(sql.includes('LEFT JOIN paws.TeachingSessionOwnership'),'must use explicit session ownership');
 assert.ok(sql.includes('subject.Label viscSubject'),'must snapshot the authoritative subject label');
 assert.ok(sql.includes('GRANT EXECUTE ON OBJECT::paws_api.DoeHistoryPolicySnapshot TO paws_runtime_doe_admin_write'),'draft role needs the new scalar function permission');
 assert.ok(sql.includes('GRANT EXECUTE ON OBJECT::paws_api.DoeHistoryPolicySnapshot TO paws_runtime_doe_policy_publish'),'publish role needs the new scalar function permission');
});
