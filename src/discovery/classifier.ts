import type { EvidenceSource, SemanticClassification, SemanticEvidence, SemanticType, StateDescriptor } from './types';

interface CandidateScore {
    score: number;
    evidence: SemanticEvidence[];
}

const ROLE_RULES: Array<[RegExp, SemanticType, number]> = [
    [/^(switch|state)\.light/, 'light', 0.9],
    [/^level\.(dimmer|brightness)/, 'dimmer', 0.9],
    [/(sensor\.)?motion|motion\.sensor/, 'motion', 0.9],
    [/presence|occupancy/, 'presence', 0.85],
    [/illuminance|value\.brightness/, 'illuminance', 0.85],
    [/temperature/, 'temperature', 0.82],
    [/humidity/, 'humidity', 0.82],
    [/cloud/, 'cloudCover', 0.78],
    [/rain|precipitation/, 'precipitation', 0.82],
    [/wind/, 'windSpeed', 0.78],
    [/(door|window|contact)/, 'contact', 0.78],
    [/lock|access/, 'lock', 0.95],
    [/alarm|security/, 'alarm', 0.95],
];

const TOKEN_RULES: Array<[RegExp, SemanticType, number]> = [
    [/\b(light|lamp|lighting|licht|lampe|leuchte)\b/, 'light', 0.48],
    [/\b(dimmer|brightness level|dimm)/, 'dimmer', 0.48],
    [/\b(motion|movement|bewegung)\b/, 'motion', 0.5],
    [/\b(presence|occupancy|anwesen|belegt)\b/, 'presence', 0.48],
    [/\b(lux|illuminance|helligkeit|beleuchtungsstärke)\b/, 'illuminance', 0.5],
    [/\b(temperature|temperatur)\b/, 'temperature', 0.45],
    [/\b(humidity|feuchte|luftfeuchtigkeit)\b/, 'humidity', 0.45],
    [/\b(cloud|cloud cover|wolken|bewölkung)\b/, 'cloudCover', 0.48],
    [/\b(rain|raining|precipitation|regen|niederschlag)\b/, 'precipitation', 0.5],
    [/\b(wind|windspeed|windgeschwindigkeit)\b/, 'windSpeed', 0.48],
    [/\b(door|window|contact|tür|fenster|kontakt)\b/, 'contact', 0.42],
    [/\b(lock|locked|schloss|verriegel)/, 'lock', 0.65],
    [/\b(alarm|security|sicherheit|sirene)\b/, 'alarm', 0.65],
];

function normalized(parts: Array<string | undefined>): string {
    return parts
        .filter((part): part is string => !!part)
        .join(' ')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

function addScore(
    scores: Map<SemanticType, CandidateScore>,
    type: SemanticType,
    weight: number,
    source: EvidenceSource,
    value: string,
): void {
    const candidate = scores.get(type) ?? { score: 0, evidence: [] };
    candidate.score += weight;
    candidate.evidence.push({ source, value: value.slice(0, 120), weight });
    scores.set(type, candidate);
}

/** Conservatively classify a state from metadata only. */
export function classifyState(descriptor: StateDescriptor): SemanticClassification {
    const scores = new Map<SemanticType, CandidateScore>();
    const role = descriptor.role?.toLowerCase() ?? '';
    const nameText = normalized([descriptor.name, ...descriptor.ancestorNames]);
    const enumText = normalized([...descriptor.rooms, ...descriptor.functions]);
    const nativeText = normalized(descriptor.nativeHints);

    for (const [pattern, type, weight] of ROLE_RULES) {
        if (pattern.test(role)) {
            addScore(scores, type, weight, 'role', role);
        }
    }

    for (const [pattern, type, weight] of TOKEN_RULES) {
        if (pattern.test(nameText)) {
            addScore(scores, type, weight, 'name', nameText);
        }
        if (pattern.test(enumText)) {
            addScore(scores, type, weight * 0.55, 'enum', enumText);
        }
        if (pattern.test(nativeText)) {
            addScore(scores, type, weight * 0.35, 'native', nativeText);
        }
    }

    const unit = descriptor.unit?.trim().toLowerCase();
    if (unit === 'lx' || unit === 'lux') {
        addScore(scores, 'illuminance', 0.72, 'unit', unit);
    }
    if (unit === '°c' || unit === '°f') {
        addScore(scores, 'temperature', 0.68, 'unit', unit);
    }
    if (unit === '%') {
        if (/humid|feucht/.test(nameText + role)) {
            addScore(scores, 'humidity', 0.58, 'unit', unit);
        }
        if (/cloud|wolken|bewolk/.test(nameText + role)) {
            addScore(scores, 'cloudCover', 0.58, 'unit', unit);
        }
    }
    if (/^(m\/s|km\/h|mph)$/.test(unit ?? '')) {
        addScore(scores, 'windSpeed', 0.68, 'unit', unit ?? '');
    }

    if (descriptor.valueType === 'boolean' && descriptor.write && /switch/.test(role)) {
        addScore(scores, 'switch', 0.42, 'type', 'writable boolean switch');
    }

    const ranked = [...scores.entries()].sort((a, b) => b[1].score - a[1].score);
    const [best, second] = ranked;
    const hasEnoughEvidence = best && best[1].score >= 0.55;
    const hasClearMargin = !second || best[1].score - second[1].score >= 0.12;
    const type = hasEnoughEvidence && hasClearMargin ? best[0] : 'unknown';
    const evidence = type === 'unknown' ? (best?.[1].evidence ?? []) : best[1].evidence;
    const confidence = type === 'unknown' ? Math.min(best?.[1].score ?? 0, 0.49) : Math.min(best[1].score, 1);
    const sensitive =
        type === 'lock' ||
        type === 'alarm' ||
        /\b(access control|security|alarm|lock|schloss|zutritt)\b/.test(`${nameText} ${role} ${enumText}`);

    return { type, confidence: Number(confidence.toFixed(3)), evidence, sensitive };
}
