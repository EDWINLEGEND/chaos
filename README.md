# Chaos

> Standalone internal demo environment for **OpsRoom**.

## Concept

In the OpsRoom demonstration workflow:
* **Chaos** is the **"patient"** — a real local multi-service environment exhibiting reproducible system states and failure scenarios.
* **OpsRoom** is the **"doctor"** — the external AI diagnostic platform that monitors, investigates evidence, and diagnoses incidents.

---

## Current Status

> [!NOTE]
> **Phase 9 Active**: The **Chaos Control Plane** (`apps/chaos-web`) is fully operational on `http://localhost:3000`. It features a rich glassmorphism UI and REST API for real-time telemetry, failure injection (latency, 500s, DB outage, payment failure), predefined scenario management (including primary silent order loss and 4 operational scenarios), experiment auto-stop safety timers, activity logging, and one-click environment reset (`pnpm reset`). See [docs/CHAOS.md](docs/CHAOS.md).

---

## High-Level Architecture

The repository is structured as a lightweight TypeScript/pnpm monorepo:

```
Chaos/
├── apps/
│   ├── checkout/             # acme-checkout HTTP service (Order domain & API)
│   ├── payment-provider/     # Fake external payment gateway HTTP service
│   └── chaos-web/            # Frontend control panel scaffold
├── packages/
│   └── shared/               # Shared domain interfaces, contracts, and MongoDB client
├── scripts/                  # Operational scripts: seed, break, reset, check-db
├── docker/                   # Docker assets and MongoDB initialization
├── docs/                     # Architecture documentation
├── docker-compose.yml        # Local orchestration (MongoDB 7)
├── pnpm-workspace.yaml       # Monorepo workspace configuration
├── tsconfig.json             # Root TypeScript project references
├── .env.example              # Environment variable definitions
├── README.md                 # System overview and guide
└── AGENTS.md                 # Engineering guidelines & contributor rules
```

---

## Getting Started

### Prerequisites

* **Node.js**: `v20+` (developed and tested on `v24.19.0`)
* **pnpm**: `v10+` (or activate via Corepack: `corepack enable`)
* **Docker / Podman**: For running local MongoDB 7

### 1. Clone and Configure

```bash
# Copy example environment configuration
cp .env.example .env
```

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Build & Verify Type Checking

```bash
# Build all packages and applications
pnpm build

# Run strict TypeScript validation across the entire workspace
pnpm typecheck
```

### 4. Run Automated Tests

```bash
pnpm test
```

### 5. Start Infrastructure (MongoDB 7)

To run the local MongoDB 7 instance using Docker Compose:

```bash
docker compose up -d mongodb
```

*(Or via Podman)*:
```bash
podman run -d --name chaos-mongodb -p 27017:27017 -e MONGO_INITDB_DATABASE=acme \
  -v chaos_mongo_data:/data/db \
  -v ./docker/mongo/init-mongo.js:/docker-entrypoint-initdb.d/init-mongo.js:ro,z \
  mongo:7.0
```

Verify database connectivity and index configuration:
```bash
pnpm db:check
```

### 6. Start Checkout Service

```bash
# Start checkout service directly
pnpm --filter @chaos/checkout run dev
# or from root concurrently
pnpm dev
```

Service endpoints:
* **Acme Checkout**: `http://localhost:3001` (`http://localhost:3001/health`)
* **Chaos Web**: `http://localhost:3000`
* **Payment Provider**: `http://localhost:3002`
* **MongoDB**: `mongodb://127.0.0.1:27017/acme`

---

## Order API Reference

### Money Representation
All monetary amounts are represented as positive integers in **minor currency units** (e.g. cents in USD) to prevent floating-point inaccuracy:
* `4999` = **$49.99**
* `1000` = **$10.00**
* `250` = **$2.50**

### 1. Create an Order
**`POST /orders`**

Request:
```bash
curl -X POST http://localhost:3001/orders \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_demo_123",
    "paymentId": "pay_stripe_456",
    "amount": 4999
  }'
```

Response (`HTTP 201 Created`):
```json
{
  "success": true,
  "data": {
    "id": "6a9be590df8ffde72c9ffb9a",
    "_id": "6a9be590df8ffde72c9ffb9a",
    "userId": "user_demo_123",
    "paymentId": "pay_stripe_456",
    "amount": 4999,
    "status": "pending",
    "createdAt": "2026-09-05T09:49:04.345Z",
    "updatedAt": "2026-09-05T09:49:04.345Z"
  }
}
```

### 2. Retrieve an Order by ID
**`GET /orders/:id`**

Request:
```bash
curl http://localhost:3001/orders/6a9be590df8ffde72c9ffb9a
```

Response (`HTTP 200 OK`):
```json
{
  "success": true,
  "data": {
    "id": "6a9be590df8ffde72c9ffb9a",
    "_id": "6a9be590df8ffde72c9ffb9a",
    "userId": "user_demo_123",
    "paymentId": "pay_stripe_456",
    "amount": 4999,
    "status": "pending",
    "createdAt": "2026-09-05T09:49:04.345Z",
    "updatedAt": "2026-09-05T09:49:04.345Z"
  }
}
```

Errors:
* Malformed ObjectId: `HTTP 400 Bad Request` (`{"error": {"code": "INVALID_ORDER_ID", ...}}`)
* Non-existent ID: `HTTP 404 Not Found` (`{"error": {"code": "ORDER_NOT_FOUND", ...}}`)

---

## Webhook API Reference

> [!IMPORTANT]
> **Known Failure Mode**: Inbound events are durably persisted to `webhook_events`. Processing then performs an unindexed duplicate check `{ userId, status: "pending" }` against `orders` (which causes a MongoDB `COLLSCAN`). The operation is bounded by `WEBHOOK_TIMEOUT_MS` (default `2000` ms). If the query times out or throws a database error, the error is caught, **completely swallowed without logging**, and returns `HTTP 200 {"received": true}`. The order is **not** created, creating a silent divergence between recorded webhook events and created orders.

### Payment Confirmed Webhook
**`POST /webhooks/payment-confirmed`**

Simulates an asynchronous notification from an external payment gateway indicating payment success.

#### Environment Configuration
* `WEBHOOK_TIMEOUT_MS`: Milliseconds to wait before timing out the duplicate-order lookup and order creation process (default: `2000`).

#### Request
```bash
curl -X POST http://localhost:3001/webhooks/payment-confirmed \
  -H "Content-Type: application/json" \
  -d '{
    "id": "evt_stripe_1001",
    "type": "payment-confirmed",
    "paymentId": "pay_stripe_2002",
    "userId": "user_demo_123",
    "amount": 4999
  }'
```

#### Successful Order Creation (`HTTP 200 OK`)
When no pending order exists for `userId` and the query completes within `WEBHOOK_TIMEOUT_MS`:
```json
{
  "success": true,
  "data": {
    "eventId": "evt_stripe_1001",
    "orderId": "6a9be6f707ea45570ead4c84",
    "created": true,
    "duplicate": false
  }
}
```

#### Duplicate Delivery Handling (`HTTP 200 OK`)
When a pending order already exists for `userId` and the query completes within `WEBHOOK_TIMEOUT_MS`:
```json
{
  "success": true,
  "data": {
    "eventId": "evt_stripe_1002",
    "orderId": "6a9be6f707ea45570ead4c84",
    "created": false,
    "duplicate": true
  }
}
```
* Note: The duplicate event is still durably recorded in `webhook_events` for reconciliation probes, but no second order is created in `orders`.

#### Timeout / Swallowed Error Path (`HTTP 200 OK`)
When the unindexed duplicate lookup exceeds `WEBHOOK_TIMEOUT_MS` (e.g. under load or slow query conditions) or fails:
```json
{
  "received": true
}
```
* The event was persisted to `webhook_events`.
* The order was **never created** in `orders`.
* The payment provider receives `HTTP 200` so it will **not** retry delivery.
* No internal error is leaked to the client and no error is logged to `console.error`.
* This causes silent divergence: `count(webhook_events) > count(orders)`.

---

## Payment Provider API Reference

The fake payment provider (`apps/payment-provider`) simulates an external payment gateway (like Stripe) for OpsRoom demo reconciliation.

In the eventual incident scenario:
* **Payment provider believes**: payment-confirmed event was successfully delivered (`HTTP 200`).
* **Acme Checkout**: webhook was received and durably written to `webhook_events`.
* **Acme Orders**: order was **not created** due to unindexed COLLSCAN query timeout.
* **Result**: `Payments (1200) == Webhook Events (1200) > Orders (1180)`.

### Environment Configuration
* `PAYMENT_PROVIDER_PORT`: Port to listen on (default: `3002`).
* `CHECKOUT_WEBHOOK_URL`: Target URL for delivering payment webhooks (default: `http://127.0.0.1:3001/webhooks/payment-confirmed`).
* `PAYMENT_STORE_FILE`: Optional file path for persisting demo payment records across restarts (e.g., `data/payments.json`).

### 1. List Payment Events (Reconciliation Endpoint)
**`GET /v1/events`**

Query parameters:
* `created[gt]=<timestamp>`: Optional Unix timestamp in seconds. Returns only events created strictly after this timestamp.

Request:
```bash
curl -g "http://localhost:3002/v1/events?created[gt]=1750000000"
```

Response (`HTTP 200 OK`):
```json
{
  "data": [
    {
      "id": "evt_0f693a14532f7317",
      "type": "payment-confirmed",
      "paymentId": "pay_0f693a14532f7317",
      "userId": "user-123",
      "amount": 4999,
      "created": 1788603472
    }
  ],
  "count": 1
}
```

### 2. Create Test Payment
**`POST /v1/test/payments`**

Generates a deterministic test payment event in the provider store without immediately delivering it.

Request:
```bash
curl -X POST http://localhost:3002/v1/test/payments \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user-123",
    "amount": 4999
  }'
```

Response (`HTTP 201 Created`):
```json
{
  "id": "evt_0f693a14532f7317",
  "type": "payment-confirmed",
  "paymentId": "pay_0f693a14532f7317",
  "userId": "user-123",
  "amount": 4999,
  "created": 1788603472
}
```

### 3. Deliver Payment Event to Checkout Webhook
**`POST /v1/test/payments/:paymentId/deliver`**

Dispatches an HTTP POST request carrying the payment event to the configured `CHECKOUT_WEBHOOK_URL`.

Request:
```bash
curl -X POST http://localhost:3002/v1/test/payments/pay_0f693a14532f7317/deliver
```

Response on Successful Webhook Receipt (`HTTP 200 OK`):
```json
{
  "success": true,
  "delivered": true,
  "paymentId": "pay_0f693a14532f7317",
  "statusCode": 200,
  "response": {
    "success": true,
    "data": {
      "eventId": "evt_0f693a14532f7317",
      "orderId": "6a9bec55ba538657b7b516eb",
      "created": true,
      "duplicate": false
    }
  }
}
```

Response on Swallowed Timeout Delivery (`HTTP 200 OK`):
```json
{
  "success": true,
  "delivered": true,
  "paymentId": "pay_0f693a14532f7317",
  "statusCode": 200,
  "response": {
    "received": true
  }
}
```
* Note: Because checkout returns `HTTP 200 {"received": true}`, the provider records successful delivery (`delivered: true`) and does not retry, establishing the silent data divergence.

---

## Operator Incident Runbook (`pnpm seed` & `pnpm break`)

The complete production incident can be rehearsed locally in four steps:

### Step 1: Seed 500,000 Orders
```bash
pnpm seed
```
* Safely clears existing `orders` and `webhook_events`.
* Generates 500,000 valid orders across 25,000 users in 50 chunks of 10,000.
* Confirms only primary key `_id_` index exists (`{ userId: 1, status: 1 }` is absent).
* Verifies `COLLSCAN` execution plan on `{ userId, status: "pending" }`.

### Step 2: Benchmark Unindexed Query
```bash
pnpm benchmark:query
```
* Measures execution metrics across multiple iterations against the 500,000 order dataset.
* **Empirical Baseline**:
  * Plan: `COLLSCAN`
  * Documents examined: `500,000`
  * Single-query latency: **~185 ms - 200 ms**
  * Saturated multi-worker latency: **~900 ms - 1500 ms**

### Step 3: Trigger Incident via Load Generator
```bash
# Start background services first:
pnpm dev

# In a separate terminal, trigger the incident load:
pnpm break
```
* Configurable via environment variables:
  * `BREAK_TOTAL_REQUESTS`: Number of payment events / webhooks to generate (default: `1200`).
  * `BREAK_CONCURRENCY`: Worker pool concurrency (default: `50`).
* Registers 1,200 real payment events with the fake payment provider.
* Fires 1,200 concurrent webhook deliveries to `POST /webhooks/payment-confirmed`.
* 50 concurrent `COLLSCAN` queries saturate MongoDB execution queue, pushing query latencies above `WEBHOOK_TIMEOUT_MS` (800ms).
* Queries that time out return `HTTP 200 {"received": true}` and skip order creation.
* Normal queries complete within 800ms and create orders.

### Step 4: Verify Incident & Business Divergence
```bash
pnpm verify:incident
```
Compares systems of record:
* **Payment Provider Events**: `1,200`
* **Webhook Events Recorded**: `1,200` (Payment → Webhook Gap = 0)
* **Orders Created**: `~310 - 350`
* **Divergence (Webhook → Order Gap)**: `~850 - 890` silent timeouts

### Step 5: Reset Environment for Next Rehearsal
```bash
pnpm reset
```
Restores the demo environment back to clean baseline:
* Clears payments and orders, drops extraneous indexes, and reseeds 500,000 orders.
* Restores pristine `AGENTS.md` rules.
* Cleans rehearsal PRs and branches on GitHub matching `opsroom/*`.
* Preserves canonical root-cause PR.

---

## Chaos Control Plane & Web Dashboard (`apps/chaos-web`)

The Chaos Control Plane runs on port `3000` (`http://localhost:3000`) and provides an interactive, operator-friendly interface for managing incidents:

```bash
# Start the Chaos Web Control Plane:
pnpm --filter @chaos/chaos-web dev
```

### Dashboard Features
* **Real-Time Telemetry Polling**: Displays service health (`acme-checkout`, `fake-payment-provider`, `mongodb`), order counts, webhook counts, and validates the intentional absence of the `{ userId, status }` index.
* **Predefined Chaos Scenarios**:
  1. `Checkout Silent Order Loss` (*Primary Incident*): Drives 1,200 concurrent webhooks against 500k orders to reproduce the silent timeout and divergence.
  2. `Payment Provider Outage`: Injects 100% payment delivery failure + 1,000ms latency on the payment gateway.
  3. `Checkout API Regression`: Injects 50% HTTP 500 errors with 800ms latency on order endpoints.
  4. `Database Degradation`: Injects 1,500ms database query latency on checkout operations.
  5. `Traffic Surge`: Spawns a 35-worker load spike against checkout endpoints.
* **Custom Failure Experiment Injection**: Injects targeted primitives (`api_latency`, `http_500`, `payment_failure`, `payment_latency`, `db_outage`, `db_latency`, `random_failure`, `timeout`, `bad_response`) with safe parameter bounds and auto-stop duration timers.
* **One-Click Environment Reset**: Invokes `pnpm reset` directly from the dashboard to reseed 500,000 orders, clear webhooks, reset payments, and restore `AGENTS.md`.
* **Activity Feed**: Real-time event log tracking experiment states and scenario progress.

See [docs/CHAOS.md](docs/CHAOS.md) for full REST API specifications and architecture details.

---

## Engineering Guidelines

Please read [AGENTS.md](AGENTS.md) for monorepo guidelines, TypeScript standards, and contribution rules.

