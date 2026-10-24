(function(root,factory){
'use strict';
const lib=factory();
if(typeof module==='object'&&module.exports)module.exports=lib;
if(root&&root.document){
 const doc=root.document,overlay=doc.getElementById('ccc-schedule-overlay'),button=doc.getElementById('ccc-schedule-btn');
 if(!overlay||!button)return;
 const closeButton=doc.getElementById('ccc-schedule-close'),years=doc.getElementById('ccc-schedule-year'),search=doc.getElementById('ccc-schedule-search'),
  refresh=doc.getElementById('ccc-schedule-refresh'),status=doc.getElementById('ccc-schedule-status'),body=doc.getElementById('ccc-schedule-body');
 let generation=0,entries=[],previousFocus=null,timeout=null,loading=false,loadError=false;
 const localYear=()=>{const date=new Date(),parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Edmonton',year:'numeric',month:'2-digit'}).formatToParts(date);
  const y=Number(parts.find(x=>x.type==='year').value),m=Number(parts.find(x=>x.type==='month').value),start=m<5?y-1:y;return start+'-'+String((start+1)%100).padStart(2,'0');};
 function currentUid(){return root.firebase?.auth?.().currentUser?.uid||'';}
 function valid(){return !overlay.hidden&&Boolean(currentUid());}
 function populate(){const now=localYear(),start=Number(now.slice(0,4));years.textContent='';for(let y=start-2;y<=start+2;y++){const value=y+'-'+String((y+1)%100).padStart(2,'0'),option=doc.createElement('option');option.value=value;option.textContent=value;years.appendChild(option);}years.value=now;}
 function render(){
  const filtered=lib.filterEntries(entries,search.value);
  const dates=lib.groupEntries(filtered);
  status.textContent=loading?'Loading CCC schedule…':loadError?'CCC schedule could not be loaded. Choose Refresh to retry.':filtered.length+' assignment'+(filtered.length===1?'':'s')+' · '+dates.size+' schedule row'+(dates.size===1?'':'s');
  body.innerHTML=loadError?'<p class="ccc-schedule-empty" role="alert">CCC schedule data is unavailable. No records are being shown until a successful refresh.</p>':dates.size?'<table class="ccc-schedule-table"><thead><tr><th>Date</th><th>Session / Block</th><th>Faculty</th></tr></thead><tbody>'+
   [...dates.values()].map(group=>'<tr><td class="ccc-schedule-date">'+lib.escape(group.date)+(group.endDate!==group.date?' – '+lib.escape(group.endDate):'')+'</td><td>'+lib.escape(group.blockLabel||group.courseCode||'CCC')+(group.blockLabel&&group.courseCode?'<small>'+lib.escape(group.courseCode)+'</small>':'')+'</td><td>'+group.staff.map(row=>'<div class="ccc-schedule-person">'+lib.escape(root.PAWS_FACULTY_NAME?.format?.(row.facultyName)||row.facultyName)+(row.halfDay?' <span class="ccc-schedule-half">Half day</span>':'')+'</div>').join('')+'</td></tr>').join('')+
   '</tbody></table>':'<p class="ccc-schedule-empty">No CCC assignments match the selected year or search.</p>';
 }
 async function load(){
  if(!valid()||loading)return;loading=true;loadError=false;const token=++generation,uid=currentUid(),selected=years.value;status.textContent='Loading CCC schedule…';body.textContent='';
  try{
   const data=await root.UCVM_PAWS_DATA.cccSchedule(selected);
   if(token!==generation||uid!==currentUid()||!valid()||selected!==years.value)return;
   if(data.academicYear!==selected||!Array.isArray(data.entries)||data.entries.length>2500)throw Error('Invalid CCC schedule response');
   if(data.entries.some(item=>!item||!lib.validDate(item.date)||!lib.validDate(item.endDate)||item.date>item.endDate||typeof item.facultyName!=='string'||!item.facultyName.trim()||typeof item.halfDay!=='boolean'))throw Error('Invalid CCC schedule record');
   entries=data.entries;
   loading=false;render();
  }catch(error){if(token!==generation||uid!==currentUid()||!valid())return;loading=false;loadError=true;entries=[];render();}
 }
 function open(){if(!currentUid())return;previousFocus=doc.activeElement;overlay.hidden=false;overlay.setAttribute('aria-hidden','false');
  populate();search.value='';closeButton.focus();load();if(timeout)root.clearInterval(timeout);timeout=root.setInterval(()=>{if(valid()&&!loading)load();},60000);}
 function close(){generation++;loading=false;loadError=false;entries=[];body.textContent='';overlay.hidden=true;overlay.setAttribute('aria-hidden','true');
  if(timeout)root.clearInterval(timeout);timeout=null;if(previousFocus?.isConnected)previousFocus.focus();}
 closeButton.addEventListener('click',close);
 overlay.addEventListener('click',event=>{if(event.target===overlay)close();});
 overlay.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close();return;}
  if(event.key==='Tab'){const focusable=[...overlay.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled])')];
   if(!focusable.length)return;const first=focusable[0],last=focusable[focusable.length-1];if(event.shiftKey&&doc.activeElement===first){event.preventDefault();last.focus();}
   else if(!event.shiftKey&&doc.activeElement===last){event.preventDefault();first.focus();}}});
 years.addEventListener('change',()=>{generation++;loading=false;loadError=false;load();});
 search.addEventListener('input',()=>{if(!loading)render();});
 refresh.addEventListener('click',()=>{generation++;loading=false;loadError=false;load();});
 doc.addEventListener('visibilitychange',()=>{if(doc.visibilityState==='visible'&&valid()&&!loading)load();});
 // Signed-out and switched accounts must not retain a cross-faculty view.
 // firebase.auth() throws until some other script has called initializeApp(), so
 // this must never be allowed to abort module setup: PAWS_CCC_SCHEDULE and the
 // profile listener below are what make the button work at all.
 try{
  root.firebase?.auth?.().onAuthStateChanged(user=>{
   if(!user&& !overlay.hidden)close();
   else if(user&& !overlay.hidden){generation++;loading=false;entries=[];load();}
  });
 }catch(_){/* timetable.js closes the viewer on sign-out and reloads on paws-profile */}
 root.addEventListener('paws-profile',event=>{
  if(!overlay.hidden){generation++;loading=false;entries=[];load();}
 });
 root.PAWS_CCC_SCHEDULE=Object.freeze({open,close});
}
})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const escape=value=>String(value==null?'':value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
 const filterEntries=(entries,term)=>{const q=String(term||'').trim().toLowerCase();return [...entries].filter(row=>!q||[row.date,row.endDate,row.facultyName,row.blockLabel,row.courseCode].some(value=>String(value||'').toLowerCase().includes(q))).sort((a,b)=>a.date.localeCompare(b.date)||String(a.endDate).localeCompare(String(b.endDate))||String(a.blockLabel||'').localeCompare(String(b.blockLabel||''))||String(a.facultyName).localeCompare(String(b.facultyName)));};
 const groupEntries=entries=>{
  const groups=new Map();
  for(const entry of entries){
   // All date boundaries belong to a source assignment. Do not merge overlapping ranges.
   const key=JSON.stringify([entry.date,entry.endDate,entry.blockLabel??null,entry.courseCode??null]);
   if(!groups.has(key))groups.set(key,{date:entry.date,endDate:entry.endDate,blockLabel:entry.blockLabel,courseCode:entry.courseCode,staff:[]});
   groups.get(key).staff.push(entry);
  }
  return groups;
 };
 return Object.freeze({escape,validDate,filterEntries,groupEntries});
});
