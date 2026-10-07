'use strict';
// Deliberately small evaluator for the documented subset used by our schemas.
const fs=require('node:fs'),path=require('node:path');
const supported=new Set(['$schema','title','type','required','properties','additionalProperties','items','minItems','maxItems','uniqueItems','enum','minLength','maxLength','minimum','maximum','pattern','format']);
function inspect(schema){
 for(const key of Object.keys(schema))if(!supported.has(key))throw Error('Unsupported schema keyword: '+key);
 for(const child of Object.values(schema.properties||{}))inspect(child);
 if(schema.items)inspect(schema.items);
}
function visit(s,v,p){
 const fail=message=>{throw Error(p+': '+message)};
 const types=Array.isArray(s.type)?s.type:[s.type];
 if(!types.some(t=>t==='null'?v===null:t==='array'?Array.isArray(v):t==='object'?v!==null&&typeof v==='object'&&!Array.isArray(v):t==='integer'?Number.isSafeInteger(v):typeof v===t))fail('invalid type');
 if(s.enum&&!s.enum.includes(v))fail('invalid enum');
 if(typeof v==='string'){
  if(v.length<(s.minLength||0)||v.length>(s.maxLength||Infinity))fail('invalid length');
  if(s.pattern&&!new RegExp(s.pattern).test(v))fail('invalid pattern');
  if(s.format&&s.format!=='date-time')fail('unsupported format');
  if(s.format==='date-time'&&(!/^\d{4}-\d{2}-\d{2}T/.test(v)||!Number.isFinite(Date.parse(v))))fail('invalid timestamp');
 }
 if(typeof v==='number'&&(v<(s.minimum??-Infinity)||v>(s.maximum??Infinity)))fail('out of bounds');
 if(Array.isArray(v)){
  if(v.length<(s.minItems||0)||v.length>(s.maxItems||Infinity))fail('invalid array length');
  if(s.uniqueItems&&new Set(v.map(x=>JSON.stringify(x))).size!==v.length)fail('duplicate item');
  v.forEach((x,i)=>visit(s.items,x,p+'['+i+']'));
 }else if(v&&typeof v==='object'){
  for(const k of s.required||[])if(!Object.hasOwn(v,k))fail('missing '+k);
  for(const [k,x]of Object.entries(v)){
   if(!Object.hasOwn(s.properties||{},k)){if(s.additionalProperties===false)fail('unexpected '+k)}
   else visit(s.properties[k],x,p+'.'+k);
  }
 }
}
function validate(name,value){
 if(!['task-spec','review','verification','status'].includes(name))throw Error('Unknown schema');
 const schema=JSON.parse(fs.readFileSync(path.join(__dirname,'../../.ai/schemas',name+'.schema.json'),'utf8'));
 inspect(schema);visit(schema,value,name);return value;
}
module.exports={validate,inspect};
