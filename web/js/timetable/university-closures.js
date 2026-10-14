(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.UCVM_UNIVERSITY_CLOSURES=api;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';

  const entries=[
    {date:'2026-01-01',name:"New Year's Day",category:'university_closure'},
    {date:'2026-02-16',name:'Family Day',category:'university_closure'},
    {date:'2026-04-03',name:'Good Friday',category:'university_closure'},
    {date:'2026-04-06',name:'Easter Monday',category:'university_closure'},
    {date:'2026-05-18',name:'Victoria Day',category:'university_closure'},
    {date:'2026-07-01',name:'Canada Day',category:'university_closure'},
    {date:'2026-08-03',name:'Heritage Day',category:'university_closure'},
    {date:'2026-09-07',name:'Labour Day',category:'university_closure'},
    {date:'2026-09-30',name:'National Day for Truth and Reconciliation',category:'university_closure'},
    {date:'2026-10-12',name:'Thanksgiving Day',category:'university_closure'},
    {date:'2026-11-11',name:'Remembrance Day',category:'university_closure'},
    {date:'2026-12-25',name:'Christmas Day',category:'university_closure'},
    {date:'2026-12-28',name:'Holiday Observance — University Closed',category:'university_closure'},
    {date:'2026-12-29',name:'Holiday Observance — University Closed',category:'university_closure'},
    {date:'2026-12-30',name:'Holiday Observance — University Closed',category:'university_closure'},
    {date:'2026-12-31',name:'Holiday Observance — University Closed',category:'university_closure'},
    {date:'2027-01-01',name:"New Year's Day",category:'university_closure'},
    {date:'2027-02-15',name:'Family Day',category:'university_closure'},
    {date:'2027-03-26',name:'Good Friday',category:'university_closure'},
    {date:'2027-03-29',name:'Easter Monday',category:'university_closure'},
    {date:'2027-05-24',name:'Victoria Day',category:'university_closure'},
    {date:'2027-07-01',name:'Canada Day',category:'university_closure'},
    {date:'2027-08-02',name:'Heritage Day',category:'university_closure'},
    {date:'2027-09-06',name:'Labour Day',category:'university_closure'},
    {date:'2027-09-30',name:'National Day for Truth and Reconciliation',category:'university_closure'},
    {date:'2027-10-11',name:'Thanksgiving Day',category:'university_closure'},
    {date:'2027-11-11',name:'Remembrance Day',category:'university_closure'},
    {date:'2027-12-27',name:'Holiday Observance — University Closed',category:'university_closure'},
    {date:'2027-12-28',name:'Holiday Observance — University Closed',category:'university_closure'},
    {date:'2027-12-29',name:'Holiday Observance — University Closed',category:'university_closure'},
    {date:'2027-12-30',name:'Holiday Observance — University Closed',category:'university_closure'},
    {date:'2027-12-31',name:'Holiday Observance — University Closed',category:'university_closure'}
  ];

  const catalog=Object.freeze(entries.map(row=>Object.freeze({...row})));
  const byDate=new Map(catalog.map(row=>[row.date,row]));
  // Reviewed 2026-09-20 against published UCalgary 2026-27 / 2027-28 calendar material.
  // Published 2028 future dates remain tentative and are intentionally not promoted to verified closure coverage.
  const coverage=Object.freeze({
    startDate:'2026-01-01',
    endDate:'2027-12-31',
    lastReviewed:'2026-09-20',
    reviewLeadDays:120,
    timeZone:'America/Edmonton',
    sourceLabel:'UCalgary Combined Annual Calendar / Registrar Academic Dates',
    note:'Future dates that are published as tentative are not treated as verified closure coverage.'
  });
  const MAINTENANCE_ROLES=new Set(['developer','owner','adfa_general']);
  const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;

  function validDate(value){
    const raw=String(value||'');
    if(!DATE_RE.test(raw))return null;
    const d=new Date(raw+'T00:00:00Z');
    return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===raw?raw:null;
  }
  function utcDate(value){return new Date(value+'T00:00:00Z')}
  function calendarDate(value=new Date(),timeZone=coverage.timeZone){
    const date=value instanceof Date?value:new Date(value);
    if(Number.isNaN(date.getTime()))return null;
    try{
      const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));
      return validDate(`${parts.year}-${parts.month}-${parts.day}`);
    }catch(_){return null}
  }
  function formatDate(value){
    const date=utcDate(value);
    return date.toLocaleDateString('en-CA',{timeZone:'UTC',year:'numeric',month:'long',day:'numeric'});
  }
  function coverageStatus(startDate,endDate=startDate){
    const start=validDate(startDate),end=validDate(endDate);
    if(!start||!end||start>end)return{valid:false,supported:false,status:'invalid',startDate:start||'',endDate:end||'',coverage};
    const before=start<coverage.startDate,after=end>coverage.endDate,supported=!before&&!after;
    return{valid:true,supported,status:supported?'verified':'out_of_range',startDate:start,endDate:end,beforeCoverage:before,afterCoverage:after,coverage};
  }
  function coverageMessage(statusOrStart,endDate){
    const status=typeof statusOrStart==='object'&&statusOrStart?statusOrStart:coverageStatus(statusOrStart,endDate);
    if(!status?.valid)return'Choose a valid start and end date.';
    if(status.beforeCoverage&&status.afterCoverage)return`University closure calendar coverage is verified only from ${formatDate(coverage.startDate)} through ${formatDate(coverage.endDate)}. Update the UCalgary closure calendar before using this date range.`;
    if(status.beforeCoverage)return`University closure calendar coverage begins ${formatDate(coverage.startDate)}. Update the UCalgary closure calendar before using earlier dates.`;
    return`University closure calendar coverage is verified only through ${formatDate(coverage.endDate)}. Update the UCalgary closure calendar before calculating AFC working days or relying on closure overlays for later dates.`;
  }
  function maintenanceStatus(asOfDate){
    const value=typeof asOfDate==='string'?validDate(asOfDate):calendarDate(asOfDate===undefined?new Date():asOfDate);
    if(!value)return{status:'invalid',coverage};
    if(value>coverage.endDate)return{status:'expired',asOfDate:value,daysUntilExpiry:0,coverage};
    const days=Math.floor((utcDate(coverage.endDate)-utcDate(value))/86400000);
    return{status:days<=coverage.reviewLeadDays?'review_due':'current',asOfDate:value,daysUntilExpiry:days,coverage};
  }
  let browserWarningKey='';
  function showCoverageWarning(message,key='coverage'){
    if(typeof document==='undefined'||!document.body||browserWarningKey===key)return false;
    browserWarningKey=key;
    let box=document.getElementById('university-closure-coverage-warning');
    if(!box){
      box=document.createElement('div');
      box.id='university-closure-coverage-warning';
      box.setAttribute('role','status');
      box.setAttribute('aria-live','polite');
      box.style.cssText='position:fixed;left:16px;right:16px;bottom:58px;z-index:99998;padding:11px 44px 11px 14px;border:1px solid #b45309;border-radius:8px;background:#fff7ed;color:#7c2d12;box-shadow:0 4px 16px #0002;font:600 13px/1.4 Segoe UI,Arial,sans-serif';
      const close=document.createElement('button');
      close.type='button';close.setAttribute('aria-label','Dismiss university closure calendar warning');close.textContent='×';
      close.style.cssText='position:absolute;right:10px;top:5px;border:0;background:transparent;color:inherit;font-size:22px;cursor:pointer';
      close.onclick=()=>{box.remove();browserWarningKey=''};
      box.appendChild(close);
      const copy=document.createElement('span');copy.dataset.message='';box.appendChild(copy);
      document.body.appendChild(box);
    }
    const copy=box.querySelector('[data-message]');if(copy)copy.textContent=message;
    return true;
  }
  function maintenanceRole(role){return MAINTENANCE_ROLES.has(String(role||'').trim().toLowerCase().replace(/[ -]+/g,'_'))}
  function warnMaintenance(role,asOfDate){
    const health=maintenanceStatus(asOfDate);
    if(!maintenanceRole(role)||!['review_due','expired'].includes(health.status))return false;
    const message=health.status==='expired'
      ?`University closure calendar coverage expired on ${formatDate(coverage.endDate)}. Closure overlays and AFC working-day calculations need a reviewed calendar update.`
      :`University closure calendar coverage ends ${formatDate(coverage.endDate)}. Review and refresh the UCalgary closure catalog before it expires.`;
    return showCoverageWarning(message,`maintenance-${health.status}`);
  }
  function get(date){return byDate.get(String(date||''))||null}
  function isClosed(date){return byDate.has(String(date||''))}
  function between(startDate,endDate){
    const status=coverageStatus(startDate,endDate);
    if(!status.valid)return[];
    if(!status.supported)showCoverageWarning(coverageMessage(status),`${status.startDate}|${status.endDate}`);
    return catalog.filter(row=>row.date>=status.startDate&&row.date<=status.endDate);
  }
  function countWorkingDays(startDate,endDate){
    const status=coverageStatus(startDate,endDate);
    if(!status.valid)return 0;
    if(!status.supported){
      const error=new RangeError(coverageMessage(status));error.code='UNIVERSITY_CLOSURE_COVERAGE';throw error;
    }
    const start=status.startDate,end=status.endDate;
    let count=0;
    for(let d=utcDate(start);d<=utcDate(end);d.setUTCDate(d.getUTCDate()+1)){
      const key=d.toISOString().slice(0,10),day=d.getUTCDay();
      if(day!==0&&day!==6&&!isClosed(key))count++;
    }
    return count;
  }

  return{entries:catalog,coverage,get,isClosed,between,countWorkingDays,coverageStatus,coverageMessage,maintenanceStatus,calendarDate,maintenanceRole,warnMaintenance};
});
