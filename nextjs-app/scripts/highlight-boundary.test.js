import assert from 'node:assert/strict';

const removeAccents = (str) => str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const isAlphaNumeric = (char) => Boolean(char && /[\p{L}\p{N}]/u.test(char));
const canHighlightMatch = (text, start, end) => !isAlphaNumeric(text[start - 1]) && !isAlphaNumeric(text[end]);

function findHighlights(text, searches) {
    const sourceText = String(text);
    const normalizedSource = removeAccents(sourceText.toLowerCase());
    const matches = [];

    searches
        .map((search, index) => ({
            normalized: removeAccents(String(search || '').trim().toLowerCase()),
            index,
        }))
        .filter(item => item.normalized)
        .sort((a, b) => b.normalized.length - a.normalized.length)
        .forEach(({ normalized, index }) => {
            let fromIndex = 0;
            while (fromIndex < normalizedSource.length) {
                const start = normalizedSource.indexOf(normalized, fromIndex);
                if (start === -1) break;
                const end = start + normalized.length;
                const overlaps = matches.some(match => start < match.end && end > match.start);
                if (!overlaps && canHighlightMatch(normalizedSource, start, end)) {
                    matches.push({ text: sourceText.slice(start, end), index });
                }
                fromIndex = start + Math.max(normalized.length, 1);
            }
        });

    return matches.map(match => match.text);
}

assert.deepEqual(findHighlights('context', ['ex']), []);
assert.deepEqual(findHighlights('the ex-boyfriend called', ['ex']), ['ex']);
assert.deepEqual(findHighlights('an ex wife arrived', ['ex wife']), ['ex wife']);
assert.deepEqual(findHighlights('context and ex-wife', ['ex']), ['ex']);
assert.deepEqual(findHighlights('tài xế say rượu', ['tai xe']), ['tài xế']);

console.log('highlight-boundary tests passed');
