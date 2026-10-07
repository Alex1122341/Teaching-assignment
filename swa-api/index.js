'use strict';
const {app}=require('@azure/functions');
const {registerSwaFunctions}=require('./server/src/runtime/swa-functions.js');
registerSwaFunctions({app});
