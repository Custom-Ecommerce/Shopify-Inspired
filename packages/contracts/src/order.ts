import { z } from 'zod';
import { objectIdSchema } from './object-id';

export const orderLineSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().min(1),
  productTitle: z.string().min(1),
  variantTitle: z.string().min(1),
  sku: z.string().nullable().optional(),
  unitPrice: z.number().int().min(0),
  quantity: z.number().int().min(1),
});

/** Order as the dashboard reads it. Money fields are in PKR as Payload stores them. */
export const orderSchema = z.object({
  id: objectIdSchema,
  orderGroupId: z.string().min(1),
  store: objectIdSchema,
  orderId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  status: z.string().min(1),
  paymentMethod: z.string().min(1),
  customerName: z.string().min(1),
  phone: z.string().nullable().optional(),
  secondaryPhone: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  courierName: z.string().nullable().optional(),
  trackingNumber: z.string().nullable().optional(),
  courierOrderId: z.string().nullable().optional(),
  courierBookingId: z.string().nullable().optional(),
  labelUrl: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  items: z.array(orderLineSchema).min(1),
  subtotal: z.number().min(0),
  deliveryCharges: z.number().min(0),
  total: z.number().min(0),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export type OrderLine = z.infer<typeof orderLineSchema>;
export type Order = z.infer<typeof orderSchema>;
