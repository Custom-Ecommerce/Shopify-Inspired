import { randomInt } from 'node:crypto';
import type { ReferralOverview, ReferralRow } from '@markaz/contracts';
import { authLimiter, sellerPortalLink } from '@/lib/account-support';
import { normalizePhoneE164, normalizeReferralCode, REFERRAL_CODE_ALPHABET, REFERRAL_CODE_LENGTH } from '@/lib/contracts';
import { HttpError, isDuplicateKeyError } from '@/lib/http';
import { readReferralSettings } from '@/lib/platform-settings';
import { RateLimitedError, Referral, User } from '@/lib/services';

/*
 * Sprint 8 (S8-B5, D-118): referral codes, capture at signup and the referrer's read. The REWARD (extending the referrer's subscription) is S8-B6 and is not here.
 *
 * Capture is silent: whatever is wrong with a code (unknown, off, self-referral, over the cap, a database problem), the signup succeeds and its answer is the same,
 * so nobody can learn from it which codes exist or why one was refused. `referredBy` is set only together with a referrals row.
 */

type Row = Record<string, any>;

const DAY_MS = 86_400_000;
/** How many of a referrer's rows the page reads, newest first. */
export const REFERRAL_LIST_MAX = 500;

export function generateReferralCode(): string {
  let code = '';
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i += 1) code += REFERRAL_CODE_ALPHABET[randomInt(REFERRAL_CODE_ALPHABET.length)];
  return code;
}

/** "Sana Khan" -> "S*** K.". Never shows more than the two initials; the number of stars says nothing about the name. */
export function maskName(name: unknown): string {
  const parts = typeof name === 'string' ? name.trim().split(/\s+/).filter(Boolean) : [];
  const initial = (word: string): string => (Array.from(word)[0] ?? '').toUpperCase();
  if (parts.length === 0) return 'Seller';
  const first = initial(parts[0]!) + '***';
  return parts.length === 1 ? first : first + ' ' + initial(parts[parts.length - 1]!) + '.';
}

/** The mailbox an address reaches, as far as self-referral cares: lower case, no +tag; for Gmail also no dots, and googlemail.com is gmail.com. */
export function mailboxOf(email: unknown): string {
  if (typeof email !== 'string') return '';
  const value = email.trim().toLowerCase();
  const at = value.lastIndexOf('@');
  if (at < 1) return value;
  let local = value.slice(0, at).split('+')[0]!;
  let domain = value.slice(at + 1);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  return local + '@' + domain;
}

export interface ReferralPerson {
  email?: unknown;
  pendingEmail?: unknown;
  phone?: unknown;
}

/** True when the referrer and the new account look like the same person: the same mailbox or the same Pakistani mobile. Pure. */
export function isSelfReferral(referrer: ReferralPerson, referred: ReferralPerson): boolean {
  const mine = [referred.email, referred.pendingEmail].map(mailboxOf).filter(Boolean);
  if ([referrer.email, referrer.pendingEmail].map(mailboxOf).some((box) => box !== '' && mine.includes(box))) return true;
  const phone = normalizePhoneE164(referrer.phone);
  return phone !== null && phone === normalizePhoneE164(referred.phone);
}

export interface NewSeller {
  id: string;
  email: string;
  phone?: string | null;
}

/**
 * Records that a NEW account signed up with a code. Called only after the account was created (an existing email never gets this far), and never throws.
 * Nothing is written when the code is malformed or unknown, referrals are off, the referrer is not an active seller, it is a self-referral, or the referrer has
 * had referralMonthlyCap new referrals in the current day (the daily cap, counted atomically; a counter-store problem lets it through, as D-081 says).
 */
export async function captureReferral(account: NewSeller, rawCode: unknown, now: Date = new Date()): Promise<void> {
  try {
    const code = normalizeReferralCode(rawCode);
    if (code === null) return;
    const settings = await readReferralSettings();
    if (settings.rewardMonths === 0 || settings.monthlyCap === 0) return;
    const referrer = (await User.findOne({ referralCode: code, role: 'seller' } as never)
      .select('email pendingEmail phone accountStatus')
      .lean()) as unknown as Row | null;
    if (!referrer || String(referrer._id) === account.id) return;
    if (referrer.accountStatus === 'suspended' || referrer.accountStatus === 'blocked') return;
    if (isSelfReferral(referrer, account)) return;
    try {
      await authLimiter.consume({ name: 'referral-signup', limit: settings.monthlyCap, windowMs: DAY_MS }, String(referrer._id), now.getTime());
    } catch (err) {
      if (err instanceof RateLimitedError) return;
      throw err;
    }
    try {
      await Referral.create({ referrer: referrer._id, referred: account.id, status: 'pending', monthsRewarded: 0, rewardedAt: null } as never);
    } catch (err) {
      // One referral per referred seller: the unique index has the last word.
      if (isDuplicateKeyError(err)) return;
      throw err;
    }
    await User.updateOne({ _id: account.id, referredBy: null } as never, { $set: { referredBy: referrer._id } } as never);
  } catch (err) {
    console.error('[seller-backend] could not record a referral', err instanceof Error ? err.name : 'unknown');
  }
}

const CODE_ATTEMPTS = 5;

/** The seller's code, made on first need. One per seller: the write only fills an empty field, and a taken code is drawn again. */
export async function ensureReferralCode(userId: unknown, draw: () => string = generateReferralCode): Promise<string> {
  const read = async (): Promise<string | null> => {
    const user = (await User.findById(userId as never).select('referralCode').lean()) as unknown as Row | null;
    if (!user) throw new HttpError(404, 'Account not found');
    return typeof user.referralCode === 'string' && user.referralCode !== '' ? user.referralCode : null;
  };
  const existing = await read();
  if (existing !== null) return existing;
  for (let attempt = 1; ; attempt += 1) {
    const code = draw();
    try {
      const updated = await User.findOneAndUpdate({ _id: userId, referralCode: null } as never, { $set: { referralCode: code } } as never, { new: true })
        .select('referralCode')
        .lean();
      if (updated) return code;
      // Another request made it between the read and the write.
      const again = await read();
      if (again !== null) return again;
      throw new HttpError(409, 'Your referral code could not be created. Please reload.');
    } catch (err) {
      if (isDuplicateKeyError(err) && attempt < CODE_ATTEMPTS) continue;
      throw err;
    }
  }
}

const iso = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/** GET /api/referrals: the code, the share link and the referrals where THIS seller is the referrer. The referred seller's email is never read. */
export async function buildReferralOverview(userId: unknown): Promise<ReferralOverview> {
  const code = await ensureReferralCode(userId);
  const settings = await readReferralSettings();
  const rows = (await Referral.find({ referrer: userId } as never)
    .sort({ createdAt: -1 })
    .limit(REFERRAL_LIST_MAX)
    .select('referred status monthsRewarded createdAt rewardedAt')
    .lean()) as unknown as Row[];
  const ids = rows.map((row) => String(row.referred));
  const people = ids.length === 0 ? [] : ((await User.find({ _id: { $in: ids } } as never).select('name').lean()) as unknown as Row[]);
  const names = new Map(people.map((person) => [String(person._id), person.name]));

  const referrals: ReferralRow[] = rows.map((row) => ({
    id: String(row._id),
    name: maskName(names.get(String(row.referred))),
    status: row.status === 'rewarded' ? 'rewarded' : 'pending',
    monthsRewarded: typeof row.monthsRewarded === 'number' && row.monthsRewarded > 0 ? Math.round(row.monthsRewarded) : 0,
    createdAt: iso(row.createdAt) ?? new Date(0).toISOString(),
    rewardedAt: iso(row.rewardedAt),
  }));
  const rewarded = referrals.filter((row) => row.status === 'rewarded').length;
  return {
    code,
    shareLink: sellerPortalLink('/signup?ref=' + code),
    enabled: settings.rewardMonths > 0,
    rewardMonths: settings.rewardMonths,
    monthlyCap: settings.monthlyCap,
    totals: {
      referred: referrals.length,
      pending: referrals.length - rewarded,
      rewarded,
      monthsEarned: referrals.reduce((sum, row) => sum + row.monthsRewarded, 0),
    },
    referrals,
  };
}
