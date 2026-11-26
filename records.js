const database = new Promise((resolve, reject) => {
    const request = indexedDB.open('affection-quiz', 1);
    request.onupgradeneeded = () => {
        request.result.createObjectStore('sessions', { keyPath: 'id' });
        request.result.createObjectStore('banks', { keyPath: 'schemaVersion' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Another tab is blocking browser storage.'));
});
database.catch(() => {}); // Display errors through the operation that uses storage.

async function storeOperation(store, mode, operation) {
    const db = await database;
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const request = operation(tx.objectStore(store));
        tx.oncomplete = () => resolve(request.result);
        tx.onabort = () => reject(tx.error);
    });
}

export const saveBank = bank => storeOperation('banks', 'readwrite', store => store.put(bank));
export const savedBank = version => storeOperation('banks', 'readonly', store => store.get(version));
export const saveRecord = record => storeOperation('sessions', 'readwrite', store => store.put(record));
export const savedRecords = () => storeOperation('sessions', 'readonly', store => store.getAll());
export const savedRecord = id => storeOperation('sessions', 'readonly', store => store.get(id));
export const deleteRecord = id => storeOperation('sessions', 'readwrite', store => store.delete(id));

export const rememberServerCopy = (id, remote, name) => storeOperation('sessions', 'readwrite', store => {
    const request = store.get(id);
    request.onsuccess = () => {
        const entry = request.result;
        if (!entry) return;
        delete entry.pendingSlug;
        store.put({ ...entry, remote, name: name ?? entry.name });
    };
    return request;
});

export function exportRecord(record) {
    return {
        sessionId: record.id,
        bankVersion: record.snapshot.schemaVersion,
        name: record.name,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        completedAt: record.completedAt,
        resume: {
            maxQuestions: record.snapshot.config.maxQuestions,
            extend: Boolean(record.snapshot.config.extend),
            answerMode: record.answerMode ?? 'binary',
            pending: record.snapshot.pending ? {
                questionId: record.snapshot.pending.questionId,
                displayOrder: record.snapshot.pending.displayOrder ?? record.snapshot.pending.options.map(option => option.id)
            } : null
        },
        summary: record.summary,
        answers: record.snapshot.answers.map(({ questionId, optionId, displayOrder, preference }) => ({
            questionId, answer: optionId, displayOrder, preference
        }))
    };
}

export function downloadRecord(data) {
    const file = new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = `affection-quiz-${data.sessionId}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const serverOrigin = 'https://lovelang.fabianflow.de';
export const slugPattern = '[a-z0-9][a-z0-9-]{0,63}';

export async function serverResult(method, slug, password = '', data) {
    const headers = {};
    if (password) {
        const bytes = new TextEncoder().encode(`result:${password}`);
        headers.Authorization = `Basic ${btoa(String.fromCharCode(...bytes))}`;
    }
    if (data) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${serverOrigin}/api/v1/results/${encodeURIComponent(slug)}`, {
        method,
        headers,
        body: data ? JSON.stringify(data) : undefined,
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(12000)
    });
    if (response.status === 204) return null;
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.slug) {
        const error = new Error(result.error ?? 'The result service is unavailable.');
        error.status = response.status;
        throw error;
    }
    return result;
}
