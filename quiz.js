import { Assessment, isAnswered } from './engine.js?v=11';
import { deleteRecord, downloadRecord, exportRecord, rememberServerCopy, saveBank, savedBank, saveRecord, savedRecord, savedRecords, serverOrigin, serverResult, slugPattern } from './records.js?v=11';
import { resultCharts } from './result-charts.js';
import { addSavedScoreRanges, reasons, summarize } from './quiz-run.js?v=11';

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
let record;
const storageStatus = document.createElement('p');
storageStatus.className = 'quiz-copy storage-status';
storageStatus.setAttribute('role', 'status');
app.after(storageStatus);

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

function field(labelText, type, value = '') {
    const label = element('label', labelText, 'quiz-field');
    const input = document.createElement('input');
    input.type = type;
    input.value = value;
    label.append(input);
    return { label, input };
}

function answerFormat(mode) {
    const label = element('label', 'Answer format', 'answer-format');
    const select = document.createElement('select');
    for (const [value, text] of [['binary', 'A/B'], ['scale', 'Five-point scale']]) {
        const option = element('option', text);
        option.value = value;
        select.append(option);
    }
    select.value = mode === 'scale' ? 'scale' : 'binary';
    label.append(select);
    return { label, select };
}

function sessionAnswerFormat(entry, onChange) {
    const { label, select } = answerFormat(entry.answerMode);
    select.addEventListener('change', () => {
        entry.answerMode = select.value;
        if (onChange) onChange();
        else void saveRecord(structuredClone(entry)).catch(localError);
    });
    return label;
}

const answeredCount = summary => summary.answered + (summary.equal ?? 0);

function localError() {
    storageStatus.textContent = 'Browser storage is unavailable. You can still export your answers as JSON.';
}

function persist(reason = record.summary?.reason ?? 'early') {
    record.snapshot = session.snapshot();
    record.summary = summarize(session, reason);
    record.updatedAt = new Date().toISOString();
    return saveRecord(structuredClone(record)).catch(localError);
}

async function bankFor(version) {
    if (bank?.schemaVersion === version) return bank;
    const original = await savedBank(version).catch(() => null) ?? (bank ??= await fetchBank());
    if (original.schemaVersion !== version) throw new Error('This session’s original question bank is unavailable.');
    return original;
}

async function restoreSession(entry) {
    const original = await bankFor(entry.snapshot.schemaVersion);
    const snapshot = structuredClone(entry.snapshot);
    const pending = snapshot.pending;
    if (pending?.displayOrder) {
        const question = original.questions.find(item => item.id === pending.questionId);
        snapshot.pending = question ? {
            done: false,
            questionId: question.id,
            prompt: question.prompt,
            options: pending.displayOrder.map(id => ({ id, text: question.options.find(option => option.id === id).text }))
        } : null;
    }
    return Assessment.restore(original, snapshot);
}

function modelPicker(selected) {
    const fieldset = document.createElement('fieldset');
    fieldset.append(element('legend', 'Choose one or more frameworks'));
    for (const id of Object.keys(modelNames)) {
        const label = element('label', '', 'model-choice');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.name = 'model';
        input.value = id;
        input.checked = selected.includes(id);
        const content = element('div');
        content.append(document.createTextNode(modelNames[id]), element('span', modelDescriptions[id]));
        label.append(input, content);
        fieldset.append(label);
    }
    return fieldset;
}

function frameworkSettings(entry, onChanged) {
    const details = element('details', '', 'session-settings');
    const form = element('form');
    const save = element('button', 'Apply frameworks');
    save.type = 'submit';
    const status = element('p', '', 'quiz-copy');
    status.setAttribute('role', 'status');
    form.append(modelPicker(entry.snapshot.models), save, status);
    details.append(element('summary', 'Change frameworks'), form);
    form.addEventListener('submit', async event => {
        event.preventDefault();
        const models = [...form.querySelectorAll('input:checked')].map(input => input.value);
        if (!models.length) { status.textContent = 'Choose at least one framework.'; return; }
        save.disabled = true;
        try {
            const restored = await restoreSession(entry);
            const original = restored.bank;
            if (record !== entry) return;
            const snapshot = restored.snapshot();
            const pending = original.questions.find(question => question.id === snapshot.pending?.questionId);
            if (!pending || !models.some(model => pending.eligibility[model])) snapshot.pending = null;
            snapshot.models = models;
            session = Assessment.restore(original, snapshot);
            await persist(entry.completedAt ? 'frameworks_changed' : 'early');
            if (record === entry) onChanged();
        } catch (error) {
            status.textContent = error.message;
        } finally {
            save.disabled = false;
        }
    });
    return details;
}

async function resume(entry, more = false) {
    try {
        const restored = await restoreSession(entry);
        const skippedCap = restored.answers.length >= restored.config.maxQuestions;
        if (more || skippedCap) {
            restored.config.maxQuestions = Math.min(restored.bank.questions.length, restored.answers.length + 12);
            restored.config.extend = true;
        }
        record = entry;
        session = restored;
        bank ??= restored.bank;
        void saveBank(restored.bank).catch(localError);
        record.completedAt = null;
        history.replaceState(null, '', location.pathname);
        showQuestion();
    } catch (error) {
        storageStatus.textContent = `This session couldn’t be resumed. ${error.message}`;
    }
}

function sharedSessionForm() {
    const form = element('form', '', 'server-form');
    const link = field('Saved link or slug', 'text');
    link.input.required = true;
    const open = element('button', 'Open saved session');
    open.type = 'submit';
    const status = element('p', '', 'quiz-copy');
    status.setAttribute('role', 'status');
    form.append(link.label, open, status);
    form.addEventListener('submit', event => {
        event.preventDefault();
        let slug = link.input.value.trim();
        if (!isSlug(slug)) {
            try {
                const url = new URL(slug);
                if (url.origin === serverOrigin) slug = url.pathname.match(/^\/r\/([^/]+)\/?$/)?.[1];
                else if (url.origin === location.origin || url.origin === 'https://medrum.github.io') slug = url.searchParams.get('result');
            } catch { slug = null; }
        }
        if (!isSlug(slug)) { status.textContent = 'Enter a saved result link or slug.'; return; }
        location.search = new URLSearchParams({ result: slug });
    });
    return form;
}

function isSlug(value) {
    return typeof value === 'string' && new RegExp(`^${slugPattern}$`).test(value);
}

function dateText(value) {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

async function goHome() {
    try {
        bank ??= await fetchBank();
        session = undefined;
        record = undefined;
        storageStatus.textContent = '';
        showIntro();
        document.querySelector('h1').focus();
    } catch (error) {
        storageStatus.textContent = error.message;
    }
}

async function showSavedSessions(container) {
    let entries;
    try {
        entries = await savedRecords();
    } catch {
        localError();
        return;
    }
    if (!entries.length) return;
    container.replaceChildren();
    for (const entry of entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
        const item = element('article', '', 'saved-session');
        item.append(element('h3', entry.name || 'Untitled session'));
        const date = entry.completedAt ? `Completed ${dateText(entry.completedAt)}` : `In progress · ${dateText(entry.updatedAt)}`;
        item.append(element('p', `${date} · ${answeredCount(entry.summary)} answered`, 'quiz-copy'));
        const actions = element('div', '', 'quiz-actions');
        actions.append(button(entry.completedAt ? 'View results' : 'Continue', async () => {
            if (entry.completedAt) {
                session = undefined;
                record = entry;
                await supplementSavedRanges(entry, entry.snapshot.schemaVersion, entry.snapshot.answers);
                if (record !== entry) return;
                showResults(entry.summary.reason);
                return;
            }
            await resume(entry);
        }), button('Export JSON', () => downloadRecord(exportRecord(entry))), button('Remove from browser', async () => {
            if (!window.confirm('Remove this session from this browser?')) return;
            try {
                await deleteRecord(entry.id);
                showIntro();
                document.querySelector('h1').focus();
            } catch {
                localError();
            }
        }));
        if (entry.remote) {
            const link = element('a', 'Server link');
            link.href = `${serverOrigin}/r/${entry.remote.slug}`;
            actions.append(link);
        }
        item.append(actions);
        container.append(item);
    }
}

async function fetchBank() {
    const response = await fetch('./questions.json?v=8');
    if (!response.ok) throw new Error('Question bank unavailable');
    return response.json();
}

async function supplementSavedRanges(entry, version, answers) {
    const needsRanges = entry.summary.models.some(model => model.covered && model.categories.some(category => !category.range));
    if (!needsRanges) return;
    try {
        const original = bank?.schemaVersion === version ? bank : await savedBank(version).catch(() => null);
        const fallback = original ?? await fetchBank();
        if (fallback.schemaVersion === version) entry.summary = addSavedScoreRanges(entry.summary, fallback, answers);
    } catch {
        // Older results can still show their original scores without the bank used to calculate them.
    }
}

function showIntro() {
    const intro = element('div');
    intro.append(element('p', bank.instructions, 'quiz-copy'));
    intro.append(element('p', 'This quiz is for personal reflection. Sessions save in this browser as you go. Sharing a server copy is optional.', 'quiz-copy'));
    const form = document.createElement('form');
    const settings = element('details', '', 'session-settings');
    const fieldset = modelPicker(Object.keys(bank.models));
    const error = element('p', '', 'quiz-copy');
    error.setAttribute('role', 'alert');
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'primary';
    submit.textContent = 'Start the quiz';
    const lengthLabel = element('label', 'Session length', 'quiz-field');
    const length = document.createElement('select');
    for (const [key, title] of [['quick', 'Short'], ['extended', 'Extended']]) {
        const limit = bank.lengths[key];
        const option = element('option', `${title} (${limit.single} for one framework, ${limit.combined} for several)`);
        option.value = key;
        length.append(option);
    }
    lengthLabel.append(length);
    const format = answerFormat('binary');
    const name = field('Session name (optional)', 'text');
    name.input.maxLength = 80;
    settings.append(element('summary', 'Settings'), fieldset, lengthLabel, error);
    form.append(format.label, name.label, submit, settings);
    form.addEventListener('submit', event => {
        event.preventDefault();
        const selected = [...form.querySelectorAll('input:checked')].map(input => input.value);
        if (!selected.length) {
            settings.open = true;
            error.textContent = 'Choose at least one framework to continue.';
            fieldset.querySelector('input').focus();
            return;
        }
        const limits = bank.lengths[length.value];
        session = new Assessment(bank, selected, { maxQuestions: selected.length === 1 ? limits.single : limits.combined });
        record = { id: crypto.randomUUID(), name: name.input.value.trim(), createdAt: new Date().toISOString(), completedAt: null,
            answerMode: format.select.value };
        void saveBank(bank).catch(localError);
        showQuestion();
    });
    intro.append(form);
    const saved = element('section', '', 'saved-sessions');
    const savedHeading = element('h2', 'Saved sessions');
    savedHeading.id = 'saved-sessions-heading';
    saved.setAttribute('aria-labelledby', savedHeading.id);
    const savedList = document.createElement('div');
    saved.append(savedHeading, sharedSessionForm(), savedList);
    app.replaceChildren(intro, saved);
    void showSavedSessions(savedList);
}

function suggestionLink(questionId, prompt, options) {
    const suggestionUrl = new URL('https://github.com/MEdrum/love-language-test/issues/new');
    const choices = options.map((option, index) => `- ${String.fromCharCode(65 + index)}. ${option}`);
    suggestionUrl.searchParams.set('title', `Question suggestion: ${questionId}`);
    suggestionUrl.searchParams.set('body', [
        `Question ID: ${questionId}`, '', prompt, '', ...choices, '', 'What would you change about this question?', '', ''
    ].join('\n'));
    const suggest = element('a', 'Suggest a change', 'suggest-change');
    suggest.href = suggestionUrl.href;
    suggest.target = '_blank';
    suggest.rel = 'noopener noreferrer';
    suggest.setAttribute('aria-label', 'Suggest a change on GitHub (opens in a new tab)');
    suggest.title = 'Opens a public GitHub issue draft';
    return suggest;
}

function showQuestion(focusFormat = false) {
    const next = session.next();
    if (next.done) {
        finish(next.reason);
        return;
    }
    void persist('early');
    const count = element('p', `Question ${session.answers.length + 1} · ${session.answers.filter(isAnswered).length} answered`, 'question-count');
    const title = heading(next.prompt);
    const options = element('div', '', 'question-options');
    const respond = (id, preference) => {
        session.answer(id, preference);
        showQuestion();
    };
    if (record.answerMode === 'scale') {
        const [a, b] = next.options;
        for (const [label, option] of [['A', a], ['B', b]]) {
            const choice = element('p', '', 'scale-gesture');
            choice.append(element('strong', `${label}. `), document.createTextNode(option.text));
            options.append(choice);
        }
        const scale = element('div', '', 'scale-options');
        scale.setAttribute('role', 'group');
        scale.setAttribute('aria-label', 'Which gesture do you prefer?');
        for (const [text, label, id, preference] of [
            ['Strong A', 'Strongly prefer A', a.id, 'strong'],
            ['Slight A', 'Slightly prefer A', a.id, 'slight'],
            ['Equal', 'Equally appealing', 'skip', 'equal'],
            ['Slight B', 'Slightly prefer B', b.id, 'slight'],
            ['Strong B', 'Strongly prefer B', b.id, 'strong']
        ]) {
            const choice = button(text, () => respond(id, preference));
            choice.setAttribute('aria-label', label);
            scale.append(choice);
        }
        options.append(scale);
    } else {
        for (const option of next.options) options.append(button(option.text, () => respond(option.id)));
    }
    const actions = element('div', '', 'quiz-actions');
    const back = button('Back', () => {
        session.undo();
        showQuestion();
    });
    back.disabled = !session.answers.length;
    actions.append(back, button('Skip', () => respond('skip')));
    actions.append(button('See results so far', () => showResults('early')));
    actions.append(suggestionLink(next.questionId, next.prompt, next.options.map(option => option.text)));
    const format = sessionAnswerFormat(record, () => showQuestion(true));
    app.replaceChildren(count, title, format, options, actions, frameworkSettings(record, showQuestion));
    (focusFormat ? format.querySelector('select') : title).focus();
}

function conflictFollowUp() {
    const { id, prompt, options } = bank.conflictFollowUp;
    const details = element('details', '', 'conflict-follow-up');
    const choices = document.createElement('fieldset');
    choices.append(element('legend', prompt));
    for (const option of options) {
        const label = element('label', '', 'model-choice');
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = id;
        label.append(input, document.createTextNode(option));
        choices.append(label);
    }
    details.append(
        element('summary', 'Reflect on disagreements'),
        element('p', 'An optional question for personal reflection, separate from your quiz scores.', 'quiz-copy'),
        choices,
        suggestionLink(id, prompt, options)
    );
    return details;
}

function resultContent(summary) {
    const answered = answeredCount(summary);
    const status = element('p', `${reasons[summary.reason] ?? reasons.early} ${answered} answered, ${summary.asked - answered} skipped.`, 'quiz-copy');
    const explanation = element('p', 'Each chart shows relative preferences within one framework. The quiz is unvalidated.', 'quiz-copy');
    return [status, explanation, resultCharts(summary.models, modelNames)];
}

function finish(reason) {
    record.completedAt ??= new Date().toISOString();
    void persist(reason);
    showResults(reason);
}

function serverSettings(entry, title, onSaved, initialPassword = '') {
    let passwordInMemory = initialPassword;
    const details = element('details', '', 'session-settings');
    details.append(element('summary', 'Edit server name, slug or password'));
    const form = element('form', '', 'server-form');
    const name = field('Server name', 'text', entry.name);
    name.input.required = true;
    name.input.maxLength = 80;
    const slug = field('New link slug', 'text', entry.remote.slug);
    slug.input.required = true;
    slug.input.pattern = slugPattern;
    slug.input.maxLength = 64;
    slug.input.autocapitalize = 'none';
    slug.input.spellcheck = false;
    const current = field('Current password', 'password');
    const next = field('New password', 'password');
    current.input.maxLength = next.input.maxLength = 256;
    const passwordAction = element('label', 'Password action', 'quiz-field');
    const action = document.createElement('select');
    for (const [value, text] of [['keep', 'Keep current setting'], ['change', 'Set a new password'], ['remove', 'Remove password']]) {
        const option = element('option', text);
        option.value = value;
        action.append(option);
    }
    passwordAction.append(action);
    const updatePasswordFields = () => {
        current.label.hidden = !entry.remote.passwordProtected || Boolean(passwordInMemory);
        current.input.required = !current.label.hidden;
        next.label.hidden = action.value !== 'change';
        next.input.required = !next.label.hidden;
    };
    updatePasswordFields();
    action.addEventListener('change', updatePasswordFields);
    const save = element('button', 'Save server settings');
    save.type = 'submit';
    const status = element('p', '', 'quiz-copy');
    status.setAttribute('role', 'status');
    form.append(name.label, slug.label, current.label, passwordAction, next.label, save, status);
    details.append(form);
    form.addEventListener('submit', async event => {
        event.preventDefault();
        save.disabled = true;
        const changes = { name: name.input.value.trim(), slug: slug.input.value };
        if (action.value !== 'keep') changes.newPassword = action.value === 'change' ? next.input.value : '';
        try {
            const response = await serverResult('PATCH', entry.remote.slug, passwordInMemory || current.input.value, changes);
            const { name: savedName, ...remote } = response;
            entry.remote = remote;
            entry.name = savedName;
            await rememberServerCopy(entry.id, remote, savedName).catch(localError);
            const { searchParams } = new URL(location.href);
            if (searchParams.has('result')) {
                searchParams.set('result', remote.slug);
                history.replaceState(null, '', `${location.pathname}?${searchParams}`);
            }
            passwordInMemory = changes.newPassword ?? passwordInMemory;
            current.input.value = next.input.value = '';
            action.value = 'keep';
            updatePasswordFields();
            title.textContent = `Results for ${savedName}`;
            onSaved?.(remote, passwordInMemory);
            status.textContent = 'Server settings saved.';
        } catch (error) {
            if (error.status === 401) {
                passwordInMemory = '';
                updatePasswordFields();
            }
            status.textContent = error.status ? error.message : 'Could not reach the result service.';
        } finally {
            save.disabled = false;
        }
    });
    return details;
}

function serverSave(entry, title) {
    const details = element('details', '', 'server-copy');
    details.append(element('summary', 'Save a server copy'));
    const form = element('form', '', 'server-form');
    const name = field('Name', 'text', entry.name);
    name.input.required = true;
    name.input.maxLength = 80;
    const slug = field('Link slug', 'text', entry.remote?.slug ?? entry.pendingSlug ?? entry.id);
    slug.input.required = true;
    slug.input.pattern = slugPattern;
    slug.input.maxLength = 64;
    slug.input.autocapitalize = 'none';
    slug.input.spellcheck = false;
    slug.input.readOnly = Boolean(entry.remote);
    const password = field(entry.remote?.passwordProtected ? 'Result password' : 'Password (optional)', 'password');
    password.input.maxLength = 256;
    password.input.required = Boolean(entry.remote?.passwordProtected);
    const submit = element('button', entry.remote ? 'Update server copy' : 'Save to server');
    submit.type = 'submit';
    const status = element('p', '', 'quiz-copy');
    status.setAttribute('role', 'status');
    const share = element('p');
    function showLink() {
        if (!entry.remote) return;
        const link = element('a', 'Open the saved result');
        link.href = `${serverOrigin}/r/${entry.remote.slug}`;
        share.replaceChildren(link, document.createTextNode(` · Saved ${dateText(entry.remote.savedAt)}`));
    }
    function showSettings() {
        details.querySelector('.session-settings')?.remove();
        if (!entry.remote) return;
        details.append(serverSettings(entry, title, remote => {
            slug.input.value = remote.slug;
            name.input.value = entry.name;
            password.input.required = remote.passwordProtected;
            password.label.firstChild.textContent = remote.passwordProtected ? 'Result password' : 'Password (optional)';
            showLink();
        }));
    }
    showLink();
    form.append(element('p', 'This sends your name, answers, and scores to the server. Anyone with the link can open the result unless you set a password. Results are stored unencrypted on the server.', 'quiz-copy'),
        name.label, slug.label, password.label, submit, status, share);
    form.addEventListener('submit', async event => {
        event.preventDefault();
        const nextName = name.input.value.trim();
        if (!nextName) {
            status.textContent = 'Enter a name for the result.';
            name.input.focus();
            return;
        }
        submit.disabled = true;
        status.textContent = 'Saving to the server…';
        entry.name = nextName;
        entry.pendingSlug = slug.input.value;
        entry.updatedAt = new Date().toISOString();
        void saveRecord(structuredClone(entry)).catch(localError);
        try {
            entry.remote = await serverResult('PUT', slug.input.value, password.input.value, exportRecord(entry));
            delete entry.pendingSlug;
            await rememberServerCopy(entry.id, entry.remote).catch(localError);
            if (record?.id === entry.id) record.remote = entry.remote;
            slug.input.readOnly = true;
            submit.textContent = 'Update server copy';
            password.input.value = '';
            password.input.required = entry.remote.passwordProtected;
            password.label.firstChild.textContent = entry.remote.passwordProtected ? 'Result password' : 'Password (optional)';
            title.textContent = `Results for ${entry.name}`;
            showLink();
            showSettings();
            status.textContent = 'Saved to the server.';
        } catch (error) {
            status.textContent = error.status ? error.message : 'Could not reach the result service. Your browser copy is still available.';
        } finally {
            submit.disabled = false;
        }
    });
    details.append(form);
    showSettings();
    return details;
}

function showResults(reason) {
    const entry = record;
    const summary = entry.summary;
    const title = heading(entry.name ? `Results for ${entry.name}` : 'Your results');
    const content = [title];
    if (entry.completedAt) content.push(element('p', `Completed ${dateText(entry.completedAt)}`, 'quiz-copy'));
    content.push(...resultContent(summary));
    const actions = element('div', '', 'quiz-actions');
    if (reason === 'early') {
        actions.append(button('Continue answering', () => resume(entry)), button('Finish with these answers', () => finish('finished')));
    }
    if (reason !== 'eligible_pool_exhausted') actions.append(button('Answer 12 more questions', () => resume(entry, true)));
    actions.append(button('Export JSON', () => downloadRecord(exportRecord(entry))), button('All sessions', goHome));
    const rename = element('form', '', 'server-form');
    const name = field('Session name in this browser', 'text', entry.name);
    name.input.maxLength = 80;
    const save = element('button', 'Save name');
    save.type = 'submit';
    rename.append(name.label, save);
    rename.addEventListener('submit', async event => {
        event.preventDefault();
        entry.name = name.input.value.trim();
        entry.updatedAt = new Date().toISOString();
        try {
            await saveRecord(structuredClone(entry));
            storageStatus.textContent = 'Name saved in this browser.';
            if (record === entry) showResults(reason);
        } catch {
            localError();
        }
    });
    content.push(actions, sessionAnswerFormat(entry), frameworkSettings(entry, () => showResults(entry.summary.reason)), rename, serverSave(entry, title));
    if (bank?.conflictFollowUp) content.push(conflictFollowUp());
    app.replaceChildren(...content);
    title.focus();
}

async function rememberSharedResult(result, remote) {
    const local = await savedRecord(result.sessionId).catch(() => null);
    const models = result.summary.models.map(model => model.id);
    const entry = local && Date.parse(local.updatedAt) >= Date.parse(result.updatedAt) ? local : {
        id: result.sessionId,
        name: result.name,
        createdAt: result.createdAt,
        updatedAt: result.updatedAt,
        completedAt: result.completedAt,
        answerMode: result.resume?.answerMode,
        summary: result.summary,
        snapshot: {
            schemaVersion: result.bankVersion,
            models,
            config: {
                maxQuestions: result.resume?.maxQuestions ?? Math.max(result.answers.length, models.length === 1 ? 24 : 30),
                extend: result.resume?.extend ?? false
            },
            answers: result.answers.map(({ questionId, answer, displayOrder, preference }) => ({ questionId, optionId: answer, displayOrder, preference })),
            pending: result.resume?.pending ?? null
        }
    };
    if (!local || Date.parse(local.updatedAt) <= Date.parse(result.updatedAt)) entry.name = result.name;
    entry.remote = remote;
    delete entry.pendingSlug;
    await saveRecord(structuredClone(entry)).catch(localError);
    return entry;
}

function showSharedResult(slug) {
    const title = heading('Shared result');
    const home = element('a', 'Go to the quiz');
    home.href = location.pathname;
    const form = element('form', '', 'server-form');
    const password = field('Result password', 'password');
    password.input.maxLength = 256;
    password.input.required = true;
    const submit = element('button', 'Open result');
    submit.type = 'submit';
    form.append(password.label, submit);
    form.hidden = true;
    const status = element('p', 'Loading the saved result…', 'quiz-copy');
    status.setAttribute('role', 'status');
    const content = element('div');
    app.replaceChildren(title, status, form, content, home);
    async function load(value = '') {
        try {
            const { result, ...remote } = await serverResult('GET', slug, value);
            await supplementSavedRanges(result, result.bankVersion, result.answers.map(answer => ({
                questionId: answer.questionId, optionId: answer.answer, preference: answer.preference
            })));
            form.hidden = true;
            password.input.value = '';
            status.textContent = '';
            title.textContent = `Results for ${result.name}`;
            const entry = await rememberSharedResult(result, remote);
            record = entry;
            session = undefined;
            const date = result.completedAt ? `Completed ${dateText(result.completedAt)}` : 'Saved before completion';
            const actions = element('div', '', 'quiz-actions');
            let passwordInMemory = value;
            actions.append(button(entry.completedAt ? 'Answer 12 more questions' : 'Continue answering', () => resume(entry, Boolean(entry.completedAt))),
                button('Export JSON', () => downloadRecord(exportRecord(entry))), button('Delete server copy', async () => {
                if (!window.confirm('Delete this result from the server?')) return;
                try {
                    await serverResult('DELETE', entry.remote.slug, passwordInMemory);
                    entry.remote = undefined;
                    await rememberServerCopy(entry.id, undefined).catch(localError);
                    status.textContent = 'Server copy deleted.';
                    content.replaceChildren();
                } catch (error) {
                    status.textContent = error.message;
                }
            }));
            const copyLink = element('a', 'Open this server link');
            copyLink.href = `${serverOrigin}/r/${entry.remote.slug}`;
            const settings = serverSettings(entry, title, (updated, password) => {
                passwordInMemory = password;
                copyLink.href = `${serverOrigin}/r/${updated.slug}`;
            }, value);
            const frameworks = frameworkSettings(entry, () => {
                history.replaceState(null, '', location.pathname);
                showResults(entry.summary.reason);
            });
            content.replaceChildren(element('p', date, 'quiz-copy'), ...resultContent(result.summary), actions, sessionAnswerFormat(entry), copyLink, frameworks, settings);
            title.focus();
        } catch (error) {
            form.hidden = error.status !== 401;
            status.textContent = error.status === 401 ? (value ? 'That password did not open the result.' : 'This result is password protected.')
                : error.status ? error.message : 'Could not reach the result service.';
            if (!form.hidden) password.input.focus();
        }
    }
    form.addEventListener('submit', async event => {
        event.preventDefault();
        submit.disabled = true;
        await load(password.input.value);
        submit.disabled = false;
    });
    if (isSlug(slug)) void load();
    else status.textContent = 'This result link is invalid.';
}

const loading = element('p', 'Loading the questions…');
loading.setAttribute('role', 'status');
app.append(loading);

try {
    const sharedSlug = new URLSearchParams(location.search).get('result');
    if (sharedSlug !== null) {
        showSharedResult(sharedSlug);
    } else {
        bank = await fetchBank();
        showIntro();
    }
} catch (error) {
    console.error(error);
    loading.textContent = 'The questions could not be loaded. Please try again later.';
}
