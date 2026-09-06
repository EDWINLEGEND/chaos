// MongoDB initialization script for the Chaos demo environment
// Runs on first container start via /docker-entrypoint-initdb.d/

// Ensure the acme database exists
db = db.getSiblingDB('acme');

// Create collections with sensible defaults
if (!db.getCollectionInfos({ name: 'orders' }).length) {
  db.createCollection('orders', { capped: false });
}
if (!db.getCollectionInfos({ name: 'webhook_events' }).length) {
  db.createCollection('webhook_events', { capped: false });
}

// ── Orders indexes ──────────────────────────────────────────────
// Compound index for the duplicate-order lookup in the payment-confirmed webhook.
// The handler queries { userId, status: "pending" } on every inbound event.
db.orders.createIndex(
  { userId: 1, status: 1 },
  { name: 'idx_orders_user_status', background: true }
);

// ── Webhook events indexes ──────────────────────────────────────
// Unique index to prevent duplicate event processing
db.webhook_events.createIndex(
  { eventId: 1 },
  { unique: true, name: 'idx_webhook_events_event_id' }
);

// Index for querying events by user
db.webhook_events.createIndex(
  { userId: 1 },
  { name: 'idx_webhook_events_user_id' }
);

print('✅ Database initialization complete – indexes created on acme.orders and acme.webhook_events');
