(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.UCVM_CALENDAR_SEARCH=api;})(typeof window==='undefined'?null:window,function(root){
 'use strict';

 // Calendar search responsiveness primitives.
 //
 // Three independent concerns live here so the timetable page can keep its
 // rendering code and so each concern can be executed directly by tests:
 //
 //   1. createDebouncer          - one trailing render per burst of keystrokes.
 //   2. createActivityCache      - scoped, deduplicated, TTL-bounded reuse of
 //                                 Working Activity rows already in memory.
 //   3. createSessionBlockController - one delegated click listener and an O(1)
 //                                 session lookup instead of one listener and a
 //                                 linear scan per rendered row.
 //
 // Nothing here talks to the network or to storage. Both the page and the tests
 // inject the loader, the clock and the timers, so behaviour is deterministic.

 const SEARCH_DEBOUNCE_MS=250;
 const ACTIVITY_CACHE_TTL_MS=60000;
 const SESSION_BLOCK_SELECTOR='[data-session-id]';
 // Shared cancellation vocabulary with calendar-activities.js. A superseded
 // request is an error, never an empty result: caching [] for it would freeze a
 // legitimate-looking empty range for the whole TTL.
 const CANCELLATION_CODE='CALENDAR_ACTIVITY_CANCELLED';
 function isCancellation(error){return error?.code===CANCELLATION_CODE||error?.name==='AbortError';}

 // ---------------------------------------------------------------------------
 // 1. Debouncer
 // ---------------------------------------------------------------------------
 // Trailing-edge debounce with explicit flush/cancel. `invoke` is called at most
 // once per burst, and never re-entrantly: the pending flag is cleared before
 // the callback runs, so a callback that schedules again (a filter chip that
 // programmatically re-fires input) still behaves.
 function createDebouncer({delay=SEARCH_DEBOUNCE_MS,invoke,setTimer=setTimeout,clearTimer=clearTimeout}={}){
  if(typeof invoke!=='function')throw Error('createDebouncer requires an invoke callback');
  const wait=Number.isFinite(Number(delay))&&Number(delay)>=0?Number(delay):SEARCH_DEBOUNCE_MS;
  let handle=null,pending=false;
  function clear(){if(handle!==null){clearTimer(handle);handle=null;}}
  function run(){handle=null;if(!pending)return false;pending=false;invoke();return true;}
  return Object.freeze({
   schedule(){pending=true;clear();handle=setTimer(run,wait);return wait;},
   flush(){clear();return run();},
   cancel(){pending=false;clear();},
   get pending(){return pending;},
   get delay(){return wait;}
  });
 }

 // ---------------------------------------------------------------------------
 // 2. Scoped activity cache
 // ---------------------------------------------------------------------------
 // The cache key is derived from the authenticated identity, the support
 // context, the requested range and the faculty scope. Two different users (or
 // the same user under a different support context, or a different range) can
 // therefore never observe each other's rows: they simply address different
 // entries. `invalidate()` bumps an epoch so a response that was already in
 // flight when the data was invalidated cannot repopulate the cache.
 function activityScopeKey(scope={}){
  const uid=String(scope?.uid||'').trim();
  if(!uid)throw Error('Calendar activity data requires an authenticated user scope.');
  return [
   'paws-calendar-activities-v1',
   uid,
   String(scope.role||''),
   String(scope.supportContextId||''),
   String(scope.start||''),
   String(scope.end||''),
   String(scope.facultyId||''),
   scope.selfOnly?'self':'all'
  ].join('\u0000');
 }

 function createActivityCache({ttlMs=ACTIVITY_CACHE_TTL_MS,now=()=>Date.now()}={}){
  const ttl=Number.isFinite(Number(ttlMs))?Number(ttlMs):ACTIVITY_CACHE_TTL_MS;
  const entries=new Map();   // key -> {rows, at}
  const inflight=new Map();  // key -> Promise
  const sequence=new Map();  // key -> newest request number
  let epoch=0;

  const fresh=entry=>entry!==undefined&&(ttl<=0||now()-entry.at<=ttl);
  function nextSequence(key){const value=(sequence.get(key)||0)+1;sequence.set(key,value);return value;}

  // Synchronous cache read used to paint without a loading flash.
  function peek(scope){
   const entry=entries.get(activityScopeKey(scope));
   return fresh(entry)?entry.rows:null;
  }

  async function get(scope,{refresh=false,load}={}){
   if(typeof load!=='function')throw Error('createActivityCache requires a load callback');
   const key=activityScopeKey(scope);
   if(!refresh){
    const entry=entries.get(key);
    if(fresh(entry))return entry.rows;
    const joined=inflight.get(key);
    if(joined)return joined;
   }
   const startedEpoch=epoch,ticket=nextSequence(key);
   const promise=Promise.resolve()
    .then(()=>load(scope))
    .then(rows=>{
     // A newer request for this key, or a global invalidation, wins over this
     // response; the older result is dropped instead of overwriting newer data.
     if(startedEpoch===epoch&&sequence.get(key)===ticket)entries.set(key,{rows,at:now()});
     return rows;
    })
    .catch(error=>{
     // Cancelled requests are released immediately so a later caller starts a
     // fresh request instead of joining a doomed one. Nothing is cached: an
     // error is never turned into valid empty rows.
     if(inflight.get(key)===promise)inflight.delete(key);
     throw error;
    })
    .finally(()=>{if(inflight.get(key)===promise)inflight.delete(key);});
   inflight.set(key,promise);
   return promise;
  }

  function invalidate(scope){
   if(scope===undefined){epoch+=1;entries.clear();inflight.clear();sequence.clear();return;}
   const key=activityScopeKey(scope);
   epoch+=1;entries.delete(key);inflight.delete(key);sequence.delete(key);
  }

  return Object.freeze({
   peek,get,invalidate,
   get ttlMs(){return ttl;},
   get size(){return entries.size;},
   has:scope=>fresh(entries.get(activityScopeKey(scope)))
  });
 }

 // ---------------------------------------------------------------------------
 // 3. Session block controller
 // ---------------------------------------------------------------------------
 // Replaces the previous "query every rendered block, linear-scan the session
 // array for each one, attach one listener per block" binding. The rendered
 // container is stable across renders (only its innerHTML is replaced), so one
 // delegated listener installed on first bind survives every later render.
 function createSessionBlockController({host,getRows,getSelectionMode,isSelected,onOpen,onToggle,onRejected,selector=SESSION_BLOCK_SELECTOR}={}){
  if(!host||typeof host.addEventListener!=='function'||typeof host.querySelectorAll!=='function')throw Error('createSessionBlockController requires a host element');
  const query=selector;
  let index=new Map(),bound=false,activeCount=0,bindCount=0;

  function reindex(){
   index=new Map();
   for(const row of getRows?.()||[]){if(row&&row.id!==undefined&&row.id!==null)index.set(String(row.id),row);}
   return index;
  }

  function activate(id){
   const row=index.get(String(id));
   if(!getSelectionMode?.()){onOpen?.(String(id));return 'open';}
   if(row?.isCcc||row?.readOnlyActivity){onRejected?.((row.isCcc?'CCC':'Working activity')+' records are read-only and cannot be selected.');return 'rejected';}
   try{onToggle?.(String(id),row);return 'toggled';}
   catch(error){onRejected?.(error?.message||String(error));return 'rejected';}
  }

  function handleClick(event){
   const target=event?.target;
   if(!target||typeof target.closest!=='function')return false;
   const element=target.closest(query);
   if(!element||element.dataset?.sessionId===undefined||element.dataset.sessionId===null)return false;
   activate(element.dataset.sessionId);
   return true;
  }

  function refresh(){
   reindex();
   const elements=[...host.querySelectorAll(query)];
   activeCount=0;
   const selectionMode=Boolean(getSelectionMode?.());
   for(const element of elements){
    const id=element?.dataset?.sessionId;
    if(id===undefined||id===null||id==='')continue;
    activeCount+=1;
    const row=index.get(String(id));
    element.classList?.toggle('selection-candidate',selectionMode&&!row?.isCcc&&!row?.readOnlyActivity);
    element.classList?.toggle('selection-selected',Boolean(isSelected?.(String(id))));
   }
   if(!bound){bound=true;bindCount+=1;host.addEventListener('click',handleClick);}
   return activeCount;
  }

  return Object.freeze({
   refresh,activate,handleClick,
   get activeCount(){return activeCount;},
   get bound(){return bound;},
   get binds(){return bindCount;},
   get indexSize(){return index.size;}
  });
 }

 return Object.freeze({SEARCH_DEBOUNCE_MS,ACTIVITY_CACHE_TTL_MS,SESSION_BLOCK_SELECTOR,CANCELLATION_CODE,isCancellation,createDebouncer,createActivityCache,activityScopeKey,createSessionBlockController});
});
