'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const rules=fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8');

for(const name of ['doe_reference_sources','doe_course_mappings','doe_subject_mappings']){
  test(`${name} is DOE-admin readable and client read-only after API cutover`,()=>{
    const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const match=rules.match(new RegExp(`match /${escaped}/\\{id\\} \\{([\\s\\S]*?)\\n  \\}`));
    assert.ok(match,`missing Firestore match block for ${name}`);
    assert.match(match[1],/allow read: if doeAdmin\(\)/);
    assert.match(match[1],/allow create,update,delete: if false/);
  });
}
