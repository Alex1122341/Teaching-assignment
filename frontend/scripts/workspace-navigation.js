(function(root,factory){
 'use strict';const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PAWS_WORKSPACE_NAVIGATION=api;
})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const mounted=new WeakMap();
 function layoutFor(width,expanded,tasksOpen){
  const drawer=expanded&&width<1600,rail=width<1100?0:expanded&&!drawer?224:64;
  return {rail,drawer,tasksOverlay:width<1600||(tasksOpen&&width-rail-320<1000)};
 }
 // Presentation only: the caller owns permitted entry nodes and their handlers.
 function mount({document:doc,window:win,groups,header,globalNodes,pageTitle='Teaching Schedule',shellClass='paws-calendar-shell',backgroundSelector='.ucalgary-masthead,.test-banner,.filter-bar-wrap,.main-content,.bottom-bar,.workspace-tasks',measureHeader=false}){
  if(mounted.has(doc))return mounted.get(doc);
  const body=doc.body,create=(tag,className,text)=>{const n=doc.createElement(tag);n.className=className;if(text)n.textContent=text;return n;};
  let expanded=win.innerWidth>=1600,signedIn=false,lastTasks=false,inertNodes=[];
  const nav=create('aside','paws-navigation');nav.id='paws-navigation';nav.setAttribute('aria-label','PAWS navigation');nav.hidden=true;
  const brand=create('div','paws-navigation-brand','PAWS');brand.append(create('small','','UCVM workspace'));nav.append(brand);
  const close=create('button','paws-navigation-close','Close navigation');close.type='button';close.setAttribute('aria-label','Close navigation');nav.append(close);
  const menu=create('button','paws-navigation-toggle','☰');menu.type='button';menu.setAttribute('aria-label','Open navigation');menu.setAttribute('aria-controls',nav.id);menu.disabled=true;header.prepend(menu);
  const sections=[],destinations=create('nav','paws-navigation-destinations');destinations.setAttribute('aria-label','Main');nav.append(destinations);
  for(const {label,entries} of groups){
   const section=create('section','paws-navigation-section'),heading=create('h2','',label);section.append(heading);
   for(const {node,icon} of entries){
    const text=node.textContent.trim();node.title=text;node.setAttribute('aria-label',text);
    const symbol=create('span','paws-navigation-icon',icon);symbol.setAttribute('aria-hidden','true');
    const name=create('span','paws-navigation-label',text);node.replaceChildren(symbol,name);
    // Existing dialog handlers capture the focused element as their return target.
    // Focus the surviving trigger before a narrow drawer hides its launcher.
    node.addEventListener('click',()=>{if(body.classList.contains('paws-navigation-drawer'))setExpanded(false);menu.focus();},true);
    section.append(node);
   }
   destinations.append(section);sections.push({section,entries});
  }
  const global=create('div','paws-global-actions');for(const node of globalNodes)if(node)global.append(node);header.append(global);
  const title=create('h1','paws-page-title',pageTitle);header.insertBefore(title,global);
  const scrim=create('button','paws-navigation-scrim');scrim.type='button';scrim.hidden=true;scrim.setAttribute('aria-label','Close navigation');body.append(nav,scrim);
  body.classList.add(shellClass);
  function restoreBackground(){for(const [node,wasInert] of inertNodes)node.inert=wasInert;inertNodes=[];}
  function layout(){
   // Business dialogs keep their existing modal controller and focus ownership.
   if(doc.querySelector('.modal-container.open,.afc-timetable-panel:not([hidden]),.leadership-directory-overlay:not([hidden]),.ccc-schedule-overlay:not([hidden]),dialog[open]'))expanded=false;
   const taskOpen=body.classList.contains('workspace-tasks-open'),state=layoutFor(win.innerWidth,expanded,taskOpen);
   lastTasks=taskOpen;restoreBackground();
   body.classList.toggle('paws-navigation-expanded',expanded&&signedIn);
   body.classList.toggle('paws-navigation-drawer',state.drawer&&signedIn);
   body.classList.toggle('paws-tasks-overlay',state.tasksOverlay);
   nav.hidden=!signedIn||(state.rail===0&&!expanded);scrim.hidden=!(signedIn&&state.drawer);
   close.hidden=!(signedIn&&expanded);menu.setAttribute('aria-expanded',String(expanded&&signedIn));menu.setAttribute('aria-label',expanded?'Collapse navigation':'Open navigation');
   if(signedIn&&state.drawer){
    nav.setAttribute('role','dialog');nav.setAttribute('aria-modal','true');
    for(const node of doc.querySelectorAll(backgroundSelector)){inertNodes.push([node,node.inert]);node.inert=true;}
    if(!nav.contains(doc.activeElement))close.focus();
   }else{nav.removeAttribute('role');nav.removeAttribute('aria-modal');}
   body.style.setProperty('--paws-header-height',(measureHeader?header:header.parentElement).getBoundingClientRect().height+'px');
  }
  function setExpanded(value,restore=true){expanded=value;layout();if(value&&body.classList.contains('paws-navigation-drawer'))close.focus();else if(restore)menu.focus();}
  menu.onclick=()=>setExpanded(!expanded);close.onclick=()=>setExpanded(false);scrim.onclick=()=>setExpanded(false);
  nav.addEventListener('keydown',event=>{
   if(event.key==='Escape'){event.preventDefault();setExpanded(false);}
   if(event.key==='Tab'&&body.classList.contains('paws-navigation-drawer')){
    const items=[...nav.querySelectorAll('button:not([disabled]),a[href]')].filter(n=>n.getClientRects().length),first=items[0],last=items.at(-1);
    if(event.shiftKey&&doc.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&doc.activeElement===last){event.preventDefault();first.focus();}
   }
  });
  win.addEventListener('resize',layout);
  const observer=new win.MutationObserver(()=>{if(lastTasks!==body.classList.contains('workspace-tasks-open'))layout();});observer.observe(body,{attributes:true,attributeFilter:['class']});
  if(win.ResizeObserver)new win.ResizeObserver(layout).observe(header);
  const api=Object.freeze({sync(active){signedIn=Boolean(active);menu.disabled=!signedIn;if(!signedIn)expanded=false;for(const {section,entries} of sections)section.hidden=entries.every(({node})=>node.hidden||node.classList.contains('hidden'));layout();}});
  mounted.set(doc,api);layout();return api;
 }
 return Object.freeze({layoutFor,mount});
});
