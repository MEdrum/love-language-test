export const reasons = {
    precision_reached: 'Every selected framework reached the quiz’s internal precision target.',
    question_limit: 'You reached the end of this session. Use the certainty shown below when interpreting the results.',
    eligible_pool_exhausted: 'The quiz ran out of suitable comparisons for the selected frameworks.',
    low_information_gain: 'The remaining comparisons were estimated to add little information.',
    finished: 'You finished this session early.',
    early: 'These estimates reflect your answers so far. You can come back to this session later.'
};

function normalProbability(z) {
    const t = 1 / (1 + 0.2316419 * z);
    const tail = Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI)
        * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    return Math.min(1, Math.max(0.5, 1 - tail));
}

export function summarize(session, reason) {
    const results = session.results();
    const models = results.models.map(model => {
        const labels = session.bank.models[model.model].categories;
        const ranked = [...model.categories].sort((a, b) => model.relativeScores[b] - model.relativeScores[a]);
        const [first, second] = ranked;
        const pair = model.pairs.find(({ a, b }) => (a === first && b === second) || (a === second && b === first));
        const covered = model.exposure.filter(Boolean).length;
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
            categories: ranked.map(id => ({ label: labels[id], score: model.relativeScores[id] }))
        };
    });
    return { reason, answered: results.answered, asked: results.asked, models };
}
