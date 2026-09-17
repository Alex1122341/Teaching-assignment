'use strict';
const fs=require('node:fs'),path=require('node:path');
module.exports=function sourceFunction(file,name){
 const text=fs.readFileSync(path.resolve(__dirname,'..',file),'utf8');
 const match=new RegExp(`^( +)(?:async )?function ${name}\\(`,'m').exec(text);
 if(!match)throw Error(`Missing production function ${file}:${name}`);
 const start=match.index+match[1].length,lineEnd=text.indexOf('\n',start);
 const first=text.slice(start,lineEnd);
 if(first.trimEnd().endsWith('}'))return first;
 const end=text.indexOf(`\n${match[1]}}`,lineEnd);
 if(end<0)throw Error(`Cannot find function end ${file}:${name}`);
 return text.slice(start,end+match[1].length+2);
};
