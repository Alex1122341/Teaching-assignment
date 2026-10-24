'use strict';
const SOURCE_SHA256='4FDB517FE0B6CDF26678643E6B606D9F8388701AAF7EA540206BEF8A5733E2DF';
function normalizeActivityNameKey(value){return typeof value==='string'?value.replace(/[ \t\r\n\u00a0]+/g,' ').trim().replace(/ *, */g,', ').toUpperCase():'';}
const retained=new Set(['University Travel','Vacation','Vacation/University Travel','RSL','Special Leave','Medical','Parental Leave','Administrative Leave','Study Leave','OPA','Remote Work (approved)'].map(normalizeActivityNameKey));
const working=new Map([
 ['CCC Day','ccc'],['Rotation Participant','rotation_participant'],['Clinical Day / PPVM (external)','clinical_day'],
 ['VETM 581 Clinical Rounds (12:30 - 4:30pm): 9 Sep 2026, 6 Jan 2027, 8 Apr 2027','vetm581_rounds'],
 ['571 - CLINICAL PHARMACOLOGY','vetm571_clinical_pharmacology'],
 ['VETM 591 IM Presentations (all day): 5 Apr 2027','vetm591_presentations'],
 ['Teaching Excellence Program(8-12:30pm)','teaching_excellence']
].map(([name,category])=>[normalizeActivityNameKey(name),category]));
function classifyActivityPurpose(label){const key=normalizeActivityNameKey(label);return retained.has(key)?{treatment:'retain_afc',category:null}:working.has(key)?{treatment:'working_candidate',category:working.get(key)}:{treatment:'quarantined',category:null};}
function approvedActivityImportPolicy(sha){
 if(typeof sha!=='string'||sha.toUpperCase()!==SOURCE_SHA256)throw Object.assign(new Error('An approved workbook is required.'),{code:'APPROVED_SOURCE_REQUIRED'});
 return Object.freeze({sourceSha256:SOURCE_SHA256,dataset:'afc-working-activities',sheetName:'AFC records',excludedRows:Object.freeze([267,297,563,773]),policyVersion:'afc-working-activities-v2'});
}
module.exports={approvedActivityImportPolicy,normalizeActivityNameKey,classifyActivityPurpose};
