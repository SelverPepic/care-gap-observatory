const BAM_PER_EUR = 1.95583;
const COLORS = ['#8b6cf7','#49c6d8','#f4b860','#e78ac3','#10b981','#f87171','#79a7ff','#b8c25b','#d9915b','#8e9aaf'];
let bundled = [];
let records = [];
let filtered = [];
let policyScenarios = {};
let policySettings = {horizon:5,objective:'patients'};
let mapTheme = 'dark';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (value='') => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const fmt = new Intl.NumberFormat('en-US',{maximumFractionDigits:0});
const compactFmt = new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1});
const money = (n, currency='BAM') => n == null || Number.isNaN(+n) ? 'Unknown' : `${fmt.format(+n)} ${currency}`;
const label = (s) => (s || 'Unknown').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
const median = a => {const x=[...a].sort((a,b)=>a-b); if(!x.length)return null; const m=Math.floor(x.length/2); return x.length%2?x[m]:(x[m-1]+x[m])/2};
const quantile = (a,q) => {const x=[...a].sort((a,b)=>a-b); if(!x.length)return null; const p=(x.length-1)*q,b=Math.floor(p),r=p-b; return x[b+1]!==undefined?x[b]+r*(x[b+1]-x[b]):x[b]};
const known = v => v !== null && v !== undefined && v !== '' && (!Array.isArray(v) || v.length);
const specialty = r => r.policy_specialty_group || r.normalized_primary_specialty || r.primary_specialty || 'Unknown';
const diagnosisFamily = r => r.policy_diagnosis_family || r.normalized_diagnosis_group || r.diagnosis_group || r.main_diagnosis || 'Unknown';
const recordKey = r => String(r.record_id || r.analysis_order || r.order || r.source_id);
const displayOrder = r => r.analysis_order || r.order || r.source_id;
const normalizeCountry = value => value === 'Turkey' || value === 'Türkiye' ? 'Türkiye' : value;

function treatmentCountries(r){return [...new Set((r.proposed_treatments||[]).map(t=>normalizeCountry(t.country)).filter(Boolean))]}
function pathway(r){
  const countries=treatmentCountries(r),local=countries.includes('Bosnia and Herzegovina'),foreign=countries.filter(c=>c!=='Bosnia and Herzegovina');
  if(local&&foreign.length)return 'mixed';
  if(local)return 'local';
  if(foreign.length)return 'abroad';
  return 'unknown';
}

function domesticEvidence(r){
  if(pathway(r)!=='unknown')return null;
  const source=[r.source_text,r.insurance_status,r.urgency].filter(Boolean).map(v=>typeof v==='string'?v:JSON.stringify(v)).join(' ').toLowerCase();
  const history=[r.source_text,r.main_diagnosis,...(r.earlier_treatments||[]),...(r.side_diagnoses||[])].filter(Boolean).join(' ').toLowerCase();
  const proposed=(r.proposed_treatments||[]).flatMap(t=>[t.type,t.detail]).filter(Boolean).join(' ').toLowerCase();
  if(/list\w*\s+(?:za\s+)?čekanj|dug\w*\s+čekanj|čekanj\w*\s+(?:na|za)\s+(?:lijek|terap|oper|pregled|tretman)|waiting list|long wait/.test(source))return 'waiting';
  if(/fond\w*\s+solidarn|solidarity fund/.test(source))return 'solidarity';
  const aftercare=/(rehabilit|physical therapy|fizikaln\w*\s+terap|prosthe|prote[zš]|assistive|wheelchair|invalidsk\w*\s+kolic|elektri[čc]n\w*\s+kolic|ortopedsk\w*\s+pomagal|molli suit)/.test(proposed);
  const injuryOrSurgery=/(injur|accident|povred|ozljed|nesre[ćc]|saobra[ćc]aj|amput|opekot|after surgery|postoper|nakon operacij|poslije operacij|operacij|surgery)/.test(history);
  return aftercare&&injuryOrSurgery?'likely_aftercare':null;
}

function analysisPathway(r){
  const direct=pathway(r);if(direct!=='unknown')return direct;
  const evidence=domesticEvidence(r);
  if(evidence==='solidarity'||evidence==='waiting')return 'local';
  if(evidence==='likely_aftercare')return 'likely_local';
  return 'unknown';
}

function treatmentCostBam(r){
  if(known(r.total_medical_cost_bam)) return +r.total_medical_cost_bam;
  const x=r.total_medical_cost_original;
  if(!x || !known(x.amount)) return null;
  return x.currency==='EUR' ? +x.amount*BAM_PER_EUR : x.currency==='BAM'||x.currency==='KM' ? +x.amount : null;
}
function treatmentTypes(r){return [...new Set((r.proposed_treatments||[]).map(t=>label(t.type)).filter(Boolean))]}
function countBy(items,getter){const m=new Map();items.forEach(r=>{const vals=getter(r);(Array.isArray(vals)?vals:[vals]).forEach(v=>{v=v||'Unknown';m.set(v,(m.get(v)||0)+1)})});return [...m].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));}
function abroadReasonGroup(value){
  const s=String(value||'').trim().toLowerCase().replaceAll(' ','_');
  if(!s||s.includes('reason_not_stated'))return 'Reason not stated';
  if(/continu|further_(care|treatment)|seek_further|further_cancer|prior_treatment_benefit/.test(s))return 'Continuation or further treatment';
  if(/diagnos|evaluation|assessment|workup/.test(s))return 'Further diagnosis or evaluation';
  if(/wait|delay|urgent|time_sensitive|time_pressure|emergency|critical_condition/.test(s))return 'Delay or urgent time pressure';
  if(/coverage|insurance|funding|lower_drug_cost/.test(s))return 'Coverage or affordability barrier';
  if(/unsuccess|failure|no_improvement|nonresponse|poor_.*response|inadequate|insufficient|limited_progress|worsened|recurrence|incomplete_.*resection|persistent_disease/.test(s))return 'Earlier treatment unsuccessful or insufficient';
  if(/exhausted|no_domestic_solution|no_effective_domestic|no_other_treatment|no_further_regional|regional_treatment_options|reported_exhaustion/.test(s))return 'Domestic or regional options exhausted';
  if(/unavailable|only_abroad|shortage|not_established|required_procedure|specialized_treatment_available_only/.test(s))return 'Treatment, procedure or medicine unavailable locally';
  if(/referral|recommended|recommendation|medical_board|physician/.test(s))return 'Specialist referral or recommendation abroad';
  if(/complex|expertise|specialized_care|rare_tumor|high_risk|disease_combination/.test(s))return 'Complex or specialist expertise required';
  if(/alternative|salvage|limb_salvage|preservation|lower_risk|revision_surgery|non_surgical/.test(s))return 'Alternative or salvage treatment sought';
  if(/progression|deterioration|complication|severe_pain|life_threatening|survival/.test(s))return 'Progression, deterioration or complications';
  if(/offer|specific_treatment|stated_need|treatment_sought_abroad|care_abroad/.test(s))return 'Foreign treatment option identified';
  return 'Other stated reason';
}
function urgencyGroup(value){
  const s=String(value||'').toLowerCase();
  if(!s)return 'Not stated';
  if(/\b(schedul|within the next|before (?:age|surgery)|by |deadline|every \d+|next treatment|planned for|planned june|beginning of may|january 22|following sunday|late october|publication month|in a few days|age[s]? \d|months? (?:described|as the ideal)|on time|first therapies|october 21|february 2021|july 20|three days after)/.test(s))return 'Concrete date, deadline, window or cadence';
  if(/\b(emergency|immediate|critical|life-threatening|fighting for (?:his|her|their) life|intensive care|every (?:second|minute|hour|day)|cannot wait|no time to wait|life (?:is |described as )?in (?:great |serious )?danger|risk of death|without treatment|only life-saving option)/.test(s))return 'Acute, life-threatening or immediate crisis';
  if(/\b(urgent|urgently|as soon as possible|earliest possible|without delay|time-critical|time is described as critical|time described as decisive|waiting unacceptable)/.test(s))return 'Explicit urgent / ASAP';
  if(/\b(risk|threat|prevent|worsen|deteriorat|progress|decline|paralysis|amputation|blindness|loss of vision|loss of arm|loss of .*function|immobility|gangrene|rupture|sepsis|survival|life-saving|sustain life|save life|developmental delay)/.test(s))return 'Serious consequence or deterioration if delayed';
  return 'Continuity, necessity or promptness only';
}
function plannedLeadDays(r){
  const s=String(r.urgency||''),published=new Date(`${String(r.published_at).slice(0,10)}T00:00:00Z`);let target=null,m=s.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if(m)target=new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  if(!target){m=s.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s*(20\d{2})\b/i);if(m)target=new Date(`${m[1]} ${m[2]}, ${m[3]} 00:00:00 UTC`)}
  if(!target||isNaN(target)||isNaN(published))return null;const days=Math.round((target-published)/86400000);return days>=0&&days<=365?days:null;
}
function outcomeGroup(value){
  const s=String(value||'').toLowerCase();
  if(!s)return 'No outcome narrative';
  if(/\bdied\b|death/.test(s))return 'Death reported';
  if(/severe neurological|complication|permanent colostomy|intensive care|critically ill|still fighting for .* life|remains hospitalized|saved her life; further recovery/.test(s))return 'Mixed or interim benefit with serious residual condition';
  if(/operation reported successful; longer-term|completed|performed|implanted|surgically removed|transplant performed|tumors .* removed|returned home|testing showed|functional outcome not stated|not yet operated/.test(s))return 'Procedure, treatment or disposition recorded; benefit unknown';
  if(/successful|improvement|improved|feels well|function normally|effective|resolved|walking|recovering|resumed function|leg saved|positive response|very good response|encouraging|repeat surgery was unnecessary/.test(s))return 'Reported favorable response or functional improvement';
  return 'Procedure, treatment or disposition recorded; benefit unknown';
}

export async function init(initialData=null){
  if(initialData){ bundled=Array.isArray(initialData)?initialData:initialData.records; }
  else { const response=await fetch('./data/cases.json',{cache:'no-store'}); bundled=await response.json(); }
  const local=localStorage.getItem('care-gap-dataset');
  if(local){try{records=validate(JSON.parse(local))}catch{records=[...bundled]}}else records=[...bundled];
  wire();populateFilters();applyFilters();
  const requestedView=new URLSearchParams(window.location.search).get('view');
  if(['overview','medical','financial','geographical','explore','quality'].includes(requestedView))switchView(requestedView);
  if(window.location.hash){const target=decodeURIComponent(window.location.hash.slice(1)),hashView=target.replace(/View$/,'');if(['overview','medical','financial','geographical','explore','quality'].includes(hashView))switchView(hashView);setTimeout(()=>document.getElementById(target)?.scrollIntoView({block:'start'}),0)}
}

function validate(data){
  const rows=Array.isArray(data)?data:data.records;
  if(!Array.isArray(rows)||!rows.length)throw new Error('Expected a non-empty JSON array or an object with records[].');
  rows.forEach((r,i)=>{if(!r.title||!r.url)throw new Error(`Record ${i+1} needs title and url.`)});
  return rows;
}

function wire(){
  $$('.tab').forEach(t=>t.addEventListener('click',()=>switchView(t.dataset.view)));
  const filterIds=['searchInput','specialtyFilter','diagnosisFilter','countryFilter','statusFilter','ageFilter','yearFilter','reviewFilter'];
  filterIds.forEach(id=>$('#'+id).addEventListener(id==='searchInput'?'input':'change',applyFilters));
  $('#clearFilters').addEventListener('click',()=>{filterIds.forEach(id=>$('#'+id).value='');applyFilters()});
  $('#methodButton').addEventListener('click',()=>$('#methodDialog').showModal());
  $$('.dialog-close').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
  $$('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d)d.close()}));
  $('#exportCsv').addEventListener('click',exportCsv);
  $('#downloadJson').addEventListener('click',()=>download('care-gap-corpus.json',JSON.stringify(records,null,2),'application/json'));
  $('#jsonImport').addEventListener('change',importJson);
  $('#resetData').addEventListener('click',()=>{localStorage.removeItem('care-gap-dataset');records=[...bundled];populateFilters();applyFilters();$('#importStatus').textContent='Bundled corpus restored.'});
  $('#askAgent').addEventListener('click',askAgent);
}

function switchView(name){
  $$('.tab').forEach(t=>t.classList.toggle('active',t.dataset.view===name));
  $$('.view').forEach(v=>v.classList.toggle('active',v.id===name+'View'));
  $('.hero').hidden=name!=='overview';
  $('#filterbar').classList.toggle('active',name==='explore'||name==='quality');
  window.scrollTo({top:0});
}

function populateFilters(){
  const set=(id,vals)=>{const el=$('#'+id),first=el.options[0];el.innerHTML='';el.append(first);[...new Set(vals.filter(Boolean))].sort().forEach(v=>el.add(new Option(v,v)))};
  set('specialtyFilter',records.map(specialty));set('diagnosisFilter',records.map(diagnosisFamily));set('countryFilter',records.flatMap(r=>treatmentCountries(r).length?treatmentCountries(r):['Not stated']));set('ageFilter',records.map(r=>r.age_group));set('yearFilter',records.map(r=>String(r.published_at||'').slice(0,4)));
}

function applyFilters(){
  const q=$('#searchInput').value.trim().toLowerCase(),sp=$('#specialtyFilter').value,dx=$('#diagnosisFilter').value,country=$('#countryFilter').value,st=$('#statusFilter').value,age=$('#ageFilter').value,year=$('#yearFilter').value,review=$('#reviewFilter').value;
  filtered=records.filter(r=>{
    const countries=treatmentCountries(r),needsReview=r.reconciliation_status==='requires_review'||r.review_required;
    const hay=[r.patient_name,r.title,r.main_diagnosis,r.diagnosis_group,specialty(r),...treatmentTypes(r),...countries,...(r.proposed_treatments||[]).map(t=>t.hospital)].join(' ').toLowerCase();
    return (!q||hay.includes(q))&&(!sp||specialty(r)===sp)&&(!dx||diagnosisFamily(r)===dx)&&(!country||(country==='Not stated'?!countries.length:countries.includes(country)))&&(!st||r.status===st)&&(!age||r.age_group===age)&&(!year||String(r.published_at||'').startsWith(year))&&(!review||(review==='review')===needsReview);
  });
  $('#filterSummary').textContent=filtered.length===records.length?`All ${records.length} records`:`${filtered.length} of ${records.length} records`;
  render();
}

function render(){renderKpis();renderOverview();renderDonut('specialtyDonut');renderDonut('medicalSpecialtyDonut',true);renderBars();renderPopulationContext();renderTemporalStats();renderAgeHistogram();renderFinancial();renderHistogram();renderBoxplot();renderMatrix();renderSpecialtyCosts('overviewSpecialtyCosts',filtered);renderSpecialtyCosts('financialSpecialtyCosts',filtered);renderFlows();renderExploreStats();renderTable();renderCompleteness();renderMethod()}

function renderKpis(){
  const costs=filtered.map(treatmentCostBam).filter(known),targets=filtered.map(r=>r.requested_campaign_amount_bam).filter(known);
  const active=filtered.filter(r=>r.status==='active').length;
  const items=[
    ['Selected cases',fmt.format(filtered.length),`${active} active · ${filtered.length-active} completed`],
    ['Known quoted treatment cost',money(costs.reduce((a,b)=>a+b,0)),`${costs.length}/${filtered.length} cases with values`],
    ['Combined campaign targets',money(targets.reduce((a,b)=>a+b,0)),`Median ${money(median(targets))}`],
    ['Foreign care named',fmt.format(filtered.filter(r=>foreignCountries(r).length).length),`${filtered.filter(r=>pathway(r)==='unknown').length} destination not stated`]
  ];
  $('#kpis').innerHTML=items.map(([l,v,n],i)=>`<article class="kpi"><div><span class="label">${esc(l)}</span><span class="dot" style="background:${COLORS[i]}"></span></div><strong>${esc(v)}</strong><small>${esc(n)}</small></article>`).join('');
}

function renderOverview(){
  const meta=[['local','Domestic: named or explicit evidence',COLORS[4]],['likely_local','Likely domestic aftercare',COLORS[6]],['abroad','Abroad only',COLORS[0]],['mixed','Bosnia + abroad',COLORS[2]],['unknown','Not stated','#666']],counts=Object.fromEntries(meta.map(([key])=>[key,filtered.filter(r=>analysisPathway(r)===key).length]));
  $('#overviewPathways').innerHTML=`<div class="pathway-stack">${meta.map(([key,name,color])=>`<div style="width:${filtered.length?100*counts[key]/filtered.length:0}%;background:${color}" title="${name}: ${counts[key]}"></div>`).join('')}</div><div class="pathway-list">${meta.map(([key,name,color])=>`<div><i style="background:${color}"></i><span>${name}</span><b>${counts[key]}</b><small>${filtered.length?(100*counts[key]/filtered.length).toFixed(1):'0.0'}%</small></div>`).join('')}</div>`;
}

function renderFinancial(){
  const costs=filtered.map(treatmentCostBam).filter(known),targets=filtered.map(r=>r.requested_campaign_amount_bam).filter(known);
  const items=[
    ['Known quoted costs',money(costs.reduce((a,b)=>a+b,0)),`${costs.length}/${filtered.length} records`],
    ['Median quoted cost',money(median(costs)),'Known values only'],
    ['Campaign targets',money(targets.reduce((a,b)=>a+b,0)),`${targets.length}/${filtered.length} records`]
  ];
  $('#financialKpis').innerHTML=items.map(([l,v,n],i)=>`<article class="kpi"><div><span class="label">${esc(l)}</span><span class="dot" style="background:${COLORS[i+1]}"></span></div><strong>${esc(v)}</strong><small>${esc(n)}</small></article>`).join('');
  const data=countBy(filtered,specialty).map(([name])=>{const rows=filtered.filter(r=>specialty(r)===name),values=rows.map(r=>r.requested_campaign_amount_bam).filter(known);return [name,values.reduce((a,b)=>a+b,0),values.length,rows.length]}).filter(d=>d[2]).sort((a,b)=>b[1]-a[1]);
  const max=Math.max(1,...data.map(d=>d[1]));
  $('#financialTargets').innerHTML=data.length?`<div class="specialty-cost-list">${data.map(d=>`<div class="specialty-cost-row"><div class="bar-label"><span>${esc(d[0])}</span><b>${money(d[1])}</b></div><div class="bar-track"><div class="bar-fill cyan" style="width:${100*d[1]/max}%"></div></div><small class="muted">${d[2]}/${d[3]} records with targets</small></div>`).join('')}</div>`:'<div class="empty">No campaign targets in this selection.</div>';
}

function renderExploreStats(){
  const needsReview=filtered.filter(r=>r.reconciliation_status==='requires_review'||r.review_required).length,costs=filtered.map(treatmentCostBam).filter(known),targets=filtered.map(r=>r.requested_campaign_amount_bam).filter(known),outcomes=filtered.filter(r=>known(r.treatment_outcome)).length;
  const quality=[
    ['Selected records',filtered.length,`${records.length-filtered.length} outside filters`],
    ['Analysis-ready',filtered.length-needsReview,`${needsReview} require review`],
    ['Known quoted cost',`${filtered.length?Math.round(100*costs.length/filtered.length):0}%`,`${costs.length}/${filtered.length} records`],
    ['Outcome stated',`${filtered.length?Math.round(100*outcomes/filtered.length):0}%`,`${outcomes}/${filtered.length} records`]
  ];
  $('#qualityKpis').innerHTML=quality.map(([l,v,n],i)=>`<article class="kpi"><div><span class="label">${esc(l)}</span><span class="dot" style="background:${COLORS[i]}"></span></div><strong>${esc(v)}</strong><small>${esc(n)}</small></article>`).join('');
  const stats=[
    ['Matching records',fmt.format(filtered.length),'Active filters applied'],
    ['Total known quoted cost',money(costs.reduce((a,b)=>a+b,0)),`${costs.length} records with values`],
    ['Median quoted cost',money(median(costs)),'Known values only'],
    ['Campaign targets',money(targets.reduce((a,b)=>a+b,0)),`${targets.length} records with targets`]
  ];
  $('#exploreStats').innerHTML=stats.map(([l,v,n],i)=>`<article class="kpi"><div><span class="label">${esc(l)}</span><span class="dot" style="background:${COLORS[i+2]}"></span></div><strong>${esc(v)}</strong><small>${esc(n)}</small></article>`).join('');
  $('#exploreResultTitle').textContent=filtered.length===records.length?'All case records':`${filtered.length} matching case records`;
  $('#agentSummary').textContent=`Analyze ${filtered.length} matching records with ${costs.length} known quoted costs and ${needsReview} review flags. The agent will receive the active filters and inspect the source-linked dataset.`;
}

function activeFilterSummary(){
  const specs=[['Search','searchInput'],['Specialty','specialtyFilter'],['Diagnosis','diagnosisFilter'],['Destination','countryFilter'],['Status','statusFilter'],['Age','ageFilter'],['Year','yearFilter'],['Review','reviewFilter']];
  return specs.map(([name,id])=>[name,$('#'+id).value]).filter(([,value])=>value).map(([name,value])=>`${name}: ${value}`).join('; ')||'No filters (entire corpus)';
}

function askAgent(){
  const costs=filtered.map(treatmentCostBam).filter(known),draft=`Analyze the Care Gap Observatory selection in detail. Active filters: ${activeFilterSummary()}. Current match: ${filtered.length} of ${records.length} campaign-derived case records; ${costs.length} have known quoted medical costs totaling ${money(costs.reduce((a,b)=>a+b,0))}. Inspect the underlying source-linked records in the Care Gap Observatory dataset, compare clinically and economically meaningful subgroups, preserve unknowns, distinguish case records from unique patients, and cite the relevant campaign URLs. Start with the most decision-relevant patterns and data-quality caveats.`;
  window.parent.postMessage({type:'moebius:new-chat',draft,autoSend:true},'*');
}

function renderDonut(target='specialtyDonut',showAll=false){
  const all=countBy(filtered,specialty),top=all.slice(0,8),topTotal=top.reduce((s,d)=>s+d[1],0),otherTotal=filtered.length-topTotal,data=otherTotal?[...top,['Other specialties',otherTotal]]:top,total=data.reduce((s,d)=>s+d[1],0); if(!total)return empty(target);
  let angle=-Math.PI/2;const cx=100,cy=100,R=78,r=48;
  const paths=data.map((d,i)=>{const a=angle,b=angle+2*Math.PI*d[1]/total;angle=b;const big=b-a>Math.PI?1:0;const p=`M ${cx+R*Math.cos(a)} ${cy+R*Math.sin(a)} A ${R} ${R} 0 ${big} 1 ${cx+R*Math.cos(b)} ${cy+R*Math.sin(b)} L ${cx+r*Math.cos(b)} ${cy+r*Math.sin(b)} A ${r} ${r} 0 ${big} 0 ${cx+r*Math.cos(a)} ${cy+r*Math.sin(a)} Z`;return `<path d="${p}" fill="${COLORS[i%COLORS.length]}" stroke="#171717" stroke-width="2"><title>${esc(d[0])}: ${d[1]}</title></path>`}).join('');
  const unknown=filtered.filter(r=>specialty(r)==='Unknown').length,smallerKnown=Math.max(0,otherTotal-unknown),smallerGroups=Math.max(0,all.slice(8).filter(([name])=>name!=='Unknown').length);
  const fullList=showAll?`<div class="specialty-all-list" aria-label="All specialties">${all.map(([name,count],i)=>`<div><i style="background:${COLORS[i%COLORS.length]}"></i><span>${esc(name)}</span><b>${count}</b><small>${total?(100*count/total).toFixed(1):'0.0'}%</small></div>`).join('')}</div>`:'';
  $('#'+target).innerHTML=`<div class="specialty-chart-layout${showAll?' with-all':''}"><svg viewBox="0 0 200 200" role="img" aria-label="Cases by specialty">${paths}<text x="100" y="96" text-anchor="middle" fill="var(--text)" font-size="27" font-weight="700">${total}</text><text x="100" y="116" text-anchor="middle" class="axis-label">CASES</text></svg><div class="legend">${data.map((d,i)=>`<div class="legend-row"><i class="legend-swatch" style="background:${COLORS[i%COLORS.length]}"></i><span>${esc(d[0])}</span><b>${d[1]}</b></div>`).join('')}</div>${fullList}</div><p class="chart-footnote">The eight largest specialties account for ${topTotal} cases. “Other specialties” contains ${smallerKnown} cases across ${smallerGroups} smaller specialty groups${unknown?`; ${unknown} additional case${unknown===1?'':'s'} remain Unknown because the source narrative did not support a reliable specialty classification`:''}. It is not missing from the chart.</p>`;
}

function renderAgeHistogram(){
  const bins=[{name:'0–4',min:0,max:5,n:0},{name:'5–17',min:5,max:18,n:0},{name:'18–34',min:18,max:35,n:0},{name:'35–49',min:35,max:50,n:0},{name:'50–64',min:50,max:65,n:0},{name:'65+',min:65,max:Infinity,n:0}],ages=filtered.filter(r=>known(r.age_years)).map(r=>Number(r.age_years)).filter(Number.isFinite);
  ages.forEach(age=>{const bin=bins.find(b=>age>=b.min&&age<b.max);if(bin)bin.n++});
  if(!ages.length)return empty('ageHistogram');
  const peak=Math.max(1,...bins.map(b=>b.n));
  $('#ageHistogram').innerHTML=`<div class="coverage-line"><strong>${ages.length}/${filtered.length}</strong><span>case records include a numeric age · ${filtered.length-ages.length} not stated</span></div><div class="year-histogram age-histogram" role="img" aria-label="Age distribution of case records with known age">${bins.map(b=>`<div><b>${b.n}</b><i style="height:${Math.max(3,120*b.n/peak)}px" title="Age ${b.name}: ${b.n} case records"></i><span>${b.name}</span></div>`).join('')}</div><p class="chart-footnote">Counts describe campaign-derived case records, not unique patients. Unknown ages are excluded from the bars and reported above.</p>`;
}

function bars(id,data,klass=''){const max=Math.max(1,...data.map(d=>d[1]));$('#'+id).innerHTML=data.length?`<div class="bar-list">${data.map(d=>`<div><div class="bar-label"><span>${esc(label(d[0]))}</span><b>${d[1]}</b></div><div class="bar-track"><div class="bar-fill ${klass}" style="width:${100*d[1]/max}%"></div></div></div>`).join('')}</div>`:'<div class="empty">No coded values in this selection.</div>'}
const DIAGNOSIS_SUMMARIES={
  'Malignant neoplasms':'Cancers of all types, including solid tumors, lymphomas, leukemias and myeloma.',
  'Neurological and neuromuscular disorders':'Conditions affecting the brain, spinal cord, nerves or muscles, including epilepsy, paralysis and neuromuscular disease.',
  'Musculoskeletal and orthopedic disorders':'Bone, joint, spine and limb conditions, including deformities, degeneration and mobility-limiting disorders.',
  'Cardiovascular disorders':'Diseases of the heart, blood vessels and circulation, including congenital and acquired heart disease.',
  'Congenital, genetic and developmental disorders':'Conditions present from birth, inherited syndromes and disorders affecting growth or development.',
  'Injuries, burns and sequelae':'Trauma, burns, amputations and longer-term consequences or disability following an injury.',
  'Gastrointestinal and hepatobiliary disorders':'Non-cancer conditions affecting the digestive tract, liver, gallbladder, bile ducts or pancreas.',
  'Non-malignant or uncertain neoplasms':'Benign, borderline or incompletely characterized tumors whose malignant behavior is not established.',
  'Ear, hearing and airway disorders':'Hearing loss and conditions of the ear, upper airway or related structures.',
  'Renal and urological disorders':'Conditions affecting the kidneys, bladder, urinary tract or related urological organs.',
  'Autoimmune and inflammatory disorders':'Conditions driven by immune-system dysfunction or persistent inflammation.',
  'Eye and vision disorders':'Conditions affecting the eyes, optic structures or vision.',
  'Infectious diseases':'Illnesses caused by infectious agents and their complications.',
  'Respiratory disorders':'Non-cancer conditions affecting the lungs and breathing.',
  'Unknown / not stated':'The public campaign did not state enough diagnostic information for a reliable family classification.'
};
function malignancySite(r){
  const s=String(r.main_diagnosis||'').toLowerCase(),primary=s.replace(/\bwith\b.*$/,'').replace(/\binvolving\b.*$/,''),fallback=String(r.normalized_diagnosis_group||r.diagnosis_group||'').toLowerCase();
  const tests=[
    ['Breast cancers',/breast|mammary/],['Gynecologic cancers',/cervi|uter|ovar|endometri|vulv|gynecolog/],
    ['Colorectal and other gastrointestinal cancers',/colorect|colon cancer|colon carcinoma|rectal|intestin|bowel|gastr|stomach|pancrea|esophag|duoden/],
    ['Blood and lymphatic cancers',/lymphoma|leuk|myeloma|hodgkin|hematolog/],
    ['Lung and thoracic cancers',/lung (?:cancer|carcinoma|adenocarcinoma)|small-cell|bronchus|thoracic cancer/],
    ['Liver and biliary cancers',/liver cancer|hepatocellular|cholangio|biliary cancer|gallbladder cancer/],
    ['Head and neck cancers',/tongue|nasopharyn|oropharyn|laryn|throat|oral cavity|mouth|salivary|head.{0,3}neck/],
    ['Brain and central nervous system cancers',/brain (?:tumor|cancer)|glioma|glioblast|medulloblast|central nervous system/],
    ['Kidney and urinary cancers',/kidney cancer|renal cancer|malignant kidney|bladder (?:cancer|tumor)|urothel|ureteral carcinoma/],
    ['Thyroid cancers',/thyroid carcinoma|thyroid cancer|parathyroid.*cancer/],
    ['Skin cancers and melanoma',/melanoma|skin (?:cancer|carcinoma)/],
    ['Bone and soft-tissue cancers',/sarcoma|bone cancer|osteosar|ewing|soft.?tissue cancer/],
    ['Male reproductive cancers',/prostate|testic/]
  ];
  for(const [name,re] of tests)if(re.test(primary))return name;
  for(const [name,re] of tests)if(re.test(fallback))return name;
  return 'Other or unspecified malignancies';
}
function renderDiagnosisPanels(){
  const data=countBy(filtered,diagnosisFamily).slice(0,8),max=Math.max(1,...data.map(d=>d[1]));
  $('#diagnosisBars').innerHTML=data.length?`<div class="diagnosis-list">${data.map(([name,n])=>`<div><div class="bar-label"><span>${esc(name)}</span><b>${n}</b></div><div class="bar-track"><div class="bar-fill" style="width:${100*n/max}%"></div></div><small class="diagnosis-summary">${esc(DIAGNOSIS_SUMMARIES[name]||'A broad analytical family grouping related diagnoses stated in campaign narratives.')}</small></div>`).join('')}</div>`:'<div class="empty">No coded values in this selection.</div>';
  const malignant=filtered.filter(r=>diagnosisFamily(r)==='Malignant neoplasms'),sites=countBy(malignant,malignancySite),siteMax=Math.max(1,...sites.map(d=>d[1]));
  $('#malignantBreakdown').innerHTML=malignant.length?`<div class="coverage-line"><strong>${malignant.length}</strong><span>case records in the malignant-neoplasm family</span></div><div class="bar-list">${sites.map(([name,n])=>`<div><div class="bar-label"><span>${esc(name)}</span><b>${n}</b></div><div class="bar-track"><div class="bar-fill cyan" style="width:${100*n/siteMax}%"></div></div></div>`).join('')}</div><p class="chart-footnote">This is a conservative text-based grouping of the stated primary diagnosis. “Other or unspecified” is retained where the cancer site or type cannot be determined reliably.</p>`:'<div class="empty">No malignant-neoplasm cases in this selection.</div>';
}
const MATCHED_PREVALENCE=[
  {name:'All malignant neoplasms',campaign:r=>diagnosisFamily(r)==='Malignant neoplasms',value:'35,957 people',detail:'Five-year prevalence · Bosnia and Herzegovina · IARC 2024 estimate'},
  {name:'Ischaemic heart disease',campaign:r=>/ischaemic|ischemic|coronary/i.test(r.main_diagnosis||''),value:'1,444.5 ♂ · 1,284.8 ♀ per 100k',detail:'Registered primary-care prevalence · Federation entity · 2021'},
  {name:'Stroke',campaign:r=>/\bstroke\b|moždani udar/i.test(r.main_diagnosis||''),value:'300.3 ♂ · 287.1 ♀ per 100k',detail:'Registered primary-care prevalence · Federation entity · 2021'},
  {name:'Type 2 diabetes',campaign:r=>/type.?2 diabetes|diabetes mellitus type 2/i.test(r.main_diagnosis||''),value:'2,918.5 ♂ · 3,413.0 ♀ per 100k',detail:'Registered primary-care prevalence · Federation entity · 2021'}
];
const CANCER_PREVALENCE_2024={
  'Breast cancers':{value:4527,detail:'Breast'},
  'Gynecologic cancers':{value:2914,detail:'Cervix, corpus uteri, ovary, vulva and vagina'},
  'Colorectal and other gastrointestinal cancers':{value:8187,detail:'Colorectum, stomach, pancreas and oesophagus'},
  'Blood and lymphatic cancers':{value:2620,detail:'Non-Hodgkin and Hodgkin lymphoma, leukaemia and multiple myeloma'},
  'Lung and thoracic cancers':{value:3274,detail:'Lung and mesothelioma'},
  'Liver and biliary cancers':{value:792,detail:'Liver and gallbladder'},
  'Head and neck cancers':{value:1591,detail:'Larynx, oral cavity, salivary glands, oro-/hypo-/nasopharynx'},
  'Brain and central nervous system cancers':{value:1473,detail:'Brain and central nervous system'},
  'Kidney and urinary cancers':{value:2970,detail:'Bladder and kidney'},
  'Thyroid cancers':{value:435,detail:'Thyroid'},
  'Skin cancers and melanoma':{value:1060,detail:'Melanoma only; other skin cancers are not separately reported'},
  'Bone and soft-tissue cancers':{value:null,detail:'No separate comparable total in the IARC country fact sheet'},
  'Male reproductive cancers':{value:2742,detail:'Prostate, testis and penis'},
  'Other or unspecified malignancies':{value:null,detail:'Cannot be matched reliably to a population site total'}
};
const POPULATION_GAPS=[
  {name:'Systemic hypertension',campaign:'0 primary diagnoses',value:'42% of adults',detail:'Federation government health survey, 2012; the newer registered-care figure was 10.7% in 2021 and is considered an underestimate.'},
  {name:'Low back pain',campaign:'0 primary diagnoses',value:'1,895 DALYs per 100k',detail:'WHO/GBD 2021 burden rate. This is not prevalence, but shows a major source of population health loss.'},
  {name:'Alzheimer’s disease and other dementias',campaign:'0 primary diagnoses',value:'720 DALYs per 100k',detail:'WHO/GBD 2021 burden rate. This is not prevalence, but shows a major source of population health loss.'}
];
function renderPopulationContext(){
  $('#populationContext').innerHTML=`<div class="comparison-table"><div class="comparison-head"><span>Diagnosis</span><span>Campaign cases</span><span>Population prevalence</span></div>${MATCHED_PREVALENCE.map(item=>`<article><div><strong>${esc(item.name)}</strong><small>${esc(item.detail)}</small></div><b>${filtered.filter(item.campaign).length}</b><strong>${esc(item.value)}</strong></article>`).join('')}</div><p class="notice">Campaign counts and population prevalence use different denominators and must not be interpreted as rates. They are aligned only to reveal representation gaps. Registered primary-care figures may understate true prevalence.</p><p class="source-row"><a class="source-link" href="https://uniatf.who.int/docs/librariesprovider22/default-document-library/bosnia-and-herzegovina-ncd-report.pdf?sfvrsn=5f625b89_1" target="_blank" rel="noopener">UN/WHO NCD assessment ↗</a> · <a class="source-link" href="https://gco.iarc.who.int/media/globocan/factsheets/populations/70-bosnia-herzegovina-fact-sheet.pdf" target="_blank" rel="noopener">IARC cancer fact sheet ↗</a></p>`;
  const malignant=filtered.filter(r=>diagnosisFamily(r)==='Malignant neoplasms'),sites=countBy(malignant,malignancySite);
  $('#cancerPrevalence').innerHTML=sites.length?`<div class="comparison-table cancer-comparison"><div class="comparison-head"><span>Cancer category</span><span>Campaign cases</span><span>5-year prevalence</span></div>${sites.map(([name,n])=>{const population=CANCER_PREVALENCE_2024[name]||{value:null,detail:'No comparable population mapping'};return `<article><div><strong>${esc(name)}</strong><small>${esc(population.detail)}</small></div><b>${n}</b><strong>${population.value==null?'Not separately available':fmt.format(population.value)}</strong></article>`}).join('')}</div><p class="chart-footnote">The category list and order now match the campaign breakdown exactly. Where a campaign category combines several cancer sites, the IARC site-specific five-year prevalence counts are summed. “Not separately available” is retained rather than inventing a comparison.</p><p class="source-row"><a class="source-link" href="https://gco.iarc.who.int/media/globocan/factsheets/populations/70-bosnia-herzegovina-fact-sheet.pdf" target="_blank" rel="noopener">IARC Bosnia and Herzegovina fact sheet ↗</a></p>`:'<div class="empty">No malignant-neoplasm cases in this selection.</div>';
  $('#populationMissing').innerHTML=`<div class="representation-gaps">${POPULATION_GAPS.map(item=>`<article><div><span>${esc(item.campaign)}</span><h5>${esc(item.name)}</h5><p>${esc(item.detail)}</p></div><strong>${esc(item.value)}</strong></article>`).join('')}</div><p class="notice">Low back pain and dementia are included because they are among Bosnia and Herzegovina’s leading 2021 causes of disability-adjusted life years in the WHO country profile, yet neither appears as a primary diagnosis in this campaign corpus. Their values are burden rates, not prevalence estimates.</p><p class="source-row"><a class="source-link" href="https://iris.who.int/bitstream/handle/10665/380237/9789289059732-eng.pdf?sequence=1" target="_blank" rel="noopener">WHO European health report 2024 country profile ↗</a></p>`;
}
function renderBars(){
  renderDiagnosisPanels();
  bars('abroadBars',countBy(filtered,r=>[...new Set((r.abroad_reason_codes||[]).map(abroadReasonGroup))]),'cyan');
  bars('failureBars',countBy(filtered,r=>(r.earlier_failure_reason_codes||[]).map(label)).filter(d=>d[0]!=='Unknown').slice(0,8));
}

function renderTemporalStats(){
  const dated=filtered.map(r=>({r,date:new Date(r.published_at)})).filter(x=>!isNaN(x.date));
  if(!dated.length){['caseTimeline','campaignStatusStats','urgencyStats','outcomeStats'].forEach(empty);return}
  const min=new Date(Math.min(...dated.map(x=>x.date))),max=new Date(Math.max(...dated.map(x=>x.date))),years=countBy(dated,x=>String(x.date.getFullYear())).sort((a,b)=>a[0].localeCompare(b[0])),peak=Math.max(1,...years.map(d=>d[1]));
  const sourceCampaigns=new Set(filtered.map(r=>r.source_id||r.url)).size;
  $('#caseTimeline').innerHTML=`<div class="time-range"><div><span>First publication</span><strong>${min.toLocaleDateString('en-GB')}</strong></div><div><span>Latest publication</span><strong>${max.toLocaleDateString('en-GB')}</strong></div><div><span>Observed span</span><strong>${((max-min)/31557600000).toFixed(1)} years</strong></div></div><div class="year-histogram" role="img" aria-label="Campaign case counts by publication year">${years.map(([year,n],i)=>`<div><b>${n}</b><i style="height:${Math.max(3,120*n/peak)}px" title="${year}: ${n} case records"></i><span>${year}${i===0||i===years.length-1?'*':''}</span></div>`).join('')}</div><p class="chart-footnote">${filtered.length} case records from ${sourceCampaigns} source campaigns. * Boundary years are partial and should not be read as annual rates.</p>`;

  const statuses=countBy(filtered,r=>label(r.status)),active=filtered.filter(r=>r.status==='active'),ages=active.map(r=>{const p=new Date(r.published_at),c=new Date(`${r.collection_date}T00:00:00`);return Math.max(0,Math.round((c-p)/86400000))}).filter(Number.isFinite);
  $('#campaignStatusStats').innerHTML=`<div class="status-summary">${statuses.map(([name,n],i)=>`<div><i style="background:${COLORS[i%COLORS.length]}"></i><span>${esc(name)}</span><b>${n}</b><small>${filtered.length?(100*n/filtered.length).toFixed(1):'0.0'}%</small></div>`).join('')}</div><div class="evidence-callout"><strong>${ages.length?`${median(ages)} days`: 'Not available'}</strong><span>Median age of the ${active.length} active campaigns at collection${ages.length?` · range ${Math.min(...ages)}–${Math.max(...ages)} days`:''}</span></div><p class="notice">A completed status is visible, but no closure date is published. True duration cannot be calculated for completed campaigns.</p>`;

  const urgencyKnown=filtered.filter(r=>known(r.urgency)),urgencyExplicit=urgencyKnown.filter(r=>r.field_provenance?.urgency==='explicit'),urgencyNonExplicit=urgencyKnown.length-urgencyExplicit.length,urgencyMissing=filtered.length-urgencyKnown.length,urgencyCounts=countBy(urgencyExplicit,r=>urgencyGroup(r.urgency)),leadDays=filtered.map(plannedLeadDays).filter(known);
  const uMax=Math.max(1,...urgencyCounts.map(d=>d[1]));
  $('#urgencyStats').innerHTML=`<div class="coverage-line"><strong>${urgencyExplicit.length}/${filtered.length}</strong><span>cases contain explicit urgency wording · ${urgencyMissing} not stated${urgencyNonExplicit?` · ${urgencyNonExplicit} inferred/derived`:''}</span></div><div class="bar-list">${urgencyCounts.map(([name,n])=>`<div><div class="bar-label"><span>${esc(name)}</span><b>${n}</b></div><div class="bar-track"><div class="bar-fill cyan" style="width:${100*n/uMax}%"></div></div></div>`).join('')}</div><div class="evidence-callout"><strong>${leadDays.length?`${median(leadDays)} days`:'Not available'}</strong><span>Median publication-to-planned-treatment lead time · ${leadDays.length} cases with an exact parseable date${leadDays.length?` · range ${Math.min(...leadDays)}–${Math.max(...leadDays)} days`:''}</span></div>`;

  const outcomeRows=filtered.filter(r=>known(r.treatment_outcome)),outcomes=countBy(outcomeRows,r=>outcomeGroup(r.treatment_outcome)),oMax=Math.max(1,...outcomes.map(d=>d[1]));
  const names=new Map();filtered.forEach(r=>{const name=String(r.patient_name||'').trim().toLocaleLowerCase();if(name)names.set(name,(names.get(name)||0)+1)});const recurring=[...names.values()].filter(n=>n>1),repeatRecords=recurring.reduce((a,b)=>a+b,0);
  $('#outcomeStats').innerHTML=`<div class="coverage-line"><strong>${outcomeRows.length}/${filtered.length}</strong><span>cases contain any outcome or follow-up narrative · ${filtered.length-outcomeRows.length} not stated</span></div><div class="bar-list">${outcomes.map(([name,n])=>`<div><div class="bar-label"><span>${esc(name)}</span><b>${n}</b></div><div class="bar-track"><div class="bar-fill" style="width:${100*n/oMax}%"></div></div></div>`).join('')}</div><div class="evidence-callout"><strong>${recurring.length} names · ${repeatRecords} records</strong><span>Exact patient-name strings appearing in multiple campaign records; a repeat appeal signal, not proof of clinical recurrence</span></div><p class="chart-footnote">Reported outcomes are early campaign narratives, not standardized or independently verified follow-up.</p>`;
}

function renderSpecialtyCosts(id,rows){
  const corpusDates=records.map(r=>new Date(r.published_at)).filter(d=>!isNaN(d)),start=new Date(Math.min(...corpusDates)),end=new Date(Math.max(...corpusDates)),periodYears=Math.max(1,(end-start)/31557600000);
  const data=countBy(rows,specialty).map(([name,cases])=>{const values=rows.filter(r=>specialty(r)===name).map(treatmentCostBam).filter(known),total=values.reduce((a,b)=>a+b,0);return {name,cases,known:values.length,total,annualAverage:total/periodYears}}).filter(d=>d.known).sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name));
  const el=$('#'+id);if(!el)return;if(!data.length)return empty(id);
  const grand=data.reduce((s,d)=>s+d.total,0),max=Math.max(...data.map(d=>d.total),1),knownCases=data.reduce((s,d)=>s+d.known,0);
  el.innerHTML=`<div class="cost-total"><span>Total known quoted cost</span><strong>${money(grand)}</strong><small>${knownCases}/${rows.length} selected cases have a cost value</small></div><div class="specialty-cost-list">${data.map(d=>`<div class="specialty-cost-row"><div class="bar-label"><span title="${esc(d.name)}">${esc(d.name)}</span><b>${money(d.total)}</b></div><div class="bar-track"><div class="bar-fill" style="width:${100*d.total/max}%"></div></div><div class="specialty-cost-meta"><small>${d.known}/${d.cases} cases with known cost</small><strong>${money(d.annualAverage)} average / year</strong></div></div>`).join('')}</div><p class="chart-footnote">Annual averages divide each specialty total by the common ${periodYears.toFixed(1)}-year corpus window (${start.toLocaleDateString('en-GB')}–${end.toLocaleDateString('en-GB')}). They are descriptive annualized campaign values—not national expenditure or inflation-adjusted costs.</p>`;
}

function renderHistogram(){
  const vals=filtered.map(treatmentCostBam).filter(known);if(!vals.length)return empty('costHistogram');
  const max=Math.max(...vals),step=Math.max(10000,Math.ceil(max/6/10000)*10000),bins=Array.from({length:Math.ceil(max/step)||1},(_,i)=>({lo:i*step,hi:(i+1)*step,n:0})); vals.forEach(v=>bins[Math.min(bins.length-1,Math.floor(v/step))].n++);
  const W=640,H=220,p=35,m=Math.max(...bins.map(b=>b.n),1),bw=(W-p*2)/bins.length-5;
  $('#costHistogram').innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Treatment cost histogram"><line x1="${p}" y1="${H-p}" x2="${W-p}" y2="${H-p}" stroke="#414141"/>${bins.map((b,i)=>{const h=(H-p*2)*b.n/m,x=p+i*((W-p*2)/bins.length)+2;return `<rect x="${x}" y="${H-p-h}" width="${bw}" height="${h}" rx="4" fill="${COLORS[0]}"><title>${money(b.lo)}–${money(b.hi)}: ${b.n}</title></rect><text x="${x+bw/2}" y="${H-12}" text-anchor="middle" class="axis-label">${Math.round(b.lo/1000)}k</text><text x="${x+bw/2}" y="${H-p-h-7}" text-anchor="middle" fill="var(--text)" font-size="10">${b.n}</text>`}).join('')}</svg>`;
}

function renderBoxplot(){
  const groups=countBy(filtered,specialty).map(([name])=>[name,filtered.filter(r=>specialty(r)===name).map(treatmentCostBam).filter(known)]).filter(d=>d[1].length).slice(0,7);if(!groups.length)return empty('costBoxplot');
  const W=650,row=32,H=groups.length*row+35,max=Math.max(...groups.flatMap(g=>g[1])),x=v=>170+(W-190)*v/max;
  $('#costBoxplot').innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Cost box plot by specialty">${groups.map((g,i)=>{const a=g[1],y=18+i*row,q1=quantile(a,.25),md=median(a),q3=quantile(a,.75),mn=Math.min(...a),mx=Math.max(...a);return `<text x="0" y="${y+4}" class="axis-label">${esc(g[0].slice(0,24))}</text><line x1="${x(mn)}" y1="${y}" x2="${x(mx)}" y2="${y}" stroke="#777"/><rect x="${x(q1)}" y="${y-8}" width="${Math.max(2,x(q3)-x(q1))}" height="16" rx="3" fill="#39304f" stroke="${COLORS[i%COLORS.length]}"/><line x1="${x(md)}" y1="${y-9}" x2="${x(md)}" y2="${y+9}" stroke="#fff"/>${a.map(v=>`<circle cx="${x(v)}" cy="${y}" r="2.5" fill="${COLORS[i%COLORS.length]}"/>`).join('')}`}).join('')}<text x="170" y="${H-4}" class="axis-label">0</text><text x="${W-2}" y="${H-4}" text-anchor="end" class="axis-label">${money(max)}</text></svg>`;
}

function renderMatrix(){
  const rows=countBy(filtered,specialty).slice(0,7).map(d=>d[0]),cols=countBy(filtered,r=>treatmentTypes(r)).filter(d=>d[0]!=='Unknown').slice(0,7).map(d=>d[0]);if(!rows.length||!cols.length)return empty('treatmentMatrix');
  const vals=rows.flatMap(row=>cols.map(col=>filtered.filter(r=>specialty(r)===row&&treatmentTypes(r).includes(col)).length)),max=Math.max(1,...vals);
  $('#treatmentMatrix').innerHTML=`<div class="matrix"><div class="matrix-grid" style="grid-template-columns:140px repeat(${cols.length},minmax(58px,1fr))"><div></div>${cols.map(c=>`<div class="matrix-label" title="${esc(c)}">${esc(c.slice(0,10))}</div>`).join('')}${rows.map(row=>`<div class="matrix-label">${esc(row)}</div>${cols.map(col=>{const n=filtered.filter(r=>specialty(r)===row&&treatmentTypes(r).includes(col)).length,a=n?(.18+.75*n/max):.03;return `<div class="matrix-cell" style="background:color-mix(in srgb,var(--accent) ${a*100}%,#1b1b1b)">${n||''}</div>`}).join('')}`).join('')}</div></div>`;
}

const geoPoint=(lon,lat)=>[25+(lon+15)/75*750,20+(72-lat)/50*495];
const COUNTRY_POINTS={
  'France':geoPoint(2.2,46.2),'Germany':geoPoint(10.45,51.17),'Switzerland':geoPoint(8.23,46.82),'Austria':geoPoint(14.55,47.52),
  'Slovenia':geoPoint(14.99,46.15),'Croatia':geoPoint(15.2,45.1),'Bosnia and Herzegovina':geoPoint(17.68,43.92),
  'Montenegro':geoPoint(19.37,42.7),'Serbia':geoPoint(21.0,44.0),'Belarus':geoPoint(28.0,53.7),'Russia':geoPoint(37.62,55.75),
  'Türkiye':geoPoint(35.0,39.0),'Egypt':geoPoint(30.0,27.0),'United Arab Emirates':geoPoint(54.4,24.4)
};
const COUNTRY_LABEL_OFFSETS={
  'Germany':[3,0],'Austria':[-4,-3],'Slovenia':[-8,2],'Croatia':[-15,4],
  'Montenegro':[3,13],'Serbia':[8,5],'Belarus':[0,4],'Türkiye':[-10,5]
};
const canonicalMapName=name=>name==='Turkey'?'Türkiye':name==='Republic of Serbia'?'Serbia':name;
const MAP_ZOOM={scale:2.6,x0:280,y0:190,tx:80,ty:18};
const focusPoint=point=>[(point[0]-MAP_ZOOM.x0)*MAP_ZOOM.scale+MAP_ZOOM.tx,(point[1]-MAP_ZOOM.y0)*MAP_ZOOM.scale+MAP_ZOOM.ty];
const pointInside=([x,y])=>x>=30&&x<=770&&y>=30&&y<=505;
function edgePoint(a,b){
  if(pointInside(b))return b;const dx=b[0]-a[0],dy=b[1]-a[1],hits=[];
  if(dx){for(const x of [38,762]){const t=(x-a[0])/dx,y=a[1]+t*dy;if(t>0&&y>=38&&y<=497)hits.push([t,[x,y]])}}
  if(dy){for(const y of [38,497]){const t=(y-a[1])/dy,x=a[0]+t*dx;if(t>0&&x>=38&&x<=762)hits.push([t,[x,y]])}}
  return (hits.sort((u,v)=>u[0]-v[0])[0]||[0,b])[1];
}

function foreignCountries(r){return treatmentCountries(r).filter(c=>c!=='Bosnia and Herzegovina')}
function flowPath(a,b){
  const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.max(1,Math.hypot(dx,dy)),ux=dx/length,uy=dy/length;
  const startInset=Math.min(18,length*.18),endInset=Math.min(26,length*.24);
  const sx=a[0]+ux*startInset,sy=a[1]+uy*startInset;
  const ex=b[0]-ux*endInset,ey=b[1]-uy*endInset;
  return `M ${sx.toFixed(1)} ${sy.toFixed(1)} L ${ex.toFixed(1)} ${ey.toFixed(1)}`;
}
function renderFlows(){
  const paths={local:[],likely_local:[],abroad:[],mixed:[],unknown:[]};filtered.forEach(r=>paths[analysisPathway(r)].push(r));
  const directLocal=filtered.filter(r=>pathway(r)==='local').length,directUnknown=filtered.filter(r=>pathway(r)==='unknown').length;
  const domesticEvidenceRows=filtered.filter(r=>domesticEvidence(r)),localNamed=paths.local.length+paths.mixed.length,abroadNamed=paths.abroad.length+paths.mixed.length;
  const kpis=[
    ['Domestic care signal',localNamed,`${directLocal} named Bosnia only · ${domesticEvidenceRows.filter(r=>domesticEvidence(r)!=='likely_aftercare').length} explicit access signals · ${paths.mixed.length} mixed`],
    ['Further care abroad',abroadNamed,`${paths.abroad.length} abroad only · ${paths.mixed.length} also local`],
    ['Foreign destinations',new Set(filtered.flatMap(foreignCountries)).size,'Countries named in proposed care'],
    ['Location unresolved',paths.unknown.length,`${directUnknown} lacked a named country before evidence review`]
  ];
  $('#flowKpis').innerHTML=kpis.map(([l,v,n],i)=>`<article class="kpi"><div><span class="label">${esc(l)}</span><span class="dot" style="background:${COLORS[i]}"></span></div><strong>${fmt.format(v)}</strong><small>${esc(n)}</small></article>`).join('');


  const pathwayMeta=[['local','Domestic: named or explicit signal',COLORS[4]],['likely_local','Likely domestic aftercare',COLORS[6]],['abroad','Abroad only',COLORS[0]],['mixed','Local + abroad',COLORS[2]],['unknown','Not stated','#666']];
  $('#pathwaySummary').innerHTML=`<div class="pathway-stack">${pathwayMeta.map(([key,name,color])=>`<div style="width:${filtered.length?100*paths[key].length/filtered.length:0}%;background:${color}" title="${name}: ${paths[key].length}"></div>`).join('')}</div><div class="pathway-list">${pathwayMeta.map(([key,name,color])=>`<div><i style="background:${color}"></i><span>${name}</span><b>${paths[key].length}</b><small>${filtered.length?(100*paths[key].length/filtered.length).toFixed(1):'0.0'}%</small></div>`).join('')}</div>`;

  const evidenceMeta=[
    ['solidarity','Solidarity Fund does not cover the therapy','Explicit financing/access evidence',COLORS[4]],
    ['waiting','Waiting list or delayed access','Explicit local-access delay',COLORS[2]],
    ['likely_aftercare','Post-injury/surgery device or rehabilitation','Likely domestic; destination remains unverified',COLORS[6]]
  ];
  const evidenceRows=Object.fromEntries(evidenceMeta.map(([key])=>[key,filtered.filter(r=>domesticEvidence(r)===key)]));
  $('#domesticEvidence').innerHTML=`<div class="domestic-evidence-grid">${evidenceMeta.map(([key,name,note,color])=>{const rows=evidenceRows[key];return `<article><div class="domestic-evidence-top"><i style="background:${color}"></i><strong>${rows.length}</strong></div><h5>${esc(name)}</h5><p>${esc(note)}</p>${rows.length?`<div class="evidence-examples">${rows.slice(0,3).map(r=>`<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)} ↗</a>`).join('')}</div>`:''}</article>`}).join('')}</div><p class="notice">These categories apply only when no treatment country was captured. Solidarity Fund and waiting-list statements are treated as explicit domestic-care evidence. Post-injury/surgery devices and rehabilitation remain “likely domestic” because the narrative does not name the place of care. Original country fields remain unchanged.</p>`;

  const topFlowSpecialties=countBy(filtered,specialty).slice(0,12).map(d=>d[0]);
  const flowGroups=topFlowSpecialties.map(name=>({name,rows:filtered.filter(r=>specialty(r)===name)}));
  const otherRows=filtered.filter(r=>!topFlowSpecialties.includes(specialty(r)));if(otherRows.length)flowGroups.push({name:'Other specialties',rows:otherRows});
  $('#specialtyFlowMatrix').innerHTML=`<div class="flow-matrix"><div class="flow-matrix-head"><span>Specialty</span>${pathwayMeta.map(([,name])=>`<span>${esc(name)}</span>`).join('')}</div>${flowGroups.map(group=>{const {name,rows}=group,counts=Object.fromEntries(pathwayMeta.map(([key])=>[key,rows.filter(r=>analysisPathway(r)===key).length]));return `<div class="flow-matrix-row"><b title="${esc(name)}">${esc(name)}</b><div class="mini-stack">${pathwayMeta.map(([key,,color])=>`<i style="width:${rows.length?100*counts[key]/rows.length:0}%;background:${color}" title="${counts[key]} ${key}"></i>`).join('')}</div>${pathwayMeta.map(([key])=>`<span>${counts[key]}</span>`).join('')}</div>`}).join('')}</div>`;

  const countryRows=countBy(filtered,foreignCountries);
  const maxCountry=Math.max(1,...countryRows.map(d=>d[1]));
  $('#countryFlowBars').innerHTML=countryRows.length?`<div class="country-bars">${countryRows.map(([country,count])=>`<div><div class="bar-label"><span>${esc(country)}</span><b>${count} cases</b></div><div class="bar-track"><div class="bar-fill cyan" style="width:${100*count/maxCountry}%"></div></div><small class="muted">${abroadNamed?(100*count/abroadNamed).toFixed(1):'0.0'}% of cases naming any foreign destination</small></div>`).join('')}<p class="notice">Country percentages may sum above 100% because a case may name more than one destination. Case-level costs are not allocated to countries.</p></div>`:'<div class="empty">No foreign destinations in this selection.</div>';

  const foreignRows=filtered.filter(r=>foreignCountries(r).length),namedHospitalRows=foreignRows.filter(r=>(r.proposed_treatments||[]).some(t=>t.country&&t.hospital&&!/not named/i.test(t.hospital))),anyHospitalTextRows=foreignRows.filter(r=>(r.proposed_treatments||[]).some(t=>t.country&&t.hospital));
  $('#hospitalFlowTable').innerHTML=countryRows.length?`<p class="notice hospital-coverage">${namedHospitalRows.length}/${foreignRows.length} foreign-destination cases contain a hospital name or brand; ${anyHospitalTextRows.length} contain any hospital text. Brand names may not identify a specific branch, so hospitals are listed—not ranked.</p>${countryRows.map(([country,count],index)=>{const rows=filtered.filter(r=>foreignCountries(r).includes(country)),named=new Map(),unnamed=[];rows.forEach(r=>{const hospitals=new Set((r.proposed_treatments||[]).filter(t=>normalizeCountry(t.country)===country).map(t=>t.hospital).filter(h=>h&&!/not named/i.test(h)));if(hospitals.size)hospitals.forEach(h=>named.set(h,(named.get(h)||0)+1));else unnamed.push(r)});const names=[...named].sort((a,b)=>b[1]-a[1]);return `<details class="hospital-country" ${index<3?'open':''}><summary><span>${esc(country)}</span><b>${count} cases</b><small>${names.reduce((s,d)=>s+d[1],0)} with named hospital</small></summary><div>${names.map(([h,n])=>`<p><span>${esc(h)}</span><b>${n}</b></p>`).join('')||'<p><span>No hospital names captured</span><b>0</b></p>'}<p class="unknown-hospital"><span>Hospital not stated</span><b>${unnamed.length}</b></p></div></details>`}).join('')}`:'<div class="empty">No foreign hospitals in this selection.</div>';
}

function renderTable(){
  $('#caseRows').innerHTML=filtered.map(r=>`<tr data-record-key="${esc(recordKey(r))}"><td>${displayOrder(r)}</td><td><span class="case-title">${esc(r.patient_name||r.title)}</span><span class="case-sub">${esc(new Date(r.published_at).toLocaleDateString('en-GB'))} · ${esc(r.location_city||'Location unknown')}</span></td><td>${esc(specialty(r))}</td><td>${esc(r.main_diagnosis||'Not stated')}</td><td>${esc(treatmentTypes(r).join(', ')||'Not stated')}</td><td>${money(treatmentCostBam(r))}</td><td>${money(r.website_raised_bam)}</td><td><span class="status ${esc(r.status)}">${esc(r.status)}</span></td></tr>`).join('');
  $$('#caseRows tr').forEach(tr=>tr.addEventListener('click',()=>showCase(tr.dataset.recordKey)));
}

function showCase(key){
  const r=records.find(x=>recordKey(x)===String(key));if(!r)return;
  const domesticLabels={solidarity:'Domestic evidence: Solidarity Fund does not cover therapy',waiting:'Domestic evidence: waiting list or delayed access',likely_aftercare:'Likely domestic: post-injury/surgery device or rehabilitation'};
  const fields=[['Published',new Date(r.published_at).toLocaleString('en-GB')],['Patient',r.patient_name],['Age',r.age_years!=null?`${r.age_years} years (${r.age_group||'group unknown'})`:r.age_group],['Location',[r.location_city,r.location_region].filter(Boolean).join(', ')],['Specialty',specialty(r)],['Source specialty',r.primary_specialty],['Main diagnosis',r.main_diagnosis],['Other diagnoses',(r.side_diagnoses||[]).join('; ')],['Earlier treatment',(r.earlier_treatments||[]).join('; ')],['Proposed care',(r.proposed_treatments||[]).map(t=>[label(t.type),t.detail,t.hospital,t.location_city,normalizeCountry(t.country)].filter(Boolean).join(' · ')).join('; ')],['Domestic-location evidence',domesticLabels[domesticEvidence(r)]],['Quoted medical cost',money(treatmentCostBam(r))],['Campaign target',money(r.requested_campaign_amount_bam)],['Website-recorded amount',money(r.website_raised_bam)],['Treatment outcome',r.treatment_outcome],['Insurance / public funding',typeof r.insurance_status==='string'?r.insurance_status:JSON.stringify(r.insurance_status||'')],['Data review',r.reconciliation_status==='requires_review'||r.review_required?'Flagged for analyst review':'Structured coding passed']];
  $('#caseDetail').innerHTML=`<p class="eyebrow">Case ${displayOrder(r)} · ${esc(r.status)}</p><h3>${esc(r.title)}</h3><dl class="detail-grid">${fields.map(([k,v])=>`<div class="detail-field"><dt>${esc(k)}</dt><dd>${esc(v||'Unknown')}</dd></div>`).join('')}</dl><p class="notice">Values come from a public campaign narrative and may be incomplete. Website-recorded donations exclude other channels. Unknown does not mean none.</p><p><a class="source-link" href="${esc(r.url)}" target="_blank" rel="noopener">Open source campaign ↗</a></p>`;
  $('#caseDialog').showModal();
}

function renderCompleteness(){
  const fields=[['Patient age',r=>r.age_group],['Location',r=>r.location_city],['Main diagnosis',r=>r.main_diagnosis],['Earlier treatment',r=>r.earlier_treatments],['Proposed treatment',r=>r.proposed_treatments],['Quoted medical cost',treatmentCostBam],['Treatment outcome',r=>r.treatment_outcome],['Insurance/public funding',r=>r.insurance_status]];
  bars('completenessBars',fields.map(([name,get])=>{const count=filtered.filter(r=>known(get(r))).length;return [`${name} (${count}/${filtered.length})`,filtered.length?Math.round(100*count/filtered.length):0]}));
}

function renderMethod(){
  const dates=records.map(r=>new Date(r.published_at)).filter(d=>!isNaN(d));const min=new Date(Math.min(...dates)),max=new Date(Math.max(...dates));
  const review=records.filter(r=>r.reconciliation_status==='requires_review'||r.review_required).length,collection=records.map(r=>r.collection_date).filter(Boolean).sort().at(-1)||'Unknown',sourceCampaigns=new Set(records.map(r=>r.source_id||r.url)).size;
  $('#heroCorpus').textContent=`Current ${records.length} coded public treatment cases`;
  $('#methodContent').innerHTML=`<p>This is an expanding point-in-time descriptive corpus of ${records.length} campaign-derived case records from ${sourceCampaigns} Pomozi.ba source campaigns in the <b>Liječenja</b> collection. Repeat appeals can represent the same named person; these are cases, not a count of unique patients. Pooled and non-medical funds are excluded. ${review} records are flagged for analyst review; “analysis-ready” means deterministic coding checks passed, not clinical validation.</p><div class="detail-grid"><div class="detail-field"><dt>Publication window</dt><dd>${min.toLocaleDateString('en-GB')}–${max.toLocaleDateString('en-GB')}</dd></div><div class="detail-field"><dt>Latest collection</dt><dd>${esc(collection)}</dd></div><div class="detail-field"><dt>Currency</dt><dd>EUR normalized at the fixed 1 EUR = 1.95583 BAM rate</dd></div><div class="detail-field"><dt>Donation metric</dt><dd>Website “Doniraj odmah” amount only</dd></div><div class="detail-field"><dt>Geographical analysis</dt><dd>Named destinations plus a separate evidence layer for unstated locations. Solidarity Fund non-coverage and waiting lists count as explicit domestic signals; post-injury/surgery devices or rehabilitation remain likely domestic. Original missing country values are preserved.</dd></div><div class="detail-field"><dt>Treatment timing</dt><dd>Mixes planned, recommended, ongoing and completed care as stated in source narratives</dd></div><div class="detail-field"><dt>Abroad-reason taxonomy</dt><dd>Similar source codes are grouped for analysis; original codes remain in the dataset</dd></div><div class="detail-field"><dt>Campaign duration</dt><dd>Only active age at collection is shown; completed campaigns lack closure dates</dd></div><div class="detail-field"><dt>Urgency and outcomes</dt><dd>Grouped only from captured narrative statements; missing means not stated, not absent</dd></div></div><p class="notice">The corpus reflects cases selected for public fundraising, not disease prevalence or total unmet need in Bosnia and Herzegovina. It must not be used alone to rank health-system investments.</p>`;
}

const POLICY_NUMERIC_FIELDS=['annualPatients','serviceCapacity','capitalCost','operatingCost','currentCost','localCost','householdAvoided','productivityGain','qalyGain'];
const POLICY_CORE_FIELDS=['annualPatients','serviceCapacity','capitalCost','operatingCost','currentCost','localCost','evidence'];

function policySpecialties(){return countBy(records,specialty).map(([name,count])=>({name,count}))}
function fieldPresent(v){return v!==null&&v!==undefined&&v!==''&&!(typeof v==='number'&&Number.isNaN(v))}
function policyReadiness(s={}){const complete=POLICY_CORE_FIELDS.filter(k=>fieldPresent(s[k])).length;return {complete,total:POLICY_CORE_FIELDS.length,ready:complete===POLICY_CORE_FIELDS.length,pct:Math.round(100*complete/POLICY_CORE_FIELDS.length)}}
function objectiveReady(s,objective){
  if(!policyReadiness(s).ready)return false;
  if(objective==='netValue')return fieldPresent(s.householdAvoided)&&fieldPresent(s.productivityGain);
  if(objective==='household')return fieldPresent(s.householdAvoided);
  return true;
}
function policyMetrics(s,horizon=5){
  if(!policyReadiness(s).ready)return null;
  const annualServed=Math.min(+s.annualPatients,+s.serviceCapacity),patients=annualServed*horizon;
  const systemSavings=patients*(+s.currentCost-+s.localCost);
  const household=fieldPresent(s.householdAvoided)?patients*+s.householdAvoided:null;
  const productivity=fieldPresent(s.productivityGain)?patients*+s.productivityGain:null;
  const fixed=+s.capitalCost+horizon*+s.operatingCost;
  const totalInvestment=fixed+patients*+s.localCost;
  const completeEconomic=household!==null&&productivity!==null;
  const netValue=completeEconomic?systemSavings+household+productivity-horizon*+s.operatingCost-+s.capitalCost:null;
  const annualBenefitBeforeCapital=annualServed*((+s.currentCost-+s.localCost)+(fieldPresent(s.householdAvoided)?+s.householdAvoided:0)+(fieldPresent(s.productivityGain)?+s.productivityGain:0))-+s.operatingCost;
  return {annualServed,patients,systemSavings,household,productivity,totalInvestment,investmentPerPatient:patients?totalInvestment/patients:null,netValue,breakEven:completeEconomic&&annualBenefitBeforeCapital>0?+s.capitalCost/annualBenefitBeforeCapital:null,qalyTotal:fieldPresent(s.qalyGain)?patients*+s.qalyGain:null};
}

function renderPolicy(){
  const specialties=policySpecialties();
  const grouped=new Map(specialties.map(x=>[x.name,records.filter(r=>specialty(r)===x.name)]));
  $('#policySignals').innerHTML=specialties.map(({name,count})=>{const rows=grouped.get(name),costs=rows.map(treatmentCostBam).filter(known),targets=rows.map(r=>r.requested_campaign_amount_bam).filter(known);return `<article class="signal-card"><div class="signal-top"><h4 title="${esc(name)}">${esc(name)}</h4><span class="signal-count">${count}</span></div><dl><dt>Median quoted cost</dt><dd>${money(median(costs))}</dd><dt>Campaign targets</dt><dd>${money(targets.reduce((a,b)=>a+b,0))}</dd></dl></article>`}).join('');

  $('#policyRows').innerHTML=specialties.map(({name,count})=>{const s=policyScenarios[name]||{},rd=policyReadiness(s),cls=rd.ready?'ready':rd.complete?'partial':'empty';return `<tr><td><span class="case-title">${esc(name)}</span></td><td><span class="mini-signal"><b>${count}</b> cases</span></td><td><span class="readiness ${cls}">${rd.ready?'Ready':rd.complete?`${rd.complete}/${rd.total} inputs`:'Not configured'}</span></td><td>${fieldPresent(s.annualPatients)?fmt.format(s.annualPatients):'—'}</td><td>${fieldPresent(s.serviceCapacity)?fmt.format(s.serviceCapacity):'—'}</td><td>${fieldPresent(s.capitalCost)?money(s.capitalCost):'—'}</td><td><button class="button ghost configure-button" data-policy-specialty="${esc(name)}">${rd.complete?'Edit':'Configure'}</button></td></tr>`}).join('');
  $$('[data-policy-specialty]').forEach(b=>b.addEventListener('click',()=>openPolicyScenario(b.dataset.policySpecialty)));

  const objective=policySettings.objective,horizon=+policySettings.horizon;
  const eligible=specialties.map(({name})=>({name,s:policyScenarios[name]||{}})).filter(x=>objectiveReady(x.s,objective)).map(x=>({...x,m:policyMetrics(x.s,horizon)}));
  const sortValue=x=>objective==='patients'?x.m.patients:objective==='netValue'?x.m.netValue:objective==='household'?x.m.household:-x.m.investmentPerPatient;
  eligible.sort((a,b)=>sortValue(b)-sortValue(a));
  const objectiveLabel={patients:'patients reached',netValue:'net economic value',household:'household savings',costPerPatient:'lowest investment per patient'}[objective];
  $('#policyResultNote').textContent=eligible.length?`${eligible.length} comparable scenario${eligible.length===1?'':'s'} · ${horizon}-year horizon`:'';
  if(eligible.length<2){
    const need=objective==='netValue'?'Core inputs, household savings and productivity values':objective==='household'?'Core inputs and household savings':'Seven core evidence fields';
    $('#policyRanking').innerHTML=`<div class="ranking-empty"><strong>Add at least two comparable scenarios</strong>${esc(need)} are required to compare by ${esc(objectiveLabel)}.</div>`;
    return;
  }
  const values=eligible.map(sortValue),lo=Math.min(...values),hi=Math.max(...values),range=hi-lo||1;
  $('#policyRanking').innerHTML=eligible.map((x,i)=>{const width=20+80*(sortValue(x)-lo)/range;return `<article class="ranking-row"><span class="rank-number">${i+1}</span><div class="ranking-name">${esc(x.name)}<small>${x.m.breakEven==null?'No positive break-even shown':`Break-even ${x.m.breakEven.toFixed(1)} years`}</small></div><div class="ranking-bar"><div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div><small class="muted">Ranked by ${esc(objectiveLabel)}</small></div><div class="rank-metric"><span>Patients</span><b>${fmt.format(x.m.patients)}</b></div><div class="rank-metric"><span>Net value</span><b>${x.m.netValue==null?'Incomplete':money(x.m.netValue)}</b></div><div class="rank-metric"><span>Households</span><b>${x.m.household==null?'Incomplete':money(x.m.household)}</b></div><div class="rank-metric"><span>Investment / patient</span><b>${money(x.m.investmentPerPatient)}</b></div></article>`}).join('');
}

function openPolicyScenario(specialty){
  const s=policyScenarios[specialty]||{};
  $('#policySpecialty').value=specialty;$('#policyDialogTitle').textContent=specialty;
  POLICY_NUMERIC_FIELDS.forEach(id=>{$('#'+id).value=fieldPresent(s[id])?s[id]:''});
  $('#policyEvidence').value=s.evidence||'';
  $('#policyDialog').showModal();
}
function savePolicyScenario(event){
  event.preventDefault();const specialty=$('#policySpecialty').value,s={};
  POLICY_NUMERIC_FIELDS.forEach(id=>{const raw=$('#'+id).value.trim();s[id]=raw===''?null:+raw});
  s.evidence=$('#policyEvidence').value.trim();s.updatedAt=new Date().toISOString();policyScenarios[specialty]=s;
  localStorage.setItem('care-gap-policy-scenarios',JSON.stringify(policyScenarios));$('#policyDialog').close();renderPolicy();
}
function clearPolicyScenario(){
  const specialty=$('#policySpecialty').value;if(!specialty||!confirm(`Clear all assumptions for ${specialty}?`))return;
  delete policyScenarios[specialty];localStorage.setItem('care-gap-policy-scenarios',JSON.stringify(policyScenarios));$('#policyDialog').close();renderPolicy();
}
function resetPolicy(){
  if(!confirm('Clear every Policy Lab scenario and comparison setting? This does not alter the case dataset.'))return;
  policyScenarios={};policySettings={horizon:5,objective:'patients'};localStorage.removeItem('care-gap-policy-scenarios');localStorage.removeItem('care-gap-policy-settings');$('#policyHorizon').value='5';$('#policyObjective').value='patients';renderPolicy();
}
function savePolicySettings(){localStorage.setItem('care-gap-policy-settings',JSON.stringify(policySettings))}
function exportPolicy(){download('care-gap-policy-scenarios.json',JSON.stringify({exportedAt:new Date().toISOString(),horizonYears:+policySettings.horizon,comparisonObjective:policySettings.objective,method:'Scenario calculations; charity-case data is contextual only',scenarios:policyScenarios},null,2),'application/json')}

function empty(id){$('#'+id).innerHTML='<div class="empty">No values in this selection.</div>'}
function download(name,content,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type}));a.download=name;a.click();URL.revokeObjectURL(a.href)}
function exportCsv(){const cols=['record_id','analysis_order','title','url','published_at','status','patient_name','age_group','location_city','policy_specialty_group','primary_specialty','main_diagnosis','requested_campaign_amount_bam','website_raised_bam'];const csv=[cols.join(','),...filtered.map(r=>cols.map(c=>`"${String(r[c]??'').replaceAll('"','""')}"`).join(','))].join('\n');download('care-gap-filtered.csv',csv,'text/csv')}
async function importJson(e){try{const rows=validate(JSON.parse(await e.target.files[0].text()));records=rows;localStorage.setItem('care-gap-dataset',JSON.stringify(rows));populateFilters();applyFilters();$('#importStatus').textContent=`Imported ${rows.length} reviewed records for this browser.`}catch(err){$('#importStatus').textContent=`Import failed: ${err.message}`}finally{e.target.value=''}}

export {policyMetrics,policyReadiness,objectiveReady,urgencyGroup,outcomeGroup,plannedLeadDays};
