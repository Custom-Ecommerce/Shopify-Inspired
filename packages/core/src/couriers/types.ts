// Phase 7.1 — Courier Adapter Layer.
//
// These types are the contract every courier integration (PostEx today,
// Leopards/TCS/M&P later — see @/lib/couriers/index.ts's registry) is
// built against. Living here in @markaz/core rather than apps/admin means
// the storefront (or any future app) can construct a ShipmentPayload or
// read a TrackingResult without depending on the admin app itself — only
// the adapters that actually call a courier's API live behind Payload's
// server-only boundary in apps/admin.

export interface ShipmentPayload {
  orderId: string;
  storeId: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  customerCity: string;
  items: { title: string; quantity: number; price: number }[];
  codAmount: number;
  weight?: number;
  instructions?: string;
}

export interface ShipmentResult {
  success: boolean;
  trackingNumber?: string;
  courierOrderId?: string;
  estimatedDelivery?: string;
  error?: string;
}

export interface TrackingResult {
  success: boolean;
  status?: string;
  location?: string;
  events?: { timestamp: string; description: string; location: string }[];
  error?: string;
}

export interface CancelResult {
  success: boolean;
  error?: string;
}

export interface RatePayload {
  originCity: string;
  destinationCity: string;
  weight: number;
  codAmount: number;
}

export interface RateResult {
  success: boolean;
  rate?: number;
  error?: string;
}

// Every courier integration implements this — the registry in
// apps/admin/src/lib/couriers/index.ts hands one of these back by name,
// and callers (order-fulfillment endpoints, admin UI actions) only ever
// talk to the interface, never to a specific courier's adapter class.
export interface CourierAdapter {
  name: string;
  bookShipment(payload: ShipmentPayload): Promise<ShipmentResult>;
  trackShipment(trackingNumber: string): Promise<TrackingResult>;
  cancelShipment(trackingNumber: string): Promise<CancelResult>;
  printLabel(trackingNumber: string): Promise<Buffer>;
  calculateRate(payload: RatePayload): Promise<RateResult>;
}
