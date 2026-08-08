/// <reference types="node" />
import { readFile } from 'node:fs/promises';
import {
  verifyOperationsEvidence,
  type OperationsEvidencePack,
} from '@app/observability';

async function main(): Promise<void> {
  const path = process.env.OPERATIONS_EVIDENCE_PACK;
  if (!path)
    throw new Error(
      'Set OPERATIONS_EVIDENCE_PACK to a JSON evidence-pack path',
    );
  const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
  const pack =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : {};
  const result = verifyOperationsEvidence(pack as OperationsEvidencePack);
  console.log(
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        ...result,
        note: 'Read-only operations evidence verification. It does not run a backup, restore, incident exercise, or release the pilot.',
      },
      null,
      2,
    ),
  );
  if (result.status !== 'PASS') process.exitCode = 1;
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error
      ? error.message
      : 'Operations evidence verification failed',
  );
  process.exitCode = 1;
});
