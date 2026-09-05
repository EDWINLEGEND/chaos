/**
 * Status lifecycle of an Order in the Acme Checkout system.
 */
export type OrderStatus = 'pending' | 'confirmed' | 'failed' | 'cancelled';

/**
 * Core Order representation stored in MongoDB `orders` collection.
 */
export interface Order {
  id: string;
  orderNumber: string;
  customerEmail: string;
  amount: number;
  currency: string;
  status: OrderStatus;
  paymentId?: string;
  createdAt: Date;
  updatedAt: Date;
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
 * Recorded webhook event stored in MongoDB `webhook_events` collection.
 */
export interface WebhookEventRecord {
  id: string;
  eventId: string;
  eventType: string;
  payload: PaymentWebhookPayload;
  processed: boolean;
  receivedAt: Date;
  error?: string;
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
 * Health check response structure.
 */
export interface ServiceHealth {
  status: 'ok' | 'degraded' | 'down';
  service: string;
  uptimeSeconds: number;
  timestamp: string;
}
