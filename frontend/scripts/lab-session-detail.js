(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.UCVM_LAB_DETAIL=api;
})(typeof window==='undefined'?null:window,function(){
  'use strict';
  const text=value=>String(value??'').trim();
  const escape=value=>text(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const slot=row=>!row.timeUnknown&&/^\d{2}:\d{2}$/.test(text(row.start))&&/^\d{2}:\d{2}$/.test(text(row.end))?`${row.start}–${row.end}`:'Time not provided';
  function buildModel(seed,rows=[]){
    const unique=new Map();
    for(const row of [seed,...rows]){
      if(!row?.id||row.isCcc||text(row.date)!==text(seed.date)||text(row.course)!==text(seed.course)||text(row.year)!==text(seed.year)||text(row.academicYear)!==text(seed.academicYear)||!['LAB','SRL'].includes(text(row.type).toUpperCase()))continue;
      if(!unique.has(text(row.id)))unique.set(text(row.id),row);
    }
    const all=[...unique.values()].sort((a,b)=>slot(a).localeCompare(slot(b))||text(a.topic).localeCompare(text(b.topic))||text(a.id).localeCompare(text(b.id)));
    const stations=all.filter(row=>text(row.type).toUpperCase()==='LAB');
    return {seed,stations,srl:all.filter(row=>text(row.type).toUpperCase()==='SRL'),slots:[...new Set(stations.map(slot))].sort()};
  }
  function render(model,{actions=()=>'',formatFacultyName=value=>String(value||'')}={}){
    const title=row=>`<strong>${escape(row.topic||'Activity not provided')}</strong><div class="lab-instructor">${escape(formatFacultyName(row.instructor||'Instructor not provided'))}</div>${row.pendingSwap?'<span class="sql-swap-pending">SWAP PENDING</span>':''}`;
    const room=row=>escape(row.room||'Room not provided');
    const hasActions=[...model.stations,...model.srl].some(row=>Boolean(actions(row)));
    const actionHead=hasActions?'<th scope="col">Actions</th>':'';
    const actionCell=row=>hasActions?`<td><div class="lab-row-actions">${actions(row)}</div></td>`:'';
    const stations=model.stations.map(row=>`<tr data-lab-session="${escape(row.id)}"><th scope="row">${title(row)}</th><td>${room(row)}</td>${model.slots.map(time=>time===slot(row)?'<td><span class="lab-group-missing">Not provided</span></td>':'<td class="lab-not-scheduled"><span class="sr-only">Not scheduled in this source interval</span></td>').join('')}${actionCell(row)}</tr>`).join('');
    const srl=model.srl.map(row=>`<tr><th scope="row">${title(row)}</th><td>${room(row)}</td><td>${escape(slot(row))}</td>${actionCell(row)}</tr>`).join('');
    return `<div class="lab-tables"><p class="lab-source-note">Times shown are the stored activity intervals. Student group rotations are not provided in the current source.</p><div class="lab-table-scroll"><table class="lab-detail-table"><caption class="sr-only">LAB activities and source intervals</caption><thead><tr><th scope="col">Station / Instructor</th><th scope="col">Room</th>${model.slots.map(time=>`<th scope="col">${escape(time)}</th>`).join('')}${actionHead}</tr></thead><tbody>${stations}</tbody></table></div>${srl?`<div class="lab-table-scroll"><table class="lab-detail-table"><caption class="sr-only">SRL activities</caption><thead><tr><th scope="col">SRL / Instructor</th><th scope="col">Room</th><th scope="col">Time</th>${actionHead}</tr></thead><tbody>${srl}</tbody></table></div>`:''}</div>`;
  }
  return Object.freeze({buildModel,render});
});
