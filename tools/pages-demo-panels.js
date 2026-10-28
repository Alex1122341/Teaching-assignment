'use strict';
// GitHub Pages Testing Site only. Movable, collapsible demo overlays.
(function renderFloatingPanels(root){
  'use strict';
  if(!root||!root.document)return;
  const doc=root.document,storeKey='paws-pages-demo-panels-v1';
  const selectors={banner:'#github-pages-test-site-banner',role:'#ucvm-pages-demo-toolbar'};
  const labels={banner:'PAWS · TEST SITE - GitHub Pages',role:'PAWS · DEMO ROLE TESTER'};
  let prefs={};
  try{prefs=JSON.parse(root.localStorage.getItem(storeKey)||'{}')||{};}catch(_){}
  if(!prefs||typeof prefs!=='object'||Array.isArray(prefs))prefs={};
  const clamp=(v,min,max)=>Math.min(Math.max(v,min),Math.max(min,max));
  const save=()=>{try{root.localStorage.setItem(storeKey,JSON.stringify(prefs));}catch(_){}};
  function within(node){
    const rect=node.getBoundingClientRect();
    const x=Math.round(clamp(rect.left,8,root.innerWidth-rect.width-8)),y=Math.round(clamp(rect.top,8,root.innerHeight-rect.height-8));
    Object.assign(node.style,{left:x+'px',top:y+'px',right:'auto',bottom:'auto'});
    return {x,y};
  }
  function css(){
    if(doc.getElementById('paws-demo-floating-style'))return;
    const style=doc.createElement('style');style.id='paws-demo-floating-style';
    style.textContent=`
[data-paws-floating-panel]{box-sizing:border-box;min-width:0;position:fixed}
[data-paws-floating-panel] .paws-float-handle{display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:grab;touch-action:none;user-select:none;margin:-3px -3px 4px;min-height:28px}
[data-paws-floating-panel] .paws-float-handle:active{cursor:grabbing}
[data-paws-floating-panel] .paws-float-title{font:800 12px/1.3 Arial,sans-serif;letter-spacing:.015em}
[data-paws-floating-panel] .paws-float-toggle{flex:none;cursor:pointer;line-height:1;border:1px solid #8a6d00;border-radius:5px;padding:3px 7px;background:#fff;color:#3d3300;font:700 12px Arial,sans-serif}
[data-paws-floating-panel].paws-collapsed{width:max-content!important;max-width:calc(100vw - 16px)!important;padding:6px 9px!important}
[data-paws-floating-panel].paws-collapsed .paws-float-content{display:none!important}
[data-paws-floating-panel].paws-collapsed .paws-float-handle{margin:0}
#ucvm-pages-demo-toolbar[data-paws-floating-panel] .paws-float-toggle{min-width:27px}
`;
    doc.head.appendChild(style);
  }
  function mount(kind){
    const node=doc.querySelector(selectors[kind]);
    if(!node)return false;
    if(node.dataset.pawsFloatingPanel)return true;
    css();
    const old=prefs[kind]||{},initial=node.getBoundingClientRect();
    const handle=doc.createElement('div');handle.className='paws-float-handle';handle.setAttribute('aria-label',labels[kind]+': drag to move');
    const title=doc.createElement('span');title.className='paws-float-title';title.textContent=labels[kind];
    const toggle=doc.createElement('button');toggle.type='button';toggle.className='paws-float-toggle';
    const contents=doc.createElement('div');contents.className='paws-float-content';
    while(node.firstChild)contents.appendChild(node.firstChild);
    if(kind==='role')contents.querySelector('.demo-title')?.remove();
    if(kind==='banner'){
      for(const n of [...contents.childNodes])if(n.nodeType===3&&/TEST SITE\s*-\s*GitHub Pages/i.test(n.textContent))n.remove();
    }
    handle.append(title,toggle);node.append(handle,contents);
    node.dataset.pawsFloatingPanel=kind;
    let collapsed=old.collapsed===true;
    const set=()=>{
      node.classList.toggle('paws-collapsed',collapsed);
      toggle.textContent=collapsed?'+':'−';
      toggle.title=(collapsed?'Expand ':'Collapse ')+labels[kind];
      toggle.setAttribute('aria-label',toggle.title);toggle.setAttribute('aria-expanded',String(!collapsed));
      contents.hidden=collapsed;
      prefs[kind]={...within(node),collapsed};save();
    };
    Object.assign(node.style,{left:(Number.isFinite(old.x)?old.x:initial.left)+'px',top:(Number.isFinite(old.y)?old.y:initial.top)+'px',right:'auto',bottom:'auto'});
    toggle.addEventListener('click',()=>{collapsed=!collapsed;set();});
    let drag=null;
    handle.addEventListener('pointerdown',e=>{
      if(e.button!==0||e.target.closest('button'))return;
      const r=node.getBoundingClientRect();
      drag={pointerId:e.pointerId,px:e.clientX,py:e.clientY,x:r.left,y:r.top};
      handle.setPointerCapture?.(e.pointerId);e.preventDefault();
    });
    handle.addEventListener('pointermove',e=>{
      if(!drag||e.pointerId!==drag.pointerId)return;
      node.style.left=clamp(drag.x+e.clientX-drag.px,8,root.innerWidth-node.offsetWidth-8)+'px';
      node.style.top=clamp(drag.y+e.clientY-drag.py,8,root.innerHeight-node.offsetHeight-8)+'px';
    });
    const stop=e=>{
      if(!drag||e.pointerId!==drag.pointerId)return;
      drag=null;prefs[kind]={...within(node),collapsed};save();
    };
    handle.addEventListener('pointerup',stop);handle.addEventListener('pointercancel',stop);
    root.addEventListener('resize',()=>{prefs[kind]={...within(node),collapsed};save();});
    set();return true;
  }
  function start(){
    const check=()=>Object.keys(selectors).every(k=>mount(k));
    if(check())return;
    const observer=new MutationObserver(()=>{if(check())observer.disconnect();});
    observer.observe(doc.body||doc.documentElement,{childList:true,subtree:true});
    root.addEventListener('load',check,{once:true});
  }
  if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})(typeof window==='undefined'?null:window);
