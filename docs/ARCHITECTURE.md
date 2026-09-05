# Chaos System Architecture

## Overview

**Chaos** is a standalone internal demonstration system engineered specifically as a target environment for **OpsRoom**.

In the context of the demo:
- **Chaos is the "patient"**: It runs real services, real databases, and reproducible failure modes.
- **OpsRoom is the "doctor"**: It monitors, analyzes evidence, detects regressions/anomalies, and provides diagnostic remediation.

## Monorepo Layout

```
Chaos/
├── apps/
│   ├── checkout/             # Acme checkout HTTP service (hosts future deliberate bug)
│   ├── payment-provider/     # Fake external payment provider HTTP service
│   └── chaos-web/            # Control panel frontend for triggering scenarios
├── packages/
│   └── shared/               # Shared domain interfaces, contracts, and utilities
├── scripts/                  # Operational scripts: seed, break, and reset
├── docker/                   # Docker assets and MongoDB init scripts
├── docs/                     # Architecture & incident documentation
├── docker-compose.yml        # Local orchestration (MongoDB 7)
├── package.json              # Monorepo root config
├── pnpm-workspace.yaml       # pnpm workspace definition
├── tsconfig.json             # TypeScript project references
├── .env.example              # Environment variables template
├── README.md                 # Project guide
└── AGENTS.md                 # Engineering guidelines & contributor rules
```

## Component Roles

### 1. `apps/checkout` (`acme-checkout`)
- A real Node.js/TypeScript HTTP checkout service.
- Connects to MongoDB 7 (`acme` database).
- Exposes order creation, status checking, and payment webhook receivers.
- **Future Role**: This is where the deliberate production incident will live (unsupported query shape on unindexed order lookup during high-traffic webhook processing).

### 2. `apps/payment-provider` (`fake-payment-provider`)
- A lightweight HTTP service acting as an external payment gateway.
- Simulates authorization, capture, and asynchronous webhook notifications (`payment.succeeded`, `payment.failed`) to `acme-checkout`.

### 3. `apps/chaos-web` (`chaos-web`)
- A frontend control panel.
- Allows operators and demo leads to inspect service health and trigger real-time failure scenarios.

### 4. `packages/shared` (`@chaos/shared`)
- Type definitions for `Order`, `PaymentWebhookPayload`, `ServiceHealth`.
- Shared validation and health payload utilities used by all apps.

### 5. `scripts/`
- `seed.ts`: Will populate MongoDB with baseline products, users, and historical orders.
- `break.ts`: Will inject real failure modes.
- `reset.ts`: Will clean database state and return the environment to baseline.

## Database: MongoDB 7
- **Database**: `acme`
- **Future Collections**:
  - `orders`: Stores customer purchase orders.
  - `webhook_events`: Stores raw inbound webhook events from payment providers.
- Local orchestration is defined in `docker-compose.yml` with a persistent named volume `chaos_mongo_data`.
