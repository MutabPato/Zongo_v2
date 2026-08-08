/// <reference types="node" />
import { readFile } from 'node:fs/promises';
import {
  verifyLocalE2eEvidence,
  type LocalE2eEvidencePack,
} from '@app/observability';

async function main(): Promise<void> {
  const path = process.env.LOCAL_E2E_EVIDENCE_PACK;
  if (!path)
    throw new Error('Set LOCAL_E2E_EVIDENCE_PACK to a JSON evidence-pack path');
  const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
  const pack =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : {};
  const result = verifyLocalE2eEvidence(pack as LocalE2eEvidencePack);
  console.log(
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        ...result,
        note: 'Read-only Local E2E evidence verification. It does not run tests, mutate transfers, or release the pilot.',
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
      : 'Local E2E evidence verification failed',
  );
  process.exitCode = 1;
});
