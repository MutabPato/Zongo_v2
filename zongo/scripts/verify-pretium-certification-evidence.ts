import { readFile } from 'node:fs/promises';
import {
  verifyPretiumCertificationEvidence,
  type PretiumCertificationEvidencePack,
} from '@app/partner';

async function main(): Promise<void> {
  const path = process.env.PRETIUM_CERTIFICATION_EVIDENCE_PACK?.trim();
  if (!path)
    throw new Error(
      'PRETIUM_CERTIFICATION_EVIDENCE_PACK must point to an operator-owned JSON evidence pack',
    );

  const pack = JSON.parse(
    await readFile(path, 'utf8'),
  ) as Partial<PretiumCertificationEvidencePack>;
  const result = verifyPretiumCertificationEvidence(pack);
  console.log(
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        ...result,
        note: 'Completeness verification only. This command does not perform live Pretium calls, certify account terms, or release the pilot.',
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
      : 'Pretium certification evidence verification failed',
  );
  process.exitCode = 1;
});
