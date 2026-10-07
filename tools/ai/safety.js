'use strict';
const fs=require('node:fs'),path=require('node:path');
function id(value){const s=String(value);if(!/^[1-9]\d*$/.test(s)||!Number.isSafeInteger(Number(s)))throw Error('Invalid issue/task ID');return s}
const secrets=[
 /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?(?:-----END [^-]+-----|$)/g,
 /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16})\b/g,
 /(["']?(?:private_key|client_secret|password|access_token|refresh_token|api_key)["']?\s*[:=]\s*)["']?[^"'\s,;}{]{6,}["']?/gi,
 /\bBearer\s+[A-Za-z0-9._~+/-]{12,}/gi,
 /https?:\/\/[^/\s:@]+:[^/\s@]+@[^/\s]+/gi
];
function redact(value){let s=String(value);for(const re of secrets)s=s.replace(re,'[REDACTED]');return s}
function assertSafe(value){if(redact(value)!==String(value))throw Error('Potential secret detected; remove it before capture or handoff')}
function safePath(root,...parts){
 const base=path.resolve(root),target=path.resolve(base,...parts);
 if(target!==base&&!target.startsWith(base+path.sep))throw Error('Path outside repository');
 let current=base;
 for(const part of path.relative(base,target).split(path.sep).filter(Boolean)){
  current=path.join(current,part);
  let stat;
  try{stat=fs.lstatSync(current)}catch(error){if(error.code!=='ENOENT')throw error}
  if(stat?.isSymbolicLink())throw Error('Symbolic link is not allowed');
 }
 return target;
}
function protectedPath(p){return /(^|\/)(?:\.env[^/]*|[^/]*credential[^/]*|[^/]*secret[^/]*|[^/]*service.account[^/]*|firestore\.rules|firebase-config\.js|shared-auth\.js|account-profile\.js|faculty-access\.js|office-capabilities\.js)(\/|$)/i.test(p)||/^(?:\.github\/|server\/|doe-(?:formula|policy)|tools\/(?:deploy|seed|bootstrap|configure-lab|run-doe))/.test(p)}
module.exports={id,redact,assertSafe,safePath,protectedPath};
