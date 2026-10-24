'use strict';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIELDS=Object.freeze(['replacementCandidateKey','courseCode','date','startTime','endTime','sessionType','room','topic']);
function validChanges(changes){
  if(!changes||typeof changes!=='object'||Array.isArray(changes)||!Object.keys(changes).length)return false;
  return Object.entries(changes).every(([key,value])=>FIELDS.includes(key)&&typeof value==='string'&&value.length<=(key==='topic'?4000:key==='room'?256:128))&&
    (!changes.replacementCandidateKey||UUID.test(changes.replacementCandidateKey))&&
    (('startTime' in changes)===('endTime' in changes));
}
const onlyKeys=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key));
module.exports={UUID,FIELDS,validChanges,onlyKeys};
