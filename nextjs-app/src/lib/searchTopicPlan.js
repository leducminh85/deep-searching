import { normalizeAdvancedSearchPlan } from './localDb.js';

export function compactText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

export function removeAccents(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function normalizeForCompare(value) {
    return removeAccents(value).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

export function detectExplicitKeywordList(topic) {
    const raw = compactText(topic);
    if (!raw.includes(',')) {
        return { explicit: false, terms: [] };
    }

    const parts = raw
        .split(',')
        .map(part => part.trim())
        .filter(Boolean);

    if (parts.length < 2) {
        return { explicit: false, terms: [] };
    }

    const simpleParts = parts.every(part => {
        const wordCount = part.split(/\s+/).filter(Boolean).length;
        return wordCount <= 3 && /^[\p{L}\p{N}\s'-]+$/u.test(part);
    });

    return {
        explicit: simpleParts,
        terms: simpleParts ? parts : [],
    };
}

function normalizeRawGroupTerms(group) {
    return Array.isArray(group?.terms)
        ? group.terms.map(term => compactText(term)).filter(Boolean)
        : [];
}

function getGroupSourceTerms(group, originalTerms) {
    const sourceTerms = Array.isArray(group?.sourceTerms) ? group.sourceTerms : [];
    const normalizedSources = new Set(sourceTerms.map(normalizeForCompare).filter(Boolean));
    const groupTerms = normalizeRawGroupTerms(group).map(normalizeForCompare);

    return originalTerms.filter(original => {
        const normalizedOriginal = normalizeForCompare(original);
        return normalizedSources.has(normalizedOriginal) || groupTerms.includes(normalizedOriginal);
    });
}

function isSameConceptMergeAllowed(group, sourceTerms) {
    if (sourceTerms.length < 2) return true;
    const relation = String(group?.relation || group?.relationship || '').toLowerCase().trim();
    const confidence = Number(group?.confidence || 0);
    return ['same_concept', 'synonym', 'same_role_alternatives'].includes(relation) && confidence >= 0.75;
}

export function postProcessExplicitKeywordPlan(rawPlan, explicitTerms) {
    const normalizedPlan = normalizeAdvancedSearchPlan(rawPlan);
    if (!normalizedPlan || !explicitTerms.length) {
        return {
            plan: normalizedPlan,
            metadata: {
                explicit_keyword_list: Boolean(explicitTerms.length),
                explicit_terms: explicitTerms,
                auto_corrected_groups: [],
            },
        };
    }

    const rawGroups = Array.isArray(rawPlan?.groups) ? rawPlan.groups : normalizedPlan.groups;
    const usedOriginals = new Set();
    const correctedGroups = [];
    const autoCorrectedGroups = [];

    for (const rawGroup of rawGroups) {
        const sourceTerms = getGroupSourceTerms(rawGroup, explicitTerms);
        const groupTerms = normalizeRawGroupTerms(rawGroup);

        if (sourceTerms.length >= 2 && !isSameConceptMergeAllowed(rawGroup, sourceTerms)) {
            autoCorrectedGroups.push({
                original_group_terms: groupTerms,
                source_terms: sourceTerms,
                reason: 'split_compound_attributes_from_explicit_keyword_list',
            });

            for (const sourceTerm of sourceTerms) {
                const normalizedSource = normalizeForCompare(sourceTerm);
                const terms = [sourceTerm, ...groupTerms.filter(term => normalizeForCompare(term) === normalizedSource)]
                    .map(compactText)
                    .filter(Boolean)
                    .filter((term, index, arr) => arr.findIndex(item => normalizeForCompare(item) === normalizeForCompare(term)) === index);

                correctedGroups.push({ operator: 'OR', terms });
                usedOriginals.add(normalizedSource);
            }
        } else {
            correctedGroups.push({
                operator: rawGroup.operator || 'OR',
                terms: groupTerms,
            });
            sourceTerms.forEach(term => usedOriginals.add(normalizeForCompare(term)));
        }
    }

    for (const sourceTerm of explicitTerms) {
        const normalizedSource = normalizeForCompare(sourceTerm);
        if (!usedOriginals.has(normalizedSource)) {
            correctedGroups.push({ operator: 'OR', terms: [sourceTerm] });
            autoCorrectedGroups.push({
                original_group_terms: [],
                source_terms: [sourceTerm],
                reason: 'restored_missing_explicit_keyword',
            });
        }
    }

    return {
        plan: normalizeAdvancedSearchPlan({
            rootOperator: correctedGroups.length > 1 ? 'AND' : (normalizedPlan.rootOperator || 'OR'),
            groups: correctedGroups,
        }),
        metadata: {
            explicit_keyword_list: true,
            explicit_terms: explicitTerms,
            auto_corrected_groups: autoCorrectedGroups,
        },
    };
}
