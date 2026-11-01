'use strict';
(function(){
  const opener=document.getElementById('site-changelog-open');
  const dialog=document.getElementById('site-changelog-dialog');
  const closer=document.getElementById('site-changelog-close');
  const contents=document.getElementById('site-changelog-entries');
  if(!opener||!dialog||!closer||!contents)return;
  const create=(tag,className,text)=>{
    const element=document.createElement(tag);
    if(className)element.className=className;
    if(text!==undefined)element.textContent=String(text);
    return element;
  };
  function render(entries){
    contents.replaceChildren();
    if(!entries.length){contents.append(create('p','site-changelog-message','No updates recorded.'));return;}
    const ordered=entries.slice().sort((a,b)=>b.date.localeCompare(a.date)||b.pr-a.pr);
    for(const item of ordered){
      const article=create('article','site-changelog-item');
      const meta=create('div','site-changelog-meta',item.date+' · PR #'+item.pr);
      const title=create('h3','site-changelog-item-title',item.title);
      const list=create('ul','site-changelog-list');
      for(const change of item.changes||[])list.append(create('li','',change));
      const link=create('a','site-changelog-pr-link','View PR #'+item.pr);
      link.href='https://github.com/UCVM-Teaching-Assignment/Teaching-assignment/pull/'+Number(item.pr);
      link.target='_blank';
      link.rel='noopener noreferrer';
      article.append(meta,title,list,link);
      contents.append(article);
    }
  }
  async function open(){
    if(dialog.open)return;
    contents.replaceChildren(create('p','site-changelog-message','Loading updates…'));
    dialog.showModal();
    try{
      const response=await fetch('./changelog.json',{cache:'no-store'});
      if(!response.ok)throw new Error('HTTP '+response.status);
      const data=await response.json();
      if(data.schemaVersion!==1||!Array.isArray(data.entries))throw new Error('Invalid release notes');
      render(data.entries.filter(item=>Number.isSafeInteger(item.pr)&&typeof item.date==='string'&&typeof item.title==='string'&&Array.isArray(item.changes)));
    }catch(_){
      contents.replaceChildren(create('p','site-changelog-message','The change log is unavailable. Reload to try again.'));
    }
  }
  opener.addEventListener('click',open);
  closer.addEventListener('click',()=>dialog.close());
})();
