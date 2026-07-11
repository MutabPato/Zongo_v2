import { Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789';

@Injectable()
export class TransactionReferenceService {
  generate(): string {
    const timePart = Date.now().toString(36).toUpperCase();
    const randomPart = Array.from(
      { length: 8 },
      () => ALPHABET[randomInt(ALPHABET.length)],
    ).join('');

    return `ZNG-${timePart}-${randomPart}`;
  }
}
