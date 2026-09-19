'use strict';

function createFirebaseAuthProvider({adminAuth,firestore}){
  if(!adminAuth?.verifyIdToken)throw new Error('Firebase Admin Auth is required.');
  if(!firestore?.collection)throw new Error('Firestore is required.');
  return{
    async verify(idToken){
      const decoded=await adminAuth.verifyIdToken(String(idToken));
      const snap=await firestore.collection('users').doc(decoded.uid).get();
      if(!snap.exists)throw Object.assign(Error('User profile is missing.'),{code:'PROFILE_REQUIRED',statusCode:403});
      const profile=snap.data()||{};
      return{
        uid:String(decoded.uid||''),
        email:String(decoded.email||profile.email||'').toLowerCase(),
        name:String(profile.name||profile.displayName||decoded.name||''),
        role:String(profile.role||'').toLowerCase(),
        facultyId:String(profile.facultyId||'')
      };
    }
  };
}

module.exports={createFirebaseAuthProvider};
