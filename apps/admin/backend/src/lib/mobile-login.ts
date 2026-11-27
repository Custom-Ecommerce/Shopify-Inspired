import * as contractsNs from '@markaz/contracts';
import { adminAuthLimiter } from '@/lib/admin-account';
import { AdminHttpError, requireAdminSecret } from '@/lib/admin-auth';
import { unwrapCjs } from '@/lib/cjs';
import { auditAdminMobile } from '@/lib/mobile-auth';
import { secondFactors } from '@/lib/second-factor';
import { hashRecoveryCode, matchTotpStep, newRecoveryCodes, newTotpSecret, openSecret, otpauthUri, sealSecret } from '@/lib/workspace';

const contracts = unwrapCjs(contractsNs) as typeof contractsNs;
export const { mobileAdminLoginRequestSchema, mobileRefreshRequestSchema, mobileLogoutRequestSchema, MOBILE_TOTP_CODES } = contracts;

/** Wrong second factor codes per account: 5 in 15 minutes. Three 6 digit codes are valid at any moment, so a guess stays hopeless. */
export const TOTP_ACCOUNT_RULE = { name: 'totp-account', limit: 5, windowMs: 15 * 60_000 };

const ISSUER = 'Markazify Admin';
const NO_STORE = { 'Cache-Control': 'no-store' };

export type SecondFactorOutcome =
  /** The factor was proved. recoveryCodes are present once, right after the enrolment. */
  | { ok: true; recoveryCodes?: string[] }
  /** Answer this and create no device. */
  | { ok: false; response: Response };

/**
 * The second factor of an admin phone sign-in (EP-31.US01.T07). Called only after the password was accepted. There is no path that returns ok without a
 * code that was checked here: a missing factor never signs in.
 *
 *   not enrolled   no code: 403 TOTP_ENROLMENT_REQUIRED with the secret to add to an authenticator app. With that app's code: enrolled, ten recovery codes.
 *   enrolled       totp or recoveryCode. A time step and a recovery code are each accepted once.
 */
export async function checkSecondFactor(userId: string, email: string, input: { totp?: string; recoveryCode?: string }): Promise<SecondFactorOutcome> {
  const secret = requireAdminSecret();
  await adminAuthLimiter.assertBelow(TOTP_ACCOUNT_RULE, userId);
  const store = secondFactors();
  const factor = await store.find(userId);

  const wrong = async (code: string, message: string): Promise<never> => {
    await adminAuthLimiter.record(TOTP_ACCOUNT_RULE, userId);
    throw new AdminHttpError(401, message, code);
  };
  const unreadable = (): never => {
    throw new AdminHttpError(409, 'The second factor cannot be read. An owner must reset it.', MOBILE_TOTP_CODES.RESET_REQUIRED);
  };

  if (!factor || factor.confirmedAt === null) {
    let pending = factor ? openSecret(factor.secretSealed, secret) : null;
    if (input.totp === undefined || !factor || pending === null) {
      if (pending === null) {
        pending = newTotpSecret();
        await store.setPending(userId, sealSecret(pending, secret));
      }
      return {
        ok: false,
        response: Response.json(
          {
            error: 'Add this account to an authenticator app, then sign in with the 6 digit code it shows.',
            code: MOBILE_TOTP_CODES.ENROLMENT_REQUIRED,
            enrolment: { secret: pending, otpauthUri: otpauthUri(pending, email, ISSUER) },
          },
          { status: 403, headers: NO_STORE },
        ),
      };
    }
    const step = matchTotpStep(pending, input.totp);
    if (step === null) return wrong(MOBILE_TOTP_CODES.INVALID, 'That code is not right.');
    const recovery = newRecoveryCodes();
    if (!(await store.confirm(userId, factor.secretSealed, step, recovery.hashes, new Date()))) {
      throw new AdminHttpError(409, 'The second factor was changed meanwhile. Sign in again.', MOBILE_TOTP_CODES.REQUIRED);
    }
    await auditAdminMobile('mobile.totp_enrolled', userId, userId);
    return { ok: true, recoveryCodes: recovery.codes };
  }

  if (input.recoveryCode !== undefined) {
    if (!(await store.useRecoveryHash(userId, hashRecoveryCode(input.recoveryCode)))) return wrong(MOBILE_TOTP_CODES.RECOVERY_INVALID, 'That recovery code is not right or was already used.');
    await auditAdminMobile('mobile.totp_recovery_used', userId, userId);
    return { ok: true };
  }

  if (input.totp === undefined) throw new AdminHttpError(403, 'Enter the code from your authenticator app.', MOBILE_TOTP_CODES.REQUIRED);
  const plain = openSecret(factor.secretSealed, secret) ?? unreadable();
  const step = matchTotpStep(plain, input.totp, Date.now(), factor.lastUsedStep);
  if (step === null || !(await store.useStep(userId, step))) return wrong(MOBILE_TOTP_CODES.INVALID, 'That code is not right.');
  return { ok: true };
}
