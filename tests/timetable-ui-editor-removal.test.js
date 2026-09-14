'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('timetable has no local layout editor while session editing remains available',()=>{
 const html=read('index.html'),js=read('timetable.js'),css=read('timetable.css'),runtime=html+'\n'+js+'\n'+css;
 for(const token of ['ui-editor-panel','ui-edit-mode-btn','bindUIEditorControls','data-ui-editable','UI_SETTINGS_KEY','ucvm_ui_settings'])assert.doesNotMatch(runtime,new RegExp(token));
 assert.doesNotMatch(css,/\.ui-editor-|body\.ui-editing|--ui-sidebar-width/);
 assert.match(js,/function openSessionForm/);
 assert.match(js,/function saveBulkSessions/);
});
