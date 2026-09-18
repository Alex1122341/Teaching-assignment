'use strict';
window.UCVM_APPROVAL_ROUTING=(()=>{
  const ADC_FIELDS=new Set(['course','courseName','year','semester','week','date','start','end','timeUnknown','type','room']);
  const FACULTY_FIELDS=new Set(['instructor','assignments','facultyIds','faculty','facultyId']);
  const order={adc:0,lab:1,adfa:2};
  const text=value=>String(value??'').trim();
  const equal=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);

  function scopeSignature(fields,patch={}){
    return JSON.stringify([...new Set(fields||[])].sort().map(field=>[field,patch?.[field]??null]));
  }

  function build({base={},patch={}}={}){
    const final={...base,...patch};
    const finalType=text(final.type).toUpperCase();
    const changed=Object.keys(patch).filter(field=>!equal(base?.[field],patch?.[field]));
    const scopes={adc:[],lab:[],adfa:[]};
    for(const field of changed){
      if(FACULTY_FIELDS.has(field))scopes.adfa.push(field);
      else if(field==='topic'){
        (finalType==='LAB'?scopes.lab:scopes.adc).push(field);
      }else if(ADC_FIELDS.has(field))scopes.adc.push(field);
    }
    for(const office of Object.keys(scopes))scopes[office].sort();
    const requiredOffices=Object.keys(scopes).filter(office=>scopes[office].length).sort((a,b)=>order[a]-order[b]);
    const scopeSignatures={};
    for(const office of Object.keys(scopes))scopeSignatures[office]=scopeSignature(scopes[office],patch);
    return{
      changedFields:changed.sort(),
      finalType,
      hasFacultyChange:scopes.adfa.length>0,
      scopes,
      requiredOffices,
      scopeSignatures
    };
  }

  return{build,scopeSignature};
})();
