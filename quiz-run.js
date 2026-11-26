import { fitModel } from './engine.js';

export const reasons = {
    precision_reached: 'Every selected framework reached the quiz’s internal precision target.',
    question_limit: 'You reached the end of this session. Use the certainty shown below when interpreting the results.',
    eligible_pool_exhausted: 'The quiz ran out of suitable comparisons for the selected frameworks.',
    low_information_gain: 'The remaining comparisons were estimated to add little information.',
    finished: 'You finished this session early.',
    frameworks_changed: 'These estimates use your saved answers with the frameworks you just selected.',
    early: 'These estimates reflect your answers so far. You can come back to this session later.'
};

function normalProbability(z) {
    const t = 1 / (1 + 0.2316419 * z);
    const tail = Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI)
        * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    return Math.min(1, Math.max(0.5, 1 - tail));
}

function scoreRanges(model) {
    const scores = model.categories.map(id => model.relativeScores[id] / 100);
    return Object.fromEntries(model.categories.map((id, index) => {
        const score = scores[index];
        const others = scores.reduce((sum, value, i) => sum + (i === index ? 0 : value), 0);
        const logOdds = Math.log(score / others);
        // Propagate the joint covariance through the log odds before mapping back to percentages.
        const gradient = scores.map((value, i) => i === index ? 1 : -value / others);
        const variance = model.covariance.reduce((sum, row, i) => sum + gradient[i] *
            row.reduce((rowSum, value, j) => rowSum + value * gradient[j], 0), 0);
        const width = 1.64485362695147 * Math.sqrt(Math.max(0, variance));
        const percentage = odds => 100 / (1 + Math.exp(-odds));
        return [id, [percentage(logOdds - width), percentage(logOdds + width)]];
    }));
}

export function addSavedScoreRanges(summary, bank, answers) {
    const questionIds = new Set(bank.questions.map(question => question.id));
    if (!answers.every(answer => questionIds.has(answer.questionId))) return summary;
    return {
        ...summary,
        models: summary.models.map(model => {
            if (!model.covered || !Object.hasOwn(bank.models, model.id) || model.categories.every(category => category.range)) return model;
            const fitted = fitModel(bank, model.id, answers);
            const ranges = scoreRanges(fitted);
            const labels = bank.models[model.id].categories;
            return {
                ...model,
                categories: model.categories.map(category => {
                    const id = fitted.categories.find(id => labels[id] === category.label);
                    return id && Math.abs(fitted.relativeScores[id] - category.score) < 1e-6
                        ? { ...category, range: ranges[id] }
                        : category;
                })
            };
        })
    };
}

export function summarize(session, reason) {
    const results = session.results();
    const models = results.models.map(model => {
        const labels = session.bank.models[model.model].categories;
        const ranked = [...model.categories].sort((a, b) => model.relativeScores[b] - model.relativeScores[a]);
        const [first, second] = ranked;
        const pair = model.pairs.find(({ a, b }) => (a === first && b === second) || (a === second && b === first));
        const covered = model.exposure.filter(Boolean).length;
        const ranges = covered ? scoreRanges(model) : {};
        const hasEvidence = [first, second].every(id => model.exposure[model.categories.indexOf(id)] > 0);
        return {
            id: model.model,
            covered,
            targetMet: model.complete,
            certainty: hasEvidence && pair.sd > 0 ? {
                leading: labels[first],
                runnerUp: labels[second],
                probability: normalProbability(Math.abs(pair.difference) / pair.sd)
            } : null,
            categories: ranked.map(id => ({ label: labels[id], score: model.relativeScores[id], range: ranges[id] }))
        };
    });
    return { reason, answered: results.answered, asked: results.asked, models };
}
