import assert from 'node:assert/strict';
import {
    detectExplicitKeywordList,
    postProcessExplicitKeywordPlan,
} from '../src/lib/searchTopicPlan.js';

function groupTerms(plan) {
    return plan.groups.map(group => group.terms);
}

const compoundCases = [
    'driver, drunk, taser',
    'officer, injured, shooting',
    'child, missing, found',
    'elderly, scammed, phone',
    'teacher, arrested, classroom',
    'tourist, robbed, hotel',
    'student, missing, campus',
    'nurse, attacked, hospital',
    'cashier, assaulted, store',
    'mayor, bribery, court',
    'delivery driver, attacked, parking lot',
];

for (const topic of compoundCases) {
    const detected = detectExplicitKeywordList(topic);
    assert.equal(detected.explicit, true, topic);
    const rawPlan = {
        rootOperator: 'AND',
        groups: [
            {
                operator: 'OR',
                terms: detected.terms,
                sourceTerms: detected.terms,
                relation: 'separate_attribute',
                confidence: 0.6,
            },
        ],
    };
    const processed = postProcessExplicitKeywordPlan(rawPlan, detected.terms);
    assert.equal(processed.plan.rootOperator, 'AND', topic);
    assert.deepEqual(groupTerms(processed.plan), detected.terms.map(term => [term]), topic);
    assert.ok(processed.metadata.auto_corrected_groups.length > 0, topic);
}

const synonymCases = [
    {
        topic: 'cop, police, officer',
        terms: ['cop', 'police', 'officer'],
    },
    {
        topic: 'robbery, theft, stealing',
        terms: ['robbery', 'theft', 'stealing'],
    },
    {
        topic: 'argument, fight, altercation',
        terms: ['argument', 'fight', 'altercation'],
    },
    {
        topic: 'attorney, lawyer, counsel',
        terms: ['attorney', 'lawyer', 'counsel'],
    },
    {
        topic: 'car, vehicle, automobile',
        terms: ['car', 'vehicle', 'automobile'],
    },
];

for (const item of synonymCases) {
    const detected = detectExplicitKeywordList(item.topic);
    const processed = postProcessExplicitKeywordPlan({
        rootOperator: 'AND',
        groups: [
            {
                operator: 'OR',
                terms: item.terms,
                sourceTerms: item.terms,
                relation: 'same_concept',
                confidence: 0.9,
            },
        ],
    }, detected.terms);

    assert.deepEqual(groupTerms(processed.plan), [item.terms], item.topic);
    assert.equal(processed.metadata.auto_corrected_groups.length, 0, item.topic);
}

const ambiguousCases = [
    ['man, woman', ['man', 'woman']],
    ['young, old', ['young', 'old']],
    ['teen, adult', ['teen', 'adult']],
    ['customer, employee', ['customer', 'employee']],
];

for (const [topic, terms] of ambiguousCases) {
    const detected = detectExplicitKeywordList(topic);
    const processed = postProcessExplicitKeywordPlan({
        rootOperator: 'AND',
        groups: [
            {
                operator: 'OR',
                terms,
                sourceTerms: terms,
                relation: 'same_role_alternatives',
                confidence: 0.8,
            },
        ],
    }, detected.terms);

    assert.deepEqual(groupTerms(processed.plan), [terms], topic);
}

const naturalLanguageCases = [
    'các vụ karen gây rối ở sân bay',
    'sovereign citizen bị cảnh sát bắt',
    'người say rượu bị taser sau khi chống đối',
    'passenger meltdown on flight',
    'tourist robbed inside a hotel lobby',
    'teacher arrested after classroom fight',
];

for (const topic of naturalLanguageCases) {
    assert.equal(detectExplicitKeywordList(topic).explicit, false, topic);
}

console.log('search-topic-plan tests passed');
