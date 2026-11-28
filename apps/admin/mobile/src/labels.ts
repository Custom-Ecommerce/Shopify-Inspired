const words = (value: string): string => (value ? value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, ' ') : value);

/** "pending" -> "Pending", "not_required" -> "Not required". */
export const label = words;

export const METHOD_LABELS: Record<string, string> = { bank: 'Bank transfer', jazzcash: 'JazzCash', easypaisa: 'Easypaisa', other: 'Other' };

export const PUSH_KIND_LABELS: Record<string, string> = {
  payment_claim: 'Subscription payment claims',
  ticket_new: 'New support tickets',
  sync_failure: 'Sync failures',
};
