// Edit validation for the mock server. The server is the only validator; the client just parses
// and sends. Kept separate from mock-server.ts (which starts listening on import) so it's testable.
import type { ClientMessage } from '../shared/protocol/codec.ts';

export const MAX_PRICE = 1000;
export const LOT_SIZE = 10;

export type Mutation = NonNullable<ClientMessage['mutation']>;

// Returns the rejection reason, or null if the edit is valid.
// Presence checks (not truthiness) so 0 is a valid edit.
export function validateMutation(
  mutation: Mutation,
  orderExists: boolean,
  options: { rejectAll?: boolean } = {},
): string | null {
  if (!orderExists) return 'unknown order';
  if (options.rejectAll) return 'risk check failed';
  const { price, quantity } = mutation;
  if (price != null && !(Number.isFinite(price) && price >= 0 && price <= MAX_PRICE)) {
    return `price outside limits (0–${MAX_PRICE})`;
  }
  if (quantity != null && !(Number.isInteger(quantity) && quantity % LOT_SIZE === 0)) {
    return `quantity must be a multiple of ${LOT_SIZE}`;
  }
  return null;
}
