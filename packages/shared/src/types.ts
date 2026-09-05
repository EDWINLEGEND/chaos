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
 * Payload accepted by POST /webhooks/payment-confirmed
 */
export interface PaymentConfirmedWebhookPayload {
  id?: string;
  eventId?: string;
  type: 'payment-confirmed';
  paymentId: string;
  userId: string;
  amount: number;
}

/**
 * Result returned after processing a payment-confirmed webhook event.
 */
export interface WebhookProcessResult {
  eventId: string;
  orderId: string;
  created: boolean;
  duplicate: boolean;
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

/**
 * External event shape returned by Fake Payment Provider GET /v1/events
 */
export interface PaymentProviderEvent {
  id: string;
  type: 'payment-confirmed';
  paymentId: string;
  userId: string;
  amount: number;
  created: number; // Unix timestamp in seconds
}

/**
 * Internal record shape including delivery metadata
 */
export interface PaymentRecord extends PaymentProviderEvent {
  delivered: boolean;
  lastDeliveryStatus?: number;
  lastAttemptAt?: Date;
}

/**
 * Input for creating a test payment event
 */
export interface CreatePaymentInput {
  userId: string;
  amount: number;
  created?: number;
}

/**
 * Result of delivering a payment event to the checkout webhook
 */
export interface PaymentDeliveryResult {
  delivered: boolean;
  paymentId: string;
  statusCode?: number;
  error?: string;
  response?: unknown;
}

/**
 * Supported Chaos Failure Primitives
 */
export type FailureType =
  | 'api_latency'
  | 'http_500'
  | 'payment_failure'
  | 'payment_latency'
  | 'db_outage'
  | 'db_latency'
  | 'random_failure'
  | 'timeout'
  | 'traffic_surge'
  | 'bad_response';

export type ExperimentTarget = 'acme-checkout' | 'fake-payment-provider';

export type ExperimentStatus = 'pending' | 'running' | 'stopping' | 'completed' | 'failed';

export interface ExperimentParams {
  delayMs?: number;
  latencyMs?: number;
  percentage?: number;
  statusCode?: number;
  durationSeconds?: number;
  concurrency?: number;
  totalRequests?: number;
  malformedPayload?: boolean;
}

export interface Experiment {
  id: string;
  name: string;
  target: ExperimentTarget;
  failureType: FailureType;
  params: ExperimentParams;
  status: ExperimentStatus;
  startedAt?: string;
  endedAt?: string;
  durationSeconds: number;
}

export interface ChaosScenario {
  id: string;
  name: string;
  description: string;
  target: string;
  defaultParams: ExperimentParams;
  status: 'idle' | 'running' | 'completed';
  isPrimary?: boolean;
  activeExperimentId?: string;
}

export interface EnvironmentStatus {
  checkout: 'healthy' | 'degraded' | 'down';
  paymentProvider: 'healthy' | 'degraded' | 'down';
  mongodb: 'healthy' | 'degraded' | 'down';
  activeExperiments: number;
  ordersCount: number;
  webhookEventsCount: number;
  supportingIndexPresent: boolean;
  timestamp: string;
}

export interface ChaosActivityLog {
  id: string;
  timestamp: string;
  type: 'info' | 'warn' | 'error' | 'success';
  message: string;
  experimentId?: string;
}

export interface ChaosControlCommand {
  action: 'ENABLE' | 'DISABLE' | 'CLEAR';
  failureType?: FailureType;
  params?: ExperimentParams;
}

