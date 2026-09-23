/* Safe Faculty candidates and legacy ADC / LAB suggestion metadata.
 *
 * A suggestion is NOT an assignment. It is workflow metadata only and must never
 * be written into `assignments[]`. Only ADFA or Developer performs the final
 * assignment.
 *
 * Privacy: a suggestion carries an OPAQUE candidate key plus a display name. It
 * never carries a UCID, a private Faculty document id, an email, a DOE value, AFC
 * dates or reason, or any HR field. `sanitize` enforces that with an allowlist and
 * `assertSafe` fails closed if a forbidden field is present.
 *
 * Pure logic: no DOM, no Firebase.
 */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.UCVM_FACULTY_SUGGESTIONS=api;
})(typeof window!=='undefined'?window:null,function(){
 'use strict';
 const OFFICES=['adc','lab'];
 // HICC uses independent actor contribution records, never a shared legacy bucket.
 const CONTRIBUTION_SOURCES=Object.freeze(['adc','lab','hicc']);
 // The only fields a stored suggestion may contain.
 const ALLOWED_KEYS=['candidateKey','displayName','suggestedByOffice','suggestedBy','suggestedAt'];
 // Anything here means private data leaked into a suggestion payload.
 const FORBIDDEN_KEYS=[
  'ucid','facultyId','faculty_id','email','doe','doeCredit','doeRate','doePolicyVersionId','doeRuleId','doeCalculationId',
  'afc','afcReason','afcStart','afcEnd','awayFromCampus','awayFromCampusRecords',
  'hrFirstLast','hrFullName','hrData','salary','fte','rank','appointmentType','contract','expiryDate',
  'phoneNumber','employeeId','sin','bankAccount'
 ];
 const text=value=>String(value??'').trim();

 function isForbiddenKey(key){
  const name=text(key);
  if(FORBIDDEN_KEYS.includes(name))return true;
  // Case-insensitive safety net for casing variants of the same field.
  const lower=name.toLowerCase();
  return FORBIDDEN_KEYS.some(candidate=>candidate.toLowerCase()===lower);
 }
 function forbiddenKeysPresent(record={}){
  return Object.keys(record||{}).filter(isForbiddenKey);
 }
 /* Fail closed: a payload containing private data is refused outright. */
 function assertSafe(record={}){
  const leaked=forbiddenKeysPresent(record);
  if(leaked.length)throw Error(`A Faculty suggestion must not carry private fields: ${leaked.join(', ')}`);
  return true;
 }
 /* Canonical candidate boundary shared by legacy suggestions and contributions.
  * Keys must come from the sanitized candidate directory; no private ID fallback.
  * Unknown metadata is omitted and known private fields are refused.
  */
 function safeCandidate(record){
  if(!record||typeof record!=='object'||Array.isArray(record))throw Error('Invalid Faculty suggestion.');
  assertSafe(record);
  const key=typeof record.candidateKey==='string'?record.candidateKey.trim():'';
  const name=typeof record.displayName==='string'?record.displayName.trim():'';
  if(!key||key.length>256||/[@\u0000-\u001f\u007f]/.test(key))throw Error('A Faculty suggestion requires a bounded opaque candidate key.');
  if(!name||name.length>200||/[\u0000-\u001f\u007f]/.test(name))throw Error('A Faculty suggestion requires a bounded display name.');
  return{candidateKey:key,displayName:name};
 }
 function sanitize(record={}){
  const out=safeCandidate(record);
  for(const key of ALLOWED_KEYS)if(key!=='candidateKey'&&key!=='displayName'&&record[key]!==undefined)out[key]=record[key];
  return out;
 }

 /* Build one suggestion. `candidateKey` must be the existing opaque replacement
  * candidate key, never a raw Faculty id. */
 function createSuggestion({candidateKey='',displayName='',office='',actor={},at=null}={}){
  const normalizedOffice=text(office).toLowerCase();
  if(!OFFICES.includes(normalizedOffice))throw Error('Only ADC or LAB may suggest Faculty.');
  const candidate=safeCandidate({candidateKey,displayName});
  const record={
   ...candidate,
   suggestedByOffice:normalizedOffice,
   suggestedBy:text(actor.uid||actor.email||''),
   suggestedAt:at
  };
  assertSafe(record);
  return record;
 }

 function emptyMetadata(){return{adc:[],lab:[]}}

 function bucketFor(metadata,office){
  const name=text(office).toLowerCase();
  if(!OFFICES.includes(name))throw Error('Only ADC or LAB suggestions are stored.');
  const current=metadata?.[name];
  return Array.isArray(current)?current:[];
 }

 /* Add a suggestion. Re-suggesting the same candidate is idempotent. */
 function addSuggestion(metadata,suggestion){
  const record=sanitize(suggestion);
  assertSafe(record);
  const office=text(record.suggestedByOffice).toLowerCase();
  if(!OFFICES.includes(office))throw Error('Only ADC or LAB suggestions are stored.');
  const next={...emptyMetadata(),...(metadata||{})};
  const existing=bucketFor(next,office);
  const without=existing.filter(row=>text(row?.candidateKey)!==text(record.candidateKey));
  next[office]=[...without,record];
  return next;
 }

 function removeSuggestion(metadata,{office='',candidateKey=''}={}){
  const name=text(office).toLowerCase();
  if(!OFFICES.includes(name))throw Error('Only ADC or LAB suggestions are stored.');
  const next={...emptyMetadata(),...(metadata||{})};
  next[name]=bucketFor(next,name).filter(row=>text(row?.candidateKey)!==text(candidateKey));
  return next;
 }

 function suggestionsFor(metadata,office){return bucketFor(metadata,office).map(sanitize)}

 /* What an ADFA approver sees. Suggestions are advisory and clearly labelled by
  * the office that raised them. */
 function describeForAdfa(metadata={}){
  const lines=[];
  for(const office of OFFICES){
   const rows=suggestionsFor(metadata,office);
   if(!rows.length)continue;
   lines.push({office,label:office.toUpperCase(),names:rows.map(row=>row.displayName),text:`Suggested by ${office.toUpperCase()}: ${rows.map(row=>row.displayName).join(', ')}`});
  }
  return lines;
 }

 /* A suggestion can never be turned into an assignment implicitly. */
 function suggestionToAssignment(suggestion){
  throw Error('A Faculty suggestion is not an assignment. ADFA or Developer must assign Faculty explicitly.');
 }

 /* Verify a suggestion payload is free of private data before it is stored. */
 function assertStorable(metadata={}){
  for(const office of OFFICES)for(const row of bucketFor(metadata,office))safeCandidate(row);
  return true;
 }

 return Object.freeze({
  OFFICES,CONTRIBUTION_SOURCES,ALLOWED_KEYS,FORBIDDEN_KEYS,
  isForbiddenKey,forbiddenKeysPresent,assertSafe,safeCandidate,sanitize,
  createSuggestion,emptyMetadata,addSuggestion,removeSuggestion,suggestionsFor,describeForAdfa,
  suggestionToAssignment,assertStorable
 });
});
