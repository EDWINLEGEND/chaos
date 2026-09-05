# Chaos Live Demo Runbook

A step-by-step operational guide for running rehearsals and live demonstrations of **Chaos** with **OpsRoom**.

---

## 1. Pre-Demo Setup

Run the clean-slate preparation:
```bash
# 1. Ensure local dependencies are up to date
pnpm install

# 2. Build monorepo packages
pnpm build

# 3. Ensure MongoDB 7 is running
docker compose up -d mongodb

# 4. Reset the environment to pristine baseline
pnpm reset
```

---

## 2. Clean-State Verification

Verify the baseline state before opening the demo:
```bash
pnpm db:check
```

Confirm the following output criteria:
* Connection to MongoDB: **SUCCESS**
* `orders` count: **500,000**
* `webhook_events` count: **0**
* Compound index `{ userId: 1, status: 1 }`: **ABSENT**
* Single unindexed query explain stage: **COLLSCAN**

---

## 3. Service Startup

### Option A: Local Process Execution (Recommended for Fast Rehearsal)
Open a terminal and start all services concurrently:
```bash
pnpm dev
```
This boots:
* `apps/chaos-web` on `http://localhost:3000`
* `apps/checkout` on `http://localhost:3001`
* `apps/payment-provider` on `http://localhost:3002`

### Option B: Docker Compose
```bash
docker compose up -d
```

---

## 4. Chaos Dashboard Navigation

1. Open your browser and navigate to:
   **`http://localhost:3000`**
2. Confirm the top status bar:
   * **Checkout**: Green dot (`healthy`)
   * **Payment Provider**: Green dot (`healthy`)
   * **MongoDB**: Green dot (`healthy`)
   * **Orders**: `500,000`
   * **Active Experiments**: `0 ACTIVE`
   * **Schema Warning Badge**: `Index Absent (COLLSCAN)`

---

## 5. Triggering the Primary Incident

### Via Web UI:
1. In the **Incident Scenarios** section, locate the top card:
   **Checkout Silent Order Loss** (*Primary Incident*).
2. Click the **`🔥 Trigger Primary Incident`** button.
3. The button updates to show progress: `⏳ Incident In Progress (Executing Load)...`.
4. Observe the **Activity Log** stream events:
   * `[Primary Incident] Concurrent webhook load generator starting (50 workers, 1200 requests)...`
   * `[Primary Incident] Concurrent webhook run completed. Silent order loss reproduced.`

### Via CLI Alternative:
In a separate terminal:
```bash
pnpm break
```

---

## 6. What OpsRoom Should Independently Observe

While Chaos is under load or immediately following the run, OpsRoom will observe:

1. **Reconciliation Divergence**:
   ```bash
   pnpm verify:incident
   ```
   * **Payment Provider Events**: `1,200`
   * **Webhook Events Recorded**: `1,200`
   * **Orders Created**: `~450 - 480`
   * **Silent Loss (Divergence Gap)**: `~720 - 750` missing orders

2. **Database Execution Bottleneck**:
   Querying `db.orders.find({ userId: "...", status: "pending" }).explain("executionStats")` reveals:
   * Execution stage: **`COLLSCAN`**
   * Documents scanned: **500,000**
   * Execution time under load: **> 800 ms** (exceeding webhook timeout threshold)

3. **Silent Failure Behavior**:
   * Checkout service returned `HTTP 200 {"received": true}` for all 1,200 webhooks.
   * No application 500 error logs or metrics were emitted.

4. **GitHub Commit History**:
   OpsRoom's GitHub agent locates the commit/PR (`feat(checkout): optimize duplicate order lookup`) on `EDWINLEGEND/chaos` that introduced the duplicate order lookup without an index.

---

## 7. Recovery & Rehearsal Reset

Once OpsRoom completes diagnosis and verification, restore the environment for the next rehearsal run:

### Via Web UI:
Click the **`🔄 Reset Environment`** button in the top action bar.

### Via CLI:
```bash
pnpm reset
```

Execution will:
1. Stop all active Chaos experiments.
2. Reseed MongoDB back to exactly 500,000 orders.
3. Drop any remediation indexes added during the rehearsal.
4. Clear `webhook_events` to 0.
5. Reset the payment provider memory store to 0 events.
6. Revert `AGENTS.md` back to the pristine 10 rules.
7. Clean any rehearsal PRs/branches created on GitHub.

---

## 8. Emergency Troubleshooting

### Issue 1: MongoDB Becomes Unhealthy or Connection Fails
* **Symptom**: `fetch failed` or `MongoServerSelectionError` in logs.
* **Remedy**:
  ```bash
  docker compose restart mongodb
  pnpm db:check
  ```

### Issue 2: Payment Provider Port Conflict
* **Symptom**: `EADDRINUSE: address already in use :::3002`.
* **Remedy**:
  ```bash
  lsof -ti:3002 | xargs kill -9
  pnpm --filter @chaos/payment-provider start
  ```

### Issue 3: Incident Does Not Diverge (Zero Timeouts)
* **Symptom**: 1,200 orders created with 0 timeouts.
* **Root Causes & Fixes**:
  1. A supporting compound index was accidentally created. Check with `pnpm db:check` and run `pnpm reset` to drop it.
  2. Dataset is too small (<500k orders). Run `pnpm seed` to repopulate.
  3. Machine has extreme CPU throughput. Increase concurrency:
     ```bash
     BREAK_CONCURRENCY=60 pnpm break
     ```

### Issue 4: Reset Partially Fails
* **Symptom**: Reset reports errors connecting to payment provider.
* **Remedy**: Ensure payment-provider service is running, or verify that `pnpm reset` safely removes `data/payments.json` on disk.
