'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const script=fs.readFileSync(path.resolve(__dirname,'../tools/pages-demo-panels.js'),'utf8');

class Element{
  constructor(tag='div',{id='',x=10,y=10,width=340,height=90}={}){
    this.id=id;this.tagName=tag.toUpperCase();this.style={};this.dataset={};this.children=[];this.parent=null;
    this.events={};this.attributes={};this.className='';this.textContent='';this.x=x;this.y=y;this.width=width;this.height=height;
    const flags=new Set();
    this.classList={contains:k=>flags.has(k),toggle:(k,v)=>v===undefined?(flags.has(k)?flags.delete(k):flags.add(k)):v?flags.add(k):flags.delete(k)};
  }
  get firstChild(){return this.children[0]||null;}
  get childNodes(){return this.children;}
  get offsetWidth(){return this.classList.contains('paws-collapsed')?190:this.width;}
  get offsetHeight(){return this.classList.contains('paws-collapsed')?34:this.height;}
  getBoundingClientRect(){
    return {left:this.style.left?parseFloat(this.style.left):this.x,top:this.style.top?parseFloat(this.style.top):this.y,width:this.offsetWidth,height:this.offsetHeight};
  }
  appendChild(n){n.parent?.removeChild(n);this.children.push(n);n.parent=this;return n;}
  append(...items){items.forEach(n=>this.appendChild(n));}
  removeChild(n){this.children.splice(this.children.indexOf(n),1);n.parent=null;}
  remove(){this.parent?.removeChild(this);}
  querySelector(q){return this.children.find(c=>c.className===q.slice(1))||null;}
  setAttribute(k,v){this.attributes[k]=v;}
  addEventListener(k,fn){(this.events[k]??=[]).push(fn);}
  fire(k,detail={}){for(const fn of this.events[k]||[])fn({pointerId:7,button:0,clientX:0,clientY:0,target:{closest:()=>null},preventDefault(){},...detail});}
  setPointerCapture(){}
}
function load(saved=new Map()){
  const banner=new Element('div',{id:'github-pages-test-site-banner',x:700,y:10,width:390,height:60});
  const role=new Element('div',{id:'ucvm-pages-demo-toolbar',x:12,y:650,width:410,height:100});
  const heading=new Element();heading.className='demo-title';role.appendChild(heading);
  const controls=new Element();controls.className='demo-controls';role.appendChild(controls);
  const mapping={'#github-pages-test-site-banner':banner,'#ucvm-pages-demo-toolbar':role};
  const styles=new Map(),listeners={};
  const doc={readyState:'complete',querySelector:k=>mapping[k]||null,createElement:tag=>new Element(tag),
    getElementById:id=>styles.get(id)||null,head:{appendChild:n=>styles.set(n.id,n)},body:new Element('body')};
  const root={document:doc,innerWidth:1200,innerHeight:800,
    localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v)},
    addEventListener:(k,fn)=>{listeners[k]=fn;}};
  vm.runInNewContext(script,{window:root,MutationObserver:class{},console});
  return {banner,role,controls,saved,root,listeners};
}
test('both testing controls mount and preserve role selector',()=>{
  const {banner,role,controls}=load();
  assert.equal(banner.dataset.pawsFloatingPanel,'banner');
  assert.equal(role.dataset.pawsFloatingPanel,'role');
  assert.match(role.children[0].children[0].textContent,/PAWS/);
  assert.ok(role.children[1].children.includes(controls));
});
test('each panel collapses separately and retains a reopen toggle',()=>{
  const {banner,role,saved}=load();
  banner.children[0].children[1].fire('click');
  assert.equal(banner.classList.contains('paws-collapsed'),true);
  assert.equal(role.classList.contains('paws-collapsed'),false);
  assert.equal(JSON.parse(saved.get('paws-pages-demo-panels-v1')).banner.collapsed,true);
  banner.children[0].children[1].fire('click');
  assert.equal(banner.classList.contains('paws-collapsed'),false);
});
test('dragging saves visible viewport position',()=>{
  const {role,saved}=load(),head=role.children[0],before=role.getBoundingClientRect();
  head.fire('pointerdown',{clientX:20,clientY:680});
  head.fire('pointermove',{clientX:190,clientY:440});
  head.fire('pointerup',{clientX:190,clientY:440});
  const after=role.getBoundingClientRect();
  assert.notEqual(after.left,before.left);assert.notEqual(after.top,before.top);
  const pos=JSON.parse(saved.get('paws-pages-demo-panels-v1')).role;
  assert.equal(pos.x,after.left);assert.equal(pos.y,after.top);
  assert.ok(after.left>=8 && after.left+after.width<=1200);
});
test('stored panel state is restored on reload',()=>{
  const saved=new Map();
  const first=load(saved);
  first.role.children[0].children[1].fire('click');
  const later=load(saved);
  assert.equal(later.role.classList.contains('paws-collapsed'),true);
  assert.equal(later.banner.classList.contains('paws-collapsed'),false);
});
