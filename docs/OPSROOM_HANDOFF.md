# OpsRoom Handoff Specification

This document defines the exact operational interface, connection contracts, and diagnostic probes required by **OpsRoom** ("the doctor") to monitor, investigate, and remediate the **Chaos** demo environment ("the patient").

---

## 1. Overview & Independence Principle

Chaos runs as a standalone local multi-service system. OpsRoom is an independent diagnostic and remediation agent.

**Core Independence Invariant:**
OpsRoom must discover the root cause and business impact using **only** its standard observational integrations:
1. Querying MongoDB collections (`orders`, `webhook_events`) and execution plans (`explain`).
2. Querying the payment provider API (`GET /v1/events`).
3. Querying the checkout service HTTP endpoints (`POST /webhooks/payment-confirmed`).
4. Inspecting GitHub commit history, PR diffs, and repository metadata.

OpsRoom does **not** rely on Chaos internal activity logs or synthetic experiment tracking.

---

## 2. Integration Connection Contracts

OpsRoom represents system integrations using the standard tuple:
```yaml
kind: <service-kind>
config: <configuration-map>
secret_ref: <credential-reference>
```

The concrete integration contracts for Chaos are:

### Integration 1: MongoDB Database
```yaml
kind: mongodb
config:
  uri: mongodb://localhost:27017/acme
  database: acme
secret_ref: none (unauthenticated local demo)
```

### Integration 2: Payment Provider Gateway
```yaml
kind: payment_provider
config:
  base_url: http://localhost:3002
secret_ref: none (or optional local bearer token)
```

### Integration 3: Checkout HTTP Service
```yaml
kind: checkout_service
config:
  base_url: http://localhost:3001
  webhook_path: /webhooks/payment-confirmed
secret_ref: none
```

### Integration 4: GitHub Repository
```yaml
kind: github
config:
  repository: EDWINLEGEND/chaos
  base_branch: main
  root_cause_pr: 1
secret_ref: github-pat
```

---

## 3. MongoDB Integration Specification

### Connection Parameters
* **URI**: `mongodb://localhost:27017/acme`
* **Database**: `acme`
* **Primary Collections**:
  * `orders`
  * `webhook_events`

### Schema: `orders` Collection
Each order document represents a customer purchase processed by the checkout service.

| Field | Type | Description |
| :--- | :--- | :--- |
| `_id` | `ObjectId` | MongoDB primary key |
| `userId` | `string` | Unique customer identifier (e.g. `user_000123`) |
| `status` | `string` | Order status (`pending`, `completed`, `failed`) |
| `paymentId` | `string` | External payment identifier (e.g. `pay_9a7b...`) |
| `amount` | `number` | Transaction amount in minor currency units |
| `createdAt` | `Date` | Timestamp of order creation |
| `updatedAt` | `Date` | Timestamp of last order update |

### Schema: `webhook_events` Collection
Each document represents an inbound payment-confirmed notification durably recorded before order creation processing.

| Field | Type | Description |
| :--- | :--- | :--- |
| `_id` | `ObjectId` | MongoDB primary key |
| `eventId` | `string` | Unique webhook event identifier (e.g. `evt_...`) |
| `paymentId` | `string` | Associated payment identifier |
| `userId` | `string` | Customer identifier associated with the payment |
| `type` | `string` | Event type constant (`payment-confirmed`) |
| `createdAt` | `Date` | Timestamp event was persisted to MongoDB |

### Key Diagnostic Probe: Execution Plan Analysis
OpsRoom must verify the execution strategy for pending order lookups by running:

```javascript
db.orders.find({
  userId: "<userId>",
  status: "pending"
}).explain("executionStats")
```

#### Expected Probe Result (Incident State)
* **`queryPlanner.winningPlan.stage`**: `COLLSCAN`
* **`executionStats.totalDocsExamined`**: ~500,000 documents
* **`executionStats.executionTimeMillis`**: > 180 ms (single query) / > 800 ms (under concurrent load)
* **Supporting compound index `{ userId: 1, status: 1 }`**: **ABSENT**

---

## 4. Payment Provider Integration Specification

### Base URL
`http://localhost:3002`

### Probe: Payment Event Reconciliation
To count canonical successful payment events and compare against MongoDB:

```http
GET /v1/events?created[gt]=<unix-seconds>
```

#### Example Request:
```bash
curl -s "http://localhost:3002/v1/events?created[gt]=1725500000"
```

#### Response Format:
```json
{
  "object": "list",
  "data": [
    {
      "id": "evt_ca1be45d94e4b0b5",
      "type": "payment-confirmed",
      "paymentId": "pay_ca1be45d94e4b0b5",
      "userId": "user_000123",
      "amount": 5000,
      "created": 1725537600
    }
  ],
  "has_more": false,
  "total": 1200
}
```

#### Reconciliation Invariant:
Under normal operation:
$$\text{Payment Events} == \text{Webhook Events} == \text{Orders Created}$$

Under primary incident divergence:
$$\text{Payment Events} \ge \text{Webhook Events} > \text{Orders Created}$$

---

## 5. Checkout Service Webhook Specification

### Endpoint
`POST http://localhost:3001/webhooks/payment-confirmed`

### Accepted Payload Shape:
```json
{
  "id": "evt_ca1be45d94e4b0b5",
  "type": "payment-confirmed",
  "paymentId": "pay_ca1be45d94e4b0b5",
  "userId": "user_000123",
  "amount": 5000
}
```

### Response Behavior:
* Returns `HTTP 200 OK` with `{"received": true}`.
* In the incident state, timed-out duplicate lookups are swallowed; the response remains `HTTP 200 {"received": true}`, while order creation is silently omitted.

---

## 6. GitHub Integration Specification

### Repository Details
* **Repository**: `EDWINLEGEND/chaos`
* **Canonical Root-Cause PR**: PR #1 (or branch `feat/optimize-duplicate-order-lookup`)
* **Branch**: `feat/optimize-duplicate-order-lookup`
* **Target Base**: `main`
* **PR Title**: `feat(checkout): optimize duplicate order lookup`
* **PR Metadata File**: [`docs/CANONICAL_PR.json`](CANONICAL_PR.json)

### Root-Cause Code Diff
The diff introduces an unindexed MongoDB query:
```diff
+export async function findPendingOrderByUser(userId: string): Promise<OrderDocument | null> {
+  const collection = getOrdersCollection();
+  return collection.findOne({ userId, status: 'pending' });
+}
```
Without adding the necessary compound index `{ userId: 1, status: 1 }` to the `orders` collection.

---

## 7. Expected OpsRoom Remediation Lifecycle

1. **Detection**: OpsRoom compares `payment_provider` events (1,200) vs MongoDB `orders` (~450), flagging severe business divergence.
2. **Diagnosis**:
   * Inspects `webhook_events` and confirms 1,200 webhooks arrived and were stored.
   * Runs `db.orders.find({ userId, status: "pending" }).explain("executionStats")` and observes `COLLSCAN` across 500,000 documents.
   * Queries GitHub API and identifies the merged commit or PR introducing `findPendingOrderByUser`.
3. **Remediation**:
   * OpsRoom creates a fix branch and PR (e.g. `opsroom/rehearsal/add-compound-index`) adding index `{ userId: 1, status: 1 }`.
   * Verifies execution plan changes from `COLLSCAN` to `IXSCAN` (<2 ms).
   * Verifies no further timeouts occur under concurrent load.
4. **Cleanup & Reset**:
   * Operator invokes `pnpm reset` to restore Chaos back to the pristine unindexed baseline for the next rehearsal.
