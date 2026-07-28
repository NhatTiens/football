import { prisma } from '@football-ai/database';

import {
  captureDueCurrentSignalSnapshots,
  getCurrentSignalSnapshotCoverage,
  getCurrentSignalSnapshotEvidence,
  planDueCurrentSignalSnapshots,
} from './current-signal-snapshot-engine.js';

function command(): string {
  return (
    process.argv[2] ??
    'preview'
  )
    .trim()
    .toLowerCase();
}

function argument(
  name: string,
): string | null {
  const prefix =
    `--${name}=`;

  return (
    process.argv.find(
      (value: string): boolean =>
        value.startsWith(
          prefix,
        ),
    )?.slice(
      prefix.length,
    ) ??
    null
  );
}

function fixtureIds(): number[] | undefined {
  const raw =
    argument('fixture');

  if (raw == null) {
    return undefined;
  }

  const values =
    raw
      .split(',')
      .map(
        (value: string): number =>
          Number(value.trim()),
      )
      .filter(
        (value: number): boolean =>
          Number.isSafeInteger(
            value,
          ) &&
          value > 0,
      );

  if (values.length === 0) {
    throw new Error(
      '--fixture must contain one or more positive provider fixture IDs.',
    );
  }

  return [
    ...new Set(values),
  ];
}

function singleFixtureId(): number | undefined {
  return fixtureIds()?.[0];
}

function limit(): number | undefined {
  const raw =
    argument('limit');

  if (raw == null) {
    return undefined;
  }

  const value =
    Number(raw);

  if (
    !Number.isSafeInteger(
      value,
    ) ||
    value < 1
  ) {
    throw new Error(
      '--limit must be a positive integer.',
    );
  }

  return value;
}

async function main(): Promise<void> {
  const selectedCommand =
    command();

  if (
    selectedCommand ===
    'preview'
  ) {
    console.log(
      JSON.stringify(
        await planDueCurrentSignalSnapshots({
          providerFixtureIds:
            fixtureIds(),
        }),
        null,
        2,
      ),
    );

    return;
  }

  if (
    selectedCommand ===
    'capture-due'
  ) {
    console.log(
      JSON.stringify(
        await captureDueCurrentSignalSnapshots({
          providerFixtureIds:
            fixtureIds(),
        }),
        null,
        2,
      ),
    );

    return;
  }

  if (
    selectedCommand ===
    'evidence'
  ) {
    console.log(
      JSON.stringify(
        await getCurrentSignalSnapshotEvidence({
          providerFixtureId:
            singleFixtureId(),
          limit:
            limit(),
        }),
        null,
        2,
      ),
    );

    return;
  }

  if (
    selectedCommand ===
    'coverage'
  ) {
    console.log(
      JSON.stringify(
        await getCurrentSignalSnapshotCoverage(),
        null,
        2,
      ),
    );

    return;
  }

  throw new Error(
    'Use preview, capture-due, evidence, or coverage.',
  );
}

main()
  .catch(
    (error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    },
  )
  .finally(async () => {
    await prisma.$disconnect();
  });
