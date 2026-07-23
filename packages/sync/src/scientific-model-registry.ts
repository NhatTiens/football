import { prisma, type InputJsonValue } from '@football-ai/database';
import {
  SCIENTIFIC_MODEL_KEY,
  type ScientificModelArtifact,
} from './scientific-model.js';
import { stableScientificArtifactId } from './scientific-v61.js';

export const SCIENTIFIC_MODEL_REGISTRY_KEY = 'SCIENTIFIC_MODEL_REGISTRY_V61';
export const SCIENTIFIC_MODEL_ALIAS_KEY = 'SCIENTIFIC_MODEL_ALIASES_V61';
const ARTIFACT_KEY_PREFIX = 'SCIENTIFIC_MODEL_ARTIFACT_V61_';

export interface ScientificArtifactMetadata {
  artifactId: string;
  version: string;
  trainedAt: string;
  trainedThrough: string;
  sampleSize: number;
  randomSeed: number | null;
  validationSampleSize: number | null;
  validationMetrics: ScientificModelArtifact['validationMetrics'] | null;
  purpose: string;
  foldIndex?: number;
  trainingLimit?: number;
  savedAt: string;
}

interface StoredScientificArtifact {
  artifact: ScientificModelArtifact;
  metadata: ScientificArtifactMetadata;
}

function parseMetadataList(value: unknown): ScientificArtifactMetadata[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is ScientificArtifactMetadata => {
    if (!entry || typeof entry !== 'object') return false;
    const record = entry as Record<string, unknown>;
    return (
      typeof record.artifactId === 'string' &&
      typeof record.version === 'string' &&
      typeof record.trainedThrough === 'string' &&
      typeof record.sampleSize === 'number'
    );
  });
}

function parseAliases(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

function artifactSettingKey(artifactId: string): string {
  // MySQL AppSetting keys are commonly VARCHAR(191); keep deterministic IDs short.
  return `${ARTIFACT_KEY_PREFIX}${artifactId}`.slice(0, 188);
}

export async function saveScientificModelArtifact(input: {
  artifact: ScientificModelArtifact;
  purpose?: string;
  foldIndex?: number;
  trainingLimit?: number;
  aliases?: string[];
}): Promise<ScientificArtifactMetadata> {
  const artifactId = stableScientificArtifactId({
    version: input.artifact.version,
    trainedThrough: input.artifact.trainedThrough,
    sampleSize: input.artifact.sampleSize,
    ...(input.artifact.randomSeed === undefined
      ? {}
      : { randomSeed: input.artifact.randomSeed }),
  });
  const savedAt = new Date().toISOString();
  const metadata: ScientificArtifactMetadata = {
    artifactId,
    version: input.artifact.version,
    trainedAt: input.artifact.trainedAt,
    trainedThrough: input.artifact.trainedThrough,
    sampleSize: input.artifact.sampleSize,
    randomSeed: input.artifact.randomSeed ?? null,
    validationSampleSize: input.artifact.validationSampleSize ?? null,
    validationMetrics: input.artifact.validationMetrics ?? null,
    purpose: input.purpose ?? 'training',
    ...(input.foldIndex === undefined ? {} : { foldIndex: input.foldIndex }),
    ...(input.trainingLimit === undefined
      ? {}
      : { trainingLimit: input.trainingLimit }),
    savedAt,
  };

  const stored: StoredScientificArtifact = {
    artifact: input.artifact,
    metadata,
  };
  await prisma.appSetting.upsert({
    where: { key: artifactSettingKey(artifactId) },
    update: { value: stored as unknown as InputJsonValue },
    create: {
      key: artifactSettingKey(artifactId),
      value: stored as unknown as InputJsonValue,
    },
  });

  const registry = await prisma.appSetting.findUnique({
    where: { key: SCIENTIFIC_MODEL_REGISTRY_KEY },
  });
  const existing = parseMetadataList(registry?.value);
  const requestedRetention = Number(
    process.env.SCIENTIFIC_ARTIFACT_RETENTION ?? 50,
  );
  const retention = Number.isFinite(requestedRetention)
    ? Math.max(5, Math.floor(requestedRetention))
    : 50;
  const next = [metadata, ...existing.filter((row) => row.artifactId !== artifactId)]
    .sort((left, right) => right.savedAt.localeCompare(left.savedAt))
    .slice(0, retention);
  await prisma.appSetting.upsert({
    where: { key: SCIENTIFIC_MODEL_REGISTRY_KEY },
    update: { value: next as unknown as InputJsonValue },
    create: {
      key: SCIENTIFIC_MODEL_REGISTRY_KEY,
      value: next as unknown as InputJsonValue,
    },
  });

  for (const alias of input.aliases ?? []) {
    await setScientificModelAlias(alias, artifactId);
  }
  return metadata;
}

export async function listScientificModelArtifacts(): Promise<
  ScientificArtifactMetadata[]
> {
  const setting = await prisma.appSetting.findUnique({
    where: { key: SCIENTIFIC_MODEL_REGISTRY_KEY },
  });
  return parseMetadataList(setting?.value);
}

export async function loadScientificModelArtifact(
  artifactIdOrAlias: string,
): Promise<StoredScientificArtifact | null> {
  const aliasesSetting = await prisma.appSetting.findUnique({
    where: { key: SCIENTIFIC_MODEL_ALIAS_KEY },
  });
  const aliases = parseAliases(aliasesSetting?.value);
  const artifactId = aliases[artifactIdOrAlias] ?? artifactIdOrAlias;
  const setting = await prisma.appSetting.findUnique({
    where: { key: artifactSettingKey(artifactId) },
  });
  if (!setting?.value || typeof setting.value !== 'object') return null;
  const stored = setting.value as unknown as StoredScientificArtifact;
  if (!stored.artifact || !stored.metadata) return null;
  return stored;
}

export async function setScientificModelAlias(
  alias: string,
  artifactId: string,
): Promise<void> {
  const normalizedAlias = alias.trim().toLowerCase();
  if (!normalizedAlias) throw new Error('Scientific model alias cannot be empty.');
  const current = await prisma.appSetting.findUnique({
    where: { key: SCIENTIFIC_MODEL_ALIAS_KEY },
  });
  const aliases = parseAliases(current?.value);
  aliases[normalizedAlias] = artifactId;
  await prisma.appSetting.upsert({
    where: { key: SCIENTIFIC_MODEL_ALIAS_KEY },
    update: { value: aliases as unknown as InputJsonValue },
    create: {
      key: SCIENTIFIC_MODEL_ALIAS_KEY,
      value: aliases as unknown as InputJsonValue,
    },
  });
}

export async function registerCurrentProductionArtifact(
  purpose = 'production-training',
): Promise<ScientificArtifactMetadata | null> {
  const setting = await prisma.appSetting.findUnique({
    where: { key: SCIENTIFIC_MODEL_KEY },
  });
  if (!setting?.value || typeof setting.value !== 'object') return null;
  const artifact = setting.value as unknown as ScientificModelArtifact;
  if (!artifact.version || !artifact.trainedThrough) return null;
  return saveScientificModelArtifact({
    artifact,
    purpose,
    aliases: ['latest', 'champion'],
  });
}
