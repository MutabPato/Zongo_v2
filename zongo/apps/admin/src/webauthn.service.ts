import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { PrismaService } from '@app/db';

@Injectable()
export class WebAuthnService {
  constructor(private readonly prisma: PrismaService) {}

  async registrationOptions(identityId: string) {
    const identity = await this.prisma.platformIdentity.findUniqueOrThrow({
      where: { id: identityId },
      include: { hardwareKeys: true },
    });
    const options = await generateRegistrationOptions({
      rpName: 'Zongo Operations',
      rpID: this.rpId(),
      userName: identity.userId,
      userID: new TextEncoder().encode(identity.id),
      userDisplayName: identity.displayName ?? identity.userId,
      authenticatorSelection: {
        authenticatorAttachment: 'cross-platform',
        userVerification: 'required',
      },
      excludeCredentials: identity.hardwareKeys.map((key) => ({
        id: key.credentialId,
        transports: key.transports as never,
      })),
    });
    await this.saveChallenge(identity.id, options.challenge, 'registration');
    return options;
  }

  async verifyRegistration(
    identityId: string,
    response: RegistrationResponseJSON,
  ) {
    const challenge = await this.consumeChallenge(identityId, 'registration');
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: this.origin(),
      expectedRPID: this.rpId(),
      requireUserVerification: true,
    });
    if (!verification.verified || !verification.registrationInfo)
      throw new BadRequestException(
        'Hardware key registration could not be verified',
      );
    const credential = verification.registrationInfo.credential;
    await this.prisma.hardwareKeyCredential.create({
      data: {
        identityId,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: credential.counter,
        transports: response.response.transports ?? [],
      },
    });
    return { verified: true };
  }

  async authenticationOptions(userId: string) {
    const identity = await this.prisma.platformIdentity.findUniqueOrThrow({
      where: { userId },
      include: { hardwareKeys: true },
    });
    if (!identity.hardwareKeys.length)
      throw new UnauthorizedException('No hardware key is registered');
    const options = await generateAuthenticationOptions({
      rpID: this.rpId(),
      userVerification: 'required',
      allowCredentials: identity.hardwareKeys.map((key) => ({
        id: key.credentialId,
        transports: key.transports as never,
      })),
    });
    await this.saveChallenge(identity.id, options.challenge, 'authentication');
    return options;
  }

  async verifyAuthentication(
    userId: string,
    response: AuthenticationResponseJSON,
  ): Promise<string> {
    const identity = await this.prisma.platformIdentity.findUniqueOrThrow({
      where: { userId },
    });
    const challenge = await this.consumeChallenge(
      identity.id,
      'authentication',
    );
    const key = await this.prisma.hardwareKeyCredential.findUnique({
      where: { credentialId: response.id },
    });
    if (!key || key.identityId !== identity.id)
      throw new UnauthorizedException('Unknown hardware key');
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: this.origin(),
      expectedRPID: this.rpId(),
      requireUserVerification: true,
      credential: {
        id: key.credentialId,
        publicKey: new Uint8Array(key.publicKey),
        counter: key.counter,
        transports: key.transports as never,
      },
    });
    if (!verification.verified)
      throw new UnauthorizedException('Hardware key assertion failed');
    await this.prisma.hardwareKeyCredential.update({
      where: { id: key.id },
      data: {
        counter: verification.authenticationInfo.newCounter,
        lastUsedAt: new Date(),
      },
    });
    return identity.id;
  }

  private async saveChallenge(
    identityId: string,
    challenge: string,
    ceremony: string,
  ): Promise<void> {
    await this.prisma.webAuthnChallenge.create({
      data: {
        identityId,
        challenge,
        ceremony,
        expiresAt: new Date(Date.now() + 5 * 60_000),
      },
    });
  }

  private async consumeChallenge(identityId: string, ceremony: string) {
    const challenge = await this.prisma.webAuthnChallenge.findFirst({
      where: { identityId, ceremony, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge)
      throw new UnauthorizedException(
        'WebAuthn challenge is invalid or expired',
      );
    await this.prisma.webAuthnChallenge.delete({ where: { id: challenge.id } });
    return challenge;
  }

  private rpId(): string {
    const value = process.env.WEBAUTHN_RP_ID;
    if (!value && process.env.NODE_ENV === 'production')
      throw new Error('WEBAUTHN_RP_ID is required in production');
    return value ?? 'localhost';
  }

  private origin(): string {
    const value = process.env.WEBAUTHN_ORIGIN;
    if (!value && process.env.NODE_ENV === 'production')
      throw new Error('WEBAUTHN_ORIGIN is required in production');
    return value ?? 'http://localhost:3002';
  }
}
