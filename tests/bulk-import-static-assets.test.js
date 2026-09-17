'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');

test('shared deployment allowlist includes every bulk import recovery runtime asset',()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'tools/static-assets.json'),'utf8'));
 for(const name of ['bulk-import-core.js','bulk-import-backup.js','bulk-import-firestore.js','bulk-import-controller.js','bulk-import-ui.js','maintenance-state.js'])assert.ok(manifest.includes(name),name);
});

test('Faculty Dashboard loads import modules in dependency order and UI after legacy handler binding',()=>{
 const html=fs.readFileSync(path.join(root,'faculty-admin.html'),'utf8');
 const names=['maintenance-state.js','bulk-import-core.js','bulk-import-backup.js','bulk-import-firestore.js','bulk-import-controller.js','faculty-admin.js','bulk-import-ui.js'];
 const positions=names.map(name=>html.indexOf(name));
 assert.ok(positions.every(value=>value>=0));
 for(let i=1;i<positions.length;i++)assert.ok(positions[i]>positions[i-1],`${names[i]} should load after ${names[i-1]}`);
});
