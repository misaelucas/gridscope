// Run the shipped script against only the DOM surface it uses, with controlled HTTP promises.
// No browser/layout emulation or third-party dependencies are needed for these state tests.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const vm = require('node:vm');
const source = readFileSync(join(__dirname, '../src/grid_report/static/app.js'), 'utf8');

class Element {
 constructor(tag='div'){this.tagName=tag;this.children=[];this.attributes={};this.listeners={};this.value='';this._text='';}
 set textContent(text){this._text=String(text);this.children=[];}
 get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
 append(child){this.children.push(child);}
 replaceChildren(...children){this._text='';this.children=children;}
 setAttribute(key,value){this.attributes[key]=String(value);}
 addEventListener(type,listener){(this.listeners[type]??=[]).push(listener);}
 dispatch(type){for(const listener of this.listeners[type]??[])listener({preventDefault(){}});}
}
function harness(){
 const elements=Object.fromEntries(['day','cards','chart','runs','error','filter'].map(id=>[id,new Element()]));
 const requests=[];
 const context=vm.createContext({Intl,Date,AbortController,
  document:{querySelector:selector=>elements[selector.slice(1)],documentElement:new Element(),
   createElement:tag=>new Element(tag),createElementNS:(_,tag)=>new Element(tag)},
  getComputedStyle:()=>({getPropertyValue:token=>token}),
  fetch:(url,{signal})=>new Promise((resolve,reject)=>requests.push({url,signal,resolve,reject}))});
 vm.runInContext(source,context);
 return {elements,requests,context,
  select(date,event='input'){elements.day.value=date;elements.day.dispatch(event);},
  submit(){elements.filter.dispatch('submit');},
  async settle(offset=0,empty=false){
   for(const request of requests.slice(offset,offset+4)){
    const url=new URL(request.url,'http://test');
    request.resolve({ok:true,json:async()=>payload(url,empty)});
   }
   await flush();
  }};
}
// Flush promise reactions using an event-loop turn, not a timing-dependent sleep.
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function payload(url,empty){
 const day=url.searchParams.get('day');
 if(url.pathname==='/api/reports')return {day,regions:['DK1','DK2'].map((area,i)=>({area,
  average_g_per_kwh:empty||i?null:0,peak_g_per_kwh:empty||i?null:20,
  minimum_g_per_kwh:empty||i?null:0,completeness_percent:empty||i?0:1,
  missing_intervals:empty||i?288:285,expected_intervals:288,last_ingested_at:null}))};
 if(url.pathname==='/api/series')return {day,area:url.searchParams.get('area'),observations:
  [0,null,20].map((intensity,i)=>({timestamp:`${day}T00:${String(i*5).padStart(2,'0')}:00Z`,
   intensity:empty||url.searchParams.get('area')==='DK2'?null:intensity}))};
 return empty?[]:[{report_day:'2026-10-10',status:'success',received:0,finished_at:null},
  {report_day:'2026-10-09',status:'running',received:null,finished_at:null}];
}
function assertCleared(h){for(const id of ['cards','chart','runs'])assert.equal(h.elements[id].children.length,0,id);}

test('populated rendering preserves zero, null gaps, SVG tokens and run statuses',async()=>{
 const h=harness();await h.settle();
 assert.equal(h.elements.cards.children.length,2);
 assert.match(h.elements.cards.children[0].textContent,/0\.0 g CO₂\/kWh/);
 assert.match(h.elements.cards.children[1].textContent,/No data g CO₂\/kWh/);
 const paths=h.elements.chart.children.filter(el=>el.tagName==='path');
 assert.equal(paths.length,2);
 assert.equal((paths[0].attributes.d.match(/M/g)||[]).length,2);
 assert.equal(paths[0].attributes.stroke,'--series-dk1');
 assert.equal(paths[1].attributes.d,'');
 assert.equal(h.elements.runs.children[0].children[2].textContent,'0');
 assert.equal(h.elements.runs.children[1].children[2].textContent,'—');
 assert.equal(h.elements.error.textContent,'');
});

test('empty responses render No data and clear the chart and run history',async()=>{
 const h=harness();await h.settle();h.submit();assertCleared(h);
 await h.settle(4,true);
 assert.equal(h.elements.cards.children.length,2);
 assert.ok(h.elements.cards.children.every(card=>card.textContent.includes('No data')));
 assert.equal(h.elements.chart.children.length,0);
 assert.equal(h.elements.runs.children.length,0);
});

test('latest date wins even when superseded fetches ignore cancellation',async()=>{
 const h=harness();h.select('2026-10-11');h.submit();
 assert.ok(h.requests.slice(0,4).every(r=>r.signal.aborted));
 await h.settle(4,true); // New response first.
 const cards=h.elements.cards.textContent;
 await h.settle(0); // Old populated response must not overwrite it.
 assert.equal(h.elements.cards.textContent,cards);
 assert.equal(h.elements.chart.children.length,0);
 assert.equal(h.elements.runs.children.length,0);
 assert.equal(h.elements.error.textContent,'');
});

test('changing the date clears rendered displays before submit and invalidates pending work',async()=>{
 const h=harness();await h.settle();
 assert.ok(h.elements.runs.children.length);
 h.select('2026-10-11','input');assertCleared(h);h.submit();
 assert.ok(h.requests.slice(4,7).every(r=>r.url.includes('day=2026-10-11')));
 h.select('2026-10-12','change');assertCleared(h);
 await h.settle(4);assertCleared(h);
 assert.equal(h.elements.error.textContent,'');
 assert.equal(h.requests.length,8); // Selection alone does not fetch.
});

test('network and JSON failures clear all displays without leaving partial rendering',async()=>{
 for(const jsonFailure of [false,true]){
  const h=harness();await h.settle();h.submit();
  if(jsonFailure)h.requests[4].resolve({ok:true,json:async()=>{throw new SyntaxError('Invalid JSON');}});
  else h.requests[4].reject(new TypeError('Network unavailable'));
  await flush();assertCleared(h);
  assert.match(h.elements.error.textContent,jsonFailure?/Invalid JSON/:/Network unavailable/);
 }
});

test('superseded failures and AbortError never replace the latest result',async()=>{
 for(const name of ['AbortError','Error']){
  const h=harness();h.select('2026-10-11');h.submit();await h.settle(4);
  const cards=h.elements.cards.textContent;
  h.requests[0].reject(Object.assign(new Error('old failure'),{name}));
  await flush();
  assert.equal(h.elements.cards.textContent,cards);
  assert.equal(h.elements.error.textContent,'');
 }
});

test('any endpoint failure clears every display, aborts remaining requests, and permits recovery',async()=>{
 for(let endpoint=0;endpoint<4;endpoint++){
  const h=harness();await h.settle();h.submit();
  h.requests[4+endpoint].resolve({ok:false,status:503});await flush();
  assertCleared(h);assert.match(h.elements.error.textContent,/503/);
  assert.ok(h.requests.slice(4,8).every(r=>r.signal.aborted));
  await h.settle(4);assertCleared(h);
  h.submit();assert.equal(h.elements.error.textContent,'');await h.settle(8);
  assert.equal(h.elements.cards.children.length,2);
 }
});

for(const [instant,expected] of [
 ['2026-03-29T22:30:00Z','2026-03-29'], // 00:30 after the short day; -24h picks March 28.
 ['2026-10-25T23:30:00Z','2026-10-25'],
 ['2026-10-25T22:30:00Z','2026-10-24'], // 23:30 on the long day; -24h picks October 25.
 ['2026-03-28T23:30:00Z','2026-03-28'],
 ['2025-12-31T23:30:00Z','2025-12-31'],
 ['2024-03-01T00:30:00Z','2024-02-29'],
])test(`Copenhagen calendar yesterday at ${instant}`,()=>{
 const h=harness();
 assert.equal(vm.runInContext(`previousDanishDay(new Date('${instant}'))`,h.context),expected);
});
