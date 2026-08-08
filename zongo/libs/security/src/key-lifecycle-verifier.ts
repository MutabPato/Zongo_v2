export const DEFAULT_KEY_PURPOSES = [
  'sender-phone',
  'beneficiary-phone',
  'beneficiary-payout-account',
  'provider-reference',
  'kyc-evidence',
] as const;

export type KeyLifecycleCheck = {
  name: string;
  status: 'PASS' | 'FAIL';
  details: Record<string, string | number | boolean>;
};

export type KeyLifecycleVerification = {
  status: 'PASS' | 'FAIL';
  checks: KeyLifecycleCheck[];
};

function normalize(value: string): string {
  return value.replace(/[^a-z0-9]/gi, '_').toUpperCase();
}

function readKey(
  environment: NodeJS.ProcessEnv,
  name: string,
): { key?: Buffer; error?: string } {
  const encoded = environment[name];
  if (!encoded) return { error: `${name} is not configured` };
  const key = Buffer.from(encoded, 'base64url');
  if (key.length !== 32) return { error: `${name} must be 32 bytes base64url` };
  return { key };
}

/**
 * Verifies only non-secret key-management invariants. It never returns key
 * material or fingerprints, and it does not claim that an external secret
 * manager has actually been approved.
 */
export function verifyKeyLifecycle(
  environment: NodeJS.ProcessEnv,
  purposes: readonly string[] = DEFAULT_KEY_PURPOSES,
  requirePilotReleaseSigningKey = false,
): KeyLifecycleVerification {
  const checks: KeyLifecycleCheck[] = [];
  const encryptionKeys = new Set<string>();
  const blindIndexKeys = new Set<string>();
  const pilotReleaseSigningKey = requirePilotReleaseSigningKey
    ? readKey(environment, 'PILOT_RELEASE_SIGNING_KEY')
    : undefined;

  const provider = environment.ZONGO_KEY_MANAGEMENT_PROVIDER?.trim();
  checks.push({
    name: 'managed-key-provider-declared',
    status: provider ? 'PASS' : 'FAIL',
    details: { configured: Boolean(provider) },
  });

  for (const purpose of purposes) {
    const suffix = normalize(purpose);
    const currentVersion =
      environment[`ZONGO_ENCRYPTION_KEY_VERSION_${suffix}`];
    const retiredVersions = (
      environment[`ZONGO_RETIRED_ENCRYPTION_KEY_VERSIONS_${suffix}`] ?? ''
    )
      .split(',')
      .map((version) => version.trim())
      .filter(Boolean);
    const configuredVersions = (
      environment[`ZONGO_ENCRYPTION_KEY_VERSIONS_${suffix}`] ??
      currentVersion ??
      ''
    )
      .split(',')
      .map((version) => version.trim())
      .filter(Boolean);

    const currentKey = currentVersion
      ? readKey(
          environment,
          `ZONGO_ENCRYPTION_KEY_${suffix}_${normalize(currentVersion)}`,
        )
      : { error: `ZONGO_ENCRYPTION_KEY_VERSION_${suffix} is not configured` };
    const versionChecks = configuredVersions.map((version) =>
      readKey(
        environment,
        `ZONGO_ENCRYPTION_KEY_${suffix}_${normalize(version)}`,
      ),
    );
    const blindIndexKey = readKey(
      environment,
      `ZONGO_BLIND_INDEX_KEY_${suffix}`,
    );
    if (currentKey.key)
      encryptionKeys.add(currentKey.key.toString('base64url'));
    if (blindIndexKey.key)
      blindIndexKeys.add(blindIndexKey.key.toString('base64url'));

    const currentIsUsable =
      Boolean(currentVersion) &&
      !retiredVersions.includes(currentVersion ?? '');
    const versionsPresent = versionChecks.every((result) =>
      Boolean(result.key),
    );
    checks.push({
      name: `key-configuration:${purpose}`,
      status:
        currentIsUsable &&
        versionsPresent &&
        Boolean(blindIndexKey.key) &&
        Boolean(currentKey.key)
          ? 'PASS'
          : 'FAIL',
      details: {
        currentVersion: currentVersion ?? '(missing)',
        retainedVersions: configuredVersions.length,
        retiredCurrentVersion: !currentIsUsable,
        blindIndexConfigured: Boolean(blindIndexKey.key),
        currentKeyConfigured: Boolean(currentKey.key),
      },
    });
  }

  checks.push({
    name: 'encryption-key-separation',
    status: encryptionKeys.size === purposes.length ? 'PASS' : 'FAIL',
    details: {
      purposes: purposes.length,
      uniqueEncryptionKeys: encryptionKeys.size,
    },
  });
  checks.push({
    name: 'blind-index-key-separation',
    status: blindIndexKeys.size === purposes.length ? 'PASS' : 'FAIL',
    details: {
      purposes: purposes.length,
      uniqueBlindIndexKeys: blindIndexKeys.size,
    },
  });
  const encryptionBlindIndexOverlap = [...encryptionKeys].some((value) =>
    blindIndexKeys.has(value),
  );
  checks.push({
    name: 'encryption-blind-index-key-separation',
    status: encryptionBlindIndexOverlap ? 'FAIL' : 'PASS',
    details: { overlap: encryptionBlindIndexOverlap },
  });
  if (requirePilotReleaseSigningKey) {
    const signingKeyValue = pilotReleaseSigningKey?.key?.toString('base64url');
    const signingKeyOverlaps = Boolean(
      signingKeyValue &&
      (encryptionKeys.has(signingKeyValue) ||
        blindIndexKeys.has(signingKeyValue)),
    );
    checks.push({
      name: 'pilot-release-signing-key-separation',
      status:
        Boolean(pilotReleaseSigningKey?.key) && !signingKeyOverlaps
          ? 'PASS'
          : 'FAIL',
      details: {
        configured: Boolean(pilotReleaseSigningKey?.key),
        overlaps: signingKeyOverlaps,
      },
    });
  }

  return {
    status: checks.every((check) => check.status === 'PASS') ? 'PASS' : 'FAIL',
    checks,
  };
}
