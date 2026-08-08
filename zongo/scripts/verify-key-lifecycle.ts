import { verifyKeyLifecycle } from '@app/security';

async function main(): Promise<void> {
  if (process.env.ALLOW_KEY_LIFECYCLE_VERIFICATION !== 'true')
    throw new Error(
      'Set ALLOW_KEY_LIFECYCLE_VERIFICATION=true to run the read-only key lifecycle verification',
    );

  const result = verifyKeyLifecycle(process.env);
  console.log(
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        ...result,
        note: 'Read-only key configuration evidence; this does not replace managed secret-manager approval, rotation execution, or access-audit review.',
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
      : 'Key lifecycle verification failed',
  );
  process.exitCode = 1;
});
