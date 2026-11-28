import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/*
 * Sprint 9 (EP-31.US01.T07, D-120): the second factor of the admin phone sign-in. TOTP as RFC 6238 (SHA-1, 30 second step, 6 digits, one step of clock
 * drift either way), written with node:crypto and checked against the RFC's own test values. The secret is stored sealed (AES-256-GCM, the key derived from
 * the admin auth secret), because the server has to compute codes from it; recovery codes are stored as SHA-256 only and each works once.
 */

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const TOTP_DRIFT_STEPS = 1;
export const RECOVERY_CODE_COUNT = 10;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return bits > 0 ? out + BASE32[(value << (5 - bits)) & 31] : out;
}

export function base32Decode(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of text.toUpperCase().replace(/[=\s]/g, '')) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error('Not base32.');
    value = ((value << 5) | index) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The HOTP value (RFC 4226) of a counter. */
export function hotp(secret: Buffer, counter: number, digits: number = TOTP_DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secret).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export const totpStep = (nowMs: number): number => Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);

/**
 * The time step a code belongs to, or null. Looks at the current step and one either way. A step at or before `lastUsedStep` is refused, so a code
 * that was accepted cannot be used again.
 */
export function matchTotpStep(secretBase32: string, code: unknown, nowMs: number = Date.now(), lastUsedStep: number = -1): number | null {
  if (typeof code !== 'string' || !new RegExp('^\\d{' + TOTP_DIGITS + '}$').test(code)) return null;
  const secret = base32Decode(secretBase32);
  const current = totpStep(nowMs);
  let found: number | null = null;
  for (let step = current - TOTP_DRIFT_STEPS; step <= current + TOTP_DRIFT_STEPS; step += 1) {
    if (timingSafeEqual(Buffer.from(hotp(secret, step)), Buffer.from(code)) && step > lastUsedStep) found = step;
  }
  return found;
}

/** 20 random bytes, the size RFC 4226 recommends for SHA-1. */
export const newTotpSecret = (): string => base32Encode(randomBytes(20));

/** What an authenticator app scans (as a QR code) or takes as a link. */
export function otpauthUri(secretBase32: string, account: string, issuer: string): string {
  const label = encodeURIComponent(issuer) + ':' + encodeURIComponent(account);
  return 'otpauth://totp/' + label + '?secret=' + secretBase32 + '&issuer=' + encodeURIComponent(issuer) + '&algorithm=SHA1&digits=' + TOTP_DIGITS + '&period=' + TOTP_STEP_SECONDS;
}

const sealKey = (keyMaterial: string): Buffer => createHash('sha256').update('totp-seal-v1:' + keyMaterial).digest();

export function sealSecret(plain: string, keyMaterial: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', sealKey(keyMaterial), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}

/** The sealed text, or null when it was changed or sealed with another key. */
export function openSecret(sealed: string, keyMaterial: string): string | null {
  const [version, iv, tag, body] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || !body) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', sealKey(keyMaterial), Buffer.from(iv, 'base64url'), { authTagLength: 16 });
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

const normalizeRecoveryCode = (code: string): string => code.toUpperCase().replace(/[\s-]/g, '');

export const hashRecoveryCode = (code: string): string => createHash('sha256').update('recovery:' + normalizeRecoveryCode(code)).digest('hex');

/** Ten codes of 60 random bits, written XXXX-XXXX-XXXX. `codes` are shown once; only `hashes` are stored. */
export function newRecoveryCodes(count: number = RECOVERY_CODE_COUNT): { codes: string[]; hashes: string[] } {
  const codes = Array.from({ length: count }, () => base32Encode(randomBytes(8)).slice(0, 12).replace(/(.{4})(?=.)/g, '$1-'));
  return { codes, hashes: codes.map(hashRecoveryCode) };
}
