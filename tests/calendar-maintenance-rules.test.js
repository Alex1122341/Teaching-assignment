'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const rules=fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8');
test('maintenance source writes require a synchronized calendar companion',()=>{assert.match(rules,/function maintenanceSessionWrite\(id\)[\s\S]*calendarMatchesSourceAfter\(id\)/);assert.match(rules,/allow create:[^\n]*maintenanceSessionWrite\(id\)/);assert.match(rules,/allow update:[^\n]*maintenanceSessionWrite\(id\)/);assert.match(rules,/allow delete:[^\n]*maintenanceSessionDelete\(id\)/);});
test('calendar repair is General-only and matches the current private source',()=>{assert.match(rules,/function generalCalendarRepair\(id\)/);assert.match(rules,/general\(\)[\s\S]*calendarMatchesCurrentSource\(id\)/);assert.match(rules,/allow (?:create|update):[^\n]*generalCalendarRepair\(id\)/);});
