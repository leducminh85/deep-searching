import Typo from 'typo-js';

let spellChecker = null;

/**
 * Initializes the spell checker by loading en_US dictionary files.
 * Since this needs to load files, it returns a promise.
 */
export const initSpellChecker = async () => {
    if (spellChecker) return spellChecker;

    try {
        // In Next.js client side, we fetch the dictionary files from the public folder
        const affData = await fetch('/dictionaries/en_US.aff').then(res => res.text());
        const dicData = await fetch('/dictionaries/en_US.dic').then(res => res.text());

        spellChecker = new Typo('en_US', affData, dicData);
        console.log('SpellChecker initialized successfully');
        return spellChecker;
    } catch (error) {
        console.error('Failed to initialize SpellChecker:', error);
        return null;
    }
};

/**
 * Checks if a word is correctly spelled.
 * Returns true if correct or if checker is not initialized yet (fail-safe).
 */
export const checkSpelling = (word) => {
    if (!spellChecker) return true;
    return spellChecker.check(word);
};

export const getSuggestions = (word) => {
    if (!spellChecker) return [];
    return spellChecker.suggest(word);
};
