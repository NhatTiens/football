import { sha256, stableStringify } from './hybrid-data-foundation-contract.js';

export const HYBRID_MODEL_VERSION = 'v8.0-stage4-market-aware-hybrid-model-v1';
export const HYBRID_MODEL_REGISTRY_VERSION = 'v8.0-stage4-champion-challenger-registry-v1';

export type HybridComponentName = 'BAYESIAN' | 'DIXON_COLES' | 'ML_SPECIALIST';
export type HybridMarketName = 'HDA' | 'BTTS' | 'TOTAL_GOALS';
export type HybridSelectionName =
  | 'HOME'
  | 'DRAW'
  | 'AWAY'
  | 'YES'
  | 'NO'
  | 'BELOW'
  | 'PUSH'
  | 'ABOVE';

export interface HybridModelComponent {
  component: HybridComponentName;
  modelVersion: string;
  probabilities: Partial<Record<HybridSelectionName, number>>;
}

export interface HybridWeightRegistry {
  version: string;
  baseWeights: Record<HybridMarketName, Record<HybridComponentName, number>>;
  horizonMultipliers: Array<{
    minimumMinutes: number;
    maximumMinutes: number;
    multipliers: Record<HybridComponentName, number>;
  }>;
  leagueMultipliers: Record<string, Partial<Record<HybridComponentName, number>>>;
}

export interface HybridMarketPrediction {
  version: string;
  registryVersion: string;
  market: HybridMarketName;
  line: number | null;
  rawProbability: Record<string, number>;
  componentProbabilities: Array<{
    component: HybridComponentName;
    modelVersion: string;
    probabilities: Record<string, number>;
  }>;
  componentWeights: Record<string, number>;
  selectedModel: 'WEIGHTED_ENSEMBLE' | HybridComponentName;
  fallbackReason: string[];
  componentDisagreement: number;
  modelVersion: string;
}

export const DEFAULT_HYBRID_WEIGHT_REGISTRY: HybridWeightRegistry = {
  version: HYBRID_MODEL_REGISTRY_VERSION,
  baseWeights: {
    HDA: { BAYESIAN: 0.45, DIXON_COLES: 0.3, ML_SPECIALIST: 0.25 },
    BTTS: { BAYESIAN: 0.5, DIXON_COLES: 0.3, ML_SPECIALIST: 0.2 },
    TOTAL_GOALS: { BAYESIAN: 0.5, DIXON_COLES: 0.35, ML_SPECIALIST: 0.15 },
  },
  horizonMultipliers: [
    {
      minimumMinutes: 90,
      maximumMinutes: Number.MAX_SAFE_INTEGER,
      multipliers: { BAYESIAN: 1.15, DIXON_COLES: 1, ML_SPECIALIST: 0.75 },
    },
    {
      minimumMinutes: 0,
      maximumMinutes: 10,
      multipliers: { BAYESIAN: 0.9, DIXON_COLES: 0.95, ML_SPECIALIST: 1.2 },
    },
  ],
  leagueMultipliers: {},
};

const EXPECTED_SELECTIONS: Record<HybridMarketName, HybridSelectionName[]> = {
  HDA: ['HOME', 'DRAW', 'AWAY'],
  BTTS: ['YES', 'NO'],
  TOTAL_GOALS: ['BELOW', 'PUSH', 'ABOVE'],
};

function finiteProbability(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function normalize(
  probabilities: Partial<Record<HybridSelectionName, number>>,
  selections: HybridSelectionName[],
): Record<string, number> {
  const values = selections.map((selection) => finiteProbability(probabilities[selection]));
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 1e-12) {
    throw new Error(`Component probabilities are empty for ${selections.join('/')}.`);
  }
  return Object.fromEntries(
    selections.map((selection, index) => [selection, values[index]! / total]),
  );
}

function horizonMultipliers(
  registry: HybridWeightRegistry,
  horizonMinutes: number,
): Record<HybridComponentName, number> {
  const row = registry.horizonMultipliers.find(
    (candidate) =>
      horizonMinutes >= candidate.minimumMinutes && horizonMinutes <= candidate.maximumMinutes,
  );
  return row?.multipliers ?? { BAYESIAN: 1, DIXON_COLES: 1, ML_SPECIALIST: 1 };
}

export function resolveHybridComponentWeights(input: {
  market: HybridMarketName;
  leagueId: number;
  horizonMinutes: number;
  availableComponents: readonly HybridComponentName[];
  registry?: HybridWeightRegistry;
}): Record<HybridComponentName, number> {
  const registry = input.registry ?? DEFAULT_HYBRID_WEIGHT_REGISTRY;
  const available = new Set(input.availableComponents);
  const horizon = horizonMultipliers(registry, input.horizonMinutes);
  const league = registry.leagueMultipliers[String(input.leagueId)] ?? {};
  const raw = (['BAYESIAN', 'DIXON_COLES', 'ML_SPECIALIST'] as const).map((component) => [
    component,
    available.has(component)
      ? Math.max(
          0,
          registry.baseWeights[input.market][component] *
            horizon[component] *
            (league[component] ?? 1),
        )
      : 0,
  ] as const);
  const total = raw.reduce((sum, row) => sum + row[1], 0);
  if (total <= 1e-12) throw new Error(`No available hybrid component for ${input.market}.`);
  return Object.fromEntries(raw.map(([component, value]) => [component, value / total])) as Record<
    HybridComponentName,
    number
  >;
}

export function buildHybridMarketPrediction(input: {
  market: HybridMarketName;
  line?: number | null;
  leagueId: number;
  horizonMinutes: number;
  components: HybridModelComponent[];
  registry?: HybridWeightRegistry;
}): HybridMarketPrediction {
  if (input.components.length === 0) throw new Error('At least one hybrid component is required.');
  const registry = input.registry ?? DEFAULT_HYBRID_WEIGHT_REGISTRY;
  const selections = EXPECTED_SELECTIONS[input.market];
  const normalizedComponents = input.components.map((component) => ({
    component: component.component,
    modelVersion: component.modelVersion,
    probabilities: normalize(component.probabilities, selections),
  }));
  const weights = resolveHybridComponentWeights({
    market: input.market,
    leagueId: input.leagueId,
    horizonMinutes: input.horizonMinutes,
    availableComponents: normalizedComponents.map((row) => row.component),
    registry,
  });
  const blended = Object.fromEntries(
    selections.map((selection) => [
      selection,
      normalizedComponents.reduce(
        (sum, component) =>
          sum + weights[component.component] * component.probabilities[selection]!,
        0,
      ),
    ]),
  );
  const rawProbability = normalize(blended, selections);
  const componentDisagreement = Math.sqrt(
    selections.reduce(
      (selectionSum, selection) =>
        selectionSum +
        normalizedComponents.reduce(
          (sum, component) =>
            sum +
            weights[component.component] *
              (component.probabilities[selection]! - rawProbability[selection]!) ** 2,
          0,
        ),
      0,
    ) / selections.length,
  );
  const available = new Set(normalizedComponents.map((row) => row.component));
  const fallbackReason: string[] = [];
  for (const component of ['BAYESIAN', 'DIXON_COLES', 'ML_SPECIALIST'] as const) {
    if (!available.has(component)) fallbackReason.push(`${component}_UNAVAILABLE`);
  }
  if (normalizedComponents.length === 1) fallbackReason.push('SINGLE_COMPONENT_FALLBACK');
  const selectedModel =
    normalizedComponents.length === 1
      ? normalizedComponents[0]!.component
      : 'WEIGHTED_ENSEMBLE';

  return {
    version: HYBRID_MODEL_VERSION,
    registryVersion: registry.version,
    market: input.market,
    line: input.line ?? null,
    rawProbability,
    componentProbabilities: normalizedComponents,
    componentWeights: Object.fromEntries(
      normalizedComponents.map((row) => [row.component, weights[row.component]]),
    ),
    selectedModel,
    fallbackReason,
    componentDisagreement,
    modelVersion: HYBRID_MODEL_VERSION,
  };
}

export function hybridMarketPredictionHash(prediction: HybridMarketPrediction): string {
  return sha256(stableStringify(prediction));
}
