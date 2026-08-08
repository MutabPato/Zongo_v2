import { readFile } from 'node:fs/promises';
import { verifyOpenBiometricsEvidence } from '@app/profile';

async function main(): Promise<void> {
  const path = process.env.OPENBIOMETRICS_EVIDENCE_PACK;
  if (!path)
    throw new Error(
      'Set OPENBIOMETRICS_EVIDENCE_PACK to a JSON evidence-pack path',
    );

  const pack = JSON.parse(await readFile(path, 'utf8')) as unknown;
  const result = verifyOpenBiometricsEvidence(
    pack && typeof pack === 'object' && !Array.isArray(pack) ? pack : {},
  );
  console.log(
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        ...result,
        note: 'Read-only evidence-pack verification. This command does not run biometric tests, approve a provider, or promote the pilot.',
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
      : 'OpenBiometrics evidence verification failed',
  );
  process.exitCode = 1;
});
