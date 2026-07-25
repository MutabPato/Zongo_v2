CREATE TABLE "HardwareKeyCredential" (
  "id" TEXT NOT NULL,
  "identityId" TEXT NOT NULL,
  "credentialId" TEXT NOT NULL,
  "publicKey" BYTEA NOT NULL,
  "counter" INTEGER NOT NULL DEFAULT 0,
  "transports" TEXT[] NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3),
  CONSTRAINT "HardwareKeyCredential_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "HardwareKeyCredential_credentialId_key" ON "HardwareKeyCredential"("credentialId");
CREATE INDEX "HardwareKeyCredential_identityId_idx" ON "HardwareKeyCredential"("identityId");
ALTER TABLE "HardwareKeyCredential" ADD CONSTRAINT "HardwareKeyCredential_identityId_fkey"
  FOREIGN KEY ("identityId") REFERENCES "PlatformIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "WebAuthnChallenge" (
  "id" TEXT NOT NULL,
  "identityId" TEXT NOT NULL,
  "challenge" TEXT NOT NULL,
  "ceremony" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebAuthnChallenge_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WebAuthnChallenge_challenge_key" ON "WebAuthnChallenge"("challenge");
CREATE INDEX "WebAuthnChallenge_identityId_ceremony_expiresAt_idx" ON "WebAuthnChallenge"("identityId", "ceremony", "expiresAt");
ALTER TABLE "WebAuthnChallenge" ADD CONSTRAINT "WebAuthnChallenge_identityId_fkey"
  FOREIGN KEY ("identityId") REFERENCES "PlatformIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
