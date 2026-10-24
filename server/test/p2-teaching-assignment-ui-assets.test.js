'use strict';

const { repositoryPath } = require('../../tools/build/frontend-paths');
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const root=repositoryPath(__dirname,'../..');
const read=file=>fs.readFileSync(repositoryPath(root,file),'utf8');

test('Teaching Assignment product page ships through Firebase Hosting and separates workflow views',()=>{
  const manifest=JSON.parse(read('tools/static-assets.json'));
  for(const file of ['teaching-assignments.html','teaching-assignments.css','teaching-assignments.js']) assert.ok(manifest.includes(file),`${file} must ship in the Hosting asset manifest`);
  const html=read('teaching-assignments.html');
  for(const id of ['queue-view','contributions-view','published-view','releases-view','publish-view','detail-panel']) assert.match(html,new RegExp(`id="${id}"`));
  assert.match(html,/firebase-auth-compat\.js/);
  assert.match(html,/paws-data-client\.js/);
  const script=read('teaching-assignments.js');
  for(const clientMethod of ['teachingAssignmentWorkQueue','teachingAssignmentContributionTargets','teachingAssignmentPackage','saveTeachingAssignmentDraft','reviewTeachingAssignment','finalSubmitTeachingAssignment','saveTeachingAssignmentFinalization','publishTeachingAssignmentRelease','teachingAssignmentPublished','dashboardFacultyById']) assert.ok(script.includes(`.${clientMethod}(`),`${clientMethod} should use the API client`);
  assert.match(script,/const esc = value =>/);
  assert.match(script,/profile\.active !== true/);
  assert.match(script,/\.confirm\(/);
});
