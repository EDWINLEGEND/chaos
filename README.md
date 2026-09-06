# Chaos

> Standalone internal demo environment for **OpsRoom**.

## Concept

In the OpsRoom demonstration workflow:
* **Chaos** is the **"patient"** — a real local microservice system that experiences simulated production failures.
* **OpsRoom** is the **"doctor"** — an AI-powered incident response platform that observes, diagnoses, and fixes problems in Chaos.

This repository provides a realistic, self-contained environment for demonstrating OpsRoom's capabilities.

## Current Status

> [!NOTE]
> **Phase 3 Active**: The core `acme-checkout` domain service and order creation/retrieval API are functional against a real MongoDB 7 instance. The future deliberate webhook timeout bug, load generator, and Chaos UI triggers have **not** been implemented yet and will be added in subsequent phases.

---

## Repository Structure

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
├── package.json              # Root workspace manifest
└── pnpm-workspace.yaml       # pnpm workspace definition
```

---

## Getting Started

### Prerequisites

* **Node.js**: `v20+` (developed and tested on `v24.19.0`)
* **pnpm**: `v10+` (or activate via Corepack: `corepack enable`)
* **Docker / Podman**: For running local MongoDB 7

### 1. Clone and Configure

```bash
git clone https://github.com/EDWINLEGEND/chaos.git
cd chaos
cp .env.example .env   # edit as needed for your environment
```

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Verify Setup

```bash
# Type-check the full codebase
pnpm typecheck

# Run the test suites
pnpm test
```

### 4. Development Commands

```bash
# Type-check all packages
pnpm typecheck

# Run all tests
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
* **`http://localhost:3001`** — acme-checkout (order management API)
* **`http://localhost:3002`** — payment-provider (fake gateway)
* **`http://localhost:3000`** — chaos-web (frontend scaffold)

---

## API Reference

### Health Check
```bash
curl http://localhost:3001/health
```

Returns service health including MongoDB connectivity status.

### Create Order
```bash
curl -X POST http://localhost:3001/orders \
  -H "Content-Type: application/json" \
  -d '{"userId": "user_123", "amount": 2999}'
```

Errors:
* `400` — Missing or invalid fields
* `500` — Server error

### List Orders
```bash
curl http://localhost:3001/orders
```

### Get Order by ID
```bash
curl http://localhost:3001/orders/<orderId>
```

---

## Webhook API Reference

> [!IMPORTANT]
> **Baseline Implementation**: The webhook handler currently operates normally. Inbound events are persisted to `webhook_events`, duplicate checks execute against `orders` (indexed on `{userId, status}`), and errors propagate as non-2xx responses. The deliberate timeout and silent error-swallowing behavior is reserved for subsequent phases.

### Payment Confirmed Webhook
**`POST /webhooks/payment-confirmed`**

Simulates an asynchronous notification from an external payment gateway indicating payment success.

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
When no pending order exists for `userId`:
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
When a pending order already exists for `userId`:
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

#### Order Creation Failed (`HTTP 502 Bad Gateway`)
When the order lookup or creation fails (e.g., database timeout under load):
```json
{
  "success": false,
  "error": {
    "code": "ORDER_CREATION_FAILED",
    "message": "Order creation failed: <details>"
  }
}
```
* Payment providers should retry on 502 responses.

#### Missing or Invalid Fields (`HTTP 400 Bad Request`)
```json
{
  "success": false,
  "error": {
    "code": "MISSING_FIELDS",
    "message": "Required fields: id, paymentId, userId, amount"
  }
}
```

---

## Database Indexes

The `init-mongo.js` script creates the following indexes on first container start:

| Collection | Index | Purpose |
|---|---|---|
| `orders` | `{userId: 1, status: 1}` | Duplicate-order lookup in payment-confirmed webhook |
| `webhook_events` | `{eventId: 1}` (unique) | Prevent duplicate event processing |
| `webhook_events` | `{userId: 1}` | Query events by user |

---

## Future Components (Upcoming Phases)

1. **Deliberate Webhook Incident**: Webhook handler with unindexed duplicate-order query triggering COLLSCAN and timeouts.
2. **Payment Gateway Simulator**: Realistic asynchronous webhook dispatcher.
3. **Chaos Engine**: Programmable fault injector (latency, timeouts, query degradation).
4. **Load Generator**: Traffic simulation generating steady-state customer checkout flow.
5. **Interactive Control Panel**: Web interface for triggering failure modes and viewing telemetry.
6. **Operational Scripts**: Active implementations of `seed.ts`, `break.ts`, and `reset.ts`.

---

## License

Internal use only — Acme Corp demo environment.
