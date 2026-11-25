import { isDuplicateKeyError } from '@/lib/http';
import { readReferralSettings } from '@/lib/platform-settings';
import { notifyReferralRewarded } from '@/lib/referral-emails';
import { isSelfReferral, type ReferralPerson } from '@/lib/referrals';
import { Referral, Store, SubscriptionCredit, SubscriptionPayment, User, writeAuditLog } from '@/lib/services';
import { extendRunningSubscription, type Extension } from '@/lib/subscription-credits';

/*
 * Sprint 8 (S8-B6, D-118): the referral reward. Called by confirmPayment AFTER the payment and the subscription are written.
 *
 * When: the REFERRED seller's first confirmed payment of a real amount (> 0). Exactly once: the referral leaves "pending" by ONE compare-and-set, so a double
 * confirm, a void followed by a new confirm and two parallel confirms give at most one reward. referralRewardMonths 0: nothing happens (the row stays pending).
 *
 * Who is refused: a referrer who is gone, suspended or blocked, and a self-referral judged again with the accounts' AND stores' phones and emails ("refused").
 * Cap: referralMonthlyCap rewards per referrer per UTC calendar month ("capped", never rewarded later); a unique slot per month makes it exact.
 *
 * The months become one SubscriptionCredit (unique per referral): used at once on a running paid period, else at the referrer's next confirmed payment.
 * It never throws: a reward problem must not undo or fail a confirmed payment.
 */

type Row = Record<string, any>;

export interface ConfirmedPayment {
  id: string;
  seller: string;
  amountRs: number;
}

async function audit(action: string, referralId: string, actorId: string, details: Record<string, unknown>): Promise<void> {
  try {
    await writeAuditLog(action, 'referral', referralId, actorId, { ...details, at: new Date().toISOString() });
  } catch (err) {
    console.error('[seller-backend] could not write the referral audit entry', err instanceof Error ? err.name : 'unknown');
  }
}

/** Everything one side is known by: the account, and the contact email, phone and WhatsApp number of each of its stores. */
async function identitiesOf(user: Row): Promise<ReferralPerson[]> {
  const stores = (await Store.find({ owner: user._id } as never).select('storefront').lean()) as unknown as Row[];
  const people: ReferralPerson[] = [{ email: user.email, pendingEmail: user.pendingEmail, phone: user.phone }];
  for (const store of stores) {
    const front = (store.storefront ?? {}) as Row;
    people.push({ email: front.contactEmail, phone: front.contactPhone }, { phone: front.whatsappNumber });
  }
  return people;
}

export function samePersonAmong(referrer: readonly ReferralPerson[], referred: readonly ReferralPerson[]): boolean {
  return referrer.some((a) => referred.some((b) => isSelfReferral(a, b)));
}

/** Closes a pending referral without a reward. */
async function close(referralId: string, status: 'capped' | 'refused', actorId: string, details: Record<string, unknown>): Promise<void> {
  const closed = await Referral.findOneAndUpdate({ _id: referralId, status: 'pending' } as never, { $set: { status } } as never, { new: true })
    .select('_id')
    .lean();
  if (closed) await audit('referral.' + status, referralId, actorId, details);
}

/** Takes the next free reward slot of the month. False: the cap is reached. Null: someone else already decided this referral. */
async function takeSlot(referral: Row, referrerId: string, set: Record<string, unknown>, month: string, cap: number): Promise<boolean | null> {
  const used = await Referral.countDocuments({ referrer: referrerId, rewardMonth: month } as never);
  for (let slot = used + 1; slot <= cap; slot += 1) {
    try {
      const won = await Referral.findOneAndUpdate(
        { _id: referral._id, status: 'pending' } as never,
        { $set: { ...set, status: 'rewarded', rewardMonth: month, rewardSlot: slot } } as never,
        { new: true },
      )
        .select('_id')
        .lean();
      return won ? true : null;
    } catch (err) {
      // Another reward of this referrer took the slot in the same instant: try the next.
      if (!isDuplicateKeyError(err)) throw err;
    }
  }
  return false;
}

async function reward(payment: ConfirmedPayment, actorId: string, now: Date): Promise<void> {
  if (!(payment.amountRs > 0)) return;
  const referral = (await Referral.findOne({ referred: payment.seller, status: 'pending' } as never).lean()) as unknown as Row | null;
  if (!referral) return;
  const settings = await readReferralSettings();
  if (settings.rewardMonths === 0) return;
  const earlier = await SubscriptionPayment.countDocuments({ seller: payment.seller, status: 'confirmed', amountRs: { $gt: 0 }, _id: { $ne: payment.id } } as never);
  if (earlier > 0) return;

  const referralId = String(referral._id);
  const referrerId = String(referral.referrer);
  const base = { referrer: referrerId, referred: payment.seller, paymentId: payment.id };
  const fields = 'email pendingEmail phone accountStatus';
  const referrer = (await User.findById(referrerId).select(fields).lean()) as unknown as Row | null;
  if (!referrer || referrer.accountStatus === 'suspended' || referrer.accountStatus === 'blocked') {
    return close(referralId, 'refused', actorId, { ...base, why: 'referrer_unavailable' });
  }
  const referred = (await User.findById(payment.seller).select(fields).lean()) as unknown as Row | null;
  if (referred && samePersonAmong(await identitiesOf(referrer), await identitiesOf(referred))) {
    return close(referralId, 'refused', actorId, { ...base, why: 'self_referral' });
  }

  const months = settings.rewardMonths;
  const month = now.toISOString().slice(0, 7);
  const taken = await takeSlot(referral, referrerId, { rewardedAt: now, monthsRewarded: months, rewardPayment: payment.id }, month, settings.monthlyCap);
  if (taken === null) return;
  if (!taken) return close(referralId, 'capped', actorId, { ...base, month, cap: settings.monthlyCap });

  try {
    await SubscriptionCredit.create({ seller: referrerId, months, reason: 'referral', referral: referralId, usedAt: null, usedByPayment: null } as never);
  } catch (err) {
    if (!isDuplicateKeyError(err)) {
      // The row says rewarded but no months were stored: the owner has to see it and add them by hand.
      await audit('referral.credit_failed', referralId, actorId, { ...base, months });
      throw err;
    }
  }

  let extension: Extension | null = null;
  try {
    extension = await extendRunningSubscription(referrerId, now, actorId);
  } catch (err) {
    // The credit is stored and still waiting: it is used at the referrer's next confirmed payment.
    console.error('[seller-backend] could not extend the referrer subscription now', err instanceof Error ? err.name : 'unknown');
  }
  await audit('referral.rewarded', referralId, actorId, { ...base, months, month, applied: extension === null ? 'next_payment' : 'running_period' });
  notifyReferralRewarded({ referralId, referrer: referrerId, months, extension });
}

/** After a payment is confirmed. Never throws. */
export async function rewardReferral(payment: ConfirmedPayment, actorId: string, now: Date = new Date()): Promise<void> {
  try {
    await reward(payment, actorId, now);
  } catch (err) {
    console.error('[seller-backend] could not process a referral reward', err instanceof Error ? err.name : 'unknown');
  }
}

/**
 * A confirmed payment was voided. When it had earned a reward, the reward is NOT taken back: the row is marked and an audit entry says so, for the owner to
 * decide by hand. Never throws.
 */
export async function noteVoidedReferralPayment(paymentId: string, actorId: string, reason: string, now: Date = new Date()): Promise<void> {
  try {
    const referral = (await Referral.findOne({ rewardPayment: paymentId, status: 'rewarded' } as never).lean()) as unknown as Row | null;
    if (!referral) return;
    await Referral.updateOne({ _id: referral._id } as never, { $set: { paymentVoidedAt: now } } as never);
    await audit('referral.payment_voided_after_reward', String(referral._id), actorId, {
      referrer: String(referral.referrer),
      referred: String(referral.referred),
      paymentId,
      months: referral.monthsRewarded ?? null,
      reason,
      note: 'The reward was NOT taken back. Decide by hand whether to remove the free months.',
    });
  } catch (err) {
    console.error('[seller-backend] could not note a voided referral payment', err instanceof Error ? err.name : 'unknown');
  }
}
