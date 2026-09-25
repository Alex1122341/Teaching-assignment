'use strict';

const text=value=>String(value??'').trim();
const normalizeEmail=value=>text(value).toLowerCase();

function bootstrapProfilesFromEnv(value){
  const raw=text(value);if(!raw)return{};
  let parsed;
  try{parsed=JSON.parse(raw)}catch(cause){
    const error=Error('PAWS_ACCOUNT_BOOTSTRAP_JSON must be valid JSON.');
    error.code='SQL_PROFILE_BOOTSTRAP_INVALID';error.cause=cause;throw error;
  }
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Object.assign(Error('PAWS_ACCOUNT_BOOTSTRAP_JSON must be an object keyed by email.'),{code:'SQL_PROFILE_BOOTSTRAP_INVALID'});
  const out={};
  for(const [key,value2] of Object.entries(parsed)){
    const mail=normalizeEmail(key);if(!mail)continue;
    if(!value2||typeof value2!=='object'||Array.isArray(value2))throw Object.assign(Error(`Bootstrap profile for ${mail} must be an object.`),{code:'SQL_PROFILE_BOOTSTRAP_INVALID'});
    out[mail]={...value2};
  }
  return out;
}

function createFirebaseSqlAuthProvider({adminAuth,userRepository,bootstrapProfiles={}}={}){
  if(!adminAuth?.verifyIdToken)throw new Error('Firebase Admin Auth is required.');
  if(!userRepository?.provision)throw new Error('SQL user repository is required.');
  return{
    async verify(idToken){
      let decoded;
      try{
        decoded=await adminAuth.verifyIdToken(String(idToken));
      }catch{
        throw Object.assign(Error('Authentication token is invalid or expired.'),{code:'AUTH_REQUIRED',statusCode:401});
      }
      const uid=text(decoded?.uid),mail=normalizeEmail(decoded?.email);
      if(!uid||!mail)throw Object.assign(Error('Verified Firebase token must include UID and email.'),{code:'PROFILE_REQUIRED',statusCode:403});

      let profile;
      try{
        profile=await userRepository.provision({
          uid,email:mail,name:text(decoded?.name),
          bootstrap:bootstrapProfiles[mail]||null
        });
      }catch(error){
        const status=Number(error?.statusCode);
        if(Number.isInteger(status)&&status>=400&&status<500)throw error;
        throw Object.assign(Error('PAWS SQL profile service is unavailable.'),{code:'SQL_PROFILE_UNAVAILABLE',statusCode:503});
      }

      if(!profile?.active)throw Object.assign(Error('This PAWS account is inactive.'),{code:'PROFILE_INACTIVE',statusCode:403});
      return profile;
    }
  };
}

module.exports={bootstrapProfilesFromEnv,createFirebaseSqlAuthProvider};
