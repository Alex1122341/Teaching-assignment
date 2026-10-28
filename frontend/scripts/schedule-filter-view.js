(function(root,factory){
 'use strict';
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PAWS_SCHEDULE_FILTER_VIEW=api;
})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const monthDay=new Intl.DateTimeFormat('en-CA',{month:'short',day:'numeric'});
 function weekLabel(week,start,end){
  const last=start.getMonth()===end.getMonth()&&start.getFullYear()===end.getFullYear()?end.getDate():monthDay.format(end);
  return `Week ${week} (${monthDay.format(start)}–${last})`;
 }
 // A projection only. The timetable and its existing type picker own all state.
 function contentChips({search='',month=null,courses=null,typeKeys=[],types=[]}){
  const chips=[],add=(kind,value,label)=>chips.push({kind,value,label});
  if(search.trim())add('search','','Search: '+search.trim());
  if(month)add('month',month.value,'Month: '+month.label);
  if(courses){
   for(const code of courses)add('course',code,'Course: '+code);
   if(!courses.length)add('restore-courses','','No courses selected');
  }
  const selected=new Set(typeKeys);
  if(!selected.size)add('restore-types','','No activity types selected');
  else if(types.some(type=>!selected.has(type.key)))for(const type of types)if(selected.has(type.key))add('type',type.key,'Type: '+type.label);
  return chips;
 }
 function mount(host,{onRemove,onClear,focusFallback}){
  const doc=host.ownerDocument;
  host.setAttribute('role','group');host.setAttribute('aria-label','Active content filters');
  function render(state){
   const oldButtons=host.children,active=doc.activeElement,restoreFocus=host.contains(active);
   const oldIndex=Array.from(oldButtons).indexOf(active),oldKey=active?.dataset?.filterKey;
   const chips=contentChips(state),nodes=[];
   if(chips.length){
    const title=doc.createElement('span');title.textContent='Active filters';nodes.push(title);
    for(const chip of chips){
     const button=doc.createElement('button');button.type='button';button.className='schedule-filter-chip';
     button.dataset.filterKey=chip.kind+':'+chip.value;button.textContent=chip.label+' ×';button.title=chip.label;
     button.setAttribute('aria-label',chip.kind==='restore-courses'?'Restore all courses':chip.kind==='restore-types'?'Restore all activity types':'Remove '+chip.label);
     button.onclick=()=>onRemove(chip.kind,chip.value);nodes.push(button);
    }
    const clear=doc.createElement('button');clear.type='button';clear.className='schedule-filter-clear';clear.dataset.filterKey='clear';
    clear.textContent='Clear content filters';clear.title='Keep year, semester, week and My Timetable selection';clear.onclick=onClear;nodes.push(clear);
   }
   host.replaceChildren(...nodes);host.hidden=!chips.length;
   if(restoreFocus)(nodes.find(node=>node.dataset?.filterKey===oldKey)||nodes[Math.max(1,Math.min(oldIndex,nodes.length-1))]||focusFallback)?.focus();
  }
  return Object.freeze({render});
 }
 return Object.freeze({weekLabel,contentChips,mount});
});
