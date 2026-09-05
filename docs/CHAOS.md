# Chaos Control Plane & Failure Injection System

This document outlines the architecture, APIs, and operational capabilities of the **Chaos Control Plane** (`apps/chaos-web`) and the target failure interceptors embedded in `acme-checkout` (`apps/checkout`) and `fake-payment-provider` (`apps/payment-provider`).

---

## 1. Overview & Purpose

Chaos is the "patient" environment for OpsRoom ("the doctor"). The Chaos Control Plane provides a unified interface—both a modern web dashboard and a comprehensive REST API—for operators and demo coordinators to:

1. **Observe real-time system telemetry**: Live health status, MongoDB document counts, active experiments, and unindexed schema validation.
2. **Inject targeted failure primitives**: Latency, HTTP 500 error spikes, simulated database outages, payment delivery failures, and query degradation.
3. **Execute reproducible chaos scenarios**: Triggering the primary production silent order loss incident or four additional operational fault modes.
4. **Reset the environment cleanly**: Restoring the 500,000 baseline MongoDB documents, clearing webhooks, verifying absence of compound indexes, resetting provider state, and restoring `AGENTS.md`.

---

## 2. Control Plane Architecture

The control plane comprises three synchronized layers:

```
┌─────────────────────────────────────────────────────────────┐
│                    Chaos Web Dashboard                      │
│             (Glassmorphism UI @ http://localhost:3000)      │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP REST API
┌──────────────────────────────▼──────────────────────────────┐
│                    apps/chaos-web Server                    │
│      - Experiment Registry (bounds enforcement & timers)    │
│      - Scenario Controller (primary break & predefined)     │
│      - Activity Logger (in-memory ring buffer)              │
│      - Environment Status Aggregator                        │
└───────────────┬──────────────────────────────┬──────────────┘
                │ POST /_chaos/control         │ POST /_chaos/control
                │ (loopback-only)              │ (loopback-only)
┌───────────────▼─────────────┐ ┌──────────────▼──────────────┐
│   apps/checkout (:3001)     │ │ apps/payment-provider (:3002)│
│   - ChaosInterceptor        │ │ - PaymentChaosInterceptor   │
│   - Route hooks & delays    │ │ - Delivery hooks & delays   │
│   - DB outage simulation    │ │ - Payment failure injection │
└─────────────────────────────┘ └─────────────────────────────┘
```

### Safety & Guardrails
- **Loopback-Only Control Endpoints**: Target interceptors reject non-loopback clients (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`) with HTTP 403 Forbidden.
- **Parameter Bounds**:
  - Maximum latency: 5,000 ms.
  - Maximum experiment duration: 300 seconds (auto-stop timer attached at creation).
  - Maximum concurrency: 50 workers.
  - Error rates clamped between 1% and 100%.
- **Zero Arbitrary Code Execution**: No arbitrary commands can be passed over the HTTP interface; scenario invocations execute strictly predefined operational routines.

---

## 3. Supported Failure Primitives

| Failure Type | Target | Parameters | Description |
| :--- | :--- | :--- | :--- |
| `api_latency` | `acme-checkout` | `delayMs: number` (0–5000) | Injects artificial delay into checkout HTTP endpoints before handler execution. |
| `http_500` | `acme-checkout` | `percentage: number` (1–100), `statusCode: number` | Intercepts requests and returns structured HTTP 500/5xx error responses at the configured rate. |
| `payment_failure` | `fake-payment-provider` | `percentage: number` (1–100) | Causes payment delivery webhooks to abort with simulated provider delivery failures. |
| `payment_latency` | `fake-payment-provider` | `delayMs: number` (0–5000) | Adds network/processing latency to outgoing webhook deliveries. |
| `db_outage` | `acme-checkout` | none | Simulates complete database unavailability, causing queries to fail with HTTP 503. |
| `db_latency` | `acme-checkout` | `delayMs: number` (0–5000) | Delays all database queries executed by the checkout service. |
| `random_failure` | `acme-checkout` | `percentage: number` (1–100) | Randomly throws transient exceptions across requests. |
| `timeout` | `acme-checkout` | none | Holds connections open until client or gateway timeout threshold is reached. |
| `bad_response` | `acme-checkout` | none | Returns malformed payloads (invalid JSON) to simulate client-side parse errors. |

---

## 4. Predefined Chaos Scenarios

### 1. Checkout Silent Order Loss (`checkout-silent-order-loss`) — *Primary Incident*
- **Target**: `acme-checkout`
- **Description**: Introduces 1,200 concurrent payment webhook requests against 500,000 seeded orders. The missing compound index `{ userId: 1, status: 1 }` forces MongoDB into a `COLLSCAN`, driving duplicate lookup times beyond the 300ms threshold. The webhook handler times out, logs no errors, swallows the rejection, and returns HTTP 200 `{ received: true }`, resulting in silent order loss.
- **Verification**: `pnpm verify:incident` confirms `Payment Events >= Webhook Events > Orders`.

### 2. Payment Provider Outage (`payment-provider-outage`)
- **Target**: `fake-payment-provider`
- **Description**: Triggers combined `payment_failure` (100%) and `payment_latency` (1,000ms) for 45 seconds, simulating an external gateway downtime.

### 3. Checkout API Regression (`checkout-api-regression`)
- **Target**: `acme-checkout`
- **Description**: Injects 50% HTTP 500 error rate with 800ms API latency across all checkout endpoints for 45 seconds.

### 4. Database Degradation (`database-degradation`)
- **Target**: `acme-checkout`
- **Description**: Injects 1,500ms database query latency, simulating severe I/O degradation or lock contention.

### 5. Traffic Surge (`traffic-surge`)
- **Target**: `acme-checkout`
- **Description**: Spawns an instant 35-worker load burst targeting checkout order creation.

---

## 5. REST API Reference

### Health & Telemetry
```http
GET /api/environment
```
**Response:**
```json
{
  "checkout": "healthy",
  "paymentProvider": "healthy",
  "mongodb": "healthy",
  "activeExperiments": 0,
  "ordersCount": 500000,
  "webhookEventsCount": 0,
  "supportingIndexPresent": false,
  "timestamp": "2026-09-05T12:00:20.980Z"
}
```

```http
POST /api/environment/reset
```
Invokes the trusted `pnpm reset` routine, clearing experiments, reseeding 500,000 MongoDB orders, clearing webhooks, ensuring index absence, and restoring the `AGENTS.md` canonical baseline.

---

### Experiments

#### List Experiments
```http
GET /api/experiments
```

#### Create & Start Experiment
```http
POST /api/experiments
Content-Type: application/json

{
  "name": "Slow Down Checkout",
  "target": "acme-checkout",
  "failureType": "api_latency",
  "params": {
    "delayMs": 500
  },
  "durationSeconds": 60
}
```

#### Stop Experiment
```http
POST /api/experiments/:id/stop
```

---

### Scenarios

#### List Scenarios
```http
GET /api/scenarios
```

#### Start Scenario
```http
POST /api/scenarios/:id/start
```

#### Stop Scenario
```http
POST /api/scenarios/:id/stop
```

---

### Activity Feed
```http
GET /api/activity
```
Returns recent system events, experiment lifecycle state transitions, and scenario execution results.
