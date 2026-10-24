'use strict';
window.UCVM_AFC_FORM_STATE=(()=>{
 function fields({reason='',rangeReady=false,loading=false,sessionCount=0}={}){
  const count=Math.max(0,Number(sessionCount)||0),ready=Boolean(rangeReady),busy=ready&&Boolean(loading),business=reason==='business_other';
  return{
   showPurpose:ready&&business,
   requirePurpose:ready&&business,
   showCoverage:ready&&!busy&&count>0,
   requireCoverage:ready&&!busy&&count>0,
   coverageMessage:!ready?'':busy?'Checking teaching assignments…':count?'':'Coverage arrangements: None needed'
  };
 }
 return{fields};
})();
