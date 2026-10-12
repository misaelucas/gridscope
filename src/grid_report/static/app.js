// Step 6: render database-backed API responses. textContent avoids HTML injection.
const day = document.querySelector('#day');
const fmt = new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Copenhagen',year:'numeric',month:'2-digit',day:'2-digit'});
const yesterday = new Date(Date.now()-86400000);
const parts = Object.fromEntries(fmt.formatToParts(yesterday).map(p=>[p.type,p.value]));
day.value = `${parts.year}-${parts.month}-${parts.day}`;
async function get(url){const response=await fetch(url);if(!response.ok)throw new Error(`Request failed (${response.status}). Check the database and API logs.`);return response.json();}
const value = n => n === null ? 'No data' : n.toFixed(1);
function node(tag,text,parent){const el=document.createElement(tag);el.textContent=text;parent.append(el);return el;}
function draw(series){
 const svg=document.querySelector('#chart');svg.replaceChildren();
 const values=series.flatMap(s=>s.observations.map(o=>o.intensity)).filter(v=>v!==null);
 if(!values.length)return;
 const maximum=Math.max(1,...values)*1.1;
 const theme=getComputedStyle(document.documentElement);
 const ink=theme.getPropertyValue('--text-400').trim();
 const divider=theme.getPropertyValue('--divider').trim();
 const colors=['--series-dk1','--series-dk2'].map(token=>theme.getPropertyValue(token).trim());
 function element(tag,attrs){const el=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,v);svg.append(el);return el;}
 for(let i=0;i<4;i++){const y=25+i*75;element('line',{x1:60,x2:980,y1:y,y2:y,stroke:divider});element('text',{x:8,y:y+5,fill:ink,'font-size':14}).textContent=Math.round(maximum*(1-i/3));}
 series.forEach((s,index)=>{
  let path='',pen=false;
  s.observations.forEach((o,i)=>{if(o.intensity===null){pen=false;return;}const x=60+i/(s.observations.length-1)*920;const y=250-o.intensity/maximum*225;path+=`${pen?'L':'M'}${x},${y} `;pen=true;});
  element('path',{d:path,fill:'none',stroke:colors[index],'stroke-width':2});
 });
 const obs=series[0].observations;
 for(const i of [0,Math.floor(obs.length/2),obs.length-1]){
  const label=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Copenhagen',hour:'2-digit',minute:'2-digit'}).format(new Date(obs[i].timestamp));
  element('text',{x:60+i/(obs.length-1)*920,y:285,fill:ink,'text-anchor':i===obs.length-1?'end':'start','font-size':14}).textContent=label;
 }
}
async function load(){
 document.querySelector('#error').textContent='';
 try{
  const [report,dk1,dk2,runs]=await Promise.all([get(`/api/reports?day=${day.value}`),get(`/api/series?day=${day.value}&area=DK1`),get(`/api/series?day=${day.value}&area=DK2`),get('/api/runs')]);
  const cards=document.querySelector('#cards');cards.replaceChildren();
  for(const r of report.regions){const card=node('section','',cards);card.className='region';node('h2',r.area,card);node('div',`${value(r.average_g_per_kwh)} g CO₂/kWh`,card).className='value';node('p',`Peak: ${value(r.peak_g_per_kwh)} · Minimum: ${value(r.minimum_g_per_kwh)}`,card);node('p',`${r.completeness_percent}% complete · ${r.missing_intervals}/${r.expected_intervals} intervals missing`,card).className=r.missing_intervals?'warning':'';node('small',`Last ingested: ${r.last_ingested_at?new Date(r.last_ingested_at).toLocaleString():'never'}`,card);}
  draw([dk1,dk2]);const body=document.querySelector('#runs');body.replaceChildren();
  for(const r of runs){const tr=node('tr','',body);for(const v of [r.report_day,r.status,r.received??'—',r.finished_at?new Date(r.finished_at).toLocaleString():'—'])node('td',String(v),tr);}
 }catch(error){document.querySelector('#cards').replaceChildren();document.querySelector('#chart').replaceChildren();document.querySelector('#error').textContent=error.message;}
}
document.querySelector('#filter').addEventListener('submit',event=>{event.preventDefault();load();});load();
