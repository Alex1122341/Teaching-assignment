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
  const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;

  function validDate(value){
    const raw=String(value||'');
    if(!DATE_RE.test(raw))return null;
    const d=new Date(raw+'T00:00:00Z');
    return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===raw?raw:null;
  }
  function utcDate(value){return new Date(value+'T00:00:00Z')}
  function get(date){return byDate.get(String(date||''))||null}
  function isClosed(date){return byDate.has(String(date||''))}
  function between(startDate,endDate){
    const start=validDate(startDate),end=validDate(endDate);
    if(!start||!end||start>end)return[];
    return catalog.filter(row=>row.date>=start&&row.date<=end);
  }
  function countWorkingDays(startDate,endDate){
    const start=validDate(startDate),end=validDate(endDate);
    if(!start||!end||start>end)return 0;
    let count=0;
    for(let d=utcDate(start);d<=utcDate(end);d.setUTCDate(d.getUTCDate()+1)){
      const key=d.toISOString().slice(0,10),day=d.getUTCDay();
      if(day!==0&&day!==6&&!isClosed(key))count++;
    }
    return count;
  }

  return{entries:catalog,get,isClosed,between,countWorkingDays};
});
