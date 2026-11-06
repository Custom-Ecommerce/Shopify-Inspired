import type { LedgerWriterPort } from './commission';

/** commissionRate is a percentage (4 means 4%), the same unit checkout stores (ID-18). */
export interface SaleRef {
  store: string;
  orderId: string;
  sellerOrderDocId: string | null;
  commissionRate: number;
  paymentMethod: string | null;
  stripePaymentIntentId: string;
}

export interface PlanRef {
  name: string;
  stripePriceId: string;
  tier: string;
}

export interface SellerStoreRef {
  storeId: string;
  ownerEmail: string;
  countryCode: string;
  stripeCustomerId: string | null;
  stripeAccountId: string | null;
}

export interface SubscriptionUpsert {
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  stripePriceId: string;
  status: string;
  storeId: string | null;
  cancelAtPeriodEnd: boolean;
}

// Persistence and identity are supplied by each app at boot via
// registerBillingPorts, so this package stays free of Mongoose model imports.
export interface BillingPorts {
  ledger: LedgerWriterPort;
  claimWebhookEvent(eventId: string, eventType: string): Promise<boolean>;
  releaseWebhookEvent(eventId: string): Promise<void>;
  upsertSubscription(input: SubscriptionUpsert): Promise<void>;
  findSaleByPaymentIntent(paymentIntentId: string): Promise<SaleRef | null>;
  findPlanByPriceId(priceId: string): Promise<PlanRef | null>;
  findSellerStoreForActor(actorId: string): Promise<SellerStoreRef | null>;
  saveStoreBilling(storeId: string, patch: { stripeCustomerId?: string; stripeAccountId?: string }): Promise<void>;
}

let registeredPorts: BillingPorts | null = null;

export function registerBillingPorts(ports: BillingPorts): void {
  registeredPorts = ports;
}

export function getBillingPorts(): BillingPorts {
  if (!registeredPorts) {
    throw new Error('Billing ports are not registered. Call registerBillingPorts at app boot.');
  }
  return registeredPorts;
}
