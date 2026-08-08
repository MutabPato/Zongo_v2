import { LOCAL_E2E_GATES, verifyLocalE2eEvidence } from './local-e2e-evidence';

describe('Local E2E evidence verification', () => {
  it('keeps an empty artifact incomplete', () => {
    expect(verifyLocalE2eEvidence({}).status).toBe('INCOMPLETE');
  });

  it('requires controlled run safety facts and every journey gate', () => {
    const result = verifyLocalE2eEvidence({
      commitOrImageDigest: 'not-a-commit',
      schemaHash: 'not-a-schema-hash',
      executedAt: 'not-a-timestamp',
      suitesPassed: 0,
      testsPassed: 0,
      workerStoppedDuringRun: false,
      workerRunningAfterRun: true,
      postgresHealthy: true,
      redisHealthy: true,
      controlledPartner: true,
      productionCredentialsUsed: true,
      externalNotificationsUsed: true,
      gateEvidence: {},
    });

    expect(result.missing).toEqual(
      expect.arrayContaining([
        'commitOrImageDigest',
        'schemaHash',
        'executedAt',
        'suitesPassed',
        'testsPassed',
        'workerStoppedDuringRun',
        'productionCredentialsUsed',
        'externalNotificationsUsed',
        ...LOCAL_E2E_GATES.map((gate) => `gateEvidence.${gate}`),
      ]),
    );
  });

  it('passes only with a complete controlled evidence artifact', () => {
    expect(
      verifyLocalE2eEvidence({
        commitOrImageDigest: 'a'.repeat(40),
        schemaHash: 'b'.repeat(64),
        executedAt: '2026-08-08T23:35:33Z',
        suitesPassed: 2,
        testsPassed: 3,
        workerStoppedDuringRun: true,
        workerRunningAfterRun: true,
        postgresHealthy: true,
        redisHealthy: true,
        controlledPartner: true,
        productionCredentialsUsed: false,
        externalNotificationsUsed: false,
        gateEvidence: Object.fromEntries(
          LOCAL_E2E_GATES.map((gate) => [gate, `evidence://${gate}`]),
        ),
      }).status,
    ).toBe('PASS');
  });
});
