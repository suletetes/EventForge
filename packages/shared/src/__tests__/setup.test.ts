import * as fc from 'fast-check';

describe('Project Setup Verification', () => {
  it('should have fast-check available for property-based testing', () => {
    const result = fc.check(
      fc.property(fc.integer(), (n) => {
        return typeof n === 'number';
      }),
      { numRuns: 10 },
    );
    expect(result.failed).toBe(false);
  });

  it('should have Jest with ts-jest working for TypeScript tests', () => {
    const add = (a: number, b: number): number => a + b;
    expect(add(1, 2)).toBe(3);
  });
});
