import { prisma } from '@football-ai/database';
import {
  freezeScientificBankrollRiskPolicy,
  getScientificBankrollRiskCoverage,
  getScientificBankrollRiskReadiness,
  planUnallocatedScientificPaperStakes,
  runScientificBankrollRiskCycle,
  syncScientificBankrollSettlements,
} from './bankroll-risk-engine.js';

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'readiness';
  if (command === 'readiness') {
    console.dir(await getScientificBankrollRiskReadiness(), { depth: null });
    return;
  }
  if (command === 'freeze-policy') {
    console.dir(await freezeScientificBankrollRiskPolicy(), { depth: null });
    return;
  }
  if (command === 'plan') {
    console.dir(await planUnallocatedScientificPaperStakes(), { depth: null });
    return;
  }
  if (command === 'settle') {
    console.dir(await syncScientificBankrollSettlements(), { depth: null });
    return;
  }
  if (command === 'coverage') {
    console.dir(await getScientificBankrollRiskCoverage(), { depth: null });
    return;
  }
  if (command === 'cycle') {
    console.dir(await runScientificBankrollRiskCycle(), { depth: null });
    return;
  }
  throw new Error(`Unknown bankroll risk command: ${command}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
