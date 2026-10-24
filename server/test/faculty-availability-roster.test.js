'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createSqlDashboardRepository}=require('../src/data/sql-dashboard-repository');
const {facultyDisplayNameSql}=require('../src/data/faculty-display-name');
test('Availability roster name search matches its displayed preferred name and retains canonical scope',async()=>{
 const calls=[],repo=createSqlDashboardRepository({query:async(sql,params)=>{calls.push({sql,params});return[];}});
 await repo.faculty({search:'Alex Different',status:'all',facultyId:'own-canonical-id',limit:200});
 const {sql,params}=calls[0],where=sql.slice(sql.lastIndexOf('WHERE '));
 assert.ok(where.includes(facultyDisplayNameSql()+" LIKE @search ESCAPE '\\'"),'Search must include the same preferred-name expression as the displayed roster');
 assert.ok(where.includes('f.FacultyId = @facultyId'));assert.equal(params.facultyId,'own-canonical-id');assert.equal(params.search,'%Alex Different%');
 assert.ok(where.includes('f.DisplayName LIKE @search'),'Legacy source names remain searchable');
});
