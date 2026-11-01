'use strict';
// Repository-owned, public release notes. No access tokens, faculty names,
// private records or other internal data may be placed in CHANGELOG.json.
const fs=require('node:fs');
const path=require('node:path');

function safeText(value,label,maxLength){
  if(typeof value!=='string'||!value.trim()||value.length>maxLength){
    throw new Error(label+' must be nonempty plain text (max '+maxLength+' characters).');
  }
  if(/[<>]/.test(value))throw new Error(label+' contains HTML markup.');
  return value;
}

function validCalendarDate(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(value+'T00:00:00Z');
  return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value;
}

function validateChangelog(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||input.schemaVersion!==1||!Array.isArray(input.entries)){
    throw new Error('CHANGELOG.json requires schemaVersion 1 and an entries array.');
  }
  const seen=new Set();
  for(const [index,item] of input.entries.entries()){
    const label='entries['+index+']';
    if(!item||typeof item!=='object'||Array.isArray(item))throw new Error(label+' is not an object.');
    if(!Number.isSafeInteger(item.pr)||item.pr<1)throw new Error(label+'.pr must be a positive PR number.');
    if(seen.has(item.pr))throw new Error('duplicate PR #'+item.pr+' entry; each PR must have one unique entry.');
    seen.add(item.pr);
    if(!validCalendarDate(item.date))throw new Error(label+'.date must be a real YYYY-MM-DD date.');
    safeText(item.title,label+'.title',140);
    if(!Array.isArray(item.changes)||!item.changes.length||item.changes.length>12){
      throw new Error(label+'.changes must contain 1 to 12 plain-language updates.');
    }
    for(const [j,change] of item.changes.entries())safeText(change,label+'.changes['+j+']',500);
  }
  return input;
}

function assertPrUpdated(current,previous,pr){
  const value=validateChangelog(current);
  const before=previous==null?{schemaVersion:1,entries:[]}:validateChangelog(previous);
  const existing=value.entries.find(item=>item.pr===Number(pr));
  if(!existing)throw new Error('PR #'+pr+' must add its own CHANGELOG.json entry.');
  const old=before.entries.find(item=>item.pr===Number(pr));
  if(old&&JSON.stringify(old)===JSON.stringify(existing)){
    throw new Error('PR #'+pr+' has not changed its own CHANGELOG.json entry; update it with this PR’s work.');
  }
  return existing;
}

function publishChangelog(root,outdir){
  const data=validateChangelog(JSON.parse(fs.readFileSync(path.join(root,'CHANGELOG.json'),'utf8')));
  fs.mkdirSync(outdir,{recursive:true});
  fs.writeFileSync(path.join(outdir,'changelog.json'),JSON.stringify(data,null,2)+'\n','utf8');
  return {file:path.join(outdir,'changelog.json'),entries:data.entries.length};
}
module.exports={validateChangelog,assertPrUpdated,publishChangelog};
