import assert from 'node:assert/strict';import fs from 'node:fs';import {Assessment,validateBank,fitModel,informationGain} from './engine.js';
const bank=JSON.parse(fs.readFileSync(new URL('./questions.json',import.meta.url)));assert(validateBank(bank));
const strengthGap = question => Math.abs(question.options[0].strength - question.options[1].strength);
assert(bank.questions.every(question => strengthGap(question) <= 1));
for (const [model, definition] of Object.entries(bank.models)) {
  const matchedPairs = new Set(bank.questions.filter(question => question.eligibility[model] && strengthGap(question) === 0)
    .map(question => question.options.map(option => option.categories[model]).sort().join('/')));
  const categoryCount = Object.keys(definition.categories).length;
  assert.equal(matchedPairs.size, categoryCount * (categoryCount - 1) / 2);
}
for(const [m,def] of Object.entries(bank.models)){const cats=Object.keys(def.categories),pairs=new Set();for(const q of bank.questions.filter(q=>q.eligibility[m]))pairs.add(q.options.map(o=>o.categories[m]).sort().join('/'));console.log(m,'eligible',bank.questions.filter(q=>q.eligibility[m]).length,'pairs',pairs.size,'/',cats.length*(cats.length-1)/2);assert.equal(pairs.size,cats.length*(cats.length-1)/2);}
const q=bank.questions.find(q=>q.eligibility.classic5),s=fitModel(bank,'classic5',[]);assert(informationGain(q,s,bank.config)>0);const after=fitModel(bank,'classic5',[{questionId:q.id,optionId:'a'}]);assert(after.theta[after.categories.indexOf(q.options[0].categories.classic5)]>0);
for(const models of [['classic5'],['modern7'],['research10'],['classic5','modern7'],['classic5','research10'],['modern7','research10'],Object.keys(bank.models)]){const a=new Assessment(bank,models);let next,seen=new Set();while(!(next=a.next()).done){assert(!seen.has(next.questionId));seen.add(next.questionId);const question=bank.questions.find(q=>q.id===next.questionId);a.answer(question.options[0].strength>question.options[1].strength?'a':question.options[0].strength<question.options[1].strength?'b':seen.size%2?'a':'b');}console.log(models.join('+'),next.reason,a.answers.length,a.states.map(s=>`${s.model}:${s.maxPairwiseSD.toFixed(2)}/${s.coverage}`));assert(a.answers.length<=bank.config.maxQuestions);assert.deepEqual(Assessment.restore(bank,a.snapshot()).results(),a.results());}
const strict=new Assessment(bank,Object.keys(bank.models),{eligibility:'strict',maxQuestions:2});let n=strict.next();assert(n.selection.shared);strict.answer('skip');assert(strict.states.every(s=>s.exposure.every(v=>v===0)));n=strict.next();strict.answer('a');strict.undo();assert.equal(strict.answers.length,1);console.log('All tests passed');

const skipped = new Assessment(bank, ['classic5'], {maxQuestions: 3});
while (!(n = skipped.next()).done) skipped.answer('skip');
assert.equal(n.reason, 'question_limit');
assert.equal(skipped.results().answered, 0);
assert.equal(skipped.results().models[0].status, 'uncertain');
console.log('All model combinations and skipped sessions passed');

const balanced = new Assessment(bank);
const byId = new Map(bank.questions.map(question => [question.id, question]));
for (let index = 0; index < bank.config.initialMatchedQuestions + 1; index++) {
  const next = balanced.next();
  assert.equal(strengthGap(byId.get(next.questionId)), 0);
  balanced.answer(index === 0 ? 'skip' : next.options[0].id);
}
console.log('Opening comparisons remain matched after a skip');

const financialGroups = ['financial_personal_cost', 'financial_shared_outing'];
for (const group of financialGroups) {
  const comparisons = bank.questions.filter(question => question.coverageGroup === group);
  assert(comparisons.every(question => question.eligibility.modern7 && !question.eligibility.classic5 && !question.eligibility.research10));
  const levels = new Set(comparisons.flatMap(question => question.options
    .filter(option => option.categories.modern7 === 'FIN').map(option => option.strength)));
  assert.deepEqual(levels, new Set([-1, 0, 1]));
}
assert(bank.questions.every(question => !question.eligibility.modern7 || question.options.every(option => option.categories.research10 !== 'DIS')));
const combined = new Assessment(bank);
for (let index = 0; index < 20; index++) {
  const next = combined.next();
  combined.answer(index % 2 === 0 ? 'a' : 'b');
}
const groupsShown = new Set(combined.answers.map(answer => byId.get(answer.questionId).coverageGroup));
for (const group of ['sadness', 'stress', 'joy', ...financialGroups]) assert(groupsShown.has(group), group);
console.log('Combined assessments sample the three emotional contexts and both financial offers');

const { summarize, addSavedScoreRanges } = await import('./quiz-run.js');
const summary = summarize(combined, 'early');
for (const model of summary.models.filter(model => model.covered)) {
  for (const { score, range: [low, high] } of model.categories) {
    assert(0 <= low && low < score && score < high && high <= 100);
  }
}
const older = structuredClone(summary);
for (const model of older.models) for (const category of model.categories) delete category.range;
const supplemented = addSavedScoreRanges(older, bank, combined.answers);
for (const model of summary.models.filter(model => model.covered)) {
  assert.deepEqual(supplemented.models.find(item => item.id === model.id).categories, model.categories);
}
assert.equal(addSavedScoreRanges(older, bank, [{ questionId: 'missing', optionId: 'a' }]), older);
console.log('Score ranges are bounded and can be restored from old summaries');
