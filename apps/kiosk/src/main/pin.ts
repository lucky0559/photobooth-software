import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEY_LEN = 32;

/** Returns `scrypt$<saltB64>$<hashB64>` with a random 16-byte salt. */
export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, KEY_LEN);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'base64');
  const expected = Buffer.from(parts[2], 'base64');
  if (salt.length === 0 || expected.length !== KEY_LEN) return false;
  return timingSafeEqual(scryptSync(pin, salt, KEY_LEN), expected);
}
