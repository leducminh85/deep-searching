import { NextResponse } from 'next/server';
import { createClient } from '../../../../utils/supabase/server';
import { getTopSearchLexemes, normalizeAdvancedSearchPlan } from '../../../../lib/localDb';
import {
    compactText,
    detectExplicitKeywordList,
    postProcessExplicitKeywordPlan,
    removeAccents,
} from '../../../../lib/searchTopicPlan';

const DEFAULT_MODEL = 'qwen2.5:7b';
const MAX_TOPIC_LENGTH = 240;
const GENERIC_WORDS = new Set([
    'cac', 'nhung', 'mot', 'vung', 'viec', 'vu', 'bi', 'o', 'tai', 'trong', 'ngoai', 'cua', 'va', 'hoac', 'la', 'co', 'khong',
    'video', 'clip', 'story', 'stories', 'incident', 'incidents', 'case', 'cases', 'event', 'events', 'viral', 'public',
    'compilation', 'caught', 'camera', 'footage', 'people', 'person', 'thing', 'things',
]);

function repairJsonCandidate(value) {
    return String(value || '')
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/"\s+"/g, '", "')
        .replace(/}\s*{/g, '}, {')
        .replace(/]\s*\[/g, '], [')
        .replace(/]\s*{/g, '], {')
        .replace(/}\s*\[/g, '}, [')
        .replace(/"\s*{/g, '", {')
        .replace(/"\s*\[/g, '", [');
}

function extractJsonObject(text) {
    const content = String(text || '').trim();
    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1] : content;
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');

    if (start === -1 || end === -1 || end <= start) {
        throw new Error('AI không trả về JSON hợp lệ.');
    }

    const jsonText = candidate.slice(start, end + 1);

    try {
        return JSON.parse(jsonText);
    } catch (originalError) {
        try {
            return JSON.parse(repairJsonCandidate(jsonText));
        } catch {
            throw originalError;
        }
    }
}

function getTermsFromPlan(plan) {
    return plan.groups
        .flatMap(group => group.terms)
        .filter((term, index, arr) => arr.indexOf(term) === index);
}

function formatDisplayQuery(plan) {
    const groupText = plan.groups.map(group => {
        const joiner = group.operator === 'AND' ? ' AND ' : ' OR ';
        const text = group.terms
            .map(term => term.includes(' ') ? `"${term}"` : term)
            .join(joiner);
        return group.terms.length > 1 ? `(${text})` : text;
    });

    const rootJoiner = plan.rootOperator === 'OR' ? ' OR ' : ' AND ';
    return groupText.join(rootJoiner);
}

function fallbackPlan(topic, listInfo = { explicit: false, terms: [] }) {
    if (listInfo.explicit && listInfo.terms.length > 0) {
        return normalizeAdvancedSearchPlan({
            rootOperator: listInfo.terms.length > 1 ? 'AND' : 'OR',
            groups: listInfo.terms.map(term => ({
                operator: 'OR',
                terms: [term],
            })),
        });
    }

    const hintedGroups = buildHintGroups(topic);
    if (hintedGroups.length > 0) {
        return normalizeAdvancedSearchPlan({
            rootOperator: hintedGroups.length > 1 ? 'AND' : 'OR',
            groups: hintedGroups,
        });
    }

    const terms = removeAccents(compactText(topic).toLowerCase())
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter(term => term.length > 1)
        .filter(term => !GENERIC_WORDS.has(term))
        .filter((term, index, arr) => arr.indexOf(term) === index)
        .slice(0, 8);

    if (terms.length === 0) return null;

    return normalizeAdvancedSearchPlan({
        rootOperator: 'OR',
        groups: [
            {
                operator: 'OR',
                terms,
            },
        ],
    });
}

function buildHintGroups(topic) {
    const normalized = removeAccents(compactText(topic).toLowerCase());
    const groups = [];

    if (/\bkaren\b/.test(normalized)) {
        groups.push({ operator: 'OR', terms: ['karen', 'woman', 'girl'] });
    }

    if (/san bay|airport|airplane|may bay|flight|chuyen bay|passenger|hanh khach/.test(normalized)) {
        groups.push({ operator: 'OR', terms: ['airport', 'airplane', 'flight', 'passenger'] });
    }

    if (/sovereign citizen|sovereign|cong dan toi thuong|freeman/.test(normalized)) {
        groups.push({ operator: 'OR', terms: ['sovereign citizen', 'sovereign', 'freeman'] });
    }

    if (/bi bat|bat giu|arrest|arrested|detain|detained|police|canh sat/.test(normalized)) {
        groups.push({ operator: 'OR', terms: ['arrested', 'arrest', 'police', 'detained'] });
    }

    if (/gay roi|noi loan|disturb|disturbance|meltdown|argument|argue/.test(normalized)) {
        groups.push({ operator: 'OR', terms: ['disturbance', 'meltdown', 'argument'] });
    }

    return groups.slice(0, 3);
}

function formatFallbackWarning(error) {
    const message = error?.message || String(error || 'Lỗi không xác định');
    if (/JSON|AI không trả về JSON|Expected|Unexpected|parse/i.test(message)) {
        return `AI trả JSON lỗi, đã dùng bộ từ khóa cơ bản. ${message}`;
    }
    if (/Ollama|fetch|connect|abort|timeout|phản hồi lỗi/i.test(message)) {
        return `Không kết nối được AI, đã dùng bộ từ khóa cơ bản. ${message}`;
    }
    return `AI không tạo được bộ từ khóa hợp lệ, đã dùng bộ từ khóa cơ bản. ${message}`;
}

async function generatePlanWithOllama(topic, corpusHints = [], listInfo = { explicit: false, terms: [] }) {
    const baseUrl = process.env.OLLAMA_BASE_URL || process.env.OLLAMA_HOST || 'http://localhost:11434';
    const model = process.env.SEARCH_OLLAMA_MODEL || process.env.OLLAMA_MODEL || process.env.V3_OLLAMA_MODEL || DEFAULT_MODEL;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    const hintText = corpusHints
        .slice(0, 80)
        .map(item => typeof item === 'string' ? item : item.word)
        .filter(Boolean)
        .join(', ');
    const explicitInstruction = listInfo.explicit
        ? [
            `The user entered an explicit keyword list: ${listInfo.terms.join(', ')}.`,
            'Treat each listed item as a separate required facet by default.',
            'You may merge multiple listed items into one OR group only if they are the same concept and substitutable alternatives, not different attributes that must co-exist.',
            'For explicit keyword lists, include "sourceTerms", "relation", and "confidence" on each group.',
            'Use relation "same_concept" only for true synonyms or same-role alternatives. Use relation "separate_attribute" for different required attributes.',
        ].join(' ')
        : '';

    try {
        const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            cache: 'no-store',
            body: JSON.stringify({
                model,
                stream: false,
                format: 'json',
                options: {
                    temperature: 0.1,
                    top_p: 0.9,
                    num_predict: 700,
                },
                messages: [
                    {
                        role: 'system',
                        content: [
                            'You generate advanced video-search keyword plans.',
                            'Return only valid JSON.',
                            'Schema: {"rootOperator":"AND","groups":[{"operator":"OR","terms":["term"],"sourceTerms":["original term"],"relation":"same_concept","confidence":0.9}]}',
                            'Use only these relation values: "same_concept", "same_role_alternatives", or "separate_attribute".',
                            'Extract only core searchable keyword facets: subject/person/entity, location/object/context, and distinctive action if it is important.',
                            'Each group is one facet and should use operator "OR" for close synonyms.',
                            'Synonym rule: put terms in the same OR group only if they are the same concept, object, role, location, context, or same-attribute alternatives.',
                            'Compound attribute rule: do not put different required attributes in the same OR group. If two words describe different dimensions that must co-exist, split them into separate groups connected by rootOperator AND.',
                            'Different dimensions include person/role, condition/state, action/result, object/tool, location/context, time, and victim/offender role.',
                            'Do not group a person/role term with a condition, action, object, or location term. If unsure whether terms are substitutable, split them.',
                            'Example: driver and drunk are not synonyms. They are two required attributes of a drunk driver, so use separate groups.',
                            'Example: man and drunk are not synonyms. Man is a person/role and drunk is a condition, so use separate groups.',
                            'Example: airport and karen are not synonyms. Airport is a location/context and karen is a person/role, so use separate groups.',
                            'Example: police and arrested are not synonyms. One is an actor/context and one is an action/result, so use separate groups when both are required.',
                            'Ambiguous same-attribute alternatives like man/woman or young/old may be one OR group if the user means either value is acceptable.',
                            'Use rootOperator "AND" when there are 2 or more required facets.',
                            'Keep only key nouns, named phrases, locations, objects, roles, and concrete actions.',
                            'Terms must be 1 or 2 words. Keep exact 2-word entities like "sovereign citizen".',
                            'Use normal spaces in multi-word terms, not underscores, slashes, or camelCase.',
                            'Avoid generic words: video, viral, incident, case, story, public, compilation, caught on camera, people.',
                            'Do not add weak abstract terms.',
                            'Prefer terms that are likely to exist in the project corpus. The corpus uses PostgreSQL simple full-text search, so there is no stemming, no synonym expansion, and no accent folding.',
                            'If the input is Vietnamese, include Vietnamese terms in both accented and unaccented forms when they are core keywords, plus English equivalents only when they are likely searchable.',
                            explicitInstruction,
                            hintText ? `High-frequency corpus lexemes for reference: ${hintText}.` : '',
                            'Example topic "karen gây rối ở sân bay": {"rootOperator":"AND","groups":[{"operator":"OR","terms":["airport","airplane","flight","passenger"],"sourceTerms":["sân bay"],"relation":"same_concept","confidence":0.9},{"operator":"OR","terms":["karen","woman","girl"],"sourceTerms":["karen"],"relation":"same_concept","confidence":0.85}]}',
                            'Example topic "sovereign citizen bị bắt": {"rootOperator":"AND","groups":[{"operator":"OR","terms":["sovereign citizen","sovereign","freeman"],"sourceTerms":["sovereign citizen"],"relation":"same_concept","confidence":0.9},{"operator":"OR","terms":["arrested","arrest","police","detained"],"sourceTerms":["bị bắt"],"relation":"same_concept","confidence":0.82}]}',
                            'Example explicit keyword list "driver, drunk, taser": {"rootOperator":"AND","groups":[{"operator":"OR","terms":["driver","motorist"],"sourceTerms":["driver"],"relation":"same_concept","confidence":0.9},{"operator":"OR","terms":["drunk","intoxicated","alcohol"],"sourceTerms":["drunk"],"relation":"same_concept","confidence":0.9},{"operator":"OR","terms":["taser","electroshock","tased"],"sourceTerms":["taser"],"relation":"same_concept","confidence":0.9}]}',
                            'Example topic "man drunk taser": {"rootOperator":"AND","groups":[{"operator":"OR","terms":["man","male"],"sourceTerms":["man"],"relation":"same_concept","confidence":0.85},{"operator":"OR","terms":["drunk","intoxicated","alcohol"],"sourceTerms":["drunk"],"relation":"same_concept","confidence":0.9},{"operator":"OR","terms":["taser","tased"],"sourceTerms":["taser"],"relation":"same_concept","confidence":0.9}]}',
                            'Example topic "airport karen woman": {"rootOperator":"AND","groups":[{"operator":"OR","terms":["airport","airplane","flight","passenger"],"sourceTerms":["airport"],"relation":"same_concept","confidence":0.9},{"operator":"OR","terms":["karen","woman","girl"],"sourceTerms":["karen","woman"],"relation":"same_role_alternatives","confidence":0.85}]}',
                            'Example explicit keyword list "cop, police, officer": {"rootOperator":"AND","groups":[{"operator":"OR","terms":["cop","police","officer"],"sourceTerms":["cop","police","officer"],"relation":"same_concept","confidence":0.9}]}',
                            'No explanations, no markdown.',
                        ].join(' '),
                    },
                    {
                        role: 'user',
                        content: `Topic: ${topic}`,
                    },
                ],
            }),
        });

        if (!response.ok) {
            throw new Error(`Ollama phản hồi lỗi ${response.status}.`);
        }

        const data = await response.json();
        const content = data?.message?.content || data?.response || '';
        const parsed = extractJsonObject(content);
        const processed = listInfo.explicit
            ? postProcessExplicitKeywordPlan(parsed, listInfo.terms)
            : { plan: normalizeAdvancedSearchPlan(parsed), metadata: { explicit_keyword_list: false, explicit_terms: [], auto_corrected_groups: [] } };
        const plan = processed.plan;

        if (!plan) {
            throw new Error('AI không tạo được nhóm từ khóa hợp lệ.');
        }

        return { plan, model, planMetadata: processed.metadata };
    } finally {
        clearTimeout(timer);
    }
}

export async function POST(request) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json().catch(() => ({}));
        const topic = compactText(body?.topic).slice(0, MAX_TOPIC_LENGTH);
        const listInfo = detectExplicitKeywordList(topic);

        if (topic.length < 2) {
            return NextResponse.json({ error: 'Vui lòng nhập chủ đề rõ hơn.' }, { status: 400 });
        }

        let generated;
        let corpusHints = [];
        let corpusWarning = null;
        try {
            corpusHints = await getTopSearchLexemes(80, 'fts_no_caption');
        } catch (error) {
            corpusWarning = `Không đọc được corpus lexeme hints: ${error.message}`;
        }

        try {
            generated = await generatePlanWithOllama(topic, corpusHints, listInfo);
        } catch (error) {
            const plan = fallbackPlan(topic, listInfo);
            if (!plan) {
                throw error;
            }
            generated = {
                plan,
                model: null,
                planMetadata: {
                    explicit_keyword_list: listInfo.explicit,
                    explicit_terms: listInfo.terms,
                    auto_corrected_groups: [],
                    fallback_used: true,
                },
                warning: formatFallbackWarning(error),
            };
        }

        return NextResponse.json({
            topic,
            plan: generated.plan,
            terms: getTermsFromPlan(generated.plan),
            displayQuery: formatDisplayQuery(generated.plan),
            model: generated.model,
            warning: generated.warning || corpusWarning || null,
            planMetadata: generated.planMetadata || null,
            corpusHints: corpusHints.slice(0, 20),
        });
    } catch (error) {
        return NextResponse.json(
            { error: error.message || 'Không tạo được bộ từ khóa nâng cao.' },
            { status: 500 }
        );
    }
}
