import type {
    PatternCondition,
    PatternExample,
    PatternFeatureKey,
    PatternFeatureValue,
    PatternSelection,
} from './types';

const DEFAULT_SELECTION: PatternSelection = {
    conditions: [],
    heldOutImprovement: 0,
    baselineRate: 0,
    selectedRate: 0,
    support: 0,
};

const REDUNDANT_GROUPS: PatternFeatureKey[][] = [
    ['time.halfHour', 'sun.sunriseOffset', 'sun.sunsetOffset', 'sun.elevationBand'],
];

function matches(example: PatternExample, conditions: PatternCondition[]): boolean {
    return conditions.every(condition => example.features.values[condition.feature] === condition.value);
}

function rate(examples: PatternExample[]): number {
    return (examples.filter(example => example.matched).length + 1) / (examples.length + 2);
}

function brier(
    examples: PatternExample[],
    baseline: number,
    conditions: PatternCondition[],
    branchRate: number,
): number {
    if (!examples.length) {
        return 1;
    }
    return (
        examples.reduce((sum, example) => {
            const probability = matches(example, conditions) ? branchRate : baseline;
            return sum + (probability - Number(example.matched)) ** 2;
        }, 0) / examples.length
    );
}

function combinations<T>(values: T[], maximum: number): T[][] {
    const result: T[][] = [];
    const visit = (start: number, selected: T[]): void => {
        if (selected.length) {
            result.push(selected);
        }
        if (selected.length === maximum) {
            return;
        }
        for (let index = start; index < values.length; index++) {
            visit(index + 1, [...selected, values[index]]);
        }
    };
    visit(0, []);
    return result;
}

function isRedundant(conditions: PatternCondition[]): boolean {
    return REDUNDANT_GROUPS.some(group => conditions.filter(condition => group.includes(condition.feature)).length > 1);
}

function atomKey(feature: PatternFeatureKey, value: PatternFeatureValue): string {
    return `${feature}:${typeof value}:${String(value)}`;
}

/** Select the smallest deterministic condition set that improves held-out prediction. */
export function selectPatternFeatures(
    examples: PatternExample[],
    options: { minimumBranchSupport?: number; minimumImprovement?: number; maximumConditions?: number } = {},
): PatternSelection {
    if (examples.length < 8) {
        return { ...DEFAULT_SELECTION };
    }
    const sorted = [...examples].sort((left, right) => left.timestamp - right.timestamp);
    const split = Math.max(5, Math.min(sorted.length - 3, Math.floor(sorted.length * 0.7)));
    const training = sorted.slice(0, split);
    const heldOut = sorted.slice(split);
    const baselineRate = rate(training);
    const baselineBrier = brier(heldOut, baselineRate, [], baselineRate);
    const atoms = new Map<string, { condition: PatternCondition; positiveSupport: number }>();
    for (const example of training.filter(item => item.matched)) {
        for (const [feature, value] of Object.entries(example.features.values)) {
            if (value !== undefined) {
                const key = atomKey(feature as PatternFeatureKey, value);
                const existing = atoms.get(key);
                atoms.set(key, {
                    condition: { feature: feature as PatternFeatureKey, value },
                    positiveSupport: (existing?.positiveSupport ?? 0) + 1,
                });
            }
        }
    }
    const minimumSupport = options.minimumBranchSupport ?? 3;
    const minimumImprovement = options.minimumImprovement ?? 0.025;
    const candidates = combinations(
        [...atoms.values()]
            .filter(atom => atom.positiveSupport >= minimumSupport)
            .sort(
                (left, right) =>
                    right.positiveSupport - left.positiveSupport ||
                    atomKey(left.condition.feature, left.condition.value).localeCompare(
                        atomKey(right.condition.feature, right.condition.value),
                    ),
            )
            .slice(0, 24)
            .map(atom => atom.condition),
        options.maximumConditions ?? 3,
    ).filter(conditions => !isRedundant(conditions));
    let best: (PatternSelection & { penalized: number }) | undefined;
    for (const conditions of candidates) {
        const trainingBranch = training.filter(example => matches(example, conditions));
        const heldOutBranch = heldOut.filter(example => matches(example, conditions));
        if (trainingBranch.length < minimumSupport || heldOutBranch.length < 2) {
            continue;
        }
        const selectedRate = rate(trainingBranch);
        if (selectedRate <= baselineRate) {
            continue;
        }
        const improvement = baselineBrier - brier(heldOut, baselineRate, conditions, selectedRate);
        const penalized = improvement - conditions.length * 0.01;
        if (improvement < minimumImprovement) {
            continue;
        }
        const selection = {
            conditions,
            heldOutImprovement: improvement,
            baselineRate,
            selectedRate,
            support: trainingBranch.length + heldOutBranch.length,
            penalized,
        };
        if (
            !best ||
            selection.penalized > best.penalized + 1e-9 ||
            (Math.abs(selection.penalized - best.penalized) <= 1e-9 && conditions.length < best.conditions.length)
        ) {
            best = selection;
        }
    }
    return best ?? { ...DEFAULT_SELECTION, baselineRate };
}
