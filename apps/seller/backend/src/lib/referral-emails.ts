import { enqueueEmail, runAfterResponse, sellerDashboardLink } from '@/lib/notifications';
import { Store, SubscriptionPlanModel, User } from '@/lib/services';
import { billingLinkFor, formatMailDate } from '@/lib/subscription-emails';
import type { Extension } from '@/lib/subscription-credits';

/*
 * Sprint 8 (S8-B6, D-118): the two referral emails, both to the REFERRER, through the notification outbox (D-091). Each has one dedupe key per referral. Neither
 * carries the referred seller's email: only a masked name. A message can never change, delay or fail the signup or the payment that caused it.
 */

const DASHBOARD_FALLBACK = 'your Markazify dashboard';

async function referrerInfo(userId: string): Promise<{ name: string; email: string } | null> {
  const user = (await User.findById(userId).select('name email').lean()) as { name?: unknown; email?: unknown } | null;
  if (!user || typeof user.email !== 'string' || user.email === '') return null;
  return { name: typeof user.name === 'string' && user.name.trim() !== '' ? user.name : user.email, email: user.email };
}

/** The referrals page lives under the seller's first store. */
async function referralsLinkFor(userId: string): Promise<string> {
  const store = (await Store.findOne({ owner: userId } as never).select('_id').sort({ createdAt: 1 }).lean()) as { _id?: unknown } | null;
  return (store?._id ? sellerDashboardLink(String(store._id), '/referrals') : null) ?? DASHBOARD_FALLBACK;
}

export interface SignedUpMail {
  referralId: string;
  referrer: string;
  /** Already masked. */
  referredName: string;
}

export async function sendReferralSignedUp(input: SignedUpMail): Promise<void> {
  const referrer = await referrerInfo(input.referrer);
  if (!referrer) return;
  await enqueueEmail({
    template: 'referral_signed_up',
    to: referrer.email,
    vars: { customerName: referrer.name, referredName: input.referredName, dashboardLink: await referralsLinkFor(input.referrer) },
    dedupeKey: 'referral_signed_up:' + input.referralId,
  });
}

export interface RewardedMail {
  referralId: string;
  referrer: string;
  months: number;
  /** The running period that was lengthened, or null: the months wait for the next confirmed payment. */
  extension: Extension | null;
}

/** Where the months apply, as one sentence. */
export function rewardNote(extension: Extension | null, planName: string): string {
  return extension === null
    ? 'It will be added to your next confirmed plan payment.'
    : 'Your ' + planName + ' plan now runs until ' + formatMailDate(extension.periodEnd) + '.';
}

export async function sendReferralRewarded(input: RewardedMail): Promise<void> {
  const referrer = await referrerInfo(input.referrer);
  if (!referrer) return;
  let planName = '';
  if (input.extension !== null) {
    const plan = (await SubscriptionPlanModel.findOne({ key: input.extension.planKey } as never).select('name').lean()) as { name?: unknown } | null;
    planName = typeof plan?.name === 'string' && plan.name !== '' ? plan.name : input.extension.planKey;
  }
  await enqueueEmail({
    template: 'referral_rewarded',
    to: referrer.email,
    vars: { customerName: referrer.name, monthsGained: String(input.months), rewardNote: rewardNote(input.extension, planName), dashboardLink: await billingLinkFor(input.referrer) },
    dedupeKey: 'referral_rewarded:' + input.referralId,
  });
}

export function notifyReferralSignedUp(input: SignedUpMail): void {
  runAfterResponse('referral_signed_up', () => sendReferralSignedUp(input));
}
export function notifyReferralRewarded(input: RewardedMail): void {
  runAfterResponse('referral_rewarded', () => sendReferralRewarded(input));
}
