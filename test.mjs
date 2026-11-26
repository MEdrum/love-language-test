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
for(const models of [['classic5'],['modern7'],['research10'],['classic5','modern7'],['classic5','research10'],['modern7','research10'],Object.keys(bank.models)]){const a=new Assessment(bank,models);let next,seen=new Set();while(!(next=a.next()).done){assert(!seen.has(next.questionId));seen.add(next.questionId);const question=bank.questions.find(q=>q.id===next.questionId);a.answer(question.options[0].strength>question.options[1].strength?'a':question.options[0].strength<question.options[1].strength?'b':seen.size%2?'a':'b');}console.log(models.join('+'),next.reason,a.answers.length,a.states.map(s=>`${s.model}:${s.maxPairwiseSD.toFixed(2)}/${s.coverage}`));assert(a.answers.length<=80);assert.deepEqual(Assessment.restore(bank,a.snapshot()).results(),a.results());}
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

const nonGiftFinancial = bank.questions.filter(question => question.coverageGroup === 'non_gift_financial');
assert(nonGiftFinancial.every(question => question.eligibility.modern7 && !question.eligibility.classic5 && !question.eligibility.research10));
assert.deepEqual(new Set(nonGiftFinancial.flatMap(question => question.options.filter(option => option.categories.modern7 === 'FIN').map(option => option.strength))), new Set([-1, 0, 1]));
const combined = new Assessment(bank);
for (let index = 0; index < 17; index++) {
  const next = combined.next();
  combined.answer(index % 2 === 0 ? 'a' : 'b');
}
const broaderFinancialCount = combined.answers.filter(answer => byId.get(answer.questionId).coverageGroup === 'non_gift_financial').length;
assert(broaderFinancialCount >= 2);
console.log('Combined assessments show financial generosity beyond gifts');
