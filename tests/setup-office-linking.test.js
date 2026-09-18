'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const setup=fs.readFileSync(path.join(__dirname,'../SETUP.md'),'utf8');

test('setup documents safe linking of pre-existing ADC and LAB Authentication users without embedding credentials',()=>{
 assert.match(setup,/Link existing ADC\/LAB Authentication users/);
 assert.match(setup,/choose \*\*ADC\*\* or \*\*LAB\*\*/i);
 assert.match(setup,/Existing Firebase Authentication UID/);
 assert.match(setup,/Do not recreate the Authentication user/);
 assert.match(setup,/Require password change/);
 assert.match(setup,/Do not store the UID or temporary password/);
});
