import assert from 'node:assert/strict';
import {
    analyzeAdvancedFacetWeights,
    buildAdvancedSearchTsQuery,
    buildOptionalAdvancedSearchTsQuery,
    buildRelaxedAdvancedSearchTsQuery,
    dropWeakestAdvancedFacet,
    filterDomainGenericTermsFromPlan,
    validateAdvancedSearchPlanWithCorpus,
} from '../src/lib/localDb.js';

const corpus = new Map([
    ['airport', 120],
    ['airplane', 40],
    ['flight', 300],
    ['passenger', 240],
    ['karen', 18],
    ['woman', 500],
    ['girl', 420],
    ['sovereign', 35],
    ['citizen', 44],
    ['freeman', 5],
    ['arrested', 80],
    ['arrest', 70],
    ['police', 1000],
    ['detained', 22],
    ['drunk', 90],
    ['intoxicated', 45],
    ['driver', 140],
    ['motorist', 35],
    ['body', 30],
    ['sân', 8],
    ['bay', 9],
    ['san', 11],
    ['nguoi', 100],
]);
const weightedCorpus = { words: corpus, totalVideos: 1000 };

const karenPlan = {
    rootOperator: 'AND',
    groups: [
        { operator: 'OR', terms: ['airport', 'airplane', 'flight', 'passenger'] },
        { operator: 'OR', terms: ['karen', 'woman', 'girl'] },
    ],
};

assert.equal(
    buildAdvancedSearchTsQuery(karenPlan),
    '(airport | airplane | flight | passenger) & (karen | woman | girl)'
);

const sovereignPlan = {
    rootOperator: 'AND',
    groups: [
        { operator: 'OR', terms: ['sovereign citizen', 'sovereign', 'freeman'] },
        { operator: 'OR', terms: ['arrested', 'arrest', 'police', 'detained'] },
    ],
};

assert.equal(
    buildAdvancedSearchTsQuery(sovereignPlan),
    '((sovereign <-> citizen) | sovereign | freeman) & (arrested | arrest | police | detained)'
);

assert.equal(
    buildRelaxedAdvancedSearchTsQuery(sovereignPlan),
    '((sovereign <-> citizen) | sovereign | citizen | freeman) & (arrested | arrest | police | detained)'
);

assert.equal(
    buildOptionalAdvancedSearchTsQuery(karenPlan),
    '(airport | airplane | flight | passenger) | (karen | woman | girl)'
);

const validated = validateAdvancedSearchPlanWithCorpus({
    rootOperator: 'AND',
    groups: [
        { operator: 'OR', terms: ['airport', 'unknown airport phrase'] },
        { operator: 'OR', terms: ['totallymissing', 'alsomissing'] },
        { operator: 'OR', terms: ['karen', 'woman'] },
    ],
}, corpus);

assert.deepEqual(validated.plan.groups, [
    { operator: 'OR', terms: ['airport'] },
    { operator: 'OR', terms: ['karen', 'woman'] },
]);
assert.equal(validated.unmatchedFacets.length, 1);
assert.deepEqual(validated.unmatchedFacets[0].terms, ['totallymissing', 'alsomissing']);

const domainGenericFiltered = validateAdvancedSearchPlanWithCorpus({
    rootOperator: 'AND',
    groups: [
        { operator: 'OR', terms: ['police', 'officer', 'arrest', 'arrested'] },
        { operator: 'OR', terms: ['drunk', 'intoxicated'] },
        { operator: 'OR', terms: ['driver', 'motorist'] },
    ],
}, corpus);

assert.deepEqual(domainGenericFiltered.plan.groups, [
    { operator: 'OR', terms: ['drunk', 'intoxicated'] },
    { operator: 'OR', terms: ['driver', 'motorist'] },
]);
assert.equal(
    domainGenericFiltered.droppedTerms.some(item => item.term === 'police' && item.reason === 'domain_generic'),
    true
);
assert.equal(
    domainGenericFiltered.droppedTerms.some(item => item.term === 'officer' && item.reason === 'domain_generic'),
    true
);
assert.equal(
    domainGenericFiltered.droppedTerms.some(item => item.term === 'arrest' && item.reason === 'domain_generic'),
    true
);
assert.equal(domainGenericFiltered.unmatchedFacets.length, 1);

const topicRouteFiltered = filterDomainGenericTermsFromPlan({
    rootOperator: 'AND',
    groups: [
        { operator: 'OR', terms: ['police', 'officer', 'bodycam', 'arrest', 'detained'] },
        { operator: 'OR', terms: ['drunk', 'intoxicated'] },
        { operator: 'OR', terms: ['driver', 'motorist'] },
    ],
});

assert.deepEqual(topicRouteFiltered.plan.groups, [
    { operator: 'OR', terms: ['drunk', 'intoxicated'] },
    { operator: 'OR', terms: ['driver', 'motorist'] },
]);
assert.equal(topicRouteFiltered.droppedTerms.some(item => item.term === 'bodycam'), true);

const bodyTermFiltered = filterDomainGenericTermsFromPlan({
    rootOperator: 'AND',
    groups: [
        { operator: 'OR', terms: ['body'] },
        { operator: 'OR', terms: ['body camera'] },
    ],
});

assert.deepEqual(bodyTermFiltered.plan.groups, [
    { operator: 'OR', terms: ['body'] },
]);
assert.equal(bodyTermFiltered.droppedTerms.some(item => item.term === 'body camera'), true);

const accented = validateAdvancedSearchPlanWithCorpus({
    rootOperator: 'AND',
    groups: [
        { operator: 'OR', terms: ['sân bay', 'san bay'] },
        { operator: 'OR', terms: ['người', 'nguoi'] },
    ],
}, corpus);

assert.deepEqual(accented.plan.groups, [
    { operator: 'OR', terms: ['sân bay', 'san bay'] },
    { operator: 'OR', terms: ['nguoi'] },
]);
assert.equal(accented.droppedTerms.some(item => item.term === 'người'), true);

const reduced = dropWeakestAdvancedFacet({
    rootOperator: 'AND',
    groups: [
        { operator: 'OR', terms: ['airport', 'flight'] },
        { operator: 'OR', terms: ['karen'] },
        { operator: 'OR', terms: ['police', 'arrest'] },
    ],
}, [300, 1, 900]);

assert.deepEqual(reduced.droppedFacet.terms, ['karen']);
assert.equal(
    buildAdvancedSearchTsQuery(reduced.plan),
    '(airport | flight) & (police | arrest)'
);

const weights = analyzeAdvancedFacetWeights({
    rootOperator: 'AND',
    groups: [
        { operator: 'OR', terms: ['woman', 'girl'] },
        { operator: 'OR', terms: ['airport', 'flight'] },
    ],
}, weightedCorpus);

assert.deepEqual(weights.broadFacets.map(facet => facet.label), ['woman|girl']);
assert.deepEqual(weights.facetWeights, [0.4, 1]);

console.log('search-query-builder tests passed');
