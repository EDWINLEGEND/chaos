import type { ObjectId } from 'mongodb';

/**
 * Status lifecycle of an Order in the Acme Checkout system.
 */
export type OrderStatus = 'pending' | 'paid' | 'cancelled' | 'failed';

/**
 * Order document shape stored directly in MongoDB `orders` collection.
 * 
 * IMPORTANT: The future duplicate-order lookup will query:
 *   db.orders.findOne({ userId, status: "pending" })
 * There is NO supporting compound index on { userId: 1, status: 1 }.
 */
export interface OrderDocument {
  _id: ObjectId;
  userId: string;
  status: OrderStatus;
  paymentId: string;
  amount: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Input parameters required to create an order.
 * Money amount is represented as minor currency units (e.g. integer cents: 4999 = $49.99).
 */
export interface CreateOrderInput {
  userId: string;
  paymentId: string;
  amount: number;
  status?: OrderStatus;
}

/**
 * Webhook event document shape stored in MongoDB `webhook_events` collection.
 * Used by OpsRoom reconciliation probes to compare received payment events against created orders.
 */
export interface WebhookEventDocument {
  _id: ObjectId;
  eventId: string;
  paymentId: string;
  userId: string;
  type: 'payment-confirmed';
  createdAt: Date;
}

/**
 * Status of a payment transaction from the payment provider.
 */
export type PaymentStatus =
  | 'requires_payment_method'
  | 'processing'
  | 'succeeded'
  | 'failed';

/**
 * Payload sent by payment-provider webhooks to checkout service.
 */
export interface PaymentWebhookPayload {
  eventId: string;
  eventType: 'payment.succeeded' | 'payment.failed';
  paymentId: string;
  orderId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  timestamp: string;
}

/**
 * Standard API response wrapper.
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Database connectivity status.
 */
export interface DatabaseHealth {
  status: 'ok' | 'down';
  database: string;
  latencyMs?: number;
  error?: string;
}

/**
 * Health check response structure.
 */
export interface ServiceHealth {
  status: 'ok' | 'degraded' | 'down';
  service: string;
  uptimeSeconds: number;
  timestamp: string;
  database?: 'ok' | 'down';
  databaseDetails?: DatabaseHealth;
}
