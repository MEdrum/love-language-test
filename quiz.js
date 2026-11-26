import { Assessment } from './engine.js';

const app = document.querySelector('#app');
const modelNames = {
    classic5: 'Five categories',
    modern7: 'Seven categories',
    research10: 'Ten categories'
};
const modelDescriptions = {
    classic5: 'A classic five-language framework.',
    modern7: 'A broader framework including intellectual and emotional connection.',
    research10: 'A research-inspired framework covering a wider range of relationship behaviours.'
};
let bank;
let session;

function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
}

function button(text, action, className) {
    const node = element('button', text, className);
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
}

function heading(text) {
    const node = element('h2', text);
    node.tabIndex = -1;
    return node;
}

function showIntro() {
    const intro = element('div');
    intro.append(element('p', bank.instructions, 'quiz-copy'));
    intro.append(element('p', 'This quiz is for personal reflection and has not been scientifically validated. Your answers stay in your browser and aren’t saved.', 'quiz-copy'));
    intro.append(element('p', `The quiz adapts to your answers and can ask up to ${bank.config.maxQuestions} questions. You can see a preliminary result once you’ve answered a question.`, 'quiz-copy'));
    const form = document.createElement('form');
    const fieldset = document.createElement('fieldset');
    fieldset.append(element('legend', 'Choose one or more frameworks'));
    for (const id of Object.keys(modelNames)) {
        const label = element('label', '', 'model-choice');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.name = 'model';
        input.value = id;
        input.checked = id === 'classic5';
        const content = element('div');
        content.append(document.createTextNode(modelNames[id]), element('span', modelDescriptions[id]));
        label.append(input, content);
        fieldset.append(label);
    }
    const error = element('p', '', 'quiz-copy');
    error.setAttribute('role', 'alert');
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'primary';
    submit.textContent = 'Start the quiz';
    form.append(fieldset, error, submit);
    form.addEventListener('submit', event => {
        event.preventDefault();
        const selected = [...form.querySelectorAll('input:checked')].map(input => input.value);
        if (!selected.length) {
            error.textContent = 'Choose at least one framework to continue.';
            return;
        }
        session = new Assessment(bank, selected);
        showQuestion();
    });
    intro.append(form);
    app.replaceChildren(intro);
}

function showQuestion() {
    const next = session.next();
    if (next.done) {
        showResults(next.reason);
        return;
    }
    const count = element('p', `Question ${session.answers.length + 1} · ${session.answers.filter(answer => answer.optionId !== 'skip').length} answered`, 'question-count');
    const suggestionUrl = new URL('https://github.com/MEdrum/love-language-test/issues/new');
    suggestionUrl.searchParams.set('title', `Question suggestion: ${next.questionId}`);
    suggestionUrl.searchParams.set('body', `Question ID: ${next.questionId}\n\nWhat would you change about this question?\n\n`);
    const suggest = element('a', 'Suggest a change', 'suggest-change');
    suggest.href = suggestionUrl.href;
    suggest.target = '_blank';
    suggest.rel = 'noopener noreferrer';
    suggest.setAttribute('aria-label', 'Suggest a change on GitHub (opens in a new tab)');
    suggest.title = 'Opens a public GitHub issue draft';
    const title = heading(next.prompt);
    const options = element('div', '', 'question-options');
    for (const option of next.options) {
        options.append(button(option.text, () => {
            session.answer(option.id);
            showQuestion();
        }));
    }
    const actions = element('div', '', 'quiz-actions');
    const back = button('Back', () => {
        session.undo();
        showQuestion();
    });
    back.disabled = !session.answers.length;
    actions.append(back, button('Skip', () => {
        session.answer('skip');
        showQuestion();
    }));
    if (session.answers.some(answer => answer.optionId !== 'skip')) {
        actions.append(button('See results so far', () => showResults('early')));
    }
    actions.append(suggest);
    app.replaceChildren(count, title, options, actions);
    title.focus();
}

function showResults(reason) {
    const results = session.results();
    const title = heading('Your results');
    const reasons = {
        precision_reached: 'The assessment reached its internal stopping criterion.',
        question_limit: 'The question limit was reached before every framework reached its stopping criterion.',
        eligible_pool_exhausted: 'There are no more suitable questions for the selected frameworks.',
        low_information_gain: 'The remaining questions were estimated to add little information.',
        early: 'These are early estimates based on the answers so far.'
    };
    const status = element('p', `${reasons[reason]} ${results.answered} answered, ${results.asked - results.answered} skipped.`, 'quiz-copy');
    const explanation = element('p', 'Scores show relative preferences within each framework. They are uncertain estimates, especially where scores are close, and are not probabilities, diagnoses, or measures of compatibility.', 'quiz-copy');
    const content = [title, status, explanation];
    for (const model of results.models) {
        const section = element('section', '', 'result-model');
        section.append(element('h3', modelNames[model.model]));
        section.append(element('p', model.complete ? 'The internal stopping criterion was reached.' : 'The internal stopping criterion was not reached, so this estimate is less certain.', 'quiz-copy'));
        if (model.exposure.every(count => count === 0)) {
            section.append(element('p', 'There are no answered questions for this framework yet.', 'quiz-copy'));
        } else {
            const list = element('ul', '', 'result-scores');
            const entries = Object.entries(model.relativeScores).sort((a, b) => b[1] - a[1]);
            for (const [id, score] of entries) {
                const item = document.createElement('li');
                const label = element('div', '', 'result-label');
                label.append(element('span', bank.models[model.model].categories[id]), element('span', `${score.toFixed(1)}%`));
                const bar = element('div', '', 'result-bar');
                bar.setAttribute('aria-hidden', 'true');
                const fill = document.createElement('span');
                fill.style.width = `${score}%`;
                bar.append(fill);
                item.append(label, bar);
                list.append(item);
            }
            section.append(list);
        }
        content.push(section);
    }
    const actions = element('div', '', 'quiz-actions');
    if (reason === 'early') actions.append(button('Continue answering', showQuestion));
    actions.append(button('Start over', () => {
        session = undefined;
        showIntro();
        document.querySelector('h1').focus();
    }));
    content.push(actions);
    app.replaceChildren(...content);
    title.focus();
}

const loading = element('p', 'Loading the questions…');
loading.setAttribute('role', 'status');
app.append(loading);

try {
    const response = await fetch('./questions.json');
    if (!response.ok) throw new Error('Question bank unavailable');
    bank = await response.json();
    showIntro();
} catch (error) {
    console.error(error);
    loading.textContent = 'The questions could not be loaded. Please try again later.';
}
