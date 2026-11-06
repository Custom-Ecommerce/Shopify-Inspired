
/** Payload's Users policy, carried over: 8 failed attempts lock the account for 10 minutes. */
export const MAX_LOGIN_ATTEMPTS = 8;
export const LOCK_DURATION_MS = 10 * 60 * 1000;

export interface LockoutState {
loginAttempts: number;
lockUntil: Date | null;
}

export function isLocked(state: LockoutState, now: Date = new Date()): boolean {
return state.lockUntil !== null && state.lockUntil.getTime() > now.getTime();
}

/**
* Pure transition for one failed login. Calling it while locked changes nothing.
* When the lock has expired, the counter starts again from zero.
*/
export function recordFailedAttempt(state: LockoutState, now: Date = new Date()): LockoutState {
if (isLocked(state, now)) {
return { loginAttempts: state.loginAttempts, lockUntil: state.lockUntil };
}
const expired = state.lockUntil !== null && state.lockUntil.getTime() <= now.getTime();
const attempts = (expired ? 0 : state.loginAttempts) + 1;
if (attempts >= MAX_LOGIN_ATTEMPTS) {
return { loginAttempts: 0, lockUntil: new Date(now.getTime() + LOCK_DURATION_MS) };
}
return { loginAttempts: attempts, lockUntil: expired ? null : state.lockUntil };
}

/** Pure transition for a successful login. */
export function recordSuccess(): LockoutState {
return { loginAttempts: 0, lockUntil: null };
}
