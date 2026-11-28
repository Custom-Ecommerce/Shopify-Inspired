import { MOBILE_IDEMPOTENCY_KEY_PATTERN } from '@markaz/contracts/mobile-data';

/**
 * One Idempotency-Key per user action: make it when the user acts and keep it with the change until the server has answered. `random` is a UUID source
 * (expo-crypto on the phone).
 */
export function createIdempotencyKeyFactory(random: () => string): () => string {
  return () => {
    const key = random();
    if (!MOBILE_IDEMPOTENCY_KEY_PATTERN.test(key)) throw new Error('The random source does not make a usable Idempotency-Key.');
    return key;
  };
}
