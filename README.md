# Chaos

> Standalone internal demo environment for **OpsRoom**.

## Concept

In the OpsRoom demonstration workflow:
* **Chaos** is the **"patient"** — a real local multi-service environment exhibiting reproducible system states and failure scenarios.
* **OpsRoom** is the **"doctor"** — the external AI diagnostic platform that monitors, investigates evidence, and diagnoses incidents.

---

## Current Status

> [!NOTE]
> **Foundation Phase**: This repository currently contains the foundational architecture, shared type contracts, application scaffolding, operational script stubs, and Docker Compose definitions. The deliberate production incident, load generator, and live scenario triggers have **not** been implemented yet and will be added in subsequent phases.

---

## High-Level Architecture

The repository is structured as a lightweight TypeScript/pnpm monorepo:

```
Chaos/
├── apps/
│   ├── checkout/             # acme-checkout HTTP service
│   ├── payment-provider/     # Fake external payment gateway HTTP service
│   └── chaos-web/            # Frontend control panel scaffold
├── packages/
│   └── shared/               # Shared domain interfaces, contracts, and helpers
├── scripts/                  # Operational scripts: seed, break, reset (stubs)
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

## Future Components

The following components will be introduced in future phases:
1. **Deliberately-Broken Checkout Logic**: Webhook handler with unindexed query patterns under MongoDB 7.
2. **Payment Gateway Simulator**: Realistic asynchronous webhook dispatcher.
3. **Chaos Engine**: Programmable fault injector (latency, timeouts, query degradation).
4. **Load Generator**: Traffic simulation generating steady-state customer checkout flow.
5. **Interactive Control Panel**: Web interface for triggering failure modes and viewing telemetry.
6. **Operational Scripts**: Active implementations of `seed.ts`, `break.ts`, and `reset.ts`.

---

## Getting Started

### Prerequisites

* **Node.js**: `v20+` (developed and tested on `v24.19.0`)
* **pnpm**: `v10+` (or activate via Corepack: `corepack enable`)
* **Docker & Docker Compose**: For running local MongoDB 7

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

### 5. Start Infrastructure (Docker)

To run the local MongoDB 7 instance:

```bash
docker compose up -d mongodb
```

### 6. Start Applications in Development Mode

```bash
# Runs checkout, payment-provider, and chaos-web concurrently
pnpm dev
```

Service endpoints:
* **Chaos Web**: `http://localhost:3000`
* **Acme Checkout**: `http://localhost:3001` (`http://localhost:3001/health`)
* **Payment Provider**: `http://localhost:3002` (`http://localhost:3002/health`)
* **MongoDB**: `mongodb://localhost:27017/acme`

---

## Engineering Guidelines

Please read [AGENTS.md](AGENTS.md) for monorepo guidelines, TypeScript standards, and contribution rules.
