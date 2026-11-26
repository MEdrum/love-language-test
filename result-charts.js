const views = [
    ['horizontal', 'Horizontal bars'],
    ['vertical', 'Vertical bars'],
    ['donut', 'Donut chart']
];
const preferenceKey = 'affection-quiz-chart';
const palette = ['#a9587c', '#5c80ad', '#ad7850', '#59876e', '#8464a7', '#b26159', '#50858b', '#928353', '#9a667f', '#6d884d'];
const groups = [
    ['Words of affirmation', 'Appreciation', 'Verbal affirmation'],
    ['Quality time', 'Activity', 'Social network integration'],
    ['Receiving gifts', 'Financial', 'Gifts'],
    ['Acts of service', 'Practical'],
    ['Physical touch', 'Physical', 'Physical intimacy'],
    ['Emotional', 'Support in difficult times'],
    ['Intellectual', 'Disclosure'],
    ['Accountability and compromise'],
    ['Pampering'],
    ['Encouragement of individual pursuits']
];

function node(tag, className, text) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (text) item.textContent = text;
    return item;
}

function categoriesFor(model) {
    return model.categories.map(({ label, score, range }, index) => {
        const group = groups.findIndex(labels => labels.includes(label));
        const validRange = Array.isArray(range) && range.length === 2 && range.every(Number.isFinite) &&
            range[0] >= 0 && range[0] <= range[1] && range[1] <= 100;
        return { label, score, range: validRange ? range : null, color: palette[group < 0 ? index % palette.length : group] };
    });
}

function values(category) {
    const result = node('span', 'chart-values', `${category.score.toFixed(1)}%`);
    if (category.range) {
        const [low, high] = category.range;
        const range = node('small', 'chart-range-value', `${low.toFixed(1)}–${high.toFixed(1)}%`);
        range.setAttribute('aria-label', `Approximate 90% range ${low.toFixed(1)} to ${high.toFixed(1)} percent`);
        result.append(range);
    }
    return result;
}

function nameWithKey(category, key) {
    const name = node('span', 'chart-category');
    const swatch = node('span', key ? 'chart-key numbered' : 'chart-key', key);
    swatch.setAttribute('aria-hidden', 'true');
    name.append(swatch, document.createTextNode(category.label));
    return name;
}

function bar(category, vertical) {
    const track = node('span', 'chart-track');
    track.setAttribute('aria-hidden', 'true');
    track.style.setProperty('--category-color', category.color);
    const fill = node('span', 'chart-fill');
    fill.style.setProperty('--score', `${category.score}%`);
    track.append(fill);
    if (category.range) {
        const [low, high] = category.range;
        const whisker = node('span', 'chart-whisker');
        whisker.style.setProperty('--low', `${low}%`);
        whisker.style.setProperty('--remainder', `${100 - high}%`);
        track.append(whisker);
    }
    if (vertical) track.classList.add('vertical-track');
    return track;
}

function categoryList(categories, view) {
    const list = node('ul', view === 'horizontal' ? 'chart-list horizontal-list' : 'chart-list chart-legend');
    for (const [index, category] of categories.entries()) {
        const item = node('li', 'chart-row');
        item.style.setProperty('--category-color', category.color);
        item.append(nameWithKey(category, view === 'vertical' ? String(index + 1) : null));
        if (view === 'horizontal') item.append(bar(category, false));
        item.append(values(category));
        list.append(item);
    }
    return list;
}

function verticalPlot(categories) {
    const plot = node('div', 'vertical-plot');
    plot.setAttribute('aria-hidden', 'true');
    const axis = node('div', 'chart-axis');
    axis.append(node('span', '', '100%'), node('span', '', '50%'), node('span', '', '0%'));
    const columns = node('div', 'chart-columns');
    columns.style.setProperty('--columns', categories.length);
    for (const [index, category] of categories.entries()) {
        const column = node('div', 'chart-column');
        column.append(bar(category, true), node('span', '', String(index + 1)));
        columns.append(column);
    }
    plot.append(axis, columns);
    return plot;
}

function donutPlot(categories) {
    const total = categories.reduce((sum, category) => sum + category.score, 0);
    let end = 0;
    const segments = categories.map(category => {
        const start = end;
        end += category.score / total * 100;
        return `${category.color} ${start}% ${end}%`;
    });
    const donut = node('div', 'donut-plot');
    donut.setAttribute('aria-hidden', 'true');
    if (total > 0) donut.style.backgroundImage = `conic-gradient(${segments.join(', ')})`;
    return donut;
}

function modelDetails(model) {
    const details = node('details', 'model-details');
    details.append(node('summary', '', 'Scoring details'));
    details.append(node('p', 'quiz-copy', model.targetMet ? 'Full-profile precision target reached.' : 'The full profile remains uncertain.'));
    if (model.certainty) {
        const { leading, runnerUp, probability } = model.certainty;
        const percentage = probability >= .995 ? 'over 99%' : `${Math.round(probability * 100)}%`;
        details.append(node('p', 'quiz-copy', `Top-two certainty: ${percentage} chance that ${leading} outranks ${runnerUp} under the model.`));
    } else {
        details.append(node('p', 'quiz-copy', 'Top-two certainty needs answers covering both leading categories.'));
    }
    return details;
}

export function resultCharts(models, modelNames) {
    const section = node('div', 'result-charts');
    const label = node('label', 'answer-format chart-format', 'Chart view');
    const select = node('select');
    for (const [value, text] of views) {
        const option = node('option', '', text);
        option.value = value;
        select.append(option);
    }
    try {
        const saved = localStorage.getItem(preferenceKey);
        if (views.some(([id]) => id === saved)) select.value = saved;
    } catch {
        // Chart changes still work when browser storage is unavailable.
    }
    label.append(select);
    const caption = node('p', 'quiz-copy chart-caption');
    const panels = node('div', 'result-models');
    if (models.some(model => model.covered)) section.append(label, caption);
    section.append(panels);

    function render() {
        const view = select.value;
        const uncertainty = models.some(model => model.covered && categoriesFor(model).some(category => category.range));
        caption.textContent = uncertainty
            ? (view === 'donut' ? 'The legend lists approximate 90% ranges.' : 'Lines with end marks and the smaller numbers show approximate 90% ranges.')
            : '';
        panels.replaceChildren();
        for (const model of models) {
            const card = node('section', 'result-model');
            const header = node('header', 'result-model-heading');
            header.append(node('h3', '', modelNames[model.id]));
            header.append(node('p', 'quiz-copy', `${model.covered} of ${model.categories.length} categories compared`));
            card.append(header);
            if (model.covered) {
                const categories = categoriesFor(model);
                const chart = node('div', `chart-view chart-${view}`);
                if (view === 'vertical') chart.append(verticalPlot(categories));
                if (view === 'donut') chart.append(donutPlot(categories));
                chart.append(categoryList(categories, view));
                card.append(chart);
            }
            card.append(modelDetails(model));
            panels.append(card);
        }
    }

    select.addEventListener('change', () => {
        try { localStorage.setItem(preferenceKey, select.value); } catch { /* Optional preference. */ }
        render();
    });
    render();
    return section;
}
