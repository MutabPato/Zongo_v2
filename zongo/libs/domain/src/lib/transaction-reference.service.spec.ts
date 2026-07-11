import { TransactionReferenceService } from './transaction-reference.service';

describe('TransactionReferenceService', () => {
  it('generates opaque unique references', () => {
    const service = new TransactionReferenceService();
    const first = service.generate();
    const second = service.generate();

    expect(first).toMatch(/^ZNG-[A-Z0-9]+-[A-Z2-9]{8}$/);
    expect(second).toMatch(/^ZNG-[A-Z0-9]+-[A-Z2-9]{8}$/);
    expect(first).not.toEqual(second);
    expect(first).not.toContain('DRC');
    expect(first).not.toContain('KE');
    expect(first).not.toContain('UG');
  });
});
