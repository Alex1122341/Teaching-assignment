'use strict';
function createFirebaseVerifier({admin,projectId,serviceAccountJson}){if(!projectId)throw Error('FIREBASE_PROJECT_ID is required');let app;function getApp(){if(app)return app;const options={projectId};if(serviceAccountJson)options.credential=admin.credential.cert(JSON.parse(serviceAccountJson));app=admin.initializeApp(options,'paws-beta-sql');return app;}return token=>admin.auth(getApp()).verifyIdToken(token,true);}
module.exports={createFirebaseVerifier};
