# Chaos

> Standalone internal demo environment for **OpsRoom**.

## Concept

In the OpsRoom demonstration workflow:
* **Chaos** is the **"patient"** — a real local multi-service environment exhibiting reproducible system states and failure scenarios.
* **OpsRoom** is the **"doctor"** — the external AI diagnostic platform that monitors, investigates evidence, and diagnoses incidents.

---

## Current Status

> [!NOTE]
> **Phase 3 Active**: The core `acme-checkout` domain service and order creation/retrieval API are functional against a real MongoDB 7 instance. The future deliberate webhook timeout bug, load generator, and Chaos UI triggers have **not** been implemented yet and will be added in subsequent phases.

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

## Future Components (Upcoming Phases)

1. **Deliberate Webhook Incident**: Webhook handler with unindexed duplicate-order query triggering COLLSCAN and timeouts.
2. **Payment Gateway Simulator**: Realistic asynchronous webhook dispatcher.
3. **Chaos Engine**: Programmable fault injector.
4. **Load Generator**: Traffic simulation generating steady-state customer checkout flow.
5. **Interactive Control Panel**: Web interface for triggering scenarios.
6. **Operational Scripts**: Active implementations of `seed.ts`, `break.ts`, and `reset.ts`.

---

## Engineering Guidelines

Please read [AGENTS.md](AGENTS.md) for monorepo guidelines, TypeScript standards, and contribution rules.
