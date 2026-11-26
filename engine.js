// Dependency-free browser/Node assessment engine. All input stays local.
const sigmoid = z => z >= 0 ? 1/(1+Math.exp(-z)) : Math.exp(z)/(1+Math.exp(z));
const softplus = z => Math.max(z,0)+Math.log1p(Math.exp(-Math.abs(z)));
const matrix = (n,f) => Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>f(i,j)));
function inverse(a) {
  const n=a.length, b=a.map((r,i)=>[...r,...Array.from({length:n},(_,j)=>+(i===j))]);
  for(let i=0;i<n;i++) {
    let k=i; for(let j=i+1;j<n;j++) if(Math.abs(b[j][i])>Math.abs(b[k][i])) k=j;
    [b[i],b[k]]=[b[k],b[i]]; const d=b[i][i]; if(Math.abs(d)<1e-12) throw Error('Singular precision');
    b[i]=b[i].map(x=>x/d);
    for(let j=0;j<n;j++) if(j!==i){const f=b[j][i];b[j]=b[j].map((x,k)=>x-f*b[i][k]);}
  } return b.map(r=>r.slice(n));
}
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
function item(q,m,cats,beta){const [a,b]=q.options;return {i:cats.indexOf(a.categories[m]),j:cats.indexOf(b.categories[m]),d:beta*(a.strength-b.strength)};}

export const isAnswered = answer => answer.optionId !== 'skip' || answer.preference === 'equal';

function validAnswer(optionId, preference) {
  if (!['a', 'b', 'skip'].includes(optionId)) return false;
  if (preference === undefined) return true;
  return optionId === 'skip' ? preference === 'equal' : ['slight', 'strong'].includes(preference);
}

function answerOutcome(answer) {
  if (answer.preference === 'equal') return 0.5;
  const weight = answer.preference === 'slight' ? 0.25 : 0.5;
  return 0.5 + (answer.optionId === 'a' ? weight : -weight);
}
export function validateBank(bank){
 const ids=new Set(); const gestures=new Map();
 for(const q of bank.questions){
  if(ids.has(q.id)||q.options.length!==2||q.options[0].id!=='a'||q.options[1].id!=='b'||!q.prompt||!q.context)throw Error('Invalid question '+q.id);ids.add(q.id);
  if(!Object.keys(bank.models).some(m=>q.eligibility[m]===true))throw Error('No eligible model '+q.id);
  for(const o of q.options){if(!o.text||!o.gestureId||![-1,0,1].includes(o.strength))throw Error('Invalid option '+q.id);const sig=JSON.stringify([o.text,o.strength,o.categories]);if(gestures.has(o.gestureId)&&gestures.get(o.gestureId)!==sig)throw Error('Inconsistent gesture');gestures.set(o.gestureId,sig);}
  for(const [m,def] of Object.entries(bank.models)){if(typeof q.eligibility[m]!=='boolean')throw Error('Missing tag');if(q.eligibility[m]){const [a,b]=q.options.map(o=>o.categories[m]);if(a===b||!Object.hasOwn(def.categories,a)||!Object.hasOwn(def.categories,b))throw Error('Invalid mapping '+q.id);}}
 }
 return true;
}
export function fitModel(bank,model,answers,config=bank.config){
 const cats=Object.keys(bank.models[model].categories),n=cats.length,lambda=1/config.priorSD**2;
 const byId=new Map(bank.questions.map(q=>[q.id,q])), rows=[],exposure=Array(n).fill(0),edges=Array.from({length:n},()=>new Set());
 for(const a of answers){const q=byId.get(a.questionId);if(!q||!q.eligibility[model]||!isAnswered(a))continue;
  const r=item(q,model,cats,config.strengthCoefficient);r.y=answerOutcome(a);rows.push(r);exposure[r.i]++;exposure[r.j]++;edges[r.i].add(r.j);edges[r.j].add(r.i);}
 const objective=t=>lambda*dot(t,t)/2+rows.reduce((s,r)=>{const z=t[r.i]-t[r.j]+r.d;return s+softplus(z)-r.y*z;},0);
 function derivatives(t){const g=t.map(v=>lambda*v),h=matrix(n,(i,j)=>i===j?lambda:0);for(const r of rows){const {i,j,d,y}=r,p=sigmoid(t[i]-t[j]+d),w=p*(1-p);g[i]+=p-y;g[j]-=p-y;h[i][i]+=w;h[j][j]+=w;h[i][j]-=w;h[j][i]-=w;}return {g,h};}
 let theta=Array(n).fill(0);
 for(let iter=0;iter<50;iter++){const {g,h}=derivatives(theta),inv=inverse(h),step=inv.map(r=>dot(r,g));if(Math.max(...step.map(Math.abs))<1e-9)break;let alpha=1,old=objective(theta);while(alpha>1e-8){const next=theta.map((v,i)=>v-alpha*step[i]);if(objective(next)<=old){theta=next;break;}alpha/=2;}if(alpha<=1e-8)break;}
 const covariance=inverse(derivatives(theta).h),pairs=[];for(let i=0;i<n;i++)for(let j=i+1;j<n;j++)pairs.push({a:cats[i],b:cats[j],difference:theta[i]-theta[j],sd:Math.sqrt(Math.max(0,covariance[i][i]+covariance[j][j]-2*covariance[i][j]))});
 const visited=new Set([0]),queue=[0];while(queue.length){for(const j of edges[queue.pop()])if(!visited.has(j)){visited.add(j);queue.push(j);}}
 const maxPairwiseSD=Math.max(...pairs.map(r=>r.sd)),coverage=visited.size===n&&exposure.every(v=>v>=config.minComparisonsPerCategory);
 const exp=theta.map(v=>Math.exp(v-Math.max(...theta))),total=exp.reduce((s,v)=>s+v,0);
 return {model,categories:cats,theta,covariance,exposure,pairs,maxPairwiseSD,coverage,complete:coverage&&maxPairwiseSD<=config.targetPairwiseSD,relativeScores:Object.fromEntries(cats.map((c,i)=>[c,100*exp[i]/total]))};
}
// Local Gaussian/Fisher approximation, not exact Bayesian mutual information.
export function informationGain(q,state,config){if(!q.eligibility[state.model])return 0;const {i,j,d}=item(q,state.model,state.categories,config.strengthCoefficient),p=sigmoid(state.theta[i]-state.theta[j]+d),c=state.covariance,v=Math.max(0,c[i][i]+c[j][j]-2*c[i][j]);return .5*Math.log2(1+p*(1-p)*v);}
export class Assessment {
 constructor(bank,models=Object.keys(bank.models),overrides={}){validateBank(bank);if(!models.length||new Set(models).size!==models.length||models.some(m=>!Object.hasOwn(bank.models,m)))throw Error('Invalid models');this.bank=bank;this.models=[...models];this.config={...bank.config,...overrides};if(!['strict','strict-first','flexible'].includes(this.config.eligibility)||!(this.config.priorSD>0)||!(this.config.targetPairwiseSD>0)||!(this.config.maxQuestions>=1)||!(this.config.sharedGainRatio>=0&&this.config.sharedGainRatio<=1))throw Error('Invalid config');this.answers=[];this.pending=null;this.refresh();}
 refresh(){this.states=this.models.map(m=>fitModel(this.bank,m,this.answers,this.config));}
 next(){if(this.pending)return this.pending;const active=this.states.filter(s=>this.config.extend||!s.complete);if(!active.length)return {done:true,reason:'precision_reached'};if(this.answers.length>=this.config.maxQuestions)return {done:true,reason:'question_limit'};
  const asked=new Set(this.answers.map(a=>a.questionId)),uses=new Map(),byId=new Map(this.bank.questions.map(q=>[q.id,q]));for(const a of this.answers)for(const o of byId.get(a.questionId).options)uses.set(o.gestureId,(uses.get(o.gestureId)||0)+1);
  const {initialMatchedQuestions = 0, unequalStrengthWeight = 1} = this.config;
  const openingComparisons = this.answers.filter(isAnswered).length < initialMatchedQuestions;
  const candidates=[];for(const q of this.bank.questions){if(asked.has(q.id))continue;
   const strengthGap = Math.abs(q.options[0].strength - q.options[1].strength);
   const relevant=active.filter(s=>q.eligibility[s.model]);if(!relevant.length)continue;let raw=0,needed=0,unseen=0;for(const s of relevant){raw+=informationGain(q,s,this.config);const {i,j}=item(q,s.model,s.categories,this.config.strengthCoefficient);needed+=+(s.exposure[i]<this.config.minComparisonsPerCategory)+ +(s.exposure[j]<this.config.minComparisonsPerCategory);unseen+=+(s.exposure[i]===0)+ +(s.exposure[j]===0);}
   const repeats=q.options.reduce((sum,o)=>sum+(uses.get(o.gestureId)||0),0);
   // A slightly uneven comparison must offer more information to justify the mismatch.
   const balanceWeight = strengthGap === 0 ? 1 : unequalStrengthWeight;
   const score=balanceWeight*(raw+.05*needed+(this.config.unseenCategoryBonus??0)*unseen)/(1+this.config.diversityPenalty*repeats);candidates.push({q,raw,score,shared:relevant.length===active.length,needed,strengthGap});}
  const matched = openingComparisons ? candidates.filter(c => c.strengthGap === 0 && (this.config.eligibility !== 'strict' || c.shared)) : [];
  const pool = matched.length ? matched : candidates;
  const sort=(a,b)=>b.score-a.score||a.q.id.localeCompare(b.q.id);pool.sort(sort);const best=pool[0],shared=pool.find(c=>c.shared);let pick;
  if(this.config.eligibility==='strict')pick=shared;
  else if(this.config.eligibility==='strict-first')pick=shared&&shared.score>=this.config.sharedGainRatio*(best?.score??0)?shared:best;
  else pick=best;
  // Shared questions can otherwise crowd out facets that belong to just one framework.
  if (this.config.eligibility !== 'strict') {
   for (const {model, group, afterQuestions} of this.bank.coverageTargets ?? []) {
    if (model && !active.some(state => state.model === model)) continue;
    const due = afterQuestions.filter(count => asked.size >= count).length;
    const shown = this.answers.filter(answer => byId.get(answer.questionId).coverageGroup === group).length;
    if (shown >= due) continue;
    const coveragePick = pool.find(candidate => candidate.q.coverageGroup === group);
    if (coveragePick) { pick = coveragePick; break; }
   }
  }
  if(!pick)return {done:true,reason:'eligible_pool_exhausted'};
  if(!this.config.extend&&pick.raw<this.config.minInformationGainBits&&!pick.needed)return {done:true,reason:'low_information_gain'};
  const order=Math.random()<.5?['a','b']:['b','a'];this.pending={done:false,questionId:pick.q.id,prompt:pick.q.prompt,options:order.map(id=>{const o=pick.q.options.find(o=>o.id===id);return {id,text:o.text};}),selection:{shared:pick.shared,expectedInformationGain:pick.raw,activeModels:active.map(s=>s.model)}};return this.pending;
 }
 answer(optionId, preference) {
  if (!this.pending || !validAnswer(optionId, preference)) throw Error('No pending question or invalid option');
  const answer = {questionId:this.pending.questionId, optionId, displayOrder:this.pending.options.map(o=>o.id)};
  if (preference !== undefined) answer.preference = preference;
  this.answers.push(answer);
  this.pending = null;
  this.refresh();
 }
 undo(){this.pending=null;this.answers.pop();this.refresh();}
 results(){return {schemaVersion:this.bank.schemaVersion,answered:this.answers.filter(isAnswered).length,equal:this.answers.filter(answer=>answer.preference==='equal').length,asked:this.answers.length,models:this.states.map(s=>({...s,status:s.complete?'precision_reached':'uncertain'}))};}
 snapshot(){return {schemaVersion:this.bank.schemaVersion,models:[...this.models],config:{...this.config},answers:structuredClone(this.answers),pending:structuredClone(this.pending)};}
 static restore(bank,s){if(s.schemaVersion!==bank.schemaVersion)throw Error('Bank version mismatch');const a=new Assessment(bank,s.models,s.config),seen=new Set();for(const r of s.answers){if(seen.has(r.questionId)||!bank.questions.some(q=>q.id===r.questionId)||!validAnswer(r.optionId,r.preference))throw Error('Invalid saved answer');seen.add(r.questionId);}a.answers=structuredClone(s.answers);a.pending=structuredClone(s.pending);a.refresh();return a;}
}
