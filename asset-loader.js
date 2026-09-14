'use strict';
window.UCVM_ASSETS=(()=>{
 const pending=new Map();
 function loadScriptOnce(url,globalName){
  if(globalName&&window[globalName])return Promise.resolve(window[globalName]);
  if(pending.has(url))return pending.get(url);
  const promise=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=url;script.async=true;script.onload=()=>resolve(globalName?window[globalName]:true);script.onerror=()=>{pending.delete(url);reject(Error(`Could not load ${url}`))};document.head.appendChild(script)});
  pending.set(url,promise);return promise;
 }
 async function ensureAfcPdf(){await loadScriptOnce('https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js','PDFLib');await loadScriptOnce('afc-form-values.js','UCVM_AFC_FORM_VALUES');await loadScriptOnce('afc-pdf-browser.js','UCVM_AFC_PDF');return window.UCVM_AFC_PDF}
 return{loadScriptOnce,ensureAfcPdf};
})();
