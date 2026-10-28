(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.PAWS_REPORTS=api;})(typeof window==='object'?window:globalThis,function(root){
 'use strict';
 const clone=value=>JSON.parse(JSON.stringify(value)),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const blank=op=>op==='isEmpty'||op==='isNotEmpty';
 const names={contains:'Contains words',eq:'Equals',ne:'Does not equal',startsWith:'Starts with',gt:'Greater than',gte:'At least',lt:'Less than',lte:'At most',between:'Between',isEmpty:'Not provided / blank',isNotEmpty:'Provided'};
 function buildDefinition(catalog,input){
  if(!/^20\d{2}-\d{2}$/.test(input.academicYear)||Number(input.academicYear.slice(5))!==(Number(input.academicYear.slice(0,4))+1)%100)throw Error('Enter an academic year such as 2026-27.');
  if(!input.datasets.length)throw Error('Select at least one data source.');
  const seen=new Set();
  return {academicYear:input.academicYear,datasets:input.datasets.map(dataset=>{
   const source=catalog.sources.find(s=>s.id===dataset.source);if(!source||seen.has(source.id))throw Error('Select a supported source once.');seen.add(source.id);
   if(!dataset.columns.length||dataset.columns.length>catalog.limits.columns||new Set(dataset.columns).size!==dataset.columns.length||dataset.columns.some(id=>!source.fields.some(f=>f.id===id)))throw Error('Select at least one valid column for '+source.label+'.');
   const typed=(field,value)=>{if(field.type==='number'){if(value===''||value===null||!Number.isFinite(Number(value)))throw Error('Enter a number for '+field.label+'.');return Number(value);}if(field.type==='boolean')return value===true||value==='true';return String(value??'');};
   if((dataset.filters||[]).length>catalog.limits.conditions)throw Error('Use no more than '+catalog.limits.conditions+' conditions per source.');
   return {source:source.id,columns:dataset.columns.slice(),search:dataset.search||'',match:dataset.match||'all',filters:(dataset.filters||[]).map(filter=>{const field=source.fields.find(f=>f.id===filter.field);if(!field||!field.operators.includes(filter.op))throw Error('Select a supported condition.');return {field:field.id,op:filter.op,...(blank(filter.op)?{}:{value:filter.op==='between'?(Array.isArray(filter.value)?filter.value:['','']).map(v=>typed(field,v)):typed(field,filter.value)})};}),sort:{...(dataset.sort||source.defaultSort)}};
  })};
 }
 function createController(options){
  const {api,getUser,getAcademicYear=()=>'',onChange=()=>{},download=()=>{},copy=()=>{}}=options;
  const isAdmin=options.isAdministrator||((user)=>root.UCVM?.admin?.(user)===true),getContext=options.getContext||(()=>root.PAWS_SUPPORT?.contextId?.()||'');
  let version=0,destroyed=false,bound=null,state={catalog:null,definition:{academicYear:getAcademicYear()||'',datasets:[]},result:null,source:null,busy:false,error:'',notice:''};
  const identity=()=>{const u=getUser();return JSON.stringify([u?.uid||'',u?.role||'',getContext(),getAcademicYear()||'']);};
  function emit(){onChange(clone(state));}
  function clear(){++version;state.result=null;state.catalog=null;state.busy=false;state.error='';state.notice='';state.definition={academicYear:getAcademicYear()||'',datasets:[]};state.source=null;bound=null;emit();}
  function allowed(){return !destroyed&&!!getUser()?.uid&&isAdmin(getUser())&&!getContext();}
  function guard(v,key){if(destroyed||v!==version)return false;if(key!==identity()||!allowed()){clear();return false;}return true;}
  function fail(error){state.result=null;state.busy=false;state.error=error?.status===403?'Reports require your own Owner or administrator session.':error?.message||'Reports could not be loaded. Retry shortly.';emit();}
  async function run(action){if(!allowed()){clear();if(!destroyed){state.error='Reports require your own Owner or administrator session.';emit();}return;}const key=identity(),v=++version;bound=key;state.busy=true;state.error='';state.notice='';emit();try{const value=await action();if(guard(v,key)){state.busy=false;emit();return value;}}catch(error){if(guard(v,key))fail(error);}}
  return {
   state(){if(bound&&bound!==identity())clear();return clone(state);},
   async initialize(){return run(async()=>{const key=identity(),v=version,catalog=await api.reportCatalog();if(!guard(v,key))return;state.catalog=catalog;state.definition={academicYear:getAcademicYear()||'',datasets:catalog.sources.filter(s=>s.id!=='history').map(s=>({source:s.id,columns:s.defaults.slice(),search:'',match:'all',filters:[],sort:{...s.defaultSort}}))};});},
   update(definition){++version;state.definition=clone(definition);state.result=null;state.busy=false;state.error='';state.notice='Selections changed. Preview to update results.';emit();},
   async preview(){if(!state.catalog)return;let definition;try{definition=buildDefinition(state.catalog,state.definition);}catch(error){fail(error);return;}state.result=null;return run(async()=>{const key=identity(),v=version,result=await api.reportQuery(definition);if(!guard(v,key))return;state.result=result;state.source=result.tables.some(t=>t.source===state.source)?state.source:result.tables[0]?.source;state.notice='Preview ready. Downloads use these selected results.';});},
   selectSource(source){if(state.result?.tables.some(t=>t.source===source)){++version;state.busy=false;state.source=source;emit();}},
   async page(offset){const result=state.result,source=state.source;if(!result)return;return run(async()=>{const key=identity(),v=version,page=await api.reportPage(result.snapshot,source,offset);if(!guard(v,key))return;const index=state.result.tables.findIndex(t=>t.source===source);state.result.tables[index]={...state.result.tables[index],...page};});},
   async export(format){const result=state.result,source=state.source;if(!result)return;return run(async()=>{const key=identity(),v=version,file=await api.reportExport(result.snapshot,format,format==='csv'?source:undefined);if(guard(v,key))download(file);});},
   async copy(){const result=state.result,table=result?.tables.find(t=>t.source===state.source);if(!table)return;return run(async()=>{const key=identity(),v=version,page=await api.reportPage(result.snapshot,table.source,table.offset);if(!guard(v,key))return;const text=value=>String(value).replace(/[\t\r\n]+/g,' '),safe=(value,col)=>value===null?'N/A':col.type==='number'?String(value):/^[\s\x00-\x1f]*[=+@-]/u.test(String(value))?"'"+text(value):text(value);const content=[page.columns.map(c=>c.label+(c.unit?' ('+c.unit+')':'')),...page.rows.map(row=>row.map((value,i)=>safe(value,page.columns[i])))].map(row=>row.map(text).join('\t')).join('\r\n');await copy(content);if(guard(v,key))state.notice='Current page copied.';});},
   clear,
   refresh(){if(bound&&bound!==identity())clear();if(!state.catalog)return this.initialize();},
   destroy(){destroyed=true;clear();}
  };
 }
 function renderTable(table){
  if(!table)return '';
  return '<div class="report-table-scroll" tabindex="0" aria-label="Report results"><table class="data-table"><thead><tr>'+table.columns.map(c=>'<th scope="col" class="'+(c.type==='number'?'report-number':'')+'">'+esc(c.label)+(c.unit?' ('+esc(c.unit)+')':'')+'</th>').join('')+'</tr></thead><tbody>'+(table.rows.length?table.rows.map(row=>'<tr>'+row.map((value,i)=>'<td class="'+(table.columns[i].type==='number'?'report-number':'')+'">'+(value===null?'N/A':esc(value)+(table.columns[i].unit&&value!==null?esc(table.columns[i].unit):''))+'</td>').join('')+'</tr>').join(''):'<tr><td colspan="'+table.columns.length+'" class="empty">No matching records. Change conditions and preview again.</td></tr>')+'</tbody></table></div>';
 }
 function defaultDownload(file){const bytes=Uint8Array.from(root.atob(file.fileBase64),c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:file.contentType})),a=root.document.createElement('a');a.href=url;a.download=file.fileName;root.document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 function mount(host,options){
  let destroyed=false,catalog=null,viewState=null;
  const controller=createController({...options,download:options.download||defaultDownload,copy:options.copy||(text=>root.navigator.clipboard.writeText(text)),onChange:state=>{viewState=state;if(destroyed)return;if(state.catalog&&catalog!==state.catalog){const first=!catalog;catalog=state.catalog;if(first)renderBuilder(state.definition);}if(!state.catalog)catalog=null;renderResults(state);}});
  host.innerHTML='<div class="paws-reports"><div class="report-heading"><div><h2>Custom reports</h2><p>Select data sources, columns and conditions. Each source stays in its own table.</p></div><span class="report-access">Owner / Administrator</span></div><div data-report-builder></div><div data-report-status role="status" aria-live="polite"></div><div data-report-results></div></div>';
  const find=selector=>host.querySelector(selector);
  const sourceDef=(source)=>({source:source.id,columns:source.defaults.slice(),search:'',match:'all',filters:[],sort:{...source.defaultSort}});
  function option(value,label,selected){return '<option value="'+esc(value)+'"'+(selected?' selected':'')+'>'+esc(label)+'</option>';}
  function renderBuilder(definition){
   const expanded=new Set([...host.querySelectorAll('[data-report-config][open]')].map(node=>node.dataset.reportConfig));
   const selected=new Map(definition.datasets.map(d=>[d.source,d]));
   find('[data-report-builder]').innerHTML='<div class="report-top"><label>Academic year<input class="input" data-report-year value="'+esc(definition.academicYear)+'" placeholder="2026-27" maxlength="7"></label><div><span class="report-label">Data sources</span><div class="report-source-choices">'+catalog.sources.map(s=>'<label><input type="checkbox" data-report-source="'+s.id+'"'+(selected.has(s.id)?' checked':'')+'>'+esc(s.label)+'</label>').join('')+'</div></div></div><div class="report-configs">'+definition.datasets.map((dataset,index)=>{
    const source=catalog.sources.find(s=>s.id===dataset.source),fieldOptions=(selectedId)=>source.fields.map(f=>option(f.id,f.label,f.id===selectedId)).join('');
    return '<details class="report-config" data-report-config="'+source.id+'"'+(expanded.has(source.id)?' open':'')+'><summary>'+esc(source.label)+' <span>'+dataset.columns.length+' columns · '+dataset.filters.length+' conditions</span></summary><p class="report-grain">'+esc(source.grain)+'</p><div class="report-config-grid"><div><h3>Columns <small>Display and export order</small></h3><ol class="report-columns">'+dataset.columns.map((id,i)=>{const f=source.fields.find(f=>f.id===id);return '<li><span>'+esc(f.label)+(f.unit?' ('+esc(f.unit)+')':'')+'</span><button type="button" class="btn btn-small" data-report-move="'+i+'" data-step="-1" aria-label="Move '+esc(f.label)+' up"'+(!i?' disabled':'')+'>↑</button><button type="button" class="btn btn-small" data-report-move="'+i+'" data-step="1" aria-label="Move '+esc(f.label)+' down"'+(i===dataset.columns.length-1?' disabled':'')+'>↓</button><button type="button" class="btn btn-small" data-report-remove-column="'+i+'" aria-label="Remove '+esc(f.label)+'">×</button></li>';}).join('')+'</ol><div class="report-inline"><select class="select" data-report-add-column aria-label="Column to add">'+option('','Add a column',true)+source.fields.filter(f=>!dataset.columns.includes(f.id)).map(f=>option(f.id,f.label,false)).join('')+'</select><button type="button" class="btn" data-report-columns-all>All columns</button><button type="button" class="btn" data-report-columns-clear>Clear columns</button></div></div><div><h3>Conditions</h3><label>Keyword search<input class="input" data-report-search value="'+esc(dataset.search)+'" placeholder="Search all approved fields" maxlength="256"></label><div class="report-inline"><label>Match<select class="select" data-report-match>'+option('all','All conditions (AND)',dataset.match==='all')+option('any','Any condition (OR)',dataset.match==='any')+'</select></label><button type="button" class="btn" data-report-add-condition'+(dataset.filters.length>=catalog.limits.conditions?' disabled':'')+'>+ Condition</button></div><div class="report-conditions">'+dataset.filters.map((f,i)=>{const field=source.fields.find(field=>field.id===f.field),values=f.op==='between'?(Array.isArray(f.value)?f.value:['','']):[f.value??''];return '<div class="report-condition" data-report-condition="'+i+'"><select class="select" data-report-field aria-label="Condition field">'+fieldOptions(f.field)+'</select><select class="select" data-report-op aria-label="Comparison">'+field.operators.map(op=>option(op,names[op],op===f.op)).join('')+'</select>'+(!blank(f.op)?values.map((v,j)=>'<input class="input" data-report-value="'+j+'" type="'+(field.type==='number'?'number':field.type==='date'?'date':'text')+'"'+(field.type==='number'?' step="any"':'')+' value="'+esc(v)+'" aria-label="Condition '+(j?'end':'value')+'">').join(''):'<span class="report-muted">No value needed</span>')+'<button type="button" class="btn btn-small" data-report-remove-condition="'+i+'" aria-label="Remove condition">×</button></div>';}).join('')+'</div><div class="report-inline"><label>Sort by<select class="select" data-report-sort>'+fieldOptions(dataset.sort.field)+'</select></label><label>Direction<select class="select" data-report-direction>'+option('asc','Ascending',dataset.sort.direction==='asc')+option('desc','Descending',dataset.sort.direction==='desc')+'</select></label></div></div></div></details>';
   }).join('')+'</div><div class="report-actions"><button type="button" class="btn btn-primary" data-report-preview>Preview report</button><button type="button" class="btn" data-report-reset>Reset</button><span class="report-muted">'+definition.datasets.length+' sources selected · N/A means not provided</span></div>';
  }
  function readDefinition(){return {academicYear:find('[data-report-year]').value.trim(),datasets:[...host.querySelectorAll('[data-report-config]')].map(node=>{const id=node.dataset.reportConfig,previous=viewState.definition.datasets.find(d=>d.source===id);return {...clone(previous),search:node.querySelector('[data-report-search]').value,match:node.querySelector('[data-report-match]').value,sort:{field:node.querySelector('[data-report-sort]').value,direction:node.querySelector('[data-report-direction]').value},filters:[...node.querySelectorAll('[data-report-condition]')].map(row=>{const op=row.querySelector('[data-report-op]').value,values=[...row.querySelectorAll('[data-report-value]')].map(n=>n.value);return {field:row.querySelector('[data-report-field]').value,op,...(blank(op)?{}:{value:op==='between'?values:values[0]??''})};})};})};}
  function renderResults(state){
   const status=find('[data-report-status]'),area=find('[data-report-results]');if(!status||!area)return;
   status.textContent=state.busy?'Loading report…':state.error||state.notice;status.className='report-status'+(state.error?' report-error':'');
   const previewButton=find('[data-report-preview]');if(previewButton)previewButton.disabled=state.busy;
   if(!state.catalog){area.innerHTML=state.busy?'':'<button type="button" class="btn" data-report-retry>Retry loading reports</button>';if(!state.busy)find('[data-report-builder]').innerHTML='';return;}
   if(!state.result){area.innerHTML='<div class="report-empty">Select the information you need, then preview the report.</div>';return;}
   const table=state.result.tables.find(t=>t.source===state.source),end=Math.min(table.offset+table.rows.length,table.total),busy=state.busy?' disabled':'';
   area.innerHTML='<div class="report-result-tabs" role="group" aria-label="Result source">'+state.result.tables.map(t=>'<button type="button" class="btn '+(t.source===state.source?'report-selected':'')+'" data-report-result="'+esc(t.source)+'" aria-pressed="'+(t.source===state.source)+'"'+busy+'>'+esc(t.label)+' <span>'+t.total+'</span></button>').join('')+'</div><div class="report-result-toolbar"><strong>'+table.total.toLocaleString()+' records</strong><div><button class="btn" type="button" data-report-copy'+busy+'>Copy current page</button><button class="btn" type="button" data-report-download="csv"'+busy+'>CSV · current table</button><button class="btn" type="button" data-report-download="xlsx"'+busy+'>Excel · all selected tables</button></div></div>'+renderTable(table)+'<div class="report-pagination"><span>'+(table.total?table.offset+1:0)+'–'+end+' of '+table.total+' · 50 per page</span><div><button class="btn" type="button" data-report-page="'+Math.max(0,table.offset-50)+'"'+(table.offset===0||state.busy?' disabled':'')+'>Previous</button><button class="btn" type="button" data-report-page="'+(table.offset+50)+'"'+(table.offset+50>=table.total||state.busy?' disabled':'')+'>Next</button></div></div><details class="report-coverage"><summary>Coverage and calculation notes</summary><ul>'+table.coverage.map(c=>'<li>'+esc(c)+'</li>').join('')+'</ul><p>Academic year '+esc(state.result.academicYear)+'. Current records read from '+esc(state.result.sourceReadStartedAt||state.result.createdAt||'N/A')+'. Preview expires '+esc(state.result.expiresAt)+'. Separate sources are read over an interval; they are not a historical database snapshot.</p></details>';
  }
  function update(definition,redraw){
   const active=root.document?.activeElement,config=active?.closest?.('[data-report-config]'),condition=active?.closest?.('[data-report-condition]');
   const attr=active?.getAttributeNames?.().find(name=>name.startsWith('data-report-'));
   controller.update(definition);if(redraw){renderBuilder(definition);if(attr&&config){const scope=find('[data-report-config="'+config.dataset.reportConfig+'"]');const container=condition?scope?.querySelector('[data-report-condition="'+condition.dataset.reportCondition+'"]'):scope;const focus=container?.querySelector('['+attr+'="'+active.getAttribute(attr)+'"]');(focus||scope?.querySelector('summary'))?.focus();}}
  }
  host.oninput=event=>{if(event.target.matches('input[data-report-year],input[data-report-search],input[data-report-value]'))update(readDefinition(),false);};
  host.onchange=event=>{
   const target=event.target;if(!catalog)return;
   let definition=readDefinition(),node=target.closest('[data-report-config]'),dataset=definition.datasets.find(d=>d.source===node?.dataset.reportConfig),source=catalog.sources.find(s=>s.id===dataset?.source);
   if(target.matches('[data-report-source]')){const id=target.dataset.reportSource;definition.datasets=target.checked?[...definition.datasets,sourceDef(catalog.sources.find(s=>s.id===id))]:definition.datasets.filter(d=>d.source!==id);update(definition,true);return;}
   if(!dataset)return;
   if(target.matches('[data-report-add-column]')){if(target.value&&!dataset.columns.includes(target.value))dataset.columns.push(target.value);update(definition,true);return;}
   if(target.matches('[data-report-field]')){const filter=dataset.filters[Number(target.closest('[data-report-condition]').dataset.reportCondition)],field=source.fields.find(f=>f.id===filter.field);filter.op=field.operators[0];filter.value='';update(definition,true);return;}
   if(target.matches('[data-report-op]')){const filter=dataset.filters[Number(target.closest('[data-report-condition]').dataset.reportCondition)];if(filter.op==='between')filter.value=['',''];if(blank(filter.op))delete filter.value;update(definition,true);return;}
   if(target.matches('select'))update(definition,false);
  };
  host.onclick=event=>{
   const button=event.target.closest('button');if(!button||button.disabled)return;
   if(button.matches('[data-report-preview]')){controller.update(readDefinition());controller.preview();return;}
   if(button.matches('[data-report-retry]')){catalog=null;controller.initialize();return;}
   if(button.matches('[data-report-reset]')){const definition={academicYear:options.getAcademicYear()||'',datasets:catalog.sources.filter(s=>s.id!=='history').map(sourceDef)};update(definition,true);return;}
   if(button.matches('[data-report-result]')){controller.selectSource(button.dataset.reportResult);return;}
   if(button.matches('[data-report-page]')){controller.page(Number(button.dataset.reportPage));return;}
   if(button.matches('[data-report-download]')){controller.export(button.dataset.reportDownload);return;}
   if(button.matches('[data-report-copy]')){controller.copy();return;}
   const node=button.closest('[data-report-config]');if(!node)return;const definition=readDefinition(),dataset=definition.datasets.find(d=>d.source===node.dataset.reportConfig),source=catalog.sources.find(s=>s.id===dataset.source);
   if(button.matches('[data-report-move]')){const i=Number(button.dataset.reportMove),j=i+Number(button.dataset.step);if(j>=0&&j<dataset.columns.length)[dataset.columns[i],dataset.columns[j]]=[dataset.columns[j],dataset.columns[i]];}
   if(button.matches('[data-report-remove-column]'))dataset.columns.splice(Number(button.dataset.reportRemoveColumn),1);
   if(button.matches('[data-report-columns-clear]'))dataset.columns=[];
   if(button.matches('[data-report-columns-all]'))dataset.columns=source.fields.map(f=>f.id);
   if(button.matches('[data-report-add-condition]')&&dataset.filters.length<catalog.limits.conditions)dataset.filters.push({field:'facultyName',op:'contains',value:''});
   if(button.matches('[data-report-remove-condition]'))dataset.filters.splice(Number(button.dataset.reportRemoveCondition),1);
   update(definition,true);
  };
  const ready=controller.initialize();
  return {ready,refresh:()=>controller.refresh(),destroy(){destroyed=true;controller.destroy();host.oninput=null;host.onchange=null;host.onclick=null;host.innerHTML='';}};
 }
 return {createController,buildDefinition,renderTable,mount};
});
