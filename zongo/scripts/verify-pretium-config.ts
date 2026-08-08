import { verifyPretiumRuntimeConfiguration } from '@app/partner';

const result = verifyPretiumRuntimeConfiguration(process.env);
console.log(
  JSON.stringify(
    {
      verifiedAt: new Date().toISOString(),
      ...result,
      note: 'Read-only runtime configuration evidence. This command never prints credentials and does not certify the Pretium account or perform a live transfer.',
    },
    null,
    2,
  ),
);
if (result.status !== 'PASS') process.exitCode = 1;
