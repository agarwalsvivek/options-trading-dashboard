import { describe, expect, it } from 'vitest';
import { LOT_SIZE, MAX_PRICE, validateMutation, type Mutation } from './validation.ts';

const mutation = (fields: { price?: number; quantity?: number }) => fields as Mutation;

describe('validateMutation', () => {
  it('accepts valid prices, including 0 and the maximum', () => {
    expect(validateMutation(mutation({ price: 0 }), true)).toBeNull();
    expect(validateMutation(mutation({ price: 123.45 }), true)).toBeNull();
    expect(validateMutation(mutation({ price: MAX_PRICE }), true)).toBeNull();
  });

  it('rejects prices outside limits or not finite', () => {
    for (const price of [-0.01, MAX_PRICE + 0.01, NaN, Infinity]) {
      expect(validateMutation(mutation({ price }), true)).toBe(`price outside limits (0–${MAX_PRICE})`);
    }
  });

  it('enforces whole lots for quantity', () => {
    expect(validateMutation(mutation({ quantity: 0 }), true)).toBeNull();
    expect(validateMutation(mutation({ quantity: LOT_SIZE * 7 }), true)).toBeNull();
    for (const quantity of [15, 20.5]) {
      expect(validateMutation(mutation({ quantity }), true)).toBe(`quantity must be a multiple of ${LOT_SIZE}`);
    }
  });

  it('ignores fields that are not set', () => {
    expect(validateMutation(mutation({}), true)).toBeNull();
  });

  it('rejects unknown orders before anything else', () => {
    expect(validateMutation(mutation({ price: -1 }), false, { rejectAll: true })).toBe('unknown order');
  });

  it('rejects everything in reject-all mode', () => {
    expect(validateMutation(mutation({ price: 10 }), true, { rejectAll: true })).toBe('risk check failed');
  });
});
