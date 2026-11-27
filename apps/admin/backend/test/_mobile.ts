// What the phone sign-in tests share: the models and helpers of the CommonJS packages, read the way the backend reads them.
import * as authNs from '@markaz/auth';
import { unwrapCjs } from '@/lib/cjs';

const auth = unwrapCjs(authNs) as typeof authNs;

export { AuditLog, User, hashPassword, memoryMobileDeviceStore, signSession } from '@/lib/workspace';
export const { base32Decode, hotp, totpStep } = auth;
